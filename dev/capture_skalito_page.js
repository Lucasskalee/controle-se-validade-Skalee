const fs = require("fs");
const http = require("http");

const targetUrl = process.argv[2] || "http://localhost:3333/skalito-svg.html";
const outputPath = process.argv[3] || "dev/skalito-capture.png";
const extraEval = process.argv[4] || "";
const cdpPort = Number(process.env.CDP_PORT || 9222);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpJson(path, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: cdpPort, path, method }, (res) => {
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

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const callbacks = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !callbacks.has(message.id)) return;
    const { resolve, reject } = callbacks.get(message.id);
    callbacks.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
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

  return { ws, send };
}

(async () => {
  const { ws, send } = await connectCdp();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send("Page.navigate", { url: targetUrl });
  await sleep(2500);
  await send("Runtime.evaluate", {
    expression: `(() => {
      const mascot = document.querySelector("skalito-mascot");
      if (mascot) {
        mascot.setAttribute("debug", "");
        mascot.setAttribute("state", "static");
      }
      document.querySelector("#referenceCheck")?.click();
      const grid = document.querySelector("#gridCheck");
      if (grid?.checked) grid.click();
      return true;
    })()`,
    returnByValue: true
  });
  await sleep(500);
  if (extraEval) {
    await send("Runtime.evaluate", {
      expression: extraEval,
      returnByValue: true
    });
    await sleep(250);
  }
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  fs.writeFileSync(outputPath, Buffer.from(shot.data, "base64"));
  ws.close();
  console.log(outputPath);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
