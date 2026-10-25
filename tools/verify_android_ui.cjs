const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const VIEWPORTS = [
  { name: 'phone-360x800', width: 360, height: 800, expectedGridCols: 2 },
  { name: 'phone-390x844', width: 390, height: 844, expectedGridCols: 2 },
  { name: 'tablet-600x960', width: 600, height: 960, expectedGridCols: 3 },
  { name: 'tablet-800x1280', width: 800, height: 1280, expectedGridCols: 3 },
  { name: 'tablet-1024x600', width: 1024, height: 600, expectedGridCols: 4 }
];

async function runBrowserSession({ port, debugPort, isAndroid, testFn }) {
  const base = path.join(root, 'dist');
  const server = http.createServer((req, res) => {
    const reqPath = new URL(req.url, 'http://localhost').pathname;
    const relPath = reqPath === '/' ? '/index.html' : reqPath;
    const file = path.resolve(base, '.' + relPath);
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    let data = fs.readFileSync(file);
    if (file.endsWith('index.html')) {
      data = data.toString().replace('<script type="module" src="auth.js"></script>', '');
    }
    const contentType = file.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : file.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : file.endsWith('.html')
          ? 'text/html; charset=utf-8'
          : 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.end(data);
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  const userDataDir = path.join(root, '.tmp', `verify-android-ui-${isAndroid ? 'cap' : 'pwa'}-${Date.now()}`);
  const chrome = spawn(
    process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      '--no-first-run',
      '--disable-gpu',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  let socket;
  let counter = 0;
  const pending = new Map();

  try {
    let targets;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json`);
        const json = await res.json();
        if (Array.isArray(json) && json.some((t) => t.type === 'page')) {
          targets = json;
          break;
        }
      } catch {}
      await wait(150);
    }
    const pageTarget = targets?.find((t) => t.type === 'page');
    assert.ok(pageTarget, 'Chrome page target must be available');

    socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });

    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Page.javascriptDialogOpening') {
        socket.send(
          JSON.stringify({
            id: ++counter,
            method: 'Page.handleJavaScriptDialog',
            params: { accept: true }
          })
        );
      }
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    };

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++counter;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (result.exceptionDetails) {
        throw new Error(JSON.stringify(result.exceptionDetails));
      }
      return result.result.value;
    };

    await send('Network.enable');
    await send('Page.enable');
    await send('Network.setBlockedURLs', { urls: ['https://*', 'http://*.supabase.co/*'] });

    const preloadSource = isAndroid
      ? `
        window.androidBridge = { postMessage: () => {} };
        window.alert = () => {};
        window.confirm = () => true;
      `
      : `
        delete window.androidBridge;
        window.alert = () => {};
        window.confirm = () => true;
      `;

    await send('Page.addScriptToEvaluateOnNewDocument', { source: preloadSource });
    await testFn({ send, evaluate, port });
  } finally {
    socket?.close();
    chrome.kill();
    server.close();
  }
}

async function run() {
  // 1. Validate Capacitor Android UI across 360px, 390px, 600px, 800px, and 1024px
  await runBrowserSession({
    port: 3361,
    debugPort: 9361,
    isAndroid: true,
    testFn: async ({ send, evaluate, port }) => {
      for (const vp of VIEWPORTS) {
        await send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: true
        });

        await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
        for (let i = 0; i < 40; i++) {
          const ready = await evaluate('Boolean(window.SkaleeAndroidUI && window.SkaleeAndroidUI.active)');
          if (ready) break;
          await wait(100);
        }

        const todayIso = new Date().toISOString().slice(0, 10);

        // Simulate authenticated state and seed 4 active products
        await evaluate(`(async () => {
          localStorage.removeItem('skalee.android.productsView');
          document.body.classList.remove('auth-loading', 'auth-anonymous');
          document.body.classList.add('auth-authenticated');
          const authOverlay = document.getElementById('authOverlay');
          if (authOverlay) authOverlay.hidden = true;

          const sampleProducts = [
            { id: 'p-1', name: 'Iogurte Natural Integral 170g', code: '1001', barcode: '7890001', qty: 12, expiry: '${todayIso}', store: 'Loja Centro', offer: true },
            { id: 'p-2', name: 'Leite Fermentado Bob Esponja 480g', code: '1002', barcode: '7890002', qty: 24, expiry: '${todayIso}', store: 'Loja Centro', offer: false },
            { id: 'p-3', name: 'Queijo Mussarela Fatiado 150g', code: '1003', barcode: '7890003', qty: 8, expiry: '${todayIso}', store: 'Loja Norte', offer: true },
            { id: 'p-4', name: 'Requeijão Cremoso Tradicional 200g', code: '1004', barcode: '7890004', qty: 15, expiry: '${todayIso}', store: 'Loja Norte', offer: false }
          ];

          window.skaleeDb = {
            listAllowedRetailLocationsForCurrentUser: async () => [
              { id: 'loc-1', name: 'Loja Centro', active: true },
              { id: 'loc-2', name: 'Loja Norte', active: true }
            ],
            listAllowedSuppliersForCurrentUser: async () => [
              { id: 'sup-1', name: 'Fornecedor Alpha', active: true }
            ],
            loadProducts: async () => sampleProducts,
            loadProductDashboardStats: async () => ({ products: 4, today: 4, seven: 4, thirty: 4, offer: 2 }),
            processOfflineSyncQueue: async () => {},
            subscribeValidityProducts: () => ({})
          };

          products = sampleProducts.slice();
          if (typeof render === 'function') render();

          window.dispatchEvent(new CustomEvent('skalee:authenticated', {
            detail: { userId: 'u-1', email: 'operador@skalee.dev', accessRole: 'platform_admin' }
          }));
          await new Promise(r => setTimeout(r, 260));
          products = sampleProducts.slice();
          if (typeof render === 'function') render();
        })()`);

        const checkLayoutInvariants = async (expectedPageId, stepLabel) => {
          const state = await evaluate(`(() => {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const docScrollWidth = document.documentElement.scrollWidth;
            const app = document.getElementById('protectedApp');
            const appRect = app ? app.getBoundingClientRect() : null;
            const header = document.getElementById('androidHeader');
            const headerRect = header ? header.getBoundingClientRect() : null;
            const brand = header ? header.querySelector('.android-header-brand') : null;
            const brandRect = brand ? brand.getBoundingClientRect() : null;
            const bell = document.getElementById('androidHeaderNotificationBtn');
            const bellRect = bell ? bell.getBoundingClientRect() : null;
            const nav = document.getElementById('androidBottomNav');
            const navRect = nav ? nav.getBoundingClientRect() : null;

            const visiblePages = [...document.querySelectorAll('.page')]
              .filter(p => p.getClientRects().length > 0)
              .map(p => ({ id: p.id, className: p.className, hidden: p.hidden }));

            const centerHit = document.elementFromPoint(Math.round(vw / 2), Math.round(vh / 2));
            const leftHit = document.elementFromPoint(32, Math.round(vh / 2));
            const rightHit = document.elementFromPoint(vw - 32, Math.round(vh / 2));

            const describeEl = (el) => {
              if (!el) return null;
              const pageAncestor = el.closest('.page');
              const navAncestor = el.closest('#androidBottomNav');
              const auditModalAncestor = el.closest('.audit-modal-overlay');
              return {
                tag: el.tagName,
                id: el.id,
                className: typeof el.className === 'string' ? el.className : '',
                pageId: pageAncestor ? pageAncestor.id : null,
                insideBottomNav: Boolean(navAncestor),
                insideClosedAuditModal: Boolean(auditModalAncestor && !auditModalAncestor.classList.contains('show'))
              };
            };

            const auditEl = document.getElementById('audit');
            const auditVisible = auditEl ? auditEl.getClientRects().length > 0 : false;

            return {
              vw,
              vh,
              docScrollWidth,
              currentTab: window.SkaleeAndroidUI.getCurrentTab(),
              appRect: appRect ? { left: Math.round(appRect.left), width: Math.round(appRect.width) } : null,
              headerRect: headerRect ? { top: Math.round(headerRect.top), height: Math.round(headerRect.height), width: Math.round(headerRect.width) } : null,
              brandRect: brandRect ? { top: Math.round(brandRect.top), bottom: Math.round(brandRect.bottom), left: Math.round(brandRect.left), right: Math.round(brandRect.right), height: Math.round(brandRect.height) } : null,
              bellRect: bellRect ? { top: Math.round(bellRect.top), bottom: Math.round(bellRect.bottom), left: Math.round(bellRect.left), right: Math.round(bellRect.right), width: Math.round(bellRect.width), height: Math.round(bellRect.height) } : null,
              navRect: navRect ? { top: Math.round(navRect.top), bottom: Math.round(navRect.bottom), left: Math.round(navRect.left), width: Math.round(navRect.width), height: Math.round(navRect.height) } : null,
              visiblePages,
              centerHit: describeEl(centerHit),
              leftHit: describeEl(leftHit),
              rightHit: describeEl(rightHit),
              auditVisible
            };
          })()`);

          const ctx = `[${vp.name} | ${stepLabel}]`;

          // 0. No horizontal overflow
          assert.ok(
            state.docScrollWidth <= vp.width,
            `${ctx} document scrollWidth (${state.docScrollWidth}) must not exceed viewport width (${vp.width})`
          );

          // 1. Header must be on a single horizontal line with bell on the right
          assert.ok(state.headerRect && state.brandRect && state.bellRect, `${ctx} header, brand and bell must exist`);
          assert.ok(
            state.headerRect.height <= 68,
            `${ctx} #androidHeader must remain compact on a single line (<=68px), got ${state.headerRect.height}px`
          );
          const brandCenterY = state.brandRect.top + state.brandRect.height / 2;
          const bellCenterY = state.bellRect.top + state.bellRect.height / 2;
          assert.ok(
            Math.abs(brandCenterY - bellCenterY) <= 5,
            `${ctx} brand and notification bell must be vertically aligned on the same row (brandY=${brandCenterY}, bellY=${bellCenterY})`
          );
          assert.ok(
            state.bellRect.left >= state.brandRect.right - 2,
            `${ctx} notification bell must sit to the right of brand without wrapping (${JSON.stringify(state.brandRect)} vs ${JSON.stringify(state.bellRect)})`
          );
          assert.equal(state.bellRect.width, 40, `${ctx} notification bell touch target width must be 40px`);
          assert.equal(state.bellRect.height, 40, `${ctx} notification bell touch target height must be 40px`);

          // 2. Only the expected page is visible
          assert.equal(state.currentTab, expectedPageId, `${ctx} currentTab must be ${expectedPageId}`);
          assert.equal(
            state.visiblePages.length,
            1,
            `${ctx} strictly 1 .page must be visible, found: ${JSON.stringify(state.visiblePages)}`
          );
          assert.equal(
            state.visiblePages[0].id,
            expectedPageId,
            `${ctx} visible page must be ${expectedPageId}, found: ${JSON.stringify(state.visiblePages)}`
          );

          // 3. Audit section must be invisible unless expectedPageId === 'audit'
          assert.equal(
            state.auditVisible,
            expectedPageId === 'audit',
            `${ctx} #audit visibility mismatch`
          );

          // 4. Main container fills viewport width
          assert.ok(state.appRect, `${ctx} #protectedApp must exist`);
          assert.equal(state.appRect.left, 0, `${ctx} #protectedApp must start at x=0`);
          assert.equal(state.appRect.width, vp.width, `${ctx} #protectedApp must fill viewport width (${vp.width}px)`);

          // 5. Bottom nav is fixed at the bottom and never stretches vertically to cover content
          assert.ok(state.navRect, `${ctx} #androidBottomNav must exist`);
          assert.equal(state.navRect.left, 0, `${ctx} #androidBottomNav left must be 0`);
          assert.equal(state.navRect.width, vp.width, `${ctx} #androidBottomNav must span full viewport width`);
          assert.ok(
            state.navRect.height >= 60 && state.navRect.height <= 90,
            `${ctx} #androidBottomNav height must be compact (60..90px), got ${state.navRect.height}px`
          );
          assert.equal(
            state.navRect.bottom,
            vp.height,
            `${ctx} #androidBottomNav bottom must align with viewport bottom (${vp.height}px), got ${state.navRect.bottom}px`
          );

          // 6. Center and side hit-tests never hit #androidBottomNav or inactive pages or closed modals
          for (const [posName, hit] of [['center', state.centerHit], ['left', state.leftHit], ['right', state.rightHit]]) {
            assert.ok(hit, `${ctx} ${posName} hit must exist`);
            assert.equal(hit.insideBottomNav, false, `${ctx} ${posName} of screen must NOT be covered by #androidBottomNav`);
            assert.equal(hit.insideClosedAuditModal, false, `${ctx} ${posName} of screen must NOT hit closed audit modal`);
            if (hit.pageId) {
              assert.equal(
                hit.pageId,
                expectedPageId,
                `${ctx} ${posName} hit landed on wrong page (${hit.pageId} instead of ${expectedPageId})`
              );
            }
          }
        };

        // Check initial post-login state on android-home
        await checkLayoutInvariants('android-home', 'post-login-home');

        // Navigate to Products tab and verify Grade & Lista views, responsive columns, details modal, and filters
        await evaluate(`document.querySelector('#androidBottomNav [data-android-page="products"]').click()`);
        await wait(80);
        await checkLayoutInvariants('products', 'tab-products-grid');

        // Verify Grade view responsive columns (2 on 360/390, 3 on 600/800, 4 on 1024)
        const gridMetrics = await evaluate(`(() => {
          const cards = [...document.querySelectorAll('#products #grid .card')];
          const rects = cards.map(c => {
            const r = c.getBoundingClientRect();
            const photo = c.querySelector('.photo');
            const content = c.querySelector('.content');
            const pr = photo ? photo.getBoundingClientRect() : null;
            const cr = content ? content.getBoundingClientRect() : null;
            return {
              id: c.dataset.productId,
              top: Math.round(r.top),
              left: Math.round(r.left),
              width: Math.round(r.width),
              photoTop: pr ? Math.round(pr.top) : 0,
              contentTop: cr ? Math.round(cr.top) : 0
            };
          });
          return {
            viewMode: document.getElementById('grid').dataset.androidView,
            savedMode: localStorage.getItem('skalee.android.productsView'),
            hasToggle: Boolean(document.getElementById('androidProductsViewToggle')),
            rects
          };
        })()`);

        assert.equal(gridMetrics.hasToggle, true, `[${vp.name}] #androidProductsViewToggle must exist in #products`);
        assert.equal(gridMetrics.viewMode, 'grid', `[${vp.name}] default products view must be grid`);
        assert.equal(gridMetrics.rects.length, 4, `[${vp.name}] 4 seeded products must be rendered in #grid`);

        const firstRowTop = gridMetrics.rects[0].top;
        const cardsInFirstRow = gridMetrics.rects.filter((r) => Math.abs(r.top - firstRowTop) <= 4);
        assert.equal(
          cardsInFirstRow.length,
          vp.expectedGridCols,
          `[${vp.name}] Grade view must render ${vp.expectedGridCols} columns in first row, got ${cardsInFirstRow.length}: ${JSON.stringify(gridMetrics.rects)}`
        );
        assert.ok(
          gridMetrics.rects[0].contentTop > gridMetrics.rects[0].photoTop,
          `[${vp.name}] In Grade view, product content must be below photo`
        );

        // Switch to Lista view and verify 1-column horizontal layout + localStorage persistence
        await evaluate(`document.querySelector('#androidProductsViewToggle [data-android-view="list"]').click()`);
        await wait(60);
        await checkLayoutInvariants('products', 'tab-products-list');

        const listMetrics = await evaluate(`(() => {
          const cards = [...document.querySelectorAll('#products #grid .card')];
          const rects = cards.map(c => {
            const r = c.getBoundingClientRect();
            const photo = c.querySelector('.photo');
            const content = c.querySelector('.content');
            const pr = photo ? photo.getBoundingClientRect() : null;
            const cr = content ? content.getBoundingClientRect() : null;
            return {
              top: Math.round(r.top),
              left: Math.round(r.left),
              width: Math.round(r.width),
              photoLeft: pr ? Math.round(pr.left) : 0,
              photoRight: pr ? Math.round(pr.right) : 0,
              photoWidth: pr ? Math.round(pr.width) : 0,
              contentLeft: cr ? Math.round(cr.left) : 0
            };
          });
          return {
            viewMode: document.getElementById('grid').dataset.androidView,
            savedMode: localStorage.getItem('skalee.android.productsView'),
            rects
          };
        })()`);

        assert.equal(listMetrics.viewMode, 'list', `[${vp.name}] #grid dataset.androidView must be 'list'`);
        assert.equal(listMetrics.savedMode, 'list', `[${vp.name}] localStorage must persist 'list'`);
        assert.ok(
          listMetrics.rects[1].top > listMetrics.rects[0].top + 40,
          `[${vp.name}] Lista view must stack cards in a single vertical column`
        );
        assert.ok(
          listMetrics.rects[0].contentLeft >= listMetrics.rects[0].photoRight,
          `[${vp.name}] Lista view must place image on the left and content on the right (${JSON.stringify(listMetrics.rects[0])})`
        );

        // Verify clicking a card opens the correct Product Detail modal, then close it
        const detailResult = await evaluate(`(async () => {
          const secondCard = document.querySelectorAll('#products #grid .card')[1];
          secondCard.click();
          await new Promise(r => setTimeout(r, 180));
          const modal = document.getElementById('productDetailModal');
          const isOpen = Boolean(modal && !modal.hidden);
          const bodyText = document.getElementById('productDetailBody')?.textContent || '';
          const closeBtn = document.getElementById('productDetailClose');
          if (closeBtn) closeBtn.click();
          return { isOpen, hasProductName: bodyText.includes('Leite Fermentado Bob Esponja 480g') };
        })()`);
        assert.equal(detailResult.isOpen, true, `[${vp.name}] clicking product card must open #productDetailModal`);
        assert.equal(detailResult.hasProductName, true, `[${vp.name}] #productDetailModal must display the clicked product details`);

        // Verify search and filter chips on Products tab
        const filterResult = await evaluate(`(async () => {
          const searchInput = document.getElementById('search');
          searchInput.value = 'Mussarela';
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (typeof render === 'function') render();
          const afterSearchCount = document.querySelectorAll('#products #grid .card').length;

          searchInput.value = '';
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (typeof render === 'function') render();

          const offerChip = document.querySelector('#chips [data-filter="offer"]');
          if (offerChip) offerChip.click();
          if (typeof render === 'function') render();
          await new Promise(r => setTimeout(r, 30));
          const afterOfferChipCount = document.querySelectorAll('#products #grid .card').length;

          const allChip = document.querySelector('#chips [data-filter="all"]');
          if (allChip) allChip.click();
          if (typeof render === 'function') render();
          await new Promise(r => setTimeout(r, 30));
          const afterResetCount = document.querySelectorAll('#products #grid .card').length;

          return { afterSearchCount, afterOfferChipCount, afterResetCount };
        })()`);
        assert.equal(filterResult.afterSearchCount, 1, `[${vp.name}] search must filter products to matching item`);
        assert.equal(filterResult.afterOfferChipCount, 2, `[${vp.name}] offer filter chip must filter to 2 offer products`);
        assert.equal(filterResult.afterResetCount, 4, `[${vp.name}] resetting filter must restore all 4 products`);

        // Switch back to Grade view
        await evaluate(`document.querySelector('#androidProductsViewToggle [data-android-view="grid"]').click()`);
        await wait(50);

        // Audit now lives in Profile; the main navigation always retains Reports.
        for (const tabId of ['register', 'report', 'android-profile', 'android-home']) {
          await evaluate(`document.querySelector('#androidBottomNav [data-android-page="${tabId}"]').click()`);
          await wait(80);
          await checkLayoutInvariants(tabId, `tab-${tabId}`);
        }
      }

      // 1.2 Functional Verification: Store Sync with Central Skalee & IndexedDB Draft Banner
      await send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true
      });

      const todayIso = new Date().toISOString().slice(0, 10);

      // Helper to boot page with customizable authorized locations and login user
      const bootAndroidWithAuth = async ({ userId, email, locations }) => {
        await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
        for (let i = 0; i < 40; i++) {
          const ready = await evaluate('Boolean(window.SkaleeAndroidUI && window.SkaleeAndroidUI.active && window.skaleeRegistrationDraft)');
          if (ready) break;
          await wait(100);
        }
        await evaluate(`(async () => {
          document.body.classList.remove('auth-loading', 'auth-anonymous');
          document.body.classList.add('auth-authenticated');
          const authOverlay = document.getElementById('authOverlay');
          if (authOverlay) authOverlay.hidden = true;

          const sampleProducts = [
            { id: 'p-1', name: 'Produto Loja 1', code: '1001', barcode: '7890001', qty: 10, expiry: '${todayIso}', store: 'Loja 1', offer: false },
            { id: 'p-2', name: 'Produto Loja 2', code: '1002', barcode: '7890002', qty: 20, expiry: '${todayIso}', store: 'Loja 2', offer: true }
          ];

          window.skaleeDb = {
            listAllowedRetailLocationsForCurrentUser: async () => ${JSON.stringify(locations)},
            listAllowedSuppliersForCurrentUser: async () => [],
            loadProducts: async (criteria = {}) => {
              if (criteria.store) return sampleProducts.filter(p => p.store === criteria.store);
              return sampleProducts;
            },
            loadProductDashboardStats: async () => ({ products: 2, today: 2, seven: 2, thirty: 2, offer: 1 }),
            processOfflineSyncQueue: async () => {},
            subscribeValidityProducts: () => ({}),
            findActiveDuplicateValidityProduct: async () => null,
            saveProduct: async (p, options = {}) => {
              if (options.onCreated) await options.onCreated('saved-ok-1');
              return { ...p, id: 'saved-ok-1' };
            },
            updateProduct: async (id, changes) => ({ id, ...changes })
          };

          window.dispatchEvent(new CustomEvent('skalee:authenticated', {
            detail: { userId: '${userId}', email: '${email}', accessRole: 'editor' }
          }));
          await new Promise(r => setTimeout(r, 260));
        })()`);
      };

      const twoStores = [
        { id: 'loc-1', name: 'Loja 1', active: true },
        { id: 'loc-2', name: 'Loja 2', active: true }
      ];

      await evaluate(`localStorage.clear()`);
      await bootAndroidWithAuth({ userId: 'user-1', email: 'user1@skalee.dev', locations: twoStores });

      // Scenario 4a: Empty draft -> banner must be strictly hidden (both .hidden and 0 client rects)
      const initialBannerState = await evaluate(`(async () => {
        await window.SkaleeAndroidUI.evaluateAndroidHomeDraftBanner();
        const banner = document.getElementById('androidHomeDraftBanner');
        return {
          hidden: banner.hidden,
          rects: banner.getClientRects().length
        };
      })()`);
      assert.equal(initialBannerState.hidden, true, '[Phase 1.2] Draft banner must be hidden when no draft exists');
      assert.equal(initialBannerState.rects, 0, '[Phase 1.2] Draft banner must have 0 client rects when hidden');

      // Scenario 1: Select Loja 2 in header and open Central Skalee (Notifications)
      const selectLoja2State = await evaluate(`(async () => {
        const headerSelect = document.getElementById('androidHeaderStoreSelect');
        headerSelect.value = 'Loja 2';
        headerSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 80));

        document.getElementById('androidHeaderNotificationBtn').click();
        await new Promise(r => setTimeout(r, 120));

        const notifCenterStore = document.getElementById('notificationCenterStore');
        const notifSettingsStore = document.getElementById('notificationStore');
        const storeFilter = document.getElementById('storeFilter');
        const pill = document.getElementById('androidHomeStorePill');
        const panelOpen = !document.getElementById('personalPanel').hidden;

        if (typeof setPersonalPanelOpen === 'function') setPersonalPanelOpen(false);

        return {
          panelOpen,
          headerValue: headerSelect.value,
          storeFilterValue: storeFilter.value,
          notifCenterValue: notifCenterStore.value,
          notifSettingsValue: notifSettingsStore.value,
          savedNotifStore: localStorage.getItem('skalee.notification.store'),
          pillText: pill.textContent
        };
      })()`);
      assert.equal(selectLoja2State.panelOpen, true, '[Phase 1.2] Clicking notification bell must open Central Skalee');
      assert.equal(selectLoja2State.headerValue, 'Loja 2', '[Phase 1.2] Header selector must be Loja 2');
      assert.equal(selectLoja2State.storeFilterValue, 'Loja 2', '[Phase 1.2] #storeFilter must sync to Loja 2');
      assert.equal(selectLoja2State.notifCenterValue, 'Loja 2', '[Phase 1.2] #notificationCenterStore must open with Loja 2');
      assert.equal(selectLoja2State.notifSettingsValue, 'Loja 2', '[Phase 1.2] #notificationStore must sync to Loja 2');
      assert.equal(selectLoja2State.savedNotifStore, 'Loja 2', '[Phase 1.2] skalee.notification.store must be Loja 2');
      assert.equal(selectLoja2State.pillText, 'Loja 2', '[Phase 1.2] Home store pill must display Loja 2');

      // Scenario 3a: Close and reopen the app -> Loja 2 must be restored for user-1
      await bootAndroidWithAuth({ userId: 'user-1', email: 'user1@skalee.dev', locations: twoStores });
      const reopenedLoja2 = await evaluate(`(() => ({
        headerValue: document.getElementById('androidHeaderStoreSelect').value,
        storeFilterValue: document.getElementById('storeFilter').value,
        notifCenterValue: document.getElementById('notificationCenterStore').value,
        pillText: document.getElementById('androidHomeStorePill').textContent
      }))()`);
      assert.equal(reopenedLoja2.headerValue, 'Loja 2', '[Phase 1.2] Reopening app must restore Loja 2 in header');
      assert.equal(reopenedLoja2.storeFilterValue, 'Loja 2', '[Phase 1.2] Reopening app must restore Loja 2 in #storeFilter');
      assert.equal(reopenedLoja2.notifCenterValue, 'Loja 2', '[Phase 1.2] Reopening app must restore Loja 2 in #notificationCenterStore');
      assert.equal(reopenedLoja2.pillText, 'Loja 2', '[Phase 1.2] Reopening app must restore Loja 2 on Home pill');

      // Scenario 2: Switch between stores via Central Skalee and back to "Todas as lojas"
      const switchStoresState = await evaluate(`(async () => {
        const notifCenterStore = document.getElementById('notificationCenterStore');
        notifCenterStore.value = 'Loja 1';
        notifCenterStore.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 60));
        const afterNotifChange = {
          header: document.getElementById('androidHeaderStoreSelect').value,
          filter: document.getElementById('storeFilter').value
        };

        const headerSelect = document.getElementById('androidHeaderStoreSelect');
        headerSelect.value = '';
        headerSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 60));
        const afterAllStores = {
          header: headerSelect.value,
          filter: document.getElementById('storeFilter').value,
          notifCenter: notifCenterStore.value,
          pill: document.getElementById('androidHomeStorePill').textContent
        };

        return { afterNotifChange, afterAllStores };
      })()`);
      assert.equal(switchStoresState.afterNotifChange.header, 'Loja 1', '[Phase 1.2] Changing store in Central Skalee must update header');
      assert.equal(switchStoresState.afterNotifChange.filter, 'Loja 1', '[Phase 1.2] Changing store in Central Skalee must update #storeFilter');
      assert.equal(switchStoresState.afterAllStores.header, '', '[Phase 1.2] Selecting Todas as lojas must set empty string in header');
      assert.equal(switchStoresState.afterAllStores.filter, '', '[Phase 1.2] Selecting Todas as lojas must set empty string in #storeFilter');
      assert.equal(switchStoresState.afterAllStores.notifCenter, '', '[Phase 1.2] Selecting Todas as lojas must set empty string in #notificationCenterStore');
      assert.equal(switchStoresState.afterAllStores.pill, 'Todas as lojas', '[Phase 1.2] Home pill must show Todas as lojas');

      // Scenario 3b: Select Loja 2, then reopen app when Loja 2 is no longer authorized -> safe fallback
      await evaluate(`(() => {
        const headerSelect = document.getElementById('androidHeaderStoreSelect');
        headerSelect.value = 'Loja 2';
        headerSelect.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await bootAndroidWithAuth({
        userId: 'user-1',
        email: 'user1@skalee.dev',
        locations: [
          { id: 'loc-1', name: 'Loja 1', active: true },
          { id: 'loc-3', name: 'Loja 3', active: true }
        ]
      });
      const fallbackMultiState = await evaluate(`(() => ({
        header: document.getElementById('androidHeaderStoreSelect').value,
        filter: document.getElementById('storeFilter').value,
        notifCenter: document.getElementById('notificationCenterStore').value
      }))()`);
      assert.equal(fallbackMultiState.header, '', '[Phase 1.2] Unauthorized store with multiple allowed stores must fallback to Todas as lojas');
      assert.equal(fallbackMultiState.filter, '', '[Phase 1.2] #storeFilter must fallback to Todas as lojas');
      assert.equal(fallbackMultiState.notifCenter, '', '[Phase 1.2] #notificationCenterStore must fallback to Todas as lojas');

      // Scenario 4, 5 & 6: Empty IndexedDB entry, Valid Draft, Store/User Isolation, Discard, Complete, and Pending Photo/Uncertain Send
      await bootAndroidWithAuth({ userId: 'user-1', email: 'user1@skalee.dev', locations: twoStores });

      const draftLifecycle = await evaluate(`(async () => {
        const draftStore = window.SkaleeDraftStore.createStore(window.indexedDB);

        // 1) Write an empty/whitespace-only record directly to IndexedDB -> banner must remain hidden
        await draftStore.write('user-1', 'loc-1', {
          fields: { barcode: '   ', qty: '', expiry: '' },
          selected: null,
          photoFile: null,
          photoData: null,
          checkpoint: null
        });
        await window.SkaleeAndroidUI.evaluateAndroidHomeDraftBanner();
        const bannerEl = document.getElementById('androidHomeDraftBanner');
        const emptyRecordVisible = !bannerEl.hidden || bannerEl.getClientRects().length > 0;

        // 2) Select Loja 1 in Register form and fill valid draft data
        els.store.value = 'loc-1';
        els.store.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 80));
        selected = { name: 'Arroz Tipo 1 5kg', code: '501', barcode: '789501' };
        els.barcode.value = '789501';
        els.qty.value = '15';
        els.expiry.value = '2027-05-01';
        await window.skaleeRegistrationDraft.persist();
        await window.SkaleeAndroidUI.evaluateAndroidHomeDraftBanner();
        const validDraftOnAllStores = {
          hidden: bannerEl.hidden,
          rects: bannerEl.getClientRects().length,
          title: document.getElementById('androidHomeDraftTitle').textContent
        };

        // 3) Store isolation: Select Loja 2 in Android header -> banner must hide because draft is in Loja 1
        const headerSelect = document.getElementById('androidHeaderStoreSelect');
        headerSelect.value = 'Loja 2';
        headerSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 80));
        await window.SkaleeAndroidUI.evaluateAndroidHomeDraftBanner();
        const validDraftOnLoja2 = {
          hidden: bannerEl.hidden,
          rects: bannerEl.getClientRects().length
        };

        // 4) Switch header to Loja 1 -> banner must show again
        headerSelect.value = 'Loja 1';
        headerSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 80));
        await window.SkaleeAndroidUI.evaluateAndroidHomeDraftBanner();
        const validDraftOnLoja1 = {
          hidden: bannerEl.hidden,
          rects: bannerEl.getClientRects().length
        };

        // 5) Discard draft via els.clear -> banner must hide immediately
        els.clear.click();
        await new Promise(r => setTimeout(r, 80));
        await window.SkaleeAndroidUI.evaluateAndroidHomeDraftBanner();
        const afterDiscard = {
          hidden: bannerEl.hidden,
          rects: bannerEl.getClientRects().length,
          inDb: Boolean(await draftStore.read('user-1', 'loc-1'))
        };

        // 6) Fill draft again and complete registration via els.save -> banner must hide immediately
        selected = { name: 'Feijão Carioca 1kg', code: '502', barcode: '789502' };
        els.barcode.value = '789502';
        els.qty.value = '9';
        els.expiry.value = '2027-06-01';
        await window.skaleeRegistrationDraft.persist();
        await window.SkaleeAndroidUI.evaluateAndroidHomeDraftBanner();
        const beforeSaveVisible = !bannerEl.hidden;

        els.save.click();
        await new Promise(r => setTimeout(r, 160));
        await window.SkaleeAndroidUI.evaluateAndroidHomeDraftBanner();
        const afterComplete = {
          hidden: bannerEl.hidden,
          rects: bannerEl.getClientRects().length,
          inDb: Boolean(await draftStore.read('user-1', 'loc-1'))
        };

        // 7) Pending photo / uncertain send checkpoint must show banner and never be auto-deleted
        await draftStore.write('user-1', 'loc-1', {
          fields: { barcode: '', qty: '', expiry: '' },
          selected: null,
          photoData: null,
          checkpoint: { state: 'sending', queueId: 'q-99' }
        });
        await window.SkaleeAndroidUI.evaluateAndroidHomeDraftBanner();
        const uncertainSendBanner = {
          hidden: bannerEl.hidden,
          rects: bannerEl.getClientRects().length,
          title: document.getElementById('androidHomeDraftTitle').textContent,
          stillInDb: Boolean((await draftStore.read('user-1', 'loc-1'))?.checkpoint)
        };

        return {
          emptyRecordVisible,
          validDraftOnAllStores,
          validDraftOnLoja2,
          validDraftOnLoja1,
          afterDiscard,
          beforeSaveVisible,
          afterComplete,
          uncertainSendBanner
        };
      })()`);

      assert.equal(draftLifecycle.emptyRecordVisible, false, '[Phase 1.2] Empty IndexedDB record must NOT trigger draft banner');
      assert.equal(draftLifecycle.validDraftOnAllStores.hidden, false, '[Phase 1.2] Valid draft must show banner');
      assert.ok(draftLifecycle.validDraftOnAllStores.rects > 0, '[Phase 1.2] Valid draft banner must be visible on screen');
      assert.equal(draftLifecycle.validDraftOnAllStores.title, 'Rascunho automático salvo', '[Phase 1.2] Valid draft banner title');
      assert.equal(draftLifecycle.validDraftOnLoja2.hidden, true, '[Phase 1.2] Loja 1 draft must NOT show when Loja 2 is active');
      assert.equal(draftLifecycle.validDraftOnLoja2.rects, 0, '[Phase 1.2] Loja 1 draft must have 0 rects on Loja 2');
      assert.equal(draftLifecycle.validDraftOnLoja1.hidden, false, '[Phase 1.2] Loja 1 draft must show when switching back to Loja 1');
      assert.equal(draftLifecycle.afterDiscard.hidden, true, '[Phase 1.2] Discarding draft must immediately hide banner');
      assert.equal(draftLifecycle.afterDiscard.rects, 0, '[Phase 1.2] Discarded draft banner must have 0 rects');
      assert.equal(draftLifecycle.afterDiscard.inDb, false, '[Phase 1.2] Discarded draft must be removed from IndexedDB');
      assert.equal(draftLifecycle.beforeSaveVisible, true, '[Phase 1.2] Draft banner visible before save');
      assert.equal(draftLifecycle.afterComplete.hidden, true, '[Phase 1.2] Completing registration must immediately hide banner');
      assert.equal(draftLifecycle.afterComplete.rects, 0, '[Phase 1.2] Completed registration banner must have 0 rects');
      assert.equal(draftLifecycle.afterComplete.inDb, false, '[Phase 1.2] Completed registration draft must be removed from IndexedDB');
      assert.equal(draftLifecycle.uncertainSendBanner.hidden, false, '[Phase 1.2] Uncertain send checkpoint must show banner');
      assert.equal(draftLifecycle.uncertainSendBanner.title, 'Cadastro interrompido aguardando conclusão', '[Phase 1.2] Uncertain send banner title');
      assert.equal(draftLifecycle.uncertainSendBanner.stillInDb, true, '[Phase 1.2] Uncertain send checkpoint must NEVER be auto-deleted');

      // Scenario 6b: User isolation -> user-2 logs in and must not inherit user-1's store or user-1's draft banner
      await bootAndroidWithAuth({ userId: 'user-2', email: 'user2@skalee.dev', locations: twoStores });
      const user2Isolation = await evaluate(`(async () => {
        await window.SkaleeAndroidUI.evaluateAndroidHomeDraftBanner();
        const banner = document.getElementById('androidHomeDraftBanner');
        return {
          headerStore: document.getElementById('androidHeaderStoreSelect').value,
          notifStore: document.getElementById('notificationCenterStore').value,
          bannerHidden: banner.hidden,
          bannerRects: banner.getClientRects().length
        };
      })()`);
      assert.equal(user2Isolation.headerStore, '', '[Phase 1.2] user-2 must not inherit user-1 store selection');
      assert.equal(user2Isolation.notifStore, '', '[Phase 1.2] user-2 Central Skalee must not inherit user-1 store selection');
      assert.equal(user2Isolation.bannerHidden, true, '[Phase 1.2] user-2 must not see user-1 draft banner');
      assert.equal(user2Isolation.bannerRects, 0, '[Phase 1.2] user-2 draft banner must have 0 rects');
    }
  });

  // 2. Preserve the original desktop web UI. Mobile web is tested in test_mobile_navigation.cjs.
  await runBrowserSession({
    port: 3362,
    debugPort: 9362,
    isAndroid: false,
    testFn: async ({ send, evaluate, port }) => {
      for (const vp of [
        { name: 'pwa-tablet-1024x600', width: 1024, height: 600 },
        { name: 'pwa-desktop-1440x900', width: 1440, height: 900 }
      ]) {
        await send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: true
        });
        await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
        await wait(200);

        const pwaState = await evaluate(`(() => ({
          hasAndroidClass: document.documentElement.classList.contains('android-app') || document.body.classList.contains('android-app'),
          uiActive: Boolean(window.SkaleeAndroidUI?.active),
          hasAndroidHeader: Boolean(document.getElementById('androidHeader')),
          hasAndroidBottomNav: Boolean(document.getElementById('androidBottomNav')),
          hasAndroidHome: Boolean(document.getElementById('android-home')),
          hasAndroidProfile: Boolean(document.getElementById('android-profile')),
          hasAndroidViewToggle: Boolean(document.getElementById('androidProductsViewToggle')),
          hasWebMainNav: Boolean(document.querySelector('nav.main-nav'))
        }))()`);

        assert.equal(pwaState.hasAndroidClass, false, `[${vp.name}] PWA must never have .android-app class`);
        assert.equal(pwaState.uiActive, false, `[${vp.name}] SkaleeAndroidUI.active must be false in PWA`);
        assert.equal(pwaState.hasAndroidHeader, false, `[${vp.name}] #androidHeader must not exist in PWA`);
        assert.equal(pwaState.hasAndroidBottomNav, false, `[${vp.name}] #androidBottomNav must not exist in PWA`);
        assert.equal(pwaState.hasAndroidHome, false, `[${vp.name}] #android-home must not exist in PWA`);
        assert.equal(pwaState.hasAndroidProfile, false, `[${vp.name}] #android-profile must not exist in PWA`);
        assert.equal(pwaState.hasAndroidViewToggle, false, `[${vp.name}] #androidProductsViewToggle must not exist in PWA`);
        assert.equal(pwaState.hasWebMainNav, true, `[${vp.name}] nav.main-nav must exist in PWA`);
      }
    }
  });

  console.log('PASS: Android layout, Grade/Lista views, Central Skalee store sync, per-user persistence, IndexedDB draft banners, user/store isolation and desktop web preservation.');
}

module.exports = { runBrowserSession };
if (require.main === module) run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
