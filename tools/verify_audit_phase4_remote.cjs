/**
 * Remote verification script for Phase 4 - Fechamento, Histórico, Reabertura e Relatório Auditável
 * Runs against production Supabase with full isolation and clean tear-down.
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
  return { status: res.status, ok: res.ok, statusText: res.statusText, data: json };
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
  if (!verifyRes.ok) throw new Error(`Falha ao verificar token para ${email}: ${JSON.stringify(verifyRes.data)}`);
  return verifyRes.data.access_token;
}

async function run() {
  console.log('=============================================================');
  console.log(' VALIDAÇÃO REMOTA OFICIAL - FASE 4 AUDITORIA DE VALIDADES');
  console.log(' Endpoint: ' + SUPABASE_URL);
  console.log('=============================================================\n');

  // 1. Obter token de Admin (skalee.razarth@gmail.com)
  console.log('1. Autenticando com credenciais de Administrador da Plataforma...');
  const adminToken = await getUserToken('skalee.razarth@gmail.com');
  assert.ok(adminToken, 'Token admin deve ser obtido');
  console.log('   ✓ Administrador autenticado com sucesso.\n');

  // 2. Verificar estrutura remota da Fase 4
  console.log('2. Validando schema e RPCs da Fase 4 no Supabase remoto...');
  const auditsCols = await fetchRaw('/rest/v1/validity_audits?select=id,revision_number,reopen_reason,conclusion_summary,closure_snapshot,action_plan&limit=1', {}, adminToken);
  assert.equal(auditsCols.ok, true, 'Colunas da Fase 4 em validity_audits devem existir');

  const eventsTable = await fetchRaw('/rest/v1/validity_audit_lifecycle_events?limit=1', {}, adminToken);
  assert.equal(eventsTable.ok, true, 'Tabela validity_audit_lifecycle_events deve existir');
  console.log('   ✓ Tabela de ciclo de vida e novas colunas de controle confirmadas.\n');

  // 3. Obter uma loja ativa existente para teste isolado
  const storesRes = await fetchRaw('/rest/v1/retail_locations?select=id,name&active=eq.true&limit=1', {}, adminToken);
  assert.ok(storesRes.data?.length > 0, 'Deve haver ao menos 1 loja ativa');
  const storeId = storesRes.data[0].id;
  const storeName = storesRes.data[0].name;

  // Usar uma competência futura de teste isolada para não conflitar com dados reais
  const testMonth = '2027-11-01';
  let testAuditId = null;

  try {
    console.log(`3. Criando auditoria de teste isolada para loja "${storeName}" na competência ${testMonth}...`);
    // Limpar se já existir teste anterior
    await fetchRaw(`/rest/v1/validity_audits?retail_location_id=eq.${storeId}&competence_month=eq.${testMonth}`, {
      method: 'DELETE'
    });

    const createAuditRes = await fetchRaw('/rest/v1/rpc/create_or_get_monthly_audit', {
      method: 'POST',
      body: JSON.stringify({
        p_retail_location_id: storeId,
        p_competence_month: testMonth
      })
    }, adminToken);
    assert.equal(createAuditRes.ok, true, 'Criação da auditoria deve ter sucesso: ' + JSON.stringify(createAuditRes.data));
    testAuditId = createAuditRes.data.id;
    assert.ok(testAuditId, 'ID da auditoria de teste deve existir');
    console.log(`   ✓ Auditoria de teste criada com ID: ${testAuditId}\n`);

    // 4. Testar Diagnóstico de Auditoria Vazia
    console.log('4. Testando Diagnóstico Pré-Fechamento em auditoria vazia...');
    const revEmpty = await fetchRaw('/rest/v1/rpc/review_validity_audit', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: testAuditId })
    }, adminToken);
    assert.equal(revEmpty.ok, true, 'review_validity_audit deve responder OK');
    assert.equal(revEmpty.data.can_close, false, 'Auditoria vazia NÃO pode ser fechada');
    assert.equal(revEmpty.data.total_items, 0, 'Total de itens deve ser 0');
    console.log('   ✓ Diagnóstico bloqueou fechamento de auditoria vazia.\n');

    // 5. Inserir itens de teste (1 com perda e custo, 1 com zero perda, 1 com perda sem custo)
    console.log('5. Inserindo itens para apuração física e teste de conciliação...');
    const item1Res = await fetchRaw('/rest/v1/rpc/add_audit_found_item', {
      method: 'POST',
      body: JSON.stringify({
        p_audit_id: testAuditId,
        p_expiry_date: '2027-11-15',
        p_quantity_audited: null, // Pendente inicialmente
        p_product_name: 'TESTE FASE 4 - Item Leite Condensado',
        p_barcode: '789999990001',
        p_product_code: 'F4-001',
        p_expiry_reason: 'Falha no PVPS'
      })
    }, adminToken);
    assert.equal(item1Res.ok, true, 'Item 1 deve ser criado');
    const item1Id = item1Res.data.id;

    const item2Res = await fetchRaw('/rest/v1/rpc/add_audit_found_item', {
      method: 'POST',
      body: JSON.stringify({
        p_audit_id: testAuditId,
        p_expiry_date: '2027-11-20',
        p_quantity_audited: null, // Pendente inicialmente
        p_product_name: 'TESTE FASE 4 - Item Iogurte Sem Perda',
        p_barcode: '789999990002',
        p_product_code: 'F4-002',
        p_expiry_reason: 'Sem classificação'
      })
    }, adminToken);
    assert.equal(item2Res.ok, true, 'Item 2 deve ser criado');
    const item2Id = item2Res.data.id;

    // Verificar bloqueio por item pendente (NULL)
    const revPending = await fetchRaw('/rest/v1/rpc/review_validity_audit', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: testAuditId })
    }, adminToken);
    assert.equal(revPending.data.can_close, false, 'Itens com quantity_audited NULL devem bloquear');
    assert.equal(revPending.data.pending_items, 2, 'Devem constar 2 pendentes');
    console.log('   ✓ Itens pendentes identificados e bloqueantes.\n');

    // Apuração:
    // Item 1: 4 unidades vencidas, custo unitário simulado
    // Como audit_found não tinha snapshot de custo SG nesta loja teste, atualizamos o snapshot diretamente via REST (admin) para testar cálculo
    await fetchRaw(`/rest/v1/validity_audit_items?id=eq.${item1Id}`, {
      method: 'PATCH',
      body: JSON.stringify({ unit_cost_snapshot: 5.50, sale_price_snapshot: 8.90 })
    });
    const count1Res = await fetchRaw('/rest/v1/rpc/record_audit_item_count', {
      method: 'POST',
      body: JSON.stringify({
        p_item_id: item1Id,
        p_quantity_audited: 4,
        p_expiry_reason: 'Falha no PVPS',
        p_action_taken: 'Descarte e reposição',
        p_notes: 'Encontrado atrás de lote novo'
      })
    }, adminToken);
    assert.equal(count1Res.ok, true, 'Apuração item 1 OK');

    // Item 2: 0 unidades (conferido sem perda)
    const count2Res = await fetchRaw('/rest/v1/rpc/record_audit_item_count', {
      method: 'POST',
      body: JSON.stringify({
        p_item_id: item2Id,
        p_quantity_audited: 0,
        p_expiry_reason: 'Sem classificação'
      })
    }, adminToken);
    assert.equal(count2Res.ok, true, 'Apuração item 2 com zero perda OK');

    // Item 3: Adicionar item com perda positiva por Excesso de compra sem custo cadastrado (alerta)
    const item3Res = await fetchRaw('/rest/v1/rpc/add_audit_found_item', {
      method: 'POST',
      body: JSON.stringify({
        p_audit_id: testAuditId,
        p_expiry_date: '2027-11-28',
        p_quantity_audited: 2,
        p_product_name: 'TESTE FASE 4 - Item Sem Custo SG',
        p_barcode: '789999990003',
        p_product_code: 'F4-003',
        p_expiry_reason: 'Excesso de compra',
        p_action_taken: 'Devolução fornecedor'
      })
    }, adminToken);
    assert.equal(item3Res.ok, true, 'Item 3 criado OK');

    console.log('   ✓ 3 itens apurados: 4 un com perda (R$ 22.00), 0 un sem perda, 2 un sem custo.\n');

    // 6. Testar Transição para ready_for_review
    console.log('6. Testando transição para ready_for_review...');
    const readyRes = await fetchRaw('/rest/v1/rpc/mark_audit_ready_for_review', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: testAuditId })
    }, adminToken);
    assert.equal(readyRes.ok, true, 'mark_audit_ready_for_review deve ser aprovado: ' + JSON.stringify(readyRes.data));
    assert.equal(readyRes.data.status, 'ready_for_review', 'Status deve ser ready_for_review');
    console.log('   ✓ Auditoria marcada como "Pronta para fechamento" com sucesso.\n');

    // 7. Testar Fechamento Oficial (close_validity_audit)
    console.log('7. Testando Fechamento Oficial (close_validity_audit) com snapshot imutável...');
    const conclusionSummary = 'Fechamento de teste da Fase 4 homologado.';
    const conclusionCritical = 'Item de laticínios apresentou falha no PVPS.';
    const conclusionRec = 'Ajustar procedimentos operacionais.';
    const actionPlan = [
      { point: 'Falha no PVPS', action: 'Treinamento equipe', responsible: 'Auditor Chefe', deadline: '2027-12-01', status: 'Pendente' }
    ];

    const closeRes = await fetchRaw('/rest/v1/rpc/close_validity_audit', {
      method: 'POST',
      body: JSON.stringify({
        p_audit_id: testAuditId,
        p_conclusion_summary: conclusionSummary,
        p_conclusion_critical_points: conclusionCritical,
        p_conclusion_recommendations: conclusionRec,
        p_conclusion_notes: 'Validação remota automatizada',
        p_action_plan: actionPlan
      })
    }, adminToken);
    assert.equal(closeRes.ok, true, 'close_validity_audit deve ter sucesso: ' + JSON.stringify(closeRes.data));
    const closed = closeRes.data;
    assert.equal(closed.status, 'completed', 'Status deve ser completed');
    assert.ok(closed.closed_at, 'closed_at deve estar preenchido');
    assert.ok(closed.closure_snapshot, 'closure_snapshot oficial deve estar preenchido');
    assert.equal(closed.closure_snapshot.reconciliation.is_balanced, true, 'Conciliação matemática deve ser 100% balanceada');
    assert.equal(Number(closed.closure_snapshot.reconciliation.sum_items_cost), 22.00, 'Impacto apurado deve ser R$ 22.00 (4 x 5.50)');
    console.log('   ✓ Auditoria finalizada, imutável e snapshot oficial congelado com conciliação perfeita.\n');

    // 8. Testar Imutabilidade
    console.log('8. Testando Imutabilidade pós-fechamento...');
    const mutateAttempt = await fetchRaw('/rest/v1/rpc/record_audit_item_count', {
      method: 'POST',
      body: JSON.stringify({ p_item_id: item1Id, p_quantity_audited: 99 })
    }, adminToken);
    assert.equal(mutateAttempt.ok, false, 'Mutação de item em auditoria completed DEVE ser rejeitada');
    console.log('   ✓ Mutação bloqueada com sucesso pela trigger de segurança.\n');

    // 9. Testar Reabertura Controlada (reopen_validity_audit)
    console.log('9. Testando Reabertura Controlada com motivo obrigatório...');
    // Tentativa sem motivo
    const reopenNoReason = await fetchRaw('/rest/v1/rpc/reopen_validity_audit', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: testAuditId, p_reason: '' })
    }, adminToken);
    assert.equal(reopenNoReason.ok, false, 'Reabertura sem motivo DEVE ser rejeitada');

    // Reabertura com motivo válido
    const reopenReason = 'Correção de contagem solicitada pela Controladoria de Teste';
    const reopenRes = await fetchRaw('/rest/v1/rpc/reopen_validity_audit', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: testAuditId, p_reason: reopenReason })
    }, adminToken);
    assert.equal(reopenRes.ok, true, 'Reabertura com motivo deve ser aprovada');
    assert.equal(reopenRes.data.status, 'open', 'Status deve voltar para open');
    assert.equal(reopenRes.data.revision_number, 2, 'Revisão deve ser incrementada para 2');
    assert.equal(reopenRes.data.reopen_reason, reopenReason, 'Motivo da reabertura deve ser gravado');
    console.log('   ✓ Auditoria reaberta com motivo registrado e revisão incrementada para Versão 2.\n');

    // 10. Testar Histórico de Auditorias (list_validity_audits_history)
    console.log('10. Testando Histórico de Auditorias Anteriores...');
    const histRes = await fetchRaw('/rest/v1/rpc/list_validity_audits_history', {
      method: 'POST',
      body: JSON.stringify({ p_retail_location_id: storeId, p_year: 2027 })
    }, adminToken);
    assert.equal(histRes.ok, true, 'Histórico deve retornar 200 OK');
    const histAudit = histRes.data.find(a => a.id === testAuditId);
    assert.ok(histAudit, 'Auditoria de teste deve estar listada no histórico');
    assert.equal(histAudit.revision_number, 2, 'Histórico deve mostrar revisão 2');
    assert.equal(histAudit.total_items, 3, 'Total de 3 itens');
    console.log('   ✓ Histórico recuperado com sucesso com métricas e número de revisão.\n');

    // 11. Testar Geração Estruturada de Dados para Relatório e PDF (get_validity_audit_report_data)
    console.log('11. Testando Dados Estruturados do Relatório (get_validity_audit_report_data)...');
    const reportRes = await fetchRaw('/rest/v1/rpc/get_validity_audit_report_data', {
      method: 'POST',
      body: JSON.stringify({ p_audit_id: testAuditId })
    }, adminToken);
    assert.equal(reportRes.ok, true, 'Relatório deve responder 200 OK');
    const rep = reportRes.data;
    assert.ok(rep.executive_summary, 'Deve conter executive_summary');
    assert.ok(rep.preventive_efficiency, 'Deve conter preventive_efficiency');
    assert.ok(rep.reasons_summary, 'Deve conter reasons_summary');
    assert.ok(rep.top_impacts, 'Deve conter top_impacts');
    assert.ok(rep.reconciliation, 'Deve conter reconciliation');
    assert.ok(rep.action_plan, 'Deve conter action_plan');
    assert.ok(rep.lifecycle_events.length >= 3, 'Deve conter os 3 eventos de ciclo de vida registrados');
    assert.equal(rep.reconciliation.is_balanced, true, 'Conciliação matemática deve ser perfeita');
    console.log('   ✓ Relatório estruturado validado com memória de cálculo e conciliação exata.\n');

    console.log('=============================================================');
    console.log(' TODOS OS TESTES DA FASE 4 PASSARAM COM 100% DE SUCESSO NO BANCO REMOTO! 🎉');
    console.log('=============================================================\n');

  } finally {
    // 12. Cleanup pristino de registros de teste
    if (testAuditId) {
      console.log('12. Executando limpeza dos registros temporários de teste...');
      await fetchRaw(`/rest/v1/validity_audits?id=eq.${testAuditId}`, {
        method: 'DELETE'
      });
      console.log('    ✓ Limpeza concluída.');
    }
  }
}

run().catch((err) => {
  console.error('\n❌ ERRO NA VALIDAÇÃO REMOTA:', err);
  process.exit(1);
});

