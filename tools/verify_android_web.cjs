const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json')));
assert.equal(config.webDir, 'dist');
assert.equal(config.appId, 'dev.skalee.validades');
assert.equal(config.appName, 'Skalee Validades');
assert.ok(!config.server.url, 'APK must use packaged files');

const androidMain = path.join(root, 'android', 'app', 'src', 'main');
const stringsXml = fs.readFileSync(path.join(androidMain, 'res', 'values', 'strings.xml'), 'utf8');
assert.match(stringsXml, /<string name="app_name">Skalee Validades<\/string>/);
assert.match(stringsXml, /<string name="title_activity_main">Skalee Validades<\/string>/);

const bgXml = fs.readFileSync(path.join(androidMain, 'res', 'values', 'ic_launcher_background.xml'), 'utf8');
assert.match(bgXml, /#0B1220/i);

const stylesXml = fs.readFileSync(path.join(androidMain, 'res', 'values', 'styles.xml'), 'utf8');
assert.match(stylesXml, /windowSplashScreenBackground/);
assert.match(stylesXml, /windowSplashScreenAnimatedIcon/);
assert.match(stylesXml, /postSplashScreenTheme/);

const stylesV31Xml = fs.readFileSync(path.join(androidMain, 'res', 'values-v31', 'styles.xml'), 'utf8');
assert.match(stylesV31Xml, /android:windowSplashScreenBackground/);
assert.match(stylesV31Xml, /android:windowSplashScreenAnimatedIcon/);

const mainActivityJava = fs.readFileSync(path.join(androidMain, 'java', 'dev', 'skalee', 'validades', 'MainActivity.java'), 'utf8');
assert.match(mainActivityJava, /SplashScreen\.installSplashScreen\(this\)/);

const expectedMipmaps = [
  ['mipmap-mdpi', 48, 108],
  ['mipmap-hdpi', 72, 162],
  ['mipmap-xhdpi', 96, 216],
  ['mipmap-xxhdpi', 144, 324],
  ['mipmap-xxxhdpi', 192, 432]
];
for (const [dir, legSize, fgSize] of expectedMipmaps) {
  for (const [name, expected] of [['ic_launcher.png', legSize], ['ic_launcher_round.png', legSize], ['ic_launcher_foreground.png', fgSize]]) {
    const p = path.join(androidMain, 'res', dir, name);
    const buf = fs.readFileSync(p);
    assert.equal(buf.readUInt32BE(16), expected, `${dir}/${name} width`);
    assert.equal(buf.readUInt32BE(20), expected, `${dir}/${name} height`);
  }
}

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(path.join(dir, item.name)) : [path.join(dir, item.name)]);
const files = walk(dist);
for (const file of files) {
 assert.ok(!/\.(env|sql|psd|jks|keystore|map)$/.test(file));
 if (!/\.(html|js|css)$/.test(file) || file.includes(`${path.sep}vendor${path.sep}`)) continue;
 const text = fs.readFileSync(file, 'utf8');
 assert.ok(!/sb_secret_[a-zA-Z0-9]|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(text), `Private credential: ${file}`);
 if (['index.html', 'auth.js', 'poster.html'].includes(path.basename(file))) {
  assert.ok(!/(?:src=|from )"https:\/\/(?:esm.sh|unpkg.com|cdnjs.cloudflare.com)/.test(text), `Startup CDN: ${file}`);
 }
 if (path.basename(file) === 'index.html') {
  for (const match of text.matchAll(/(?:src|href)="([^"${}<>]+)"/g)) {
   const ref = match[1].split(/[?#]/)[0];
   if (!ref || /^(?:https?:|data:|blob:|javascript:|mailto:)/.test(ref)) continue;
   if (!/\.(js|css|png|svg|webmanifest|html)$/.test(ref)) continue;
   assert.ok(fs.existsSync(path.join(dist, ref)), `Missing packaged asset: ${ref}`);
  }
 }
}
console.log(`PASS: ${files.length} packaged files, Capacitor webDir, Android visual identity resources, local startup libraries and asset paths.`);
