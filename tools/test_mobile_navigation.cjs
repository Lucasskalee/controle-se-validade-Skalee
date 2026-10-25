const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runBrowserSession } = require('./verify_android_ui.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Exercise the real online query builder and offline selector against date boundaries.
function verifyQueryParity() {
  const source = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
  const functionSource = name => source.slice(source.indexOf(`function ${name}(`)).split(/\r?\nfunction /)[0];
  const context = {
    sanitizePostgrestSearchTerm: value => String(value || ''),
    localDateKeyFromOffset: days => new Date(Date.UTC(2026, 9, 18 + days)).toISOString().slice(0, 10),
    remainingDays: date => (Date.parse(date) - Date.UTC(2026, 9, 18)) / 86400000,
    productHasSupplier: (p, value) => value.split(/[,;]/).includes(p.supplierCode)
  };
  vm.createContext(context);
  vm.runInContext(functionSource('applyProductQueryCriteria') + '\n' + functionSource('filterAndSortProductsLocally'), context);
  const products = [-2, -1, 0, 1, 7, 8].map((day, i) => ({
    id: String(day), expiry: context.localDateKeyFromOffset(day), qty: i % 2 ? 120 : 5,
    offer: i % 2 === 0, store: 'Loja A', supplierCode: '10'
  }));
  for (const expiryRange of [null, 'expired_today', 'today', '3', '7', '15']) {
    for (const offerStatus of [null, 'offer', 'no_offer']) {
      for (const highQuantity of [false, true]) {
        const criteria = { store: 'Loja A', supplier: '10;20', filters: { expiryRange, offerStatus, highQuantity } };
        const checks = [];
        const fields = { expiry_date: 'expiry', quantity: 'qty', supplier_code: 'supplierCode' };
        const query = {};
        for (const op of ['eq', 'gte', 'lte', 'in']) query[op] = (field, value) => {
          checks.push(p => {
            const actual = p[fields[field] || field];
            return op === 'eq' ? actual === value : op === 'gte' ? actual >= value : op === 'lte' ? actual <= value : value.includes(actual);
          });
          return query;
        };
        context.applyProductQueryCriteria(query, criteria);
        const online = products.filter(p => checks.every(check => check(p))).map(p => p.id).sort();
        const offline = Array.from(context.filterAndSortProductsLocally(products, criteria), p => p.id).sort();
        assert.deepEqual(online, offline, JSON.stringify(criteria));
        if (expiryRange === 'expired_today' && !offerStatus && !highQuantity) assert.deepEqual(online, ['-1', '-2', '0']);
        if (expiryRange === '7' && !offerStatus && !highQuantity) assert.deepEqual(online, ['0', '1', '7']);
      }
    }
  }
  console.log('PASS: 36 online/offline filter combinations, expiry boundaries and supplier multiselect.');
}

async function run() {
  verifyQueryParity();
  const sessions = [
    { isAndroid: true, port: 3370, debugPort: 9370 },
    { isAndroid: false, port: 3372, debugPort: 9372 }
  ];
  for (const session of sessions) {
    const { isAndroid, port, debugPort } = session;
    await runBrowserSession({ port, debugPort, isAndroid, testFn: async ({ send, evaluate, port }) => {
      if (!isAndroid) await send('Emulation.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
      });
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        window.__swUnregisterCalls = 0;
        navigator.serviceWorker.getRegistrations = async () => [{ unregister: async () => { window.__swUnregisterCalls++; } }];
      ` });
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
      for (let i = 0; i < 50; i++) {
        if (await evaluate('Boolean(window.SkaleeAndroidUI?.active && window.skaleeAuditAccess)')) break;
        await wait(100);
      }
      await evaluate(`(async () => {
        document.body.classList.remove('auth-loading', 'auth-anonymous');
        document.body.classList.add('auth-authenticated');
        document.getElementById('authScreen').hidden = true;
        appAuthenticated = true;
        activeUserEmail = 'operador@teste.local';
        isViewer = false;
        allowedLocations = [{id:'loc-1',name:'Loja A',active:true}];
        allowedSuppliers = null;
        scheduleProductQueryReload = () => {};
        window.__reportLoads = 0;
        window.__auditContext = {can_access_audit:false,is_admin:false,locations:[]};
        const day = offset => { const d = new Date(); d.setDate(d.getDate()+offset); return localDateKey(d); };
        window.__products = [
          {id:'expired',name:'Leite integral',expiry:day(-1),offer:true,qty:120},
          {id:'today',name:'Iogurte natural',expiry:day(0),offer:false,qty:10},
          {id:'soon',name:'Queijo minas',expiry:day(7),offer:true,qty:130},
          {id:'later',name:'Manteiga',expiry:day(8),offer:false,qty:20}
        ].map(p=>({...p,store:'Loja A',supplierCode:'10',code:p.id}));
        window.skaleeDb = {
          loadAuditAccessContext: async () => window.__auditContext,
          loadProducts: async () => { window.__reportLoads++; return window.__products.filter(p=>remaining(p.expiry)>=0); }
        };
        products = window.__products.slice(); dashboardStats = null;
        render();
        await window.skaleeAuditAccess.refresh();
        window.SkaleeAndroidUI.navigateAndroidTab('android-home');
        window.SkaleeAndroidUI.syncAndroidData();
      })()`);
      const labels = await evaluate(`Array.from(document.querySelectorAll('#androidBottomNav button'), b=>b.textContent.trim())`);
      assert.deepEqual(labels, ['Início','Produtos','Cadastrar','Relatórios','Perfil']);
      assert.equal(await evaluate('window.__swUnregisterCalls'), isAndroid ? 1 : 0, 'Mobile web keeps its service worker');
      assert.deepEqual(await evaluate(`['Expired','Expiring','Offer'].map(n=>document.getElementById('androidKpi'+n+'Value').textContent)`), ['2','2','2']);

      const visibleIds = () => evaluate(`Array.from(document.querySelectorAll('#grid [data-product-id]'), c=>c.dataset.productId).sort()`);
      await evaluate(`document.getElementById('androidKpiExpired').click()`);
      assert.deepEqual(await visibleIds(), ['expired','today']);
      assert.equal(await evaluate(`document.querySelector('[data-filter="expired_today"]').getAttribute('aria-pressed')`), 'true');
      await evaluate(`document.querySelector('[data-filter="offer"]').click(); document.querySelector('[data-filter="high"]').click(); render()`);
      assert.deepEqual(await visibleIds(), ['expired']);
      await evaluate(`window.SkaleeAndroidUI.navigateAndroidTab('android-home'); document.getElementById('androidKpiExpiring').click()`);
      assert.deepEqual(await visibleIds(), ['soon'], 'KPI preserves offer and quantity filters');
      assert.deepEqual(await evaluate('({...activeFilters})'), {expiryRange:'7',offerStatus:'offer',highQuantity:true});
      await evaluate(`activeFilters.offerStatus='no_offer'; document.getElementById('androidKpiOffer').click()`);
      assert.deepEqual(await visibleIds(), ['soon'], 'Offer KPI retains expiry and quantity');
      await evaluate(`resetActiveFilters(); render()`);
      assert.deepEqual(await visibleIds(), ['later','soon','today'], 'Reset retains original active-only semantics');

      await evaluate(`document.querySelector('#androidBottomNav [data-android-page="report"]').click()`);
      await wait(60);
      assert.equal(await evaluate('reportProductsLoaded && window.__reportLoads > 0'), true, 'Common user report loads');
      assert.equal(await evaluate(`document.querySelector('#androidBottomNav [aria-current="page"]').dataset.androidPage`), 'report');
      await evaluate(`document.querySelector('#androidBottomNav [data-android-page="android-profile"]').click()`);
      assert.equal(await evaluate(`document.getElementById('androidProfileAuditBtn').hidden`), true);
      await evaluate(`document.getElementById('androidProfileAuditBtn').hidden=false; document.getElementById('androidProfileAuditBtn').click()`);
      assert.equal(await evaluate('window.SkaleeAndroidUI.getCurrentTab()'), 'android-profile', 'Forcing visibility cannot grant audit access');
      // An authorized operator, without the admin role, gets the audit entry.
      await evaluate(`(async()=>{ window.__auditContext={can_access_audit:true,is_admin:false,locations:[]}; await window.skaleeAuditAccess.refresh(); })()`);
      assert.equal(await evaluate(`document.getElementById('androidProfileAuditBtn').hidden`), false);
      await evaluate(`document.getElementById('androidProfileAuditBtn').click()`);
      await wait(50);
      assert.equal(await evaluate('window.SkaleeAndroidUI.getCurrentTab()'), 'audit');
      assert.equal(await evaluate(`document.querySelector('#androidBottomNav [aria-current="page"]').dataset.androidPage`), 'android-profile');
      await evaluate(`(async()=>{ window.__auditContext={can_access_audit:false,locations:[]}; await window.skaleeAuditAccess.refresh(); })()`);
      assert.notEqual(await evaluate('window.SkaleeAndroidUI.getCurrentTab()'), 'audit', 'Revocation closes audit');
      await evaluate(`isViewer=true; window.SkaleeAndroidUI.syncAndroidData(); window.SkaleeAndroidUI.navigateAndroidTab('register')`);
      assert.notEqual(await evaluate('window.SkaleeAndroidUI.getCurrentTab()'), 'register');
      assert.equal(await evaluate(`document.querySelector('#androidBottomNav [data-android-page="register"]').disabled`), true);
      await evaluate(`isViewer=false; window.SkaleeAndroidUI.syncAndroidData(); window.SkaleeAndroidUI.navigateAndroidTab('android-home')`);

      for (const width of [320,360,390,430,768,1440,390]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        await wait(80);
        const active = isAndroid || width <= 767;
        assert.equal(await evaluate('window.SkaleeAndroidUI.active'), active);
        const state = await evaluate(`(() => {
          const nav = document.getElementById('androidBottomNav');
          const app = document.getElementById('protectedApp');
          return { visible:nav.getClientRects().length>0, width:document.documentElement.scrollWidth,
            bottom:nav.getBoundingClientRect().bottom, padding:parseFloat(getComputedStyle(app).paddingBottom),
            navHeight:nav.getBoundingClientRect().height,
            pages:Array.from(document.querySelectorAll('.page')).filter(p=>p.getClientRects().length).map(p=>p.id) };
        })()`);
        assert.equal(state.visible, active);
        assert.equal(state.pages.length, 1, 'Exactly one visible page after resizing');
        if (state.width > width + 1) {
          console.log('Overflow', {width, state}, await evaluate(`({innerWidth, clientWidth:document.documentElement.clientWidth, viewport:document.querySelector('meta[name="viewport"]').content, styles:[document.documentElement,document.body,document.getElementById('protectedApp')].map(e=>{const s=getComputedStyle(e);return {tag:e.tagName,display:s.display,width:s.width,minWidth:s.minWidth,maxWidth:s.maxWidth,position:s.position,transform:s.transform}}), elements:Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>${width}+1).slice(-16).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right}))})`));
          const shot = await send('Page.captureScreenshot',{format:'png'});
          fs.writeFileSync(path.join(__dirname,'../.tmp/mobile-review/overflow.png'),Buffer.from(shot.data,'base64'));
        }
        assert.ok(state.width <= width + 1, `No horizontal page overflow at ${width}px (actual ${state.width}px)`);
        if (active) {
          assert.ok(Math.abs(state.bottom-844) <= 1);
          assert.ok(state.padding >= state.navHeight + 16, 'Content clears the raised center button');
          await evaluate(`window.SkaleeAndroidUI.navigateAndroidTab('android-home')`);
          for (const theme of ['light','dark']) {
            await evaluate(`document.documentElement.dataset.theme='${theme}'`);
            const sizes = await evaluate(`Array.from(document.querySelectorAll('.android-kpi-card')).map(c=>({
              width:c.clientWidth, scroll:c.scrollWidth,
              font:parseFloat(getComputedStyle(c.querySelector('strong')).fontSize)
            }))`);
            assert.ok(sizes.every(s=>s.width>=s.scroll && s.font>=30), 'Readable KPI values without clipping');
            if ([360,390].includes(width)) {
              const shot = await send('Page.captureScreenshot', {format:'png'});
              fs.mkdirSync(path.join(__dirname,'../.tmp/mobile-review'),{recursive:true});
              fs.writeFileSync(path.join(__dirname,`../.tmp/mobile-review/${isAndroid?'android':'iphone'}-${width}-${theme}.png`),Buffer.from(shot.data,'base64'));
            }
          }
        }
      }
    } });
    console.log(`PASS: ${isAndroid?'Android':'iPhone-sized web'} navigation, reports, permissions, KPI filters, layouts and safe footer spacing.`);
  }
}
run().catch(error=>{ console.error(error); process.exitCode=1; });
