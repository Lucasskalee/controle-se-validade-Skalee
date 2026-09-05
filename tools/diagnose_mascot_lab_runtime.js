const http = require("http");

const TARGET_URL = process.argv[2] || "http://localhost:3333/skalito-svg";
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
    req.setTimeout(5000, () => req.destroy(new Error(`Timeout reading ${path}`)));
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
        if (!callbacks.has(messageId)) return;
        callbacks.delete(messageId);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);
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

  return { ws, send, evaluate, consoleMessages };
}

(async () => {
  const page = await connectCdp();
  const { ws, send, evaluate, consoleMessages } = page;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send("Page.navigate", { url: TARGET_URL });
  await sleep(2500);

  const base = await evaluate(`(() => ({
    title: document.title,
    hasMascot: !!document.querySelector("#mascot"),
    status: document.querySelector(".status-text")?.textContent || "",
    headLoaded: document.querySelector("#mascotHead")?.complete === true,
    headFlameLoaded: document.querySelector("#mascotHeadFlame")?.complete === true,
    bodyLoaded: document.querySelector("#mascotBody")?.complete === true,
    tailLoaded: document.querySelector("#mascotBodyTail")?.complete === true
  }))()`);

  const rafFps = await evaluate(`new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    function tick(now) {
      frames += 1;
      if (now - start >= 1000) resolve(frames);
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })`);

  const tailWave = await evaluate(`(() => {
    const tail = document.querySelector("#mascotBodyTail");
    if (!tail) return { pass: false, reason: "missing tail layer" };
    const style = getComputedStyle(tail);
    return {
      pass: tail.complete === true && style.animationName.includes("energyTailWave"),
      loaded: tail.complete === true,
      animationName: style.animationName,
      transform: style.transform,
      transformOrigin: style.transformOrigin
    };
  })()`);

  const headFlameWave = await evaluate(`(() => {
    const flame = document.querySelector("#mascotHeadFlame");
    if (!flame) return { pass: false, reason: "missing head flame layer" };
    const style = getComputedStyle(flame);
    return {
      pass: flame.complete === true && style.animationName.includes("headFlameWave"),
      loaded: flame.complete === true,
      animationName: style.animationName,
      transform: style.transform,
      transformOrigin: style.transformOrigin
    };
  })()`);

  async function clickAndMeasure(buttonId, probeSelector, expectedClass, waitMs = 180) {
    return evaluate(`(async () => {
      const button = document.querySelector("${buttonId}");
      const mascot = document.querySelector("#mascot");
      const probe = document.querySelector("${probeSelector}");
      if (!button || !mascot || !probe) return { pass: false, reason: "missing DOM" };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, ${waitMs}));
      const style = getComputedStyle(probe);
      const classPresent = mascot.classList.contains("${expectedClass}") || probe.classList.contains("${expectedClass}");
      return {
        pass: classPresent || style.animationName !== "none" || style.transform !== "none",
        mascotClass: mascot.className,
        probeClass: probe.className,
        animationName: style.animationName,
        transform: style.transform,
        status: document.querySelector(".status-text")?.textContent || ""
      };
    })()`);
  }

  async function clickEyeExpression(buttonId, expectedExpression, waitMs = 120) {
    return evaluate(`(async () => {
      const button = document.querySelector("${buttonId}");
      const leftEye = document.querySelector("#eyeLeft");
      const rightEye = document.querySelector("#eyeRight");
      if (!button || !leftEye || !rightEye) return { pass: false, reason: "missing eye DOM" };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, ${waitMs}));
      return {
        pass:
          leftEye.dataset.expression === "${expectedExpression}" &&
          rightEye.dataset.expression === "${expectedExpression}" &&
          leftEye.currentSrc.includes("eyes-${expectedExpression}-left.png") &&
          rightEye.currentSrc.includes("eyes-${expectedExpression}-right.png"),
        leftExpression: leftEye.dataset.expression || "",
        rightExpression: rightEye.dataset.expression || "",
        leftSrc: leftEye.currentSrc.split("/").pop(),
        rightSrc: rightEye.currentSrc.split("/").pop()
      };
    })()`);
  }

  async function triggerBlinkFromAlert() {
    return evaluate(`(async () => {
      const alertButton = document.querySelector("#btnEyeAlert");
      const blinkButton = document.querySelector("#btnBlink");
      const leftEye = document.querySelector("#eyeLeft");
      const rightEye = document.querySelector("#eyeRight");
      if (!alertButton || !blinkButton || !leftEye || !rightEye) return { pass: false, reason: "missing blink DOM" };
      alertButton.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      blinkButton.click();
      await new Promise((resolve) => setTimeout(resolve, 70));
      const duringBlink = {
        leftExpression: leftEye.dataset.expression || "",
        rightExpression: rightEye.dataset.expression || "",
        classPresent: leftEye.classList.contains("is-blinking") || rightEye.classList.contains("is-blinking"),
        leftSrc: leftEye.currentSrc.split("/").pop(),
        rightSrc: rightEye.currentSrc.split("/").pop()
      };
      await new Promise((resolve) => setTimeout(resolve, 180));
      const afterBlink = {
        leftExpression: leftEye.dataset.expression || "",
        rightExpression: rightEye.dataset.expression || "",
        leftSrc: leftEye.currentSrc.split("/").pop(),
        rightSrc: rightEye.currentSrc.split("/").pop()
      };
      return {
        pass:
          duringBlink.classPresent &&
          duringBlink.leftExpression === "blink" &&
          duringBlink.rightExpression === "blink" &&
          afterBlink.leftExpression === "alert" &&
          afterBlink.rightExpression === "alert",
        duringBlink,
        afterBlink
      };
    })()`);
  }

  const wave = await clickAndMeasure("#btnWave", ".anim-arm-right", "is-waving");
  await sleep(2600);
  const celebrate = await clickAndMeasure("#btnCelebrate", ".mascot-float-container", "is-celebrating");
  await sleep(2400);
  const eyeNeutral = await clickEyeExpression("#btnEyeNeutral", "neutral");
  const eyeBlinkExpression = await clickEyeExpression("#btnEyeBlink", "blink");
  const eyeAlert = await clickEyeExpression("#btnEyeAlert", "alert");
  const blink = await triggerBlinkFromAlert();
  await clickEyeExpression("#btnEyeNeutral", "neutral");

  const assets404 = await evaluate(`(() => {
    const failed = performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/assets/mascot/") && entry.responseStatus && entry.responseStatus >= 400)
      .map((entry) => ({ name: entry.name, status: entry.responseStatus }));
    return failed.length ? failed : "PASS";
  })()`);

  const errors = consoleMessages.filter((item) => item.type === "error" || item.type === "exception");
  const result = {
    page: base.hasMascot ? "PASS" : "FAIL",
    rafReal: `${rafFps} FPS`,
    wave: wave.pass ? "PASS" : "FAIL",
    celebrate: celebrate.pass ? "PASS" : "FAIL",
    tailWave: tailWave.pass ? "PASS" : "FAIL",
    headFlameWave: headFlameWave.pass ? "PASS" : "FAIL",
    eyeNeutral: eyeNeutral.pass ? "PASS" : "FAIL",
    eyeBlinkExpression: eyeBlinkExpression.pass ? "PASS" : "FAIL",
    eyeAlert: eyeAlert.pass ? "PASS" : "FAIL",
    blink: blink.pass ? "PASS" : "FAIL",
    consoleErrors: errors,
    assets404,
    details: { base, wave, celebrate, tailWave, headFlameWave, eyeNeutral, eyeBlinkExpression, eyeAlert, blink }
  };

  console.log(JSON.stringify(result, null, 2));
  ws.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
