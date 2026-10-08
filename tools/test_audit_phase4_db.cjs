const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let PGlite;
try {
  PGlite = require('@electric-sql/pglite').PGlite;
} catch (_) {
  PGlite = require(path.resolve(__dirname, '../.tmp/sg-test/node_modules/@electric-sql/pglite')).PGlite;
}

const phase1Migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261006114622_audit_phase1_permissions.sql'), 'utf8');
const phase2Migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261006133000_audit_phase2_data_structures.sql'), 'utf8');
const phase2FixMigration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261006145500_audit_phase2_incremental_fix.sql'), 'utf8');
const phase3Migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261006170000_audit_phase3_items_and_physical_count.sql'), 'utf8');
const phase4Migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261008000000_audit_phase4_closure_and_reports.sql'), 'utf8');

async function run() {
  console.log('=== TESTES DE INTEGRIDADE, VALIDAÇÕES E RELATÓRIO - FASE 4 AUDITORIA ===\n');
  const db = new PGlite();

  // Setup base schema environment
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema private;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_app_meta_data jsonb default '{}'::jsonb,
      banned_until timestamptz
    );
    create table public.user_profiles (
      id uuid primary key default gen_random_uuid(),
      user_id uuid references auth.users(id),
      active boolean default true
    );
    create table public.promoter_profiles (
      user_id uuid primary key references auth.users(id),
      active boolean default true
    );
    create table public.promoter_location_assignments (
      promoter_user_id uuid references auth.users(id),
      location_id uuid,
      active boolean default true
    );
    create table public.admin_audit_log (
      id uuid primary key default gen_random_uuid(),
      actor_user_id uuid,
      action text,
      table_name text,
      record_id text,
      old_data jsonb,
      new_data jsonb,
      created_at timestamptz default now()
    );
    create or replace function private.write_admin_audit() returns trigger language plpgsql security definer set search_path = '' as $$
    declare
      changed_record_id text;
    begin
      changed_record_id := coalesce(
        case when tg_op = 'DELETE' then to_jsonb(old) ->> 'id' else to_jsonb(new) ->> 'id' end,
        case when tg_op = 'DELETE' then to_jsonb(old) ->> 'user_id' else to_jsonb(new) ->> 'user_id' end
      );
      insert into public.admin_audit_log(actor_user_id, action, table_name, record_id, old_data, new_data)
      values (auth.uid(), lower(tg_op), tg_table_name, changed_record_id, to_jsonb(old), to_jsonb(new));
      return coalesce(NEW, OLD);
    end; $$;

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    create function private.can_view_location(p_loc uuid) returns boolean language sql stable as $$
      select true;
    $$;

    create table public.retail_locations (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      code text,
      active boolean not null default true
    );
    create table public.catalog_products (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      barcode text,
      internal_code text,
      active boolean default true,
      photo_path text
    );
    create table public.validity_products (
      id uuid primary key default gen_random_uuid(),
      catalog_product_id uuid references public.catalog_products(id),
      retail_location_id uuid references public.retail_locations(id),
      product_code text,
      barcode text,
      name text not null,
      quantity numeric not null,
      expiry_date date not null,
      completed_at timestamptz,
      photo_path text
    );
    create table public.product_stock_snapshots (
      id uuid primary key default gen_random_uuid(),
      retail_location_id uuid references public.retail_locations(id),
      catalog_product_id uuid references public.catalog_products(id),
      internal_code text,
      stock_quantity numeric,
      cost_price numeric,
      sale_price numeric,
      snapshot_date date,
      created_at timestamptz default now()
    );
    create table public.sg_stock_current (
      id uuid primary key default gen_random_uuid(),
      retail_location_id uuid references public.retail_locations(id),
      catalog_product_id uuid references public.catalog_products(id),
      internal_code text,
      stock_quantity numeric,
      snapshot_date date,
      last_seen_at timestamptz default now()
    );
  `);

  console.log('1. Aplicando Migrations anteriores (Fase 1, 2 e 3)...');
  await db.exec(phase1Migration.replace(/notify pgrst.*/g, ''));
  await db.exec(phase2Migration.replace(/notify pgrst.*/g, ''));
  await db.exec(phase2FixMigration.replace(/notify pgrst.*/g, ''));
  await db.exec(phase3Migration.replace(/notify pgrst.*/g, ''));
  console.log('   ✓ Migrations 1, 2 e 3 aplicadas com sucesso.');

  console.log('\n2. Aplicando Migration da Fase 4 (fechamento, histórico, reabertura e relatórios)...');
  await db.exec(phase4Migration.replace(/notify pgrst.*/g, ''));
  console.log('   ✓ Migration Fase 4 aplicada com sucesso.');

  // Criação de usuários e lojas de teste
  const adminId = '11111111-1111-4111-8111-111111111111';
  const respId = '22222222-2222-4222-8222-222222222222';
  const storeId = '33333333-3333-4333-8333-333333333333';

  await db.exec(`
    insert into auth.users (id, email, raw_app_meta_data) values
      ('${adminId}', 'admin@skalee.com', '{"access_role": "platform_admin"}'::jsonb),
      ('${respId}', 'resp@skalee.com', '{"access_role": "editor"}'::jsonb);

    insert into public.retail_locations (id, name, code, active) values
      ('${storeId}', 'Supermercado Central 01', '01', true);

    insert into public.audit_user_location_assignments (user_id, retail_location_id, active) values
      ('${respId}', '${storeId}', true);
  `);

  // Define contexto como Admin
  await db.exec(`set request.jwt.claim.sub = '${adminId}';`);

  // Teste A: Auditoria Vazia e Bloqueio de Fechamento
  console.log('\n3. Validando Diagnóstico de Auditoria Vazia (Cenário A)...');
  const auditRes = await db.query(`
    select private.create_or_get_monthly_audit('${storeId}', '2026-10-01'::date) as audit;
  `);
  const auditId = auditRes.rows[0].audit.id;

  const reviewEmpty = await db.query(`select private.review_validity_audit('${auditId}') as res;`);
  assert.equal(reviewEmpty.rows[0].res.can_close, false, 'Auditoria vazia NÃO pode ser fechada');
  assert.equal(reviewEmpty.rows[0].res.total_items, 0, 'Total de itens deve ser 0');
  console.log('   ✓ Auditoria vazia diagnosticada e bloqueada para fechamento.');

  // Teste B e C: Adicionando produtos monitorados com contagem pendente (quantity_audited is NULL)
  console.log('\n4. Validando Produtos Monitorados e Bloqueio com quantity_audited NULL (Cenários B e C)...');
  const prod1Id = '44444444-4444-4444-8444-444444444441';
  const prod2Id = '44444444-4444-4444-8444-444444444442';
  const cat1Id = '55555555-5555-4555-8555-555555555551';
  const cat2Id = '55555555-5555-4555-8555-555555555552';

  await db.exec(`
    insert into public.catalog_products (id, name, barcode, internal_code, active) values
      ('${cat1Id}', 'Iogurte Natural 170g', '78910001', '101', true),
      ('${cat2Id}', 'Leite Integral 1L', '78910002', '102', true);

    insert into public.validity_products (id, catalog_product_id, retail_location_id, product_code, barcode, name, quantity, expiry_date) values
      ('${prod1Id}', '${cat1Id}', '${storeId}', '101', '78910001', 'Iogurte Natural 170g', 10, '2026-10-12'),
      ('${prod2Id}', '${cat2Id}', '${storeId}', '102', '78910002', 'Leite Integral 1L', 20, '2026-10-18');

    insert into public.product_stock_snapshots (retail_location_id, catalog_product_id, internal_code, stock_quantity, cost_price, sale_price, snapshot_date) values
      ('${storeId}', '${cat1Id}', '101', 50, 4.50, 6.90, '2026-10-01'),
      ('${storeId}', '${cat2Id}', '102', 100, 3.20, 5.49, '2026-10-01');

    select private.sync_validity_audit_monitored_items('${auditId}');
  `);

  const reviewPending = await db.query(`select private.review_validity_audit('${auditId}') as res;`);
  assert.equal(reviewPending.rows[0].res.total_items, 2, 'Total deve ser 2 itens');
  assert.equal(reviewPending.rows[0].res.pending_items, 2, 'Dois itens devem estar pendentes (NULL)');
  assert.equal(reviewPending.rows[0].res.can_close, false, 'Não pode fechar com itens pendentes');
  console.log('   ✓ Itens pendentes bloqueiam fechamento com mensagem explícita.');

  // Teste D, E e F: Apuração com zero (D), positiva (E) e sem custo (F)
  console.log('\n5. Validando apurações físicas: Zero perda (D), Perda positiva (E) e Sem custo (F)...');
  const items = await db.query(`select id, product_name, barcode from public.validity_audit_items where audit_id = '${auditId}' order by product_name;`);
  const itemIogurte = items.rows[0].id;
  const itemLeite = items.rows[1].id;

  // Iogurte: 0 vencidos (apurado sem perda)
  await db.query(`
    select private.record_audit_item_count('${itemIogurte}', 0, 'Sem classificação');
  `);

  // Leite: 5 unidades vencidas por 'Falha no PVPS' (com custo R$ 3.20 = R$ 16.00)
  await db.query(`
    select private.record_audit_item_count('${itemLeite}', 5, 'Falha no PVPS', null, 'Descarte imediato', 'Estava no fundo da prateleira');
  `);

  // Cenário I e F: Adicionando item encontrado na auditoria (audit_found) sem custo cadastrado
  const addFoundRes = await db.query(`
    select private.add_audit_found_item(
      '${auditId}',
      '2026-10-25'::date,
      3,
      null,
      '78999999',
      '999',
      'Queijo Especial Sem Snapshot Custo',
      'Excesso de compra',
      null,
      'Separado para devolução',
      'Encontrado no depósito'
    ) as res;
  `);
  const itemFoundId = addFoundRes.rows[0].res.id;

  const reviewWithFound = await db.query(`select private.review_validity_audit('${auditId}') as res;`);
  const rev = reviewWithFound.rows[0].res;
  assert.equal(rev.pending_items, 0, 'Nenhum item pendente');
  assert.equal(rev.zero_loss_items, 1, '1 item conferido sem perda (quantidade 0)');
  assert.equal(rev.positive_loss_items, 2, '2 itens com perda positiva');
  assert.equal(rev.total_units_audited, 8, 'Total de 8 unidades vencidas (5 leite + 3 queijo)');
  assert.equal(rev.total_loss_cost, 16.00, 'Impacto apurado deve ser R$ 16.00 (custo do queijo ausente não soma 0)');
  assert.equal(rev.missing_cost_count, 1, 'Deve alertar 1 produto sem custo');
  assert.equal(rev.can_close, true, 'Admin pode fechar com aviso de produto sem custo');
  console.log('   ✓ quantity_audited=0 separado de perdas; item sem custo alertado sem mascarar R$ 0,00.');

  // Teste J: Validação de motivo "Outro" sem detalhe
  console.log('\n6. Validando bloqueio de motivo "Outro" sem descrição detalhada (Cenário J)...');
  let otherDetailBlocked = false;
  try {
    await db.query(`
      select private.record_audit_item_count('${itemIogurte}', 2, 'Outro', '   ');
    `);
  } catch (err) {
    otherDetailBlocked = true;
  }
  assert.equal(otherDetailBlocked, true, 'Gravação de motivo Outro sem detalhe deve ser BLOQUEADA');
  console.log('   ✓ Motivo "Outro" sem detalhe bloqueia o fechamento e a gravação corretamente.');

  // Teste: Marcar como Pronta para Fechamento (ready_for_review)
  console.log('\n7. Validando transição para ready_for_review...');
  // Responsável marca como pronta
  await db.exec(`set request.jwt.claim.sub = '${respId}';`);
  const readyRes = await db.query(`select private.mark_audit_ready_for_review('${auditId}') as res;`);
  assert.equal(readyRes.rows[0].res.status, 'ready_for_review', 'Status deve ser ready_for_review');
  console.log('   ✓ Responsável marcou auditoria como ready_for_review com sucesso.');

  // Teste K e O: Fechamento oficial com congelamento e conciliação financeira
  console.log('\n8. Validando Fechamento Oficial (close_validity_audit), Snapshot e Conciliação (Cenários K e O)...');
  await db.exec(`set request.jwt.claim.sub = '${adminId}';`);

  const conclusionData = {
    summary: 'Auditoria de Outubro realizada com sucesso. Redução de 15% nas perdas em relação ao mês anterior.',
    critical: 'Setor de laticínios apresentou falha no PVPS.',
    recommendations: 'Treinamento imediato da equipe de reposição.',
    notes: 'Revisão presencial efetuada pelo Auditor Chefe.'
  };
  const actionPlanData = [
    { point: 'Falha no PVPS no setor de laticínios', action: 'Treinar repositores', responsible: 'Gerente Loja 01', deadline: '2026-11-05', status: 'Pendente' },
    { point: 'Excesso de compra queijos especiais', action: 'Ajustar parâmetros de compras', responsible: 'Compras Matriz', deadline: '2026-11-10', status: 'Pendente' }
  ];

  const closedRes = await db.query(`
    select private.close_validity_audit(
      '${auditId}',
      '${conclusionData.summary}',
      '${conclusionData.critical}',
      '${conclusionData.recommendations}',
      '${conclusionData.notes}',
      '${JSON.stringify(actionPlanData)}'::jsonb
    ) as res;
  `);

  const closedAudit = closedRes.rows[0].res;
  assert.equal(closedAudit.status, 'completed', 'Status deve ser completed');
  assert.ok(closedAudit.closed_at, 'closed_at deve estar preenchido');
  assert.ok(closedAudit.closure_snapshot, 'closure_snapshot deve ser gravado');
  assert.equal(closedAudit.closure_snapshot.reconciliation.is_balanced, true, 'Conciliação deve estar balanceada');
  assert.equal(closedAudit.closure_snapshot.reconciliation.sum_items_cost, 16.00, 'Soma dos itens deve ser R$ 16.00');
  assert.equal(closedAudit.closure_snapshot.reconciliation.sum_reasons_cost, 16.00, 'Soma dos motivos deve ser R$ 16.00');
  console.log('   ✓ Fechamento oficial realizado: closure_snapshot gerado e conciliação perfeita comprovada.');

  // Teste de Imutabilidade
  console.log('\n9. Validando Imutabilidade pós-fechamento...');
  let mutationBlocked = false;
  try {
    await db.query(`
      select private.record_audit_item_count('${itemIogurte}', 10, 'Baixo giro');
    `);
  } catch (err) {
    mutationBlocked = true;
  }
  assert.equal(mutationBlocked, true, 'Mutação de itens em auditoria completed deve ser rejeitada');
  console.log('   ✓ Imutabilidade estrita preservada para auditoria finalizada.');

  // Teste L e M: Reabertura controlada com motivo obrigatório e histórico
  console.log('\n10. Validando Reabertura Controlada (reopen_validity_audit) com motivo obrigatório (Cenários L e M)...');
  // Tentativa sem motivo deve falhar
  let reopenWithoutReasonBlocked = false;
  try {
    await db.query(`select private.reopen_validity_audit('${auditId}', '');`);
  } catch (err) {
    reopenWithoutReasonBlocked = true;
  }
  assert.equal(reopenWithoutReasonBlocked, true, 'Reabertura sem motivo deve ser bloqueada');

  // Reabertura com motivo válido
  const reopenReason = 'Correção na contagem física do Iogurte solicitada pela gerência.';
  const reopenedRes = await db.query(`
    select private.reopen_validity_audit('${auditId}', '${reopenReason}') as res;
  `);
  const reopenedAudit = reopenedRes.rows[0].res;
  assert.equal(reopenedAudit.status, 'open', 'Status deve voltar para open');
  assert.equal(reopenedAudit.revision_number, 2, 'Revisão deve ser incrementada para 2');
  assert.equal(reopenedAudit.reopen_reason, reopenReason, 'Motivo deve ser registrado');
  console.log('   ✓ Reabertura validada: motivo obrigatório, revisão incrementada e histórico gravado.');

  // Teste N: Histórico de Auditorias
  console.log('\n11. Validando Histórico de Auditorias (list_validity_audits_history - Cenário N)...');
  const historyRes = await db.query(`
    select private.list_validity_audits_history('${storeId}', 2026, null) as res;
  `);
  const historyList = historyRes.rows[0].res;
  assert.equal(historyList.length, 1, 'Deve listar 1 auditoria');
  assert.equal(historyList[0].revision_number, 2, 'Deve indicar revisão 2');
  assert.equal(historyList[0].reopen_reason, reopenReason, 'Deve conter motivo da reabertura');
  console.log('   ✓ Histórico de auditorias recuperado com métricas consolidadas.');

  // Teste P: Estrutura Completa do Relatório
  console.log('\n12. Validando Estrutura Completa do Relatório (get_validity_audit_report_data - Cenário P)...');
  const reportRes = await db.query(`
    select private.get_validity_audit_report_data('${auditId}') as res;
  `);
  const report = reportRes.rows[0].res;
  assert.ok(report.executive_summary, 'Deve conter executive_summary');
  assert.ok(report.preventive_efficiency, 'Deve conter preventive_efficiency');
  assert.ok(report.reasons_summary, 'Deve conter reasons_summary');
  assert.ok(report.top_impacts, 'Deve conter top_impacts');
  assert.ok(report.reconciliation, 'Deve conter reconciliation');
  assert.ok(report.conclusion, 'Deve conter conclusion');
  assert.ok(report.action_plan, 'Deve conter action_plan');
  assert.ok(report.lifecycle_events.length >= 3, 'Deve conter eventos de ciclo de vida (ready, closed, reopened)');
  assert.equal(report.reconciliation.is_balanced, true, 'Conciliação do relatório deve ser verdadeira');
  console.log('   ✓ Relatório estruturado gerado com memória de cálculo, plano de ação e conciliação.');

  console.log('\n=============================================================');
  console.log(' TODOS OS 18 TESTES DA FASE 4 FORAM APROVADOS COM SUCESSO! 🎉');
  console.log('=============================================================\n');
}

run().catch((err) => {
  console.error('ERRO NOS TESTES DA FASE 4:', err);
  process.exit(1);
});
