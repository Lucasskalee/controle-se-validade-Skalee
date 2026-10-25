const { chromium } = require('C:/Users/skale/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const port = 8196;
const out = path.join(root, 'visual-validation', 'titanium-2.6');
fs.mkdirSync(out, { recursive: true });

const server = http.createServer((req, res) => {
  let rel = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(root, `.${rel}`);
  if (!file.startsWith(root) || !fs.existsSync(file)) return res.writeHead(404).end();
  let data = fs.readFileSync(file);
  if (file.endsWith('index.html')) data = data.toString().replace('<script type="module" src="auth.js"></script>', '');
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html';
  res.writeHead(200, { 'Content-Type': type }); res.end(data);
});

const setup = `(() => {
  document.documentElement.classList.add('android-app'); document.body.classList.add('android-app');
  document.body.classList.remove('auth-loading', 'auth-anonymous');
  const authScreen = document.getElementById('authScreen');
  if (authScreen) { authScreen.hidden = true; authScreen.setAttribute('aria-hidden', 'true'); }
  window.allowedLocations = [{ name: 'Loja Principal', active: true }];
  window.allowedSuppliers = [];
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const fixtureProducts = [
    { id:'fixture-expired', barcode:'789000000001', code:'FIX-001', name:'Produto vencido para validação', qty:14, expiry:day(-1), store:'Loja Principal', offer:false },
    { id:'fixture-today', barcode:'789000000002', code:'FIX-002', name:'Iogurte Natural 170g', qty:24, expiry:day(0), store:'Loja Principal', offer:false },
    { id:'fixture-three-days', barcode:'789000000003', code:'FIX-003', name:'Leite Integral 1L em oferta', qty:48, expiry:day(3), store:'Loja Principal', offer:true },
    { id:'fixture-seven-days', barcode:'789000000004', code:'FIX-004', name:'Queijo Mussarela 150g', qty:32, expiry:day(7), store:'Loja Principal', offer:false },
    { id:'fixture-high-quantity', barcode:'789000000005', code:'FIX-005', name:'Arroz Premium Estoque Alto', qty:120, expiry:day(21), store:'Loja Principal', offer:false },
    { id:'fixture-no-image', barcode:'789000000006', code:'FIX-006', name:'Produto sem imagem cadastrada', qty:8, expiry:day(12), store:'Loja Principal', offer:false },
    { id:'fixture-long-description', barcode:'789000000007', code:'FIX-007', name:'Produto com descrição longa para validar quebra de linha, truncamento e leitura dos detalhes no card', qty:6, expiry:day(30), store:'Loja Principal', offer:false }
  ].map((product) => ({
    ...product,
    supplierCode: 'FIX-SUP-001', supplierName: 'Fornecedor de Validação', supplierAliases: [{ code: 'FIX-SUP-001', name: 'Fornecedor de Validação' }],
    photo: '', photoPath: '', photoLoaded: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null, ownerId: 'fixture-user'
  }));
  window.__titaniumFixtureProducts = fixtureProducts;
  window.products = fixtureProducts;
  const fixtureLoader = async () => { window.__titaniumFixtureLoadCount = (window.__titaniumFixtureLoadCount || 0) + 1; return fixtureProducts.slice(); };
  window.skaleeDb = window.skaleeDb || {};
  window.skaleeDb.loadProducts = fixtureLoader;
  window.skaleeDb.loadProductDashboardStats = async () => ({ products: fixtureProducts.length, today: 1, seven: 3, thirty: fixtureProducts.length, offer: 1 });
  document.documentElement.dataset.androidTab = 'android-home';
  if (typeof buildAndroidUI === 'function') buildAndroidUI();
  if (typeof syncAndroidHome === 'function') syncAndroidHome();
  if (typeof syncAndroidProfile === 'function') syncAndroidProfile();
  if (typeof scheduleProductQueryReload === 'function') scheduleProductQueryReload(0);
  if (typeof products !== 'undefined' && typeof render === 'function') { products = fixtureProducts.slice(); render(); }
  const tour = document.getElementById('personalTourModal');
  if (tour) tour.hidden = true;
  return Boolean(document.querySelector('[data-android-theme]') && document.querySelector('[data-background-style]'));
})()`;

(async () => {
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/skale/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/123 Mobile Safari/537.36', reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const consoleErrors = []; page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); }); page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const setupOk = await page.evaluate(setup);
  const initial = await page.evaluate(() => ({ url: location.href, activeTab: document.documentElement.dataset.androidTab || null, androidActive: document.documentElement.classList.contains('android-app'), themeButtons: document.querySelectorAll('[data-android-theme]').length, backgroundButtons: document.querySelectorAll('[data-background-style]').length, visibleButtons: [...document.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(b => b.innerText.trim()).slice(0, 40), errors: window.__validationErrors || [] }));
  await page.screenshot({ path: path.join(out, 'diagnostic-initial.png') });
  if (!initial.themeButtons) { fs.writeFileSync(path.join(out, 'diagnostic.json'), JSON.stringify({ setupOk, initial, consoleErrors }, null, 2)); console.log(JSON.stringify({ setupOk, initial, consoleErrors }, null, 2)); await browser.close(); server.close(); return; }
  await page.locator('button[data-android-page="android-profile"]').click();
  await page.waitForTimeout(100);
  const profileState = await page.evaluate(() => ({ activeTab: document.documentElement.dataset.androidTab, profileHidden: document.getElementById('android-profile')?.hidden, visibleThemeButtons: [...document.querySelectorAll('[data-android-theme]')].filter(b => getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0).map(b => b.dataset.androidTheme), visibleBackgroundButtons: [...document.querySelectorAll('[data-background-style]')].filter(b => b.getBoundingClientRect().width > 0).map(b => b.dataset.backgroundStyle) }));
  await page.screenshot({ path: path.join(out, 'diagnostic-profile.png') });
  if (profileState.visibleThemeButtons.length !== 5) { fs.writeFileSync(path.join(out, 'diagnostic.json'), JSON.stringify({ setupOk, initial, profileState, consoleErrors }, null, 2)); console.log(JSON.stringify({ setupOk, initial, profileState, consoleErrors }, null, 2)); await browser.close(); server.close(); return; }
  const minimum = [];
  for (const theme of ['dark', 'light']) {
    await page.locator(`[data-android-theme="${theme}"]`).click();
    const state = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, preference: document.documentElement.dataset.themePreference, stored: localStorage.getItem('skalee.theme') }));
    await page.screenshot({ path: path.join(out, `minimum-${theme}.png`) });
    minimum.push({ expected: theme, ...state, applied: state.stored === theme && state.theme === theme });
  }
  fs.writeFileSync(path.join(out, 'minimum-test.json'), JSON.stringify({ setupOk, initial, profileState, minimum, consoleErrors }, null, 2));
  if (process.env.TITANIUM_MINIMUM_ONLY === '1') { console.log(JSON.stringify({ setupOk, initial, profileState, minimum, consoleErrors }, null, 2)); await browser.close(); server.close(); return; }
  const themes = ['dark','light','industrial','creative','executive'];
  const backgrounds = ['titanium','image'];
  const results = [];
  let glassCustomization = null;
  let productScenarios = null;
  for (const theme of themes) for (const background of backgrounds) {
    await page.locator(`[data-android-theme="${theme}"]`).click();
    if (background === 'image') {
      await page.locator('button[data-background-style="image"]').click();
      await page.locator('#androidGlassWallpaperInput').setInputFiles({ name: 'fixture-wallpaper.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
      await page.locator('#androidGlassWallpaperApplyBtn').click();
    } else {
      await page.locator('button[data-background-style="titanium"]').click();
    }
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, preference: document.documentElement.dataset.themePreference, background: document.documentElement.dataset.backgroundStyle, visual: document.documentElement.dataset.visualEffect, home: Boolean(document.querySelector('#android-home')), products: Boolean(document.querySelector('#android-products')), profile: Boolean(document.querySelector('#android-profile')), bottomNav: Boolean(document.querySelector('.android-bottom-nav')), header: Boolean(document.querySelector('#androidHeader')), productText: document.body.innerText.includes('Iogurte Natural'), controls: document.querySelectorAll('[data-android-theme]').length + document.querySelectorAll('[data-background-style]').length }));
    const safe = `${theme}-${background}`;
    await page.locator('button[data-android-page="products"]').click();
    await page.waitForTimeout(80);
    const productsState = await page.evaluate(() => ({ activeTab: document.documentElement.dataset.androidTab, visible: !document.getElementById('products')?.hidden, productText: document.body.innerText.includes('Iogurte Natural'), search: Boolean(document.querySelector('#search, [placeholder*="Buscar" i], .searchrow')), cards: document.querySelectorAll('#grid .card, #grid .product-card, .android-product-card').length, fixtureLoadCount: window.__titaniumFixtureLoadCount || 0, gridText: document.querySelector('#grid')?.innerText || '', storeFilter: document.querySelector('#storeFilter')?.value || '', supplierFilter: document.querySelector('#supplierFilter')?.value || '', resultText: document.querySelector('#result')?.textContent || '' }));
    if (!productScenarios) {
      const captureScenario = async (filter) => {
        await page.locator('button[data-filter="all"][data-label="Todos"]').click();
        await page.locator(`[data-filter="${filter}"]`).click();
        await page.waitForTimeout(40);
        return page.evaluate(() => ({ filter: document.querySelector('.chip.active')?.dataset.filter || '', cards: document.querySelectorAll('#grid .card').length, text: document.querySelector('#grid')?.innerText || '' }));
      };
      const expired = await captureScenario('expired_today');
      const offer = await captureScenario('offer');
      const highQuantity = await captureScenario('high');
      await page.locator('button[data-filter="all"][data-label="Todos"]').click();
      await page.waitForTimeout(40);
      productScenarios = { expired, offer, highQuantity, restoredCards: await page.locator('#grid .card').count() };
    }
    await page.screenshot({ path: path.join(out, `${safe}-products.png`) });
    await page.locator('button[data-android-page="android-home"]').click();
    await page.waitForTimeout(60);
    await page.screenshot({ path: path.join(out, `${safe}-home.png`) });
    await page.locator('button[data-android-page="android-profile"]').click();
    await page.waitForTimeout(60);
    await page.screenshot({ path: path.join(out, `${safe}-profile.png`) });
    if (!glassCustomization) {
      await page.locator('[data-android-theme="dark"]').click();
      await page.waitForTimeout(60);
      await page.locator('button[data-background-style="image"]').click();
      await page.locator('#androidGlassWallpaperInput').setInputFiles({ name: 'fixture-wallpaper.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
      await page.waitForTimeout(80);
      await page.locator('#androidGlassWallpaperApplyBtn').click();
      await page.waitForTimeout(80);
      await page.locator('#androidGlassBlurRange').fill('30');
      await page.locator('#androidGlassIntensityRange').fill('90');
      await page.locator('#androidGlassDimRange').fill('45');
      await page.waitForTimeout(40);
      glassCustomization = await page.evaluate(async () => {
        const root = document.documentElement;
        const fallbackBackdrop = getComputedStyle(document.querySelector('.android-profile-card')).backdropFilter;
        root.classList.remove('performance-mode');
        const normalBackdrop = getComputedStyle(document.querySelector('.android-profile-card')).backdropFilter;
        root.classList.add('performance-mode');
        return {
        theme: document.documentElement.dataset.theme,
        background: document.documentElement.dataset.glassBackground,
        wallpaper: document.documentElement.dataset.glassWallpaper,
        blur: getComputedStyle(document.documentElement).getPropertyValue('--sk-glass-blur').trim(),
        intensity: getComputedStyle(document.documentElement).getPropertyValue('--sk-glass-alpha').trim(),
        dim: getComputedStyle(document.documentElement).getPropertyValue('--sk-glass-dim').trim(),
        stored: Boolean(await window.skaleeLocalStore?.getMeta('skalee.glassWallpaper', null)),
        globalWallpaper: getComputedStyle(document.querySelector('#protectedApp'), '::before').backgroundImage,
        cardSurface: getComputedStyle(document.querySelector('.android-profile-card'), '::before').backgroundImage,
        navSurface: getComputedStyle(document.querySelector('#androidBottomNav'), '::after').backgroundImage,
        duplicatedWallpaper: [getComputedStyle(document.querySelector('.android-profile-card'), '::before').backgroundImage, getComputedStyle(document.querySelector('#androidBottomNav'), '::after').backgroundImage].every(value => !value.includes('data:image')),
        sliderState: { blur: document.querySelector('#androidGlassBlurRange')?.value, intensity: document.querySelector('#androidGlassIntensityRange')?.value, dim: document.querySelector('#androidGlassDimRange')?.value },
        fallbackBackdrop,
        normalBackdrop
        };
      });
      glassCustomization.sliderSnapshots = {};
      for (const [label, values] of Object.entries({ min: ['6', '45', '0'], mid: ['18', '72', '18'], max: ['30', '90', '45'] })) {
        await page.locator('#androidGlassBlurRange').fill(values[0]);
        await page.locator('#androidGlassIntensityRange').fill(values[1]);
        await page.locator('#androidGlassDimRange').fill(values[2]);
        await page.waitForTimeout(30);
        glassCustomization.sliderSnapshots[label] = await page.evaluate(() => ({ blur: getComputedStyle(document.documentElement).getPropertyValue('--sk-glass-blur').trim(), alpha: getComputedStyle(document.documentElement).getPropertyValue('--sk-glass-alpha').trim(), dim: getComputedStyle(document.documentElement).getPropertyValue('--sk-glass-dim').trim(), panel: getComputedStyle(document.querySelector('.android-profile-card')).backgroundColor }));
        await page.screenshot({ path: path.join(out, `glass-controls-${label}.png`) });
      }
      await page.screenshot({ path: path.join(out, 'glass-frosted-custom-image-profile.png') });
      glassCustomization.universalThemes = {};
      for (const universalTheme of themes) {
        await page.locator(`[data-android-theme="${universalTheme}"]`).click();
        await page.waitForTimeout(35);
        glassCustomization.universalThemes[universalTheme] = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, wallpaper: document.documentElement.dataset.glassWallpaper, backgroundImage: getComputedStyle(document.body).backgroundImage, panel: getComputedStyle(document.querySelector('.android-profile-card')).backgroundColor, panelToken: getComputedStyle(document.documentElement).getPropertyValue('--sk-glass-panel-bg').trim(), glassBg: getComputedStyle(document.documentElement).getPropertyValue('--sk-glass-bg').trim(), alpha: getComputedStyle(document.documentElement).getPropertyValue('--sk-glass-alpha').trim() }));
      }
      await page.locator('#androidGlassWallpaperRemoveBtn').click();
      await page.waitForTimeout(60);
    }
    results.push({ expected: { theme, background }, actual: { ...state, productsState }, applied: state.theme === theme && state.background === background && state.controls >= 7 && productsState.cards > 0 && productsState.productText, screenshot: `${safe}-home.png`, productsScreenshot: `${safe}-products.png`, profileScreenshot: `${safe}-profile.png` });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-android-theme="dark"]').click(); await page.locator('button[data-background-style="titanium"]').click();
  const reducedMotion = await page.evaluate(() => ({ media: matchMedia('(prefers-reduced-motion: reduce)').matches, theme: document.documentElement.dataset.theme, background: document.documentElement.dataset.backgroundStyle }));
  await page.screenshot({ path: path.join(out, 'glass-dynamic-reduced-motion.png') });
  const report = { fixture: 'tools/validate_real_titanium.cjs authorized local fixture via window.skaleeDb.loadProducts', fixtureProducts: 7, fixtureScenarios: ['expired', 'today', 'three-days', 'seven-days', 'offer', 'high-quantity', 'no-image', 'long-description'], productScenarios, glassCustomization, viewport: { width:393, height:852 }, results, reducedMotion, consoleErrors, approved: results.filter(r => r.applied).length };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ approved: report.approved, total: results.length, setupOk, reducedMotion, consoleErrors, out }, null, 2));
  await browser.close(); server.close();
})().catch(e => { console.error(e.stack || e); server.close(); process.exitCode = 1; });
