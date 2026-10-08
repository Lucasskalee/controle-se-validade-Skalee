const https = require('https');

function fetchVersion() {
  return new Promise((resolve, reject) => {
    https.get('https://controle-de-validade-skalee.vercel.app/?t=' + Date.now(), res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const accessMatch = data.match(/audit-access\.js\?v=([^"]+)/);
        const reportMatch = data.match(/audit-report-generator\.js\?v=([^"]+)/);
        resolve({
          access: accessMatch ? accessMatch[1] : null,
          report: reportMatch ? reportMatch[1] : null
        });
      });
    }).on('error', reject);
  });
}

async function main() {
  for (let i = 0; i < 6; i++) {
    const v = await fetchVersion();
    console.log(`[Attempt ${i + 1}] audit-access.js: ${v.access}, audit-report-generator.js: ${v.report}`);
    if (v.access === '4.1.0' && v.report === '4.1.0') {
      console.log('✓ SUCCESS: Vercel deployment completed with v4.1.0!');
      return;
    }
    await new Promise(r => setTimeout(r, 8000));
  }
}

main().catch(console.error);
