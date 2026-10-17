const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
 const base = path.join(root, process.env.TEST_WEB_ROOT || 'dist');
 const server = http.createServer((req, res) => {
  const file = path.resolve(base, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  let data = fs.readFileSync(file);
  if (file.endsWith('index.html')) data = data.toString().replace('<script type="module" src="auth.js"></script>', '');
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
  res.end(data);
 });
 await new Promise(resolve => server.listen(3358, '127.0.0.1', resolve));
 const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--disable-gpu', '--remote-debugging-port=9358',
  `--user-data-dir=${path.join(root, '.tmp', `android-drafts-${Date.now()}`)}`, 'about:blank'
 ], { stdio: 'ignore' });
 let socket, counter = 0;
 const pending = new Map();
 try {
  let targets;
  for (let i = 0; i < 40; i++) {
   try { targets = await (await fetch('http://127.0.0.1:9358/json')).json(); if (targets.length) break; } catch {}
   await wait(150);
  }
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
   const message = JSON.parse(data), item = pending.get(message.id);
   if (message.method === 'Page.javascriptDialogOpening') {
    console.log('Dialog in test:', message.params.message);
    socket.send(JSON.stringify({ id: ++counter, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
   }
   if (!item) return;
   pending.delete(message.id); clearTimeout(item.timer);
   if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
   const id = ++counter;
   const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
   pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
   let result;
   try { result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); }
   catch (error) { throw new Error(`${error.message}: ${expression.slice(0, 250)}`); }
   if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
   return result.result.value;
  };
  await send('Network.enable');
  await send('Page.enable');
  await send('Network.setBlockedURLs', { urls: ['https://*', 'http://*.supabase.co/*'] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.alert = message => { window.lastAlert = message; }; window.confirm = () => true;` });
  const load = async () => {
   await send('Page.navigate', { url: 'http://127.0.0.1:3358/index.html' });
   for (let i = 0; i < 50; i++) { if (await evaluate('Boolean(window.skaleeRegistrationDraft)')) break; await wait(100); }
   assert.equal(await evaluate('Boolean(window.skaleeRegistrationDraft)'), true);
   await evaluate(`window.skaleeDb = {
    listAllowedRetailLocationsForCurrentUser: async () => [{id:'a',name:'Loja A'},{id:'b',name:'Loja B'}],
    listAllowedSuppliersForCurrentUser: async () => [], loadProducts: async () => [],
    loadProductDashboardStats: async () => ({}), processOfflineSyncQueue: async () => {},
    subscribeValidityProducts: () => ({}), findActiveDuplicateValidityProduct: async () => null
   }; window.alert = m => { window.__alerts = (window.__alerts || []).concat(String(m)); }; window.testLogin = async id => {
    window.dispatchEvent(new CustomEvent('skalee:authenticated', {detail:{userId:id,email:id+'@test.local',accessRole:'editor'}}));
    await new Promise(r=>setTimeout(r,250));
   }; void 0;`);
  };
  await load();
  if (!process.env.TEST_WEB_ROOT) assert.equal(await evaluate(`typeof ZXingBrowser + ':' + typeof Html5Qrcode`), 'object:function');
  await evaluate(`(async()=>{
   await testLogin('alice'); els.store.value='a'; els.store.dispatchEvent(new Event('change',{bubbles:true}));
   await new Promise(r=>setTimeout(r,100));
   selected={name:'Produto teste',code:'42',barcode:'123'}; els.barcode.value='123'; els.qty.value='7'; els.expiry.value='2027-01-01';
   photoData={blob:new Blob(['image-content'],{type:'image/jpeg'}),extension:'jpg',contentType:'image/jpeg',width:1,height:1};
   selectedImageState={type:'processed',photoData,source:'upload'};
   await skaleeRegistrationDraft.persist();
  })()`);
  await load(); // New document: no in-memory form state survives.
  await evaluate(`testLogin('bob')`);
  assert.equal(await evaluate('els.qty.value'), '', 'Other user must never restore Alice');
  await evaluate(`testLogin('alice')`);
  assert.deepEqual(await evaluate(`({qty:els.qty.value,name:selected?.name,photo:photoData?.blob?.size})`), { qty:'7', name:'Produto teste', photo:13 });
  await evaluate(`(async()=>{els.store.value='b';els.store.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,100));})()`);
  assert.equal(await evaluate('els.qty.value'), '', 'Other store must have a separate form');
  await evaluate(`(async()=>{els.store.value='a';els.store.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,100));})()`);
  assert.equal(await evaluate('els.qty.value'), '7');
  await evaluate(`(async()=>{
   window.createCalls=0;window.updateCalls=0;
   skaleeDb.saveProduct=async(p,options)=>{createCalls++;await options.onCreated('saved-42');return {...p,id:'saved-42',photoUploadError:'Falha simulada'};};
   skaleeDb.updateProduct=async(id)=>{updateCalls++;return {id,name:'Produto teste',qty:7,expiry:'2027-01-01',store:'Loja A'};};
   els.save.click();await new Promise(r=>setTimeout(r,200));
  })()`);
  assert.equal(await evaluate('skaleeRegistrationDraft.pending()'), 'photo-pending');
  assert.equal(await evaluate(`(async()=>{const d=await SkaleeDraftStore.createStore(indexedDB).read('alice','a');return d.photoData.blob.size;})()`), 13);
  await evaluate(`(async()=>{els.save.click();await new Promise(r=>setTimeout(r,200));})()`);
  assert.deepEqual(await evaluate('({create:createCalls,update:updateCalls,qty:els.qty.value})'), {create:1,update:1,qty:''});
  assert.equal(await evaluate(`(async()=>!(await SkaleeDraftStore.createStore(indexedDB).read('alice','a')))()`), true);
  await evaluate(`(async()=>{
   skaleeDb.saveProduct=async(p,options)=>{const id='offline_'+(++createCalls);await options.onQueued(id);return {...p,id,isOffline:true};};
   for(let i=0;i<2;i++){
    selected={name:'Offline '+i,code:String(i)};els.qty.value='2';els.expiry.value='2027-01-01';els.save.click();await new Promise(r=>setTimeout(r,150));
   }
  })()`);
  assert.equal(await evaluate(`(async()=> (await SkaleeDraftStore.createStore(indexedDB).list('alice')).filter(d=>d.originalStoreId==='a').length)()`), 2);
  assert.equal(await evaluate('els.qty.value'), '', 'Offline queue must allow another registration');
  await evaluate(`(async()=>{
   await skaleeRegistrationDraft.synced('offline_2',{id:'online-2',draftStoreId:'a'},'alice');
   await skaleeRegistrationDraft.synced('offline_3',{id:'online-3',draftStoreId:'a',photoUploadError:'Foto pendente'},'alice');
   document.getElementById('draftPending').click();await new Promise(r=>setTimeout(r,150));
  })()`);
  assert.equal(await evaluate('skaleeRegistrationDraft.pending()'), 'photo-pending');
  await evaluate(`(async()=>{els.save.click();await new Promise(r=>setTimeout(r,150));})()`);
  assert.equal(await evaluate(`(async()=> (await SkaleeDraftStore.createStore(indexedDB).list('alice')).length)()`), 0);
  // Native result uses the same real browser compression pipeline and owner checks.
  await evaluate(`(async()=>{
   window.ticket=await skaleeRegistrationDraft.prepareCamera();
   const db=SkaleeDraftStore.createStore(indexedDB),d=await db.read('alice','a');
   const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;
   const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
   await db.write('alice','a',{...d,photoFile:new File([blob],'native.png',{type:'image/png'}),photoData:null,cameraResultId:ticket.id});
   await skaleeRegistrationDraft.receiveNativePhoto(ticket);
  })()`);
  assert.equal(await evaluate('photoData.blob.size <= 180*1024'), true);
  await evaluate(`testLogin('bob')`);
  assert.equal(await evaluate('skaleeRegistrationDraft.receiveNativePhoto(ticket)'), false);
  assert.equal(await evaluate('photoData === null'), true);
  await evaluate(`testLogin('alice')`);
  // An uncertain result is retained and cannot silently trigger another insert.
  await evaluate(`(async()=>{selected={name:'Pendente',code:'1'};els.qty.value='1';els.expiry.value='2027-01-01';await skaleeRegistrationDraft.begin();})()`);
  await load(); await evaluate(`testLogin('alice')`);
  assert.equal(await evaluate('skaleeRegistrationDraft.pending()'), 'sending');
  assert.equal(await evaluate(`(async()=>{try{await skaleeRegistrationDraft.begin();return false;}catch{return true;}})()`), true);
  console.log('PASS: browser reload, local libraries, user/store isolation, image compression/recovery, offline multi-registration, upload retry and uncertain-send guard.');
 } finally { socket?.close(); chrome.kill(); server.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
