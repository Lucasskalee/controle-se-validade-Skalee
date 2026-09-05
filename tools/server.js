const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3333;
const ROOT = path.resolve(__dirname, "..");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  
  if (reqPath === "/" || reqPath === "/skalito-svg") {
    reqPath = "/skalito-svg.html";
  }

  const filePath = path.join(ROOT, reqPath);

  // Security check: stay within workspace
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Acesso negado");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`404: Arquivo não encontrado (${reqPath})`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache"
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 SERVIDOR DO SKALITO ANIMADO ATIVO!`);
  console.log(`🌐 Abra no seu navegador: http://localhost:${PORT}/skalito-svg.html`);
  console.log(`======================================================\n`);
});
