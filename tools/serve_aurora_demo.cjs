/**
 * tools/serve_aurora_demo.cjs
 *
 * Servidor HTTP local isolado para testes no Android físico.
 * Permite acesso na rede Wi-Fi local ou via redirecionamento de porta ADB.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 8080;
const ROOT = path.resolve(__dirname, '..');

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  let reqPath = reqUrl.pathname;

  if (reqPath === '/' || reqPath === '/aurora' || reqPath === '/prototype') {
    reqPath = '/dev/prototype-soft-aurora.html';
  }
  if (reqPath === '/glass-2-2' || reqPath === '/glass22' || reqPath === '/2.2') {
    reqPath = '/dev/prototype-titanium-glass-2-2.html';
  }

  let filePath = path.resolve(ROOT, '.' + reqPath);

  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, 'dev', 'prototype-soft-aurora.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.cjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log('=================================================================');
  console.log(' SKALEE SOFT AURORA 2.1 — SERVIDOR DE DEMONSTRAÇÃO ANDROID');
  console.log('=================================================================');
  console.log(`Porta ativa: ${PORT}`);
  console.log(`\n1. Acesso no mesmo Wi-Fi pelo navegador do celular:`);
  console.log(`   http://${localIp}:${PORT}/dev/prototype-soft-aurora.html`);
  console.log(`\n2. Acesso via USB com ADB Reverse:`);
  console.log(`   adb reverse tcp:${PORT} tcp:${PORT}`);
  console.log(`   http://localhost:${PORT}/dev/prototype-soft-aurora.html`);
  console.log('=================================================================');
  console.log('Pressione Ctrl+C para encerrar o servidor.');
});

