const http = require("http");

const TARGET_URL = process.argv[2] || "http://localhost:3333/skalito-svg.html";
const CDP_PORT = Number(process.env.CDP_PORT || 9222);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpJson(path, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: CDP_PORT, path, method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${path}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error(`Timeout reading ${path}`));
    });
    req.end();
  });
}

async function connectCdp() {
  let target;
  try {
    target = await httpJson(`/json/new?${encodeURIComponent("about:blank")}`, "PUT");
  } catch (_error) {
    const targets = await httpJson("/json/list");
    target = targets.find((item) => item.type === "page");
  }
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("No page WebSocket target available from Chrome DevTools Protocol");
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const callbacks = new Map();
  const events = [];
  const consoleMessages = [];

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && callbacks.has(message.id)) {
      const { resolve, reject } = callbacks.get(message.id);
      callbacks.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    events.push(message);
    if (message.method === "Runtime.consoleAPICalled") {
      consoleMessages.push({
        type: message.params.type,
        args: message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" ")
      });
    }
    if (message.method === "Runtime.exceptionThrown") {
      consoleMessages.push({
        type: "exception",
        args: message.params.exceptionDetails.text
      });
    }
  });

  function send(method, params = {}) {
    const messageId = ++id;
    ws.send(JSON.stringify({ id: messageId, method, params }));
    return new Promise((resolve, reject) => {
      callbacks.set(messageId, { resolve, reject });
      setTimeout(() => {
        if (callbacks.has(messageId)) {
          callbacks.delete(messageId);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 10000);
    });
  }

  function waitForEvent(method, timeoutMs = 10000) {
    const existing = events.find((event) => event.method === method);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const found = events.find((event) => event.method === method);
        if (found) {
          clearInterval(timer);
          resolve(found);
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for ${method}`));
        }
      }, 50);
    });
  }

  async function evaluate(expression, awaitPromise = true) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text);
    }
    return result.result.value;
  }

  return { ws, send, waitForEvent, evaluate, consoleMessages };
}

function pass(value) {
  return value ? "PASS" : "FAIL";
}

async function run() {
  const cdp = await connectCdp();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.navigate", { url: TARGET_URL });
  await cdp.waitForEvent("Page.loadEventFired");
  await sleep(2600);

  const baseState = await cdp.evaluate("window.skalitoDiagnostics?.getState?.()");
  const assetsPass = baseState?.assets === "PASS";
  const heartbeatPass = Number(baseState?.heartbeat || 0) >= 1;
    const rafMatch = String(baseState?.raf || "").match(/(\d+)\s*FPS/);
  const rafFps = rafMatch ? Number(rafMatch[1]) : 0;

  const stateResults = {};
  for (const state of ["static", "idle", "thinking", "talking", "happy", "alert"]) {
    await cdp.evaluate(`document.querySelector('[data-state="${state}"]').click()`);
    await sleep(state === "static" ? 250 : 800);
    const measured = await cdp.evaluate(`(() => {
      const mascot = document.getElementById("mascot");
      const head = mascot.querySelector("#head");
      const root = mascot.querySelector(".skalito-root");
      return {
        mode: mascot.getAttribute("state"),
        className: mascot.className,
        headTransform: getComputedStyle(head).transform,
        rootTransform: getComputedStyle(root).transform
      };
    })()`);
    const expectedMode = measured.mode === state;
    const animated = state === "static"
      ? true
      : [measured.headTransform, measured.rootTransform].some((value) => value && value !== "none" && value !== "matrix(1, 0, 0, 1, 0, 0)");
    stateResults[state] = { pass: expectedMode && animated, measured };
  }

  const eventResults = {};
  await cdp.evaluate(`document.querySelector('[data-state="static"]').click()`);
  await sleep(150);
  for (const item of [
    ["blink", "blink", "#eye-left"],
    ["flapWings", "wingFlap", "#wing-left"],
    ["wave", "wave", "#arm-left"],
    ["point", "point", "#arm-left"],
    ["celebrate", "celebrate", ".skalito-root"]
  ]) {
    const [buttonEvent, label, selector] = item;
    await cdp.evaluate(`document.querySelector('[data-event="${buttonEvent}"]').click()`);
    await sleep(buttonEvent === "blink" ? 180 : 240);
    const measured = await cdp.evaluate(`(() => {
      const mascot = document.getElementById("mascot");
      const el = mascot.querySelector("${selector}");
      return {
        className: mascot.className,
        mode: mascot.getAttribute("state"),
        transform: getComputedStyle(el).transform,
        animationName: getComputedStyle(el).animationName
      };
    })()`);
    const hasEventClass = String(measured.className).includes("skalito-event-");
    const hasAnimation = measured.animationName && measured.animationName !== "none";
    const hasTransform = measured.transform && measured.transform !== "none" && measured.transform !== "matrix(1, 0, 0, 1, 0, 0)";
    eventResults[label] = { pass: hasEventClass && (hasAnimation || hasTransform), measured };
    await sleep(1200);
  }

  await cdp.evaluate(`document.getElementById("headProbeToggle").click()`);
  await sleep(650);
  const minimalHead = await cdp.evaluate(`(() => {
    const head = document.getElementById("mascot").querySelector("#head");
    return getComputedStyle(head).transform;
  })()`);
  await cdp.evaluate(`document.getElementById("headProbeToggle").click()`);

  const isolatedResults = {};
  for (const group of ["head", "eyes", "arm-left", "arm-right", "wing-left", "wing-right", "tail"]) {
    await cdp.evaluate(`(() => { const s=document.getElementById("isolatedGroupSelect"); s.value="${group}"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(650);
    const selector = group === "eyes" ? "#eye-left" : group === "tail" ? "#body" : `#${group}`;
    const transform = await cdp.evaluate(`getComputedStyle(document.getElementById("mascot").querySelector("${selector}")).transform`);
    isolatedResults[group] = transform && transform !== "none" && transform !== "matrix(1, 0, 0, 1, 0, 0)";
  }
  await cdp.evaluate(`(() => { const s=document.getElementById("isolatedGroupSelect"); s.value=""; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);

  await cdp.evaluate(`(() => { document.getElementById("gpuSafeToggle").click(); document.querySelector('[data-state="idle"]').click(); })()`);
  await sleep(900);
  const gpuSafe = await cdp.evaluate(`(() => {
    const mascot = document.getElementById("mascot");
    const head = mascot.querySelector("#head");
    return {
      active: document.body.classList.contains("skalito-gpu-safe-mode"),
      mode: mascot.getAttribute("state"),
      transform: getComputedStyle(head).transform
    };
  })()`);

  const finalState = await cdp.evaluate("window.skalitoDiagnostics.getState()");
  cdp.ws.close();

  const consoleErrors = cdp.consoleMessages.filter((msg) => ["error", "exception"].includes(msg.type));
  const result = {
    jsHeartbeat: pass(heartbeatPass),
    rafReal: rafFps ? `${rafFps} FPS` : "FAIL",
    idle: pass(stateResults.idle.pass),
    thinking: pass(stateResults.thinking.pass),
    talking: pass(stateResults.talking.pass),
    happy: pass(stateResults.happy.pass),
    alert: pass(stateResults.alert.pass),
    blink: pass(eventResults.blink.pass),
    wingFlap: pass(eventResults.wingFlap.pass),
    wave: pass(eventResults.wave.pass),
    point: pass(eventResults.point.pass),
    celebrate: pass(eventResults.celebrate.pass),
    domTransforms: pass(
      stateResults.idle.pass &&
      eventResults.wave.pass &&
      minimalHead &&
      minimalHead !== "none"
    ),
    gpuSafeMode: pass(
      gpuSafe.active &&
      gpuSafe.mode === "idle" &&
      gpuSafe.transform &&
      gpuSafe.transform !== "none" &&
      gpuSafe.transform !== "matrix(1, 0, 0, 1, 0, 0)"
    ),
    consoleErrors,
    assets404: pass(assetsPass),
    details: {
      baseState,
      finalState,
      stateResults,
      eventResults,
      minimalHead,
      isolatedResults,
      gpuSafe
    }
  };

  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
