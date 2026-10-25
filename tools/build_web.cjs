const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
// Fixed destination and explicit allowlist: never copy repository/configuration/secrets.
if (out !== path.resolve(root, 'dist')) throw new Error('Invalid output');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
const files = ['index.html', 'poster.html', 'skalito-demo.html', 'skalito-svg.html',
 'styles.css', 'auth.css', 'theme-layout.css', 'admin-cadastros.css', 'notification-center.css',
 'product-detail.css', 'android-ui.css', 'auth.js', 'admin-cadastros.js', 'audit-access.js', 'audit-report-generator.js',
 'local-store.js', 'local-query.js', 'product-image-service.js', 'product-detail.js', 'product-gallery.js',
 'product-drafts.js', 'registration-draft-ui.js', 'native-camera.js', 'android-ui.js', 'report-assets.js', 'sw.js', 'manifest.webmanifest'];
for (const file of fs.readdirSync(root)) if (/^skalee-[\w-]+\.png$/.test(file)) files.push(file);
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(out, file));
for (const dir of ['components', 'assets']) fs.cpSync(path.join(root, dir), path.join(out, dir), {
 recursive: true, filter: source => fs.statSync(source).isDirectory() || /\.(js|css|svg|png|jpg|jpeg|webp|gif|json|woff2?|ttf|html)$/.test(source)
});
async function main() {
 await esbuild.build({ stdin: { contents: 'import { Camera } from "@capacitor/camera"; import { App } from "@capacitor/app"; import { Filesystem, Directory, Encoding } from "@capacitor/filesystem"; import { Share } from "@capacitor/share"; window.skaleeNativePlugins = { Camera, App, Filesystem, Directory, Encoding, Share };', resolveDir: root },
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020', outfile: path.join(out, 'vendor/native-plugins.js') });
 await esbuild.build({ stdin: { contents: 'export { createClient } from "@supabase/supabase-js";', resolveDir: root },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2020', outfile: path.join(out, 'vendor/supabase.js') });
 fs.copyFileSync(path.join(root, 'node_modules/@zxing/browser/umd/zxing-browser.min.js'), path.join(out, 'vendor/zxing-browser.min.js'));
 fs.copyFileSync(path.join(root, 'node_modules/html5-qrcode/html5-qrcode.min.js'), path.join(out, 'vendor/html5-qrcode.min.js'));
 for (const file of ['auth.js', 'poster.html']) {
  const target = path.join(out, file);
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('https://esm.sh/@supabase/supabase-js@2.55.0', './vendor/supabase.js'));
 }
 const index = path.join(out, 'index.html');
 fs.writeFileSync(index, fs.readFileSync(index, 'utf8')
  .replace('<head>', '<head>\n<script src="vendor/native-plugins.js"></script>')
  .replace(/<script src="https:\/\/unpkg.com\/[^>]+><\/script>/, '<script src="vendor/zxing-browser.min.js"></script>')
  .replace(/<script src="https:\/\/cdnjs.cloudflare.com\/[^>]+><\/script>/, '<script src="vendor/html5-qrcode.min.js"></script>'));
 const sw = path.join(out, 'sw.js');
 fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace('const APP_SHELL = [', 'const APP_SHELL = ["/vendor/supabase.js", "/vendor/zxing-browser.min.js", "/vendor/html5-qrcode.min.js",'));
 console.log('Web assets built in dist; startup libraries bundled locally.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
