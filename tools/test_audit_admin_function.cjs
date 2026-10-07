const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('supabase/functions/admin-users/index.ts', 'utf8').replace(/^import .*;\s*/m, '');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
async function run({ admin = false, error = null, action = 'list', targetAdmin = false, token = 'test-token', email = 'any-admin@example.invalid' } = {}) {
 let handler, privilegedCalls = 0;
 const user = { id: 'actor', email };
 const userClient = {
  auth: { getUser: async () => ({ data: { user }, error }) },
  rpc: async name => { assert.equal(name, 'get_audit_access_context'); return { data: { is_admin: admin }, error: null }; }
 };
 const adminClient = { auth: { admin: {
  listUsers: async () => { privilegedCalls++; return { data: { users: [{ id: 'other-admin', email, app_metadata: { access_role: 'platform_admin' } }, { id:'ordinary', email:'ordinary@example.invalid', app_metadata:{} }] }, error: null }; },
  getUserById: async () => ({ data: { user: { app_metadata: { access_role: targetAdmin ? 'platform_admin' : 'editor' } } }, error:null }),
  updateUserById: async () => { privilegedCalls++; return { error: null }; }
 } } };
 vm.runInNewContext(javascript, {
  Deno: { env: { get: key => key }, serve: callback => { handler = callback; } },
  createClient: (_url,key) => key === 'SUPABASE_SERVICE_ROLE_KEY' ? adminClient : userClient,
  Request, Response, Date
 });
 const response = await handler(new Request('https://test.invalid', { method: 'POST', headers: token ? { Authorization: 'Bearer '+token } : {}, body: JSON.stringify({ action, id: 'target', active:false }) }));
 return { status:response.status, body:await response.json(), privilegedCalls };
}
(async () => {
 assert.equal((await run({token:''})).status,401);
 assert.equal((await run({error:{message:'invalid'}})).status,401);
 const ordinary = await run(); assert.equal(ordinary.status,403); assert.equal(ordinary.privilegedCalls,0);
 assert.equal((await run({email:'skalee.razarth@gmail.com'})).status,403,'Email cannot grant admin');
 const admin = await run({admin:true}); assert.equal(admin.status,200); assert.equal(admin.body.users[0].isAdmin,true); assert.equal(admin.body.users[1].isAdmin,false);
 assert.equal((await run({admin:true,action:'set_active',targetAdmin:true})).status,400,'All platform admins are protected');
 assert.equal((await run({admin:true,action:'set_active'})).status,200,'Existing activation API still works');
 assert.equal((await run({admin:true,action:'unknown'})).status,400);
 console.log('PASS: admin-users authentication, server authorization, no email bypass, role labels and activation protection.');
})().catch(error => { console.error(error); process.exitCode=1; });
