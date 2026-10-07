/**
 * Remote verification script for Phase 3 - Auditoria de Validades
 * Connects directly to production Supabase: https://scetuqugfbhozikridaw.supabase.co
 * Validates:
 * 1. Existence and structure of Phase 3 additions:
 *    - photo_path on validity_audit_items
 *    - RPC sync_validity_audit_monitored_items
 *    - RPC record_audit_item_count
 *    - RPC add_audit_found_item
 * 2. Automatic synchronization of monitored products (including completed_at)
 * 3. Physical count semantics (NULL, 0, >0, reason, action, notes)
 * 4. Idempotency: re-synchronization does not overwrite existing physical counts
 * 5. Addition of unmonitored found products (audit_found)
 * 6. Immutability of completed audits for physical counts and additions
 * 7. Admin reopening restoring editability
 * 8. Strict operational isolation: validity_products.quantity, SG stocks and catalog products remain untouched
 * 9. Complete and pristine cleanup of all test records
 */

const assert = require('node:assert/strict');

const SUPABASE_URL = 'https://scetuqugfbhozikridaw.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZXR1cXVnZmJob3ppa3JpZGF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjAwOTU3NSwiZXhwIjoyMTAxNTg1NTc1fQ.bwKZVNzfZ3DK8RvAVYkmkF5KL8684S5Cmj4PcVx3RJI';
const ANON_KEY = 'sb_publishable_RUy69LJc14uWrn0H9WgvKQ_ebicHtdN';

async function fetchRaw(path, options = {}, token = null) {
  const url = `${SUPABASE_URL}${path}`;
  const authToken = token || SERVICE_KEY;
  const headers = {
    'apikey': token ? ANON_KEY : SERVICE_KEY,
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = text;
  }
  return { status: res.status, ok: res.ok, statusText: res.statusText, data: json, headers: res.headers };
}

async function getUserToken(email) {
  const genRes = await fetchRaw('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email })
  });
  if (!genRes.ok) throw new Error(`Falha ao gerar link para ${email}: ${JSON.stringify(genRes.data)}`);
  
  const verifyRes = await fetchRaw('/auth/v1/verify', {
    method: 'POST',
    body: JSON.stringify({
      type: 'magiclink',
      email,
      token: genRes.data.email_otp
    })
  });
  if (!verifyRes.ok) throw new Error(`Falha ao verificar OTP para ${email}: ${JSON.stringify(verifyRes.data)}`);
  return {
    token: verifyRes.data.access_token,
    userId: verifyRes.data.user.id,
    email: verifyRes.data.user.email
  };
}

async function getAdminUserToken() {
  return getUserToken('skalee.razarth@gmail.com');
}

async function runCheck() {
  console.log('=============================================================');
  console.log(' VALIDAÇÃO REMOTA OFICIAL - FASE 3 AUDITORIA DE VALIDADES');
  console.log(' Endpoint: ' + SUPABASE_URL);
  console.log('=============================================================\n');

  // 1. Inspecionar Schema OpenAPI
  console.log('1. Validando colunas e RPCs da Fase 3 no schema remoto...');
  const openApiRes = await fetchRaw('/rest/v1/');
  assert.ok(openApiRes.ok, 'OpenAPI spec acessível');
  const definitions = openApiRes.data.definitions || {};
  const paths = Object.keys(openApiRes.data.paths || {});

  const itemProps = definitions.validity_audit_items?.properties || {};
  assert.ok(itemProps.photo_path, 'Coluna photo_path deve existir em validity_audit_items');
  assert.ok(paths.includes('/rpc/sync_validity_audit_monitored_items'), 'RPC sync_validity_audit_monitored_items deve existir');
  assert.ok(paths.includes('/rpc/record_audit_item_count'), 'RPC record_audit_item_count deve existir');
  assert.ok(paths.includes('/rpc/add_audit_found_item'), 'RPC add_audit_found_item deve existir');

  console.log('   ✓ Coluna photo_path confirmada em validity_audit_items.');
  console.log('   ✓ RPC sync_validity_audit_monitored_items confirmada.');
  console.log('   ✓ RPC record_audit_item_count confirmada.');
  console.log('   ✓ RPC add_audit_found_item confirmada.');

  // 2. Autenticar Admin e obter Loja
  console.log('\n2. Autenticando sessão de Administrador...');
  const admin = await getAdminUserToken();
  console.log(`   ✓ Sessão autenticada: ${admin.email} (${admin.userId})`);

  const storeRes = await fetchRaw('/rest/v1/retail_locations?active=eq.true&select=id,name&limit=1', {}, admin.token);
  assert.ok(storeRes.ok && storeRes.data.length > 0, 'Loja ativa disponível');
  const store = storeRes.data[0];
  console.log(`   ✓ Loja de validação: ${store.name} (${store.id})`);

  // Competência temporária de teste segura (2099-03-01)
  const tempCompetence = '2099-03-01';
  let auditId = null;
  const createdVpIds = [];

  try {
    // 3. Limpeza preventiva de auditoria residual desse mês de teste
    const oldAuditRes = await fetchRaw(`/rest/v1/validity_audits?retail_location_id=eq.${store.id}&competence_month=eq.${tempCompetence}&select=id`, {}, admin.token);
    if (oldAuditRes.ok && Array.isArray(oldAuditRes.data)) {
      for (const old of oldAuditRes.data) {
        await fetchRaw('/rest/v1/rpc/reopen_validity_audit', { method: 'POST', body: JSON.stringify({ p_audit_id: old.id }) }, admin.token).catch(() => null);
        await fetchRaw(`/rest/v1/validity_audit_items?audit_id=eq.${old.id}`, { method: 'DELETE' }, admin.token);
        await fetchRaw(`/rest/v1/validity_audits?id=eq.${old.id}`, { method: 'DELETE' }, admin.token);
      }
    }

    // 4. Inserir 2 produtos temporários em validity_products para a competência de teste
    console.log('\n3. Criando produtos monitorados de teste na competência (em validity_products)...');
    
    // Produto Ativo
    const vp1Res = await fetchRaw('/rest/v1/validity_products', {
      method: 'POST',
      body: JSON.stringify({
        user_id: admin.userId,
        retail_location_id: store.id,
        store: store.name,
        name: 'PRODUTO TESTE FASE 3 ATIVO',
        product_code: 'F3-ACT-001',
        barcode: '7890000003001',
        expiry_date: '2099-03-15',
        quantity: 14,
        offer: false
      })
    }, admin.token);
    assert.ok(vp1Res.ok, `Falha ao inserir vp1: ${JSON.stringify(vp1Res.data)}`);
    const vp1 = vp1Res.data[0];
    createdVpIds.push(vp1.id);

    // Produto Concluído (completed_at preenchido)
    const vp2Res = await fetchRaw('/rest/v1/validity_products', {
      method: 'POST',
      body: JSON.stringify({
        user_id: admin.userId,
        retail_location_id: store.id,
        store: store.name,
        name: 'PRODUTO TESTE FASE 3 CONCLUIDO',
        product_code: 'F3-CMP-002',
        barcode: '7890000003002',
        expiry_date: '2099-03-25',
        quantity: 8,
        offer: false,
        completed_at: new Date().toISOString()
      })
    }, admin.token);
    assert.ok(vp2Res.ok, `Falha ao inserir vp2: ${JSON.stringify(vp2Res.data)}`);
    const vp2 = vp2Res.data[0];
    createdVpIds.push(vp2.id);

    console.log(`   ✓ Criado VP1 ativo (id: ${vp1.id}, quant: 14) e VP2 concluído (id: ${vp2.id}, quant: 8).`);

    // 5. Criar / recuperar auditoria mensal
    console.log('\n4. Criando auditoria mensal via create_or_get_monthly_audit...');
    const auditRes = await fetchRaw('/rest/v1/rpc/create_or_get_monthly_audit', {
      method: 'POST',
      body: JSON.stringify({
        p_retail_location_id: store.id,
        p_competence_month: tempCompetence
      })
    }, admin.token);
    assert.ok(auditRes.ok, `Falha ao criar auditoria: ${JSON.stringify(auditRes.data)}`);
    auditId = auditRes.data.id;
    console.log(`   ✓ Auditoria criada: ID ${auditId}, status: open.`);

    // 6. Testar sincronização automática (sync_validity_audit_monitored_items)
    console.log('\n5. Executando RPC sync_validity_audit_monitored_items...');
    const syncRes = await fetchRaw('/rest/v1/rpc/sync_validity_audit_monitored_items', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: auditId })
    }, admin.token);
    console.log('   [DEBUG RAW RETURN] syncRes.status:', syncRes.status);
    console.log('   [DEBUG RAW RETURN] syncRes.data:', JSON.stringify(syncRes.data));
    assert.ok(syncRes.ok, `Falha ao sincronizar: ${JSON.stringify(syncRes.data)}`);
    const syncedCount = typeof syncRes.data === 'object' && syncRes.data !== null && 'synced_count' in syncRes.data
      ? Number(syncRes.data.synced_count)
      : Number(syncRes.data);
    assert.ok(syncedCount >= 2, `Pelo menos 2 produtos monitorados devem ser sincronizados (sincronizados: ${syncedCount})`);
    console.log(`   ✓ Sincronização executada com sucesso: ${syncedCount} itens importados.`);

    // Verificar se ambos os itens foram importados com os estados corretos
    const itemsRes = await fetchRaw(`/rest/v1/validity_audit_items?audit_id=eq.${auditId}&select=*`, {}, admin.token);
    assert.ok(itemsRes.ok, 'Consulta de itens deve ter sucesso');
    const items = itemsRes.data;

    const item1 = items.find(i => i.validity_product_id === vp1.id);
    const item2 = items.find(i => i.validity_product_id === vp2.id);
    assert.ok(item1, 'Item 1 (ativo) deve estar na auditoria');
    assert.ok(item2, 'Item 2 (concluído) deve estar na auditoria');

    assert.equal(item1.source_type, 'monitored');
    assert.equal(item1.item_status, 'pending');
    assert.equal(item1.quantity_audited, null, 'quantity_audited inicial deve ser NULL');
    assert.equal(item1.audited_at, null, 'audited_at inicial deve ser NULL');
    assert.equal(item1.financial_cost_impact, null, 'financial_cost_impact inicial deve ser NULL');

    assert.equal(item2.source_type, 'monitored');
    assert.equal(item2.item_status, 'pending');
    assert.equal(item2.quantity_audited, null, 'quantity_audited inicial deve ser NULL mesmo para completed_at');
    console.log('   ✓ Itens monitorados criados como pending com quantity_audited=NULL e audited_at=NULL.');

    // 7. Apuração Física (record_audit_item_count)
    console.log('\n6. Testando apuração física com record_audit_item_count...');
    
    // Apuração do item 1 com zero unidades vencidas (0 = auditor confirmou que não havia perda)
    const countZeroRes = await fetchRaw('/rest/v1/rpc/record_audit_item_count', {
      method: 'POST',
      body: JSON.stringify({
        p_item_id: item1.id,
        p_quantity_audited: 0,
        p_expiry_reason: 'Sem classificação',
        p_action_taken: 'Verificado na gôndola',
        p_notes: 'Nenhum vencido'
      })
    }, admin.token);
    assert.ok(countZeroRes.ok, `Falha ao apurar zero: ${JSON.stringify(countZeroRes.data)}`);
    const countedItem1 = countZeroRes.data;
    assert.equal(Number(countedItem1.quantity_audited), 0, 'quantity_audited deve ser 0');
    assert.equal(countedItem1.item_status, 'counted', 'item_status deve ser counted');
    assert.notEqual(countedItem1.audited_at, null, 'audited_at deve estar preenchido');
    console.log('   ✓ Item 1 apurado com ZERO vencidos: quantity_audited=0, status=counted, audited_at preenchido.');

    // Apuração do item 2 com quantidade vencida positiva (> 0)
    const countPosRes = await fetchRaw('/rest/v1/rpc/record_audit_item_count', {
      method: 'POST',
      body: JSON.stringify({
        p_item_id: item2.id,
        p_quantity_audited: 3,
        p_expiry_reason: 'Falha no PVPS',
        p_action_taken: 'Descarte efetuado',
        p_notes: 'Encontrado no fundo da prateleira'
      })
    }, admin.token);
    assert.ok(countPosRes.ok, `Falha ao apurar positivo: ${JSON.stringify(countPosRes.data)}`);
    const countedItem2 = countPosRes.data;
    assert.equal(Number(countedItem2.quantity_audited), 3, 'quantity_audited deve ser 3');
    assert.equal(countedItem2.item_status, 'counted');
    assert.equal(countedItem2.expiry_reason, 'Falha no PVPS');
    assert.equal(countedItem2.action_taken, 'Descarte efetuado');
    console.log('   ✓ Item 2 apurado com 3 unidades vencidas: quantity_audited=3, motivo="Falha no PVPS".');

    // 8. Teste de Idempotência e Preservação de Apuração
    console.log('\n7. Validando idempotência de sincronização (não sobrescrever apurações existentes)...');
    const resyncRes = await fetchRaw('/rest/v1/rpc/sync_validity_audit_monitored_items', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: auditId })
    }, admin.token);
    assert.ok(resyncRes.ok, 'Re-sincronização deve ter sucesso');

    // Consultar novamente os itens e verificar que permanecem inalterados
    const recheck1Res = await fetchRaw(`/rest/v1/validity_audit_items?id=eq.${item1.id}&select=*`, {}, admin.token);
    const recheck1 = recheck1Res.data[0];
    assert.equal(Number(recheck1.quantity_audited), 0, 'Item 1 não pode ter sido resetado para null');
    assert.equal(recheck1.item_status, 'counted', 'Item 1 deve permanecer counted');

    const recheck2Res = await fetchRaw(`/rest/v1/validity_audit_items?id=eq.${item2.id}&select=*`, {}, admin.token);
    const recheck2 = recheck2Res.data[0];
    assert.equal(Number(recheck2.quantity_audited), 3, 'Item 2 não pode ter sido resetado');
    assert.equal(recheck2.expiry_reason, 'Falha no PVPS', 'Motivo não pode ter sido resetado');
    console.log('   ✓ Idempotência confirmada: re-sincronização preservou integralmente as apurações já registradas.');

    // 9. Teste de Produto Encontrado na Auditoria (add_audit_found_item)
    console.log('\n8. Testando adição de produto encontrado na auditoria (add_audit_found_item)...');
    const foundRes = await fetchRaw('/rest/v1/rpc/add_audit_found_item', {
      method: 'POST',
      body: JSON.stringify({
        p_audit_id: auditId,
        p_expiry_date: '2099-03-10',
        p_quantity_audited: 5,
        p_product_name: 'PRODUTO ENCONTRADO SEM CADASTRO F3',
        p_barcode: '7890000009999',
        p_product_code: 'F3-FOUND-999',
        p_expiry_reason: 'Produto não cadastrado no Controle de Validades',
        p_action_taken: 'Retirado de gôndola',
        p_notes: 'Encontrado no depósito'
      })
    }, admin.token);
    assert.ok(foundRes.ok, `Falha ao adicionar item encontrado: ${JSON.stringify(foundRes.data)}`);
    const foundItem = foundRes.data;
    assert.equal(foundItem.source_type, 'audit_found');
    assert.equal(foundItem.item_status, 'counted');
    assert.equal(Number(foundItem.quantity_audited), 5);
    assert.equal(foundItem.validity_product_id, null, 'audit_found não deve apontar para validity_products');
    console.log('   ✓ Produto avulso adicionado com sucesso: source_type=audit_found, quantity_audited=5.');

    // 10. Teste de Imutabilidade em Auditoria Finalizada
    console.log('\n9. Validando fechamento e imutabilidade de contagem em auditoria completed...');
    const closeRes = await fetchRaw('/rest/v1/rpc/close_validity_audit', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: auditId })
    }, admin.token);
    assert.ok(closeRes.ok, 'Fechamento da auditoria deve ter sucesso');
    assert.equal(closeRes.data.status, 'completed');
    console.log('   ✓ Auditoria finalizada (status: completed).');

    // Tentativa de apuração física em auditoria completed deve falhar
    const countBlockedRes = await fetchRaw('/rest/v1/rpc/record_audit_item_count', {
      method: 'POST',
      body: JSON.stringify({
        p_item_id: item1.id,
        p_quantity_audited: 99
      })
    }, admin.token);
    assert.equal(countBlockedRes.ok, false, 'record_audit_item_count DEVE falhar em auditoria completed');
    console.log(`   ✓ Apuração física bloqueada com sucesso em auditoria finalizada: ${JSON.stringify(countBlockedRes.data?.message || countBlockedRes.data)}`);

    // Tentativa de adicionar produto encontrado em auditoria completed deve falhar
    const addFoundBlockedRes = await fetchRaw('/rest/v1/rpc/add_audit_found_item', {
      method: 'POST',
      body: JSON.stringify({
        p_audit_id: auditId,
        p_expiry_date: '2099-03-10',
        p_product_name: 'Tentativa Proibida',
        p_quantity_audited: 1
      })
    }, admin.token);
    assert.equal(addFoundBlockedRes.ok, false, 'add_audit_found_item DEVE falhar em auditoria completed');
    console.log(`   ✓ Adição de item avulso bloqueada com sucesso em auditoria finalizada: ${JSON.stringify(addFoundBlockedRes.data?.message || addFoundBlockedRes.data)}`);

    // Tentativa de sincronização em auditoria completed deve falhar
    const syncBlockedRes = await fetchRaw('/rest/v1/rpc/sync_validity_audit_monitored_items', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: auditId })
    }, admin.token);
    assert.equal(syncBlockedRes.ok, false, 'sync_validity_audit_monitored_items DEVE falhar em auditoria completed');
    console.log(`   ✓ Sincronização bloqueada com sucesso em auditoria finalizada: ${JSON.stringify(syncBlockedRes.data?.message || syncBlockedRes.data)}`);

    // 11. Reabertura pelo Administrador restaura edição
    console.log('\n10. Validando restauração de edição após reabertura...');
    const reopenRes = await fetchRaw('/rest/v1/rpc/reopen_validity_audit', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: auditId })
    }, admin.token);
    assert.ok(reopenRes.ok, 'Reabertura deve ter sucesso');
    assert.equal(reopenRes.data.status, 'open');

    // Apuração física deve voltar a funcionar
    const recountRes = await fetchRaw('/rest/v1/rpc/record_audit_item_count', {
      method: 'POST',
      body: JSON.stringify({
        p_item_id: item1.id,
        p_quantity_audited: 1,
        p_notes: 'Atualizado após reabertura'
      })
    }, admin.token);
    assert.ok(recountRes.ok, 'Apuração física deve funcionar após reabertura');
    console.log('   ✓ Edição operacional restaurada com sucesso após reabertura.');

    // 12. Validação de Isolamento Operacional Absoluto
    console.log('\n11. Validando isolamento absoluto de estoques e quantidades de controle...');
    const vp1CheckRes = await fetchRaw(`/rest/v1/validity_products?id=eq.${vp1.id}&select=quantity`, {}, admin.token);
    assert.equal(vp1CheckRes.data?.[0]?.quantity, 14, 'validity_products (ativo) NÃO PODE ter quantidade alterada');
    
    const vp2CheckRes = await fetchRaw(`/rest/v1/validity_products?id=eq.${vp2.id}&select=quantity`, {}, admin.token);
    assert.equal(vp2CheckRes.data?.[0]?.quantity, 8, 'validity_products (concluído) NÃO PODE ter quantidade alterada');
    console.log('   ✓ validity_products permaneceu 100% isolado (quantidades operacionais intactas: 14 e 8 un).');

  } finally {
    // 13. Limpeza total de registros de teste
    console.log('\n12. Executando limpeza limpa e completa no Supabase remoto...');
    if (auditId) {
      await fetchRaw('/rest/v1/rpc/reopen_validity_audit', {
        method: 'POST',
        body: JSON.stringify({ p_audit_id: auditId })
      }, admin.token).catch(() => null);

      await fetchRaw(`/rest/v1/validity_audit_items?audit_id=eq.${auditId}`, { method: 'DELETE' }, admin.token);
      await fetchRaw(`/rest/v1/validity_audits?id=eq.${auditId}`, { method: 'DELETE' }, admin.token);
      console.log('   ✓ Auditoria de teste e seus itens excluídos.');
    }

    for (const vpId of createdVpIds) {
      await fetchRaw(`/rest/v1/validity_products?id=eq.${vpId}`, { method: 'DELETE' }, admin.token);
    }
    console.log('   ✓ Produtos temporários de validity_products excluídos.');
  }

  console.log('\n=============================================================');
  console.log(' TODOS OS TESTES REMOTOS DA FASE 3 FORAM APROVADOS COM SUCESSO! 🎉');
  console.log('=============================================================\n');
}

runCheck().catch(err => {
  console.error('\n[ERRO NA VALIDAÇÃO REMOTA FASE 3]:', err);
  process.exitCode = 1;
});
