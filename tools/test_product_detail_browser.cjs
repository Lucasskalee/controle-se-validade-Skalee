// Usage: node tools/test_product_detail_browser.cjs <playwright-module-path> <existing-test-browser-cdp-url>
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
(async () => {
 const browser = await chromium.connectOverCDP(process.argv[3]);
 const context = await browser.newContext({ viewport: { width:390,height:844 }, isMobile:true, hasTouch:true, serviceWorkers:'block' });
 try {
 const page = await context.newPage();
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 // No account session or production mutations in this isolated test context.
 await page.route('**/auth.js', route => route.fulfill({ contentType:'text/javascript', body:'' }));
 await page.goto('http://localhost:3333/index.html');
 await page.waitForFunction(() => typeof openProductDetailModal === 'function');
 await page.evaluate(fs.readFileSync(path.join(__dirname,'fixtures/product-detail-browser.js'),'utf8'));
 await page.waitForFunction(() => window.modalTestHistoryCalls === 1);
 await page.waitForTimeout(250); // Finish the existing modal entrance transition.
 assert.equal(await page.locator('.detail-photo img').count(), 0, 'No product photo must not fall back to the app logo');
 assert.match(await page.locator('.detail-photo').innerText(), /Sem foto/);
 // Exercise the actual modal with an unmistakable temporary test image, without Storage writes.
 await page.evaluate(() => {
  closeProductDetailModal();
  window.modalTestProduct.photo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>');
  openProductDetailModal(window.modalTestProduct);
 });
 assert.equal(await page.locator('.detail-photo img').getAttribute('src'), await page.evaluate(() => modalTestProduct.photo), 'The modal must preserve the product photo source');
 await page.evaluate(() => {
  closeProductDetailModal();
  window.modalTestProduct.photo = '';
  window.modalTestHistoryCalls = 0;
  openProductDetailModal(window.modalTestProduct);
 });
 await page.waitForTimeout(250);
 const initial = await page.locator('.detail-header').boundingBox();
 const client = await context.newCDPSession(page);
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:320,y:390}]});
 for(let x=290;x>=70;x-=22) await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:390}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(() => document.querySelectorAll('.detail-dot')[1].getAttribute('aria-current') === 'true');
 assert.deepEqual(await page.locator('.detail-header').boundingBox(), initial);
 assert.equal(await page.evaluate(() => modalTestHistoryCalls), 1);
 await page.locator('.detail-dot').nth(2).click();
 await page.waitForFunction(() => document.querySelectorAll('.detail-dot')[2].getAttribute('aria-current') === 'true');
 await page.waitForTimeout(400);
 await page.screenshot({path:'dev/modal-slide3-mobile.png'});
 for(const viewport of [{width:320,height:568},{width:844,height:390},{width:1366,height:900}]) {
  await page.setViewportSize(viewport);
  const geometry = await page.evaluate(() => ({overflow:document.documentElement.scrollWidth>innerWidth,footer:document.querySelector('.detail-footer').getBoundingClientRect().bottom,header:document.querySelector('.detail-header').getBoundingClientRect().top}));
  assert.equal(geometry.overflow,false);
  assert.ok(geometry.footer<=viewport.height && geometry.header>=0);
 }
 await page.screenshot({path:'dev/modal-desktop.png'});
 await page.evaluate(() => document.documentElement.dataset.theme='dark');
 await page.screenshot({path:'dev/modal-dark.png'});
 // Gallery is separate from the three information panels, and never saves data.
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(() => {
  closeProductDetailModal();
  const sample = label => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="400"><rect width="360" height="400" fill="#e2e8f0"/><text x="180" y="200" font-size="24" text-anchor="middle">Foto de teste ${label}</text></svg>`);
  modalTestProduct.photo = sample('1');
  modalTestProduct.photoPath = 'fixture/photo1.webp';
  window.galleryTestCalls = 0;
  window.skaleeDb.loadProductGallery = async () => {
   window.galleryTestCalls++;
   return { images:[{photoUrl:modalTestProduct.photo,photoPath:'fixture/photo1.webp'},{photoUrl:modalTestProduct.photo,photoPath:'fixture/photo1.webp'},{photoUrl:sample('2'),photoPath:'fixture/photo2.webp'}] };
  };
  openProductDetailModal(modalTestProduct);
 });
 await page.locator('.detail-gallery-trigger').click();
 await page.waitForFunction(()=>document.querySelector('.gallery-counter')?.textContent==='1 de 2');
 assert.equal(await page.locator('.gallery-slide').count(),2);
 await page.locator('.gallery-next').click();
 await page.waitForTimeout(400);
 assert.equal(await page.locator('.gallery-counter').innerText(),'2 de 2');
 await page.screenshot({path:'dev/product-gallery-mobile.png'});
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:65,y:390}]});
 for(let x=90;x<=330;x+=24) await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:390}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(()=>document.querySelector('.gallery-counter')?.textContent==='1 de 2');
 assert.equal(await page.evaluate(()=>galleryTestCalls),1);
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('.product-gallery'));
 assert.ok(await page.locator('#productDetailModal').evaluate(el=>el.classList.contains('show')));
 assert.equal(await page.evaluate(()=>modalTestSaved.length),0);
 await page.evaluate(()=>{window.skaleeDb.loadProductGallery=async()=>{throw new Error('Simulated gallery failure');};});
 await page.locator('.detail-gallery-trigger').click();
 await page.waitForFunction(()=>document.querySelector('.gallery-status')?.textContent.includes('foto atual foi mantida'));
 assert.equal(await page.locator('.gallery-slide img').getAttribute('src'),await page.evaluate(()=>modalTestProduct.photo));
 await page.locator('.gallery-close').click();
 assert.deepEqual(errors,[]);
 console.log('PASS: real product image source preserved; missing image shows Sem foto (no logo); native touch swipe, fixed header/footer, one history read, 320px/landscape/desktop, no page errors.');
 console.log('PASS: gallery deduplication, arrow/touch navigation, one load, Escape preserves details, failed request preserves current image, no writes.');
 } finally {
  await context.close();
  await browser.close();
 }
})().catch(e => { console.error(e); process.exitCode=1; });
