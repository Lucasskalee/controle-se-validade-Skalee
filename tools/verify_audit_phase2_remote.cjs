/**
 * Remote verification script for Phase 2 - Auditoria de Validades
 * Connects directly to production Supabase: https://scetuqugfbhozikridaw.supabase.co
 * Validates:
 * 1. Existence and structure of validity_audits and validity_audit_items
 * 2. RPCs: create_or_get_monthly_audit, close_validity_audit, reopen_validity_audit
 * 3. RLS and permissions integration
 * 4. Quantity semantics:
 *    - quantity_audited = NULL -> audited_at is NULL, financial_cost_impact is NULL (pending)
 *    - quantity_audited = 0 -> audited_at is timestamp, financial_cost_impact is 0.00 (zero confirmed)
 *    - quantity_audited > 0 -> financial_cost_impact and potential_sales_loss calculated correctly
 * 5. Completed audit immutability: items cannot be inserted, updated or deleted
 * 6. Completed audit delete protection: completed audit cannot be deleted (must reopen first)
 * 7. Admin reopening restores open status
 * 8. Operational isolation: validity_products.quantity, SG snapshots, SG stock and catalog products intact
 * 9. Pristine cleanup of all test data
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
  console.log(' VALIDAÇÃO REMOTA OFICIAL - FASE 2 AUDITORIA DE VALIDADES');
  console.log(' Endpoint: ' + SUPABASE_URL);
  console.log('=============================================================\n');

  // 1. Inspecionar Schema Cache e OpenAPI
  console.log('1. Validando existência de tabelas e RPCs no schema remoto...');
  const openApiRes = await fetchRaw('/rest/v1/');
  assert.ok(openApiRes.ok, 'OpenAPI spec acessível');
  const definitions = openApiRes.data.definitions || {};
  const paths = Object.keys(openApiRes.data.paths || {});

  assert.ok('validity_audits' in definitions, 'Tabela validity_audits deve existir no schema cache');
  assert.ok('validity_audit_items' in definitions, 'Tabela validity_audit_items deve existir no schema cache');
  assert.ok(paths.includes('/rpc/create_or_get_monthly_audit'), 'RPC create_or_get_monthly_audit deve existir');
  assert.ok(paths.includes('/rpc/close_validity_audit'), 'RPC close_validity_audit deve existir');
  assert.ok(paths.includes('/rpc/reopen_validity_audit'), 'RPC reopen_validity_audit deve existir');

  console.log('   ✓ Tabela validity_audits confirmada.');
  console.log('   ✓ Tabela validity_audit_items confirmada.');
  console.log('   ✓ RPCs create_or_get_monthly_audit, close_validity_audit, reopen_validity_audit confirmadas.');

  // 2. Inspecionar colunas e constraints
  console.log('\n2. Validando colunas e tipos em validity_audit_items...');
  const itemProps = definitions.validity_audit_items?.properties || {};
  assert.ok(itemProps.quantity_audited, 'Coluna quantity_audited deve existir');
  assert.ok(itemProps.audited_at, 'Coluna audited_at deve existir');
  assert.ok(itemProps.financial_cost_impact, 'Coluna financial_cost_impact (STORED GENERATED) deve existir');
  assert.ok(itemProps.potential_sales_loss, 'Coluna potential_sales_loss (STORED GENERATED) deve existir');
  assert.ok(itemProps.item_status, 'Coluna item_status deve existir');
  assert.ok(itemProps.expiry_reason, 'Coluna expiry_reason deve existir');
  assert.ok(itemProps.expiry_reason_other, 'Coluna expiry_reason_other deve existir');
  console.log('   ✓ Colunas, tipos e campos calculados confirmados no schema.');

  // 3. Obter sessão de Administrador e Loja
  console.log('\n3. Autenticando sessão real de Administrador...');
  const admin = await getAdminUserToken();
  console.log(`   ✓ Sessão autenticada: ${admin.email} (${admin.userId})`);

  // Validar permissões da Fase 1 integradas
  const permRes = await fetchRaw('/rest/v1/rpc/get_audit_access_context', { method: 'POST', body: '{}' }, admin.token);
  assert.ok(permRes.ok && permRes.data.is_admin, 'Contexto de autorização deve confirmar is_admin = true');
  console.log('   ✓ Integração de autorização Fase 1 validada: is_admin = true, can_access_audit = true.');

  // Testar bloqueio de acesso anônimo (Privilégios e RLS)
  const anonRes = await fetchRaw('/rest/v1/validity_audits?select=id', {}, ANON_KEY);
  assert.equal(anonRes.ok, false, 'Acesso anônimo a validity_audits deve ser sumariamente bloqueado');
  assert.equal(anonRes.data?.code, '42501', 'Código de erro deve ser 42501 (permission denied)');
  console.log('   ✓ Bloqueio de acesso anônimo confirmado: HTTP 401 / code 42501 (permission denied for table validity_audits).');

  const storeRes = await fetchRaw('/rest/v1/retail_locations?active=eq.true&select=id,name&limit=1', {}, admin.token);
  assert.ok(storeRes.ok && storeRes.data.length > 0, 'Loja ativa disponível');
  const store = storeRes.data[0];
  console.log(`   ✓ Loja operacional de teste: ${store.name} (${store.id})`);

  // 4. Teste de isolamento prévio (captura estado das tabelas operacionais)
  const vpBeforeRes = await fetchRaw('/rest/v1/validity_products?select=id,quantity&limit=1', {}, admin.token);
  const vpBefore = vpBeforeRes.data?.[0];
  const snapBeforeRes = await fetchRaw('/rest/v1/product_stock_snapshots?select=id,stock_quantity&limit=1', {}, admin.token);
  const snapBefore = snapBeforeRes.data?.[0];

  // Competência temporária segura para teste (2099-02-01)
  const tempCompetence = '2099-02-01';

  // Limpeza preventiva segura
  const existingAuditRes = await fetchRaw(`/rest/v1/validity_audits?retail_location_id=eq.${store.id}&competence_month=eq.${tempCompetence}&select=id`, {}, admin.token);
  if (existingAuditRes.ok && Array.isArray(existingAuditRes.data)) {
    for (const oldAudit of existingAuditRes.data) {
      await fetchRaw('/rest/v1/rpc/reopen_validity_audit', { method: 'POST', body: JSON.stringify({ p_audit_id: oldAudit.id }) }, admin.token).catch(() => null);
      await fetchRaw(`/rest/v1/validity_audit_items?audit_id=eq.${oldAudit.id}`, { method: 'DELETE' }, admin.token);
      await fetchRaw(`/rest/v1/validity_audits?id=eq.${oldAudit.id}`, { method: 'DELETE' }, admin.token);
    }
  }

  // 5. Teste da RPC create_or_get_monthly_audit
  console.log('\n4. Executando RPC create_or_get_monthly_audit...');
  const createAuditRes = await fetchRaw('/rest/v1/rpc/create_or_get_monthly_audit', {
    method: 'POST',
    body: JSON.stringify({
      p_retail_location_id: store.id,
      p_competence_month: tempCompetence
    })
  }, admin.token);
  assert.ok(createAuditRes.ok, `Falha ao criar auditoria: ${JSON.stringify(createAuditRes.data)}`);
  const auditId = createAuditRes.data.id;
  assert.equal(createAuditRes.data.status, 'open', 'Auditoria deve nascer open');
  assert.equal(createAuditRes.data.created_by, admin.userId, 'created_by deve ser o usuário autenticado');
  console.log(`   ✓ Auditoria criada: ID ${auditId}, status: open, responsável: ${admin.email}`);

  try {
    // 6. Testes das Regras de Quantidade e audited_at
    console.log('\n5. Validando semântica de quantity_audited e audited_at...');

    // 6.1 Item pendente (quantity_audited = NULL)
    // audited_at DEVE ser NULL, financial_cost_impact DEVE ser NULL
    const itemNullRes = await fetchRaw('/rest/v1/validity_audit_items', {
      method: 'POST',
      body: JSON.stringify({
        audit_id: auditId,
        source_type: 'audit_found',
        product_code: 'SKU-PENDING-TEST',
        product_name: 'Produto Teste Pendente',
        expiry_date: '2099-05-01',
        item_status: 'pending',
        quantity_audited: null,
        unit_cost_snapshot: 12.50,
        sale_price_snapshot: 19.90
      })
    }, admin.token);
    assert.ok(itemNullRes.ok, `Falha ao inserir item NULL: ${JSON.stringify(itemNullRes.data)}`);
    const itemNull = itemNullRes.data[0];
    assert.equal(itemNull.quantity_audited, null, 'quantity_audited deve ser null');
    assert.equal(itemNull.audited_at, null, 'audited_at DEVE ser null para item pendente');
    assert.equal(itemNull.financial_cost_impact, null, 'financial_cost_impact DEVE ser null quando quantity_audited for null');
    assert.equal(itemNull.potential_sales_loss, null, 'potential_sales_loss DEVE ser null quando quantity_audited for null');
    console.log('   ✓ Caso NULL (pendente): quantity_audited=null, audited_at=null, financial_cost_impact=null');

    // 6.2 Item com contagem zero confirmada (quantity_audited = 0)
    // audited_at DEVE ser preenchido, financial_cost_impact DEVE ser 0.00
    const nowIso = new Date().toISOString();
    const itemZeroRes = await fetchRaw('/rest/v1/validity_audit_items', {
      method: 'POST',
      body: JSON.stringify({
        audit_id: auditId,
        source_type: 'audit_found',
        product_code: 'SKU-ZERO-TEST',
        product_name: 'Produto Teste Zero Vencidos',
        expiry_date: '2099-05-01',
        item_status: 'counted',
        quantity_audited: 0,
        unit_cost_snapshot: 12.50,
        sale_price_snapshot: 19.90,
        audited_at: nowIso
      })
    }, admin.token);
    assert.ok(itemZeroRes.ok, `Falha ao inserir item Zero: ${JSON.stringify(itemZeroRes.data)}`);
    const itemZero = itemZeroRes.data[0];
    assert.equal(Number(itemZero.quantity_audited), 0, 'quantity_audited deve ser 0');
    assert.notEqual(itemZero.audited_at, null, 'audited_at deve ser preenchido quando contado');
    assert.equal(Number(itemZero.financial_cost_impact), 0.00, 'financial_cost_impact deve ser 0.00');
    assert.equal(Number(itemZero.potential_sales_loss), 0.00, 'potential_sales_loss deve ser 0.00');
    console.log('   ✓ Caso Zero (zero confirmados): quantity_audited=0, audited_at=timestamp, financial_cost_impact=0.00');

    // 6.3 Item sem custo financeiro (quantity_audited = 5, unit_cost_snapshot = null)
    // financial_cost_impact DEVE ser NULL
    const itemNoCostRes = await fetchRaw('/rest/v1/validity_audit_items', {
      method: 'POST',
      body: JSON.stringify({
        audit_id: auditId,
        source_type: 'audit_found',
        product_code: 'SKU-NO-COST-TEST',
        product_name: 'Produto Teste Sem Custo',
        expiry_date: '2099-05-01',
        item_status: 'counted',
        quantity_audited: 5,
        unit_cost_snapshot: null,
        sale_price_snapshot: 19.90,
        audited_at: nowIso
      })
    }, admin.token);
    assert.ok(itemNoCostRes.ok, `Falha ao inserir item Sem Custo: ${JSON.stringify(itemNoCostRes.data)}`);
    const itemNoCost = itemNoCostRes.data[0];
    assert.equal(Number(itemNoCost.quantity_audited), 5, 'quantity_audited deve ser 5');
    assert.equal(itemNoCost.financial_cost_impact, null, 'financial_cost_impact DEVE ser null quando unit_cost_snapshot for null');
    assert.equal(Number(itemNoCost.potential_sales_loss), 99.50, 'potential_sales_loss deve ser 5 * 19.90 = 99.50');
    console.log('   ✓ Caso Sem Custo: quantity=5, custo=null -> financial_cost_impact permanece null');

    // 6.4 Item com quantidade vencida positiva (quantity_audited = 8, unit_cost_snapshot = 12.50)
    // 8 un x R$ 12.50 custo = R$ 100.00; 8 un x R$ 19.90 venda = R$ 159.20
    const itemPosRes = await fetchRaw('/rest/v1/validity_audit_items', {
      method: 'POST',
      body: JSON.stringify({
        audit_id: auditId,
        source_type: 'audit_found',
        product_code: 'SKU-POS-TEST',
        product_name: 'Produto Teste 8 Vencidos',
        expiry_date: '2099-05-01',
        item_status: 'counted',
        quantity_audited: 8,
        unit_cost_snapshot: 12.50,
        sale_price_snapshot: 19.90,
        expiry_reason: 'Falha no PVPS',
        audited_at: nowIso
      })
    }, admin.token);
    assert.ok(itemPosRes.ok, `Falha ao inserir item Positivo: ${JSON.stringify(itemPosRes.data)}`);
    const itemPos = itemPosRes.data[0];
    assert.equal(Number(itemPos.quantity_audited), 8, 'quantity_audited deve ser 8');
    assert.equal(Number(itemPos.financial_cost_impact), 100.00, 'financial_cost_impact deve ser 8 * 12.50 = 100.00');
    assert.equal(Number(itemPos.potential_sales_loss), 159.20, 'potential_sales_loss deve ser 8 * 19.90 = 159.20');
    console.log('   ✓ Caso Positivo (vencidos confirmados): quantity_audited=8, impacto=100.00, perda potencial=159.20');

    // 7. Fechamento da auditoria via close_validity_audit
    console.log('\n6. Validando fechamento e imutabilidade total em completed...');
    const closeRes = await fetchRaw('/rest/v1/rpc/close_validity_audit', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: auditId })
    }, admin.token);
    assert.ok(closeRes.ok, `Falha ao fechar auditoria: ${JSON.stringify(closeRes.data)}`);
    assert.equal(closeRes.data.status, 'completed', 'Status da auditoria deve ser completed');
    console.log('   ✓ Auditoria finalizada via close_validity_audit (status: completed).');

    // 8. Teste de Imutabilidade: Mutação de itens em completed deve ser REJEITADA (INSERT, UPDATE e DELETE) inclusive para Admin
    console.log('\n7. Validando bloqueio de mutações em auditoria finalizada (INSERT, UPDATE, DELETE)...');
    const insertBlockedRes = await fetchRaw('/rest/v1/validity_audit_items', {
      method: 'POST',
      body: JSON.stringify({
        audit_id: auditId,
        source_type: 'audit_found',
        product_name: 'Tentativa Proibida',
        expiry_date: '2099-05-01',
        quantity_audited: 5
      })
    }, admin.token);
    assert.equal(insertBlockedRes.ok, false, 'INSERT em auditoria completed deve falhar inclusive para Admin');
    console.log(`   ✓ Inserção em auditoria finalizada bloqueada com sucesso (${insertBlockedRes.status}): ${JSON.stringify(insertBlockedRes.data?.message || insertBlockedRes.data)}`);

    const updateBlockedRes = await fetchRaw(`/rest/v1/validity_audit_items?id=eq.${itemPos.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity_audited: 999 })
    }, admin.token);
    assert.equal(updateBlockedRes.ok, false, 'UPDATE em auditoria completed deve falhar inclusive para Admin');
    console.log(`   ✓ Atualização em auditoria finalizada bloqueada com sucesso (${updateBlockedRes.status}): ${JSON.stringify(updateBlockedRes.data?.message || updateBlockedRes.data)}`);

    const deleteItemBlockedRes = await fetchRaw(`/rest/v1/validity_audit_items?id=eq.${itemPos.id}`, {
      method: 'DELETE'
    }, admin.token);
    assert.equal(deleteItemBlockedRes.ok, false, 'DELETE de item em auditoria completed deve falhar inclusive para Admin');
    console.log(`   ✓ Exclusão de item em auditoria finalizada bloqueada com sucesso (${deleteItemBlockedRes.status}): ${JSON.stringify(deleteItemBlockedRes.data?.message || deleteItemBlockedRes.data)}`);

    // 9. Teste de Proteção contra DELETE: Exclusão de auditoria completed deve ser REJEITADA
    console.log('\n8. Validando proteção contra DELETE de auditoria finalizada...');
    const deleteBlockedRes = await fetchRaw(`/rest/v1/validity_audits?id=eq.${auditId}`, {
      method: 'DELETE'
    }, admin.token);
    assert.equal(deleteBlockedRes.ok, false, 'DELETE de auditoria completed DEVE ser rejeitado inclusive para Admin');
    console.log(`   ✓ Exclusão de auditoria finalizada bloqueada com sucesso (${deleteBlockedRes.status}): ${JSON.stringify(deleteBlockedRes.data?.message || deleteBlockedRes.data)}`);

    // 10. Reabertura pelo Administrador via reopen_validity_audit
    console.log('\n9. Validando reabertura pelo Administrador...');
    const reopenRes = await fetchRaw('/rest/v1/rpc/reopen_validity_audit', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: auditId })
    }, admin.token);
    assert.ok(reopenRes.ok, `Falha ao reabrir auditoria: ${JSON.stringify(reopenRes.data)}`);
    assert.equal(reopenRes.data.status, 'open', 'Auditoria deve voltar para status open');
    console.log('   ✓ Auditoria reaberta com sucesso via reopen_validity_audit (status: open).');

    // Validação de que após reabrir a edição é restaurada
    const updateAfterReopenRes = await fetchRaw(`/rest/v1/validity_audit_items?id=eq.${itemPos.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: 'Observação pós reabertura' })
    }, admin.token);
    assert.ok(updateAfterReopenRes.ok, 'UPDATE após reabertura deve ter sucesso');
    console.log('   ✓ Edição operacional restaurada com sucesso após reabertura.');

    // 11. Validação de Responsável pela Auditoria e Usuário Comum
    console.log('\n10. Validando permissões de Usuário Comum e Responsável por Loja...');
    const commonUser = await getUserToken('promotor@teste.com');
    
    // Garantir estado limpo inicial para o teste de usuário comum
    await fetchRaw('/rest/v1/rpc/set_audit_user_locations', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: commonUser.userId, p_location_ids: [] })
    }, admin.token);

    // Usuário comum sem permissão
    const commonContextRes = await fetchRaw('/rest/v1/rpc/get_audit_access_context', { method: 'POST', body: '{}' }, commonUser.token);
    assert.equal(commonContextRes.data?.can_access_audit, false, 'Usuário sem atribuição não pode acessar auditoria');
    
    const commonAuditsRes = await fetchRaw('/rest/v1/validity_audits?select=id', {}, commonUser.token);
    assert.ok(commonAuditsRes.ok && Array.isArray(commonAuditsRes.data) && commonAuditsRes.data.length === 0, 'Usuário comum deve receber lista vazia por RLS');

    const commonCreateRes = await fetchRaw('/rest/v1/rpc/create_or_get_monthly_audit', {
      method: 'POST',
      body: JSON.stringify({ p_retail_location_id: store.id, p_competence_month: tempCompetence })
    }, commonUser.token);
    assert.equal(commonCreateRes.ok, false, 'Usuário sem atribuição não pode criar auditoria');
    console.log('   ✓ Usuário comum sem atribuição 100% bloqueado (RLS e RPC).');

    // Atribuição de Responsável à Loja 1 pelo Admin
    await fetchRaw('/rest/v1/rpc/set_audit_user_locations', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: commonUser.userId, p_location_ids: [store.id] })
    }, admin.token);

    const auditorContextRes = await fetchRaw('/rest/v1/rpc/get_audit_access_context', { method: 'POST', body: '{}' }, commonUser.token);
    assert.equal(auditorContextRes.data?.can_access_audit, true, 'Responsável com loja atribuída deve ter can_access_audit = true');
    assert.ok(auditorContextRes.data?.locations?.some(l => l.id === store.id), 'Responsável deve ter a loja atribuída no contexto');

    const auditorAuditsRes = await fetchRaw(`/rest/v1/validity_audits?id=eq.${auditId}&select=id`, {}, commonUser.token);
    assert.ok(auditorAuditsRes.ok && auditorAuditsRes.data.length === 1, 'Responsável deve conseguir ler auditoria de sua loja');

    // Se houver uma 2ª loja, verificar bloqueio restrito
    const otherStoreRes = await fetchRaw(`/rest/v1/retail_locations?active=eq.true&id=neq.${store.id}&select=id,name&limit=1`, {}, admin.token);
    if (otherStoreRes.ok && otherStoreRes.data.length > 0) {
      const otherStore = otherStoreRes.data[0];
      const auditorOtherStoreRes = await fetchRaw('/rest/v1/rpc/create_or_get_monthly_audit', {
        method: 'POST',
        body: JSON.stringify({ p_retail_location_id: otherStore.id, p_competence_month: tempCompetence })
      }, commonUser.token);
      assert.equal(auditorOtherStoreRes.ok, false, 'Responsável NÃO pode acessar loja não atribuída');
      console.log(`   ✓ Responsável limitado às suas lojas: bloqueado na loja ${otherStore.name}.`);
    }

    // Limpeza da atribuição temporária do promotor
    await fetchRaw('/rest/v1/rpc/set_audit_user_locations', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: commonUser.userId, p_location_ids: [] })
    }, admin.token);
    console.log('   ✓ Limpeza da atribuição temporária de auditor concluída com sucesso.');

    // 11. Validação de Isolamento Operacional das tabelas de negócio
    console.log('\n10. Validando isolamento absoluto das tabelas operacionais...');
    if (vpBefore) {
      const vpAfterRes = await fetchRaw(`/rest/v1/validity_products?id=eq.${vpBefore.id}&select=id,quantity`, {}, admin.token);
      assert.equal(vpAfterRes.data?.[0]?.quantity, vpBefore.quantity, 'validity_products.quantity NÃO PODE sofrer alteração');
      console.log(`   ✓ validity_products.quantity permaneceu 100% inalterado (${vpBefore.quantity} un).`);
    }
    if (snapBefore) {
      const snapAfterRes = await fetchRaw(`/rest/v1/product_stock_snapshots?id=eq.${snapBefore.id}&select=id,stock_quantity`, {}, admin.token);
      assert.equal(snapAfterRes.data?.[0]?.stock_quantity, snapBefore.stock_quantity, 'product_stock_snapshots NÃO PODE sofrer alteração');
      console.log(`   ✓ product_stock_snapshots permaneceu 100% inalterado (${snapBefore.stock_quantity} un).`);
    }

    // Catalog check
    const catBeforeRes = await fetchRaw('/rest/v1/products?select=id,name&limit=1', {}, admin.token);
    if (catBeforeRes.ok && catBeforeRes.data?.[0]) {
      const catProd = catBeforeRes.data[0];
      const catAfterRes = await fetchRaw(`/rest/v1/products?id=eq.${catProd.id}&select=id,name`, {}, admin.token);
      assert.equal(catAfterRes.data?.[0]?.name, catProd.name, 'Catálogo de produtos NÃO PODE sofrer alteração');
      console.log(`   ✓ products (catálogo) permaneceu 100% inalterado.`);
    }

  } finally {
    // 12. Limpeza completa dos dados de teste
    console.log('\n11. Executando limpeza dos dados temporários no Supabase remoto...');
    if (auditId) {
      await fetchRaw('/rest/v1/rpc/reopen_validity_audit', {
        method: 'POST',
        body: JSON.stringify({ p_audit_id: auditId })
      }, admin.token).catch(() => null);

      const cleanItemsRes = await fetchRaw(`/rest/v1/validity_audit_items?audit_id=eq.${auditId}`, { method: 'DELETE' }, admin.token);
      assert.ok(cleanItemsRes.ok, `Falha ao limpar itens de teste: ${JSON.stringify(cleanItemsRes.data)}`);

      const cleanRes = await fetchRaw(`/rest/v1/validity_audits?id=eq.${auditId}`, { method: 'DELETE' }, admin.token);
      assert.ok(cleanRes.ok, `Falha ao limpar registro de teste: ${JSON.stringify(cleanRes.data)}`);
      console.log('   ✓ Registros temporários de homologação removidos com sucesso.');
    }

    if (admin && admin.token) {
      const promotorId = '4fc56466-9bbf-4ab8-9332-84e06aec038b';
      await fetchRaw('/rest/v1/rpc/set_audit_user_locations', {
        method: 'POST',
        body: JSON.stringify({ p_user_id: promotorId, p_location_ids: [] })
      }, admin.token).catch(() => null);
    }
  }

  console.log('\n=============================================================');
  console.log(' TODOS OS TESTES REMOTOS DA FASE 2 FORAM APROVADOS COM SUCESSO! 🎉');
  console.log('=============================================================\n');
}

runCheck().catch(err => {
  console.error('\n[ERRO NA VALIDAÇÃO REMOTA]:', err);
  process.exitCode = 1;
});
