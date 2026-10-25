const { chromium } = require('C:/Users/skale/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const outputDir = path.join(root, 'visual-validation');
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/skale/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
  await page.goto('http://127.0.0.1:4174/skaleedemo.html', { waitUntil: 'networkidle' });

  const themes = ['dark', 'light', 'glass', 'industrial', 'creative', 'executive'];
  const backgrounds = ['solid', 'textured', 'dynamic'];
  const results = [];
  for (const theme of themes) {
    for (const background of backgrounds) {
      await page.evaluate(({ theme, background }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.backgroundStyle = background;
      }, { theme, background });
      await page.waitForTimeout(80);
      const state = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        background: document.documentElement.dataset.backgroundStyle,
        width: window.innerWidth,
        height: window.innerHeight,
        header: Boolean(document.querySelector('header, [role="banner"]')),
        navigation: Boolean(document.querySelector('nav, .tour-nav, .android-bottom-nav')),
        products: Boolean(document.querySelector('.tour-products, .product-card, .card')),
        profile: Boolean(document.querySelector('.personal-panel, [data-android-page="profile"]')),
        filters: Boolean(document.querySelector('.tour-search, .chip, [data-filter]')),
        text: document.body.innerText.includes('PRODUTOS ATIVOS') && document.body.innerText.includes('Validade:'),
        overlapping: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1); }).length,
      }));
      const file = path.join(outputDir, `${theme}-${background}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const settings = page.locator('#btn-open-settings');
      if (await settings.count()) {
        await settings.click();
        await page.waitForTimeout(50);
        await page.screenshot({ path: path.join(outputDir, `${theme}-${background}-profile.png`), fullPage: false });
        const close = page.locator('#btn-close-panel');
        if (await close.count()) await close.click();
      }
      results.push({ expectedTheme: theme, expectedBackground: background, ...state, screenshot: path.relative(root, file), profileScreenshot: path.join('visual-validation', `${theme}-${background}-profile.png`) });
    }
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'glass'; document.documentElement.dataset.backgroundStyle = 'dynamic'; });
  const reducedMotion = await page.evaluate(() => ({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, theme: document.documentElement.dataset.theme, background: document.documentElement.dataset.backgroundStyle }));
  await page.screenshot({ path: path.join(outputDir, 'glass-dynamic-reduced-motion.png'), fullPage: false });

  fs.writeFileSync(path.join(outputDir, 'validation-report.json'), JSON.stringify({ viewport: { width: 393, height: 852 }, combinations: results, reducedMotion, consoleErrors }, null, 2));
  console.log(JSON.stringify({ count: results.length, outputDir, consoleErrors, reducedMotion, failed: results.filter(r => r.theme !== r.expectedTheme || r.background !== r.expectedBackground || !r.text || r.overlapping > 0).length }, null, 2));
  await browser.close();
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
