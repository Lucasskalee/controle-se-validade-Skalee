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
const manualCostMigration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261008010000_audit_manual_cost_and_sg_refresh.sql'), 'utf8');

async function run() {
  console.log('=============================================================');
  console.log(' TESTE LOCAL PGLITE: FASE 4.1 AUDITORIA DE VALIDADES SKALEE');
  console.log('=============================================================\n');

  const db = new PGlite();

  // 1. Setup base schema
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
    begin return coalesce(new, old); end;
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    $$;
    create function private.can_view_location(p_loc uuid) returns boolean language sql stable as $$
      select true;
    $$;
    create table public.retail_locations (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      code text,
      address text,
      active boolean default true
    );
    create table public.catalog_products (
      id uuid primary key default gen_random_uuid(),
      barcode text,
      internal_code text,
      name text not null,
      photo_path text,
      active boolean default true
    );
    create table public.validity_products (
      id uuid primary key default gen_random_uuid(),
      retail_location_id uuid references public.retail_locations(id),
      catalog_product_id uuid references public.catalog_products(id),
      barcode text,
      product_code text,
      name text not null,
      expiry_date date not null,
      photo_path text,
      created_at timestamptz default now(),
      completed_at timestamptz
    );
    create table public.product_stock_snapshots (
      id uuid primary key default gen_random_uuid(),
      retail_location_id uuid not null references public.retail_locations(id),
      catalog_product_id uuid references public.catalog_products(id),
      internal_code text,
      barcode text,
      stock_quantity numeric,
      cost_price numeric,
      sale_price numeric,
      snapshot_date date not null,
      created_at timestamptz default now()
    );
    create table public.sg_stock_current (
      id uuid primary key default gen_random_uuid(),
      retail_location_id uuid not null references public.retail_locations(id),
      catalog_product_id uuid references public.catalog_products(id),
      internal_code text,
      barcode text,
      stock_quantity numeric,
      snapshot_date date,
      last_seen_at timestamptz default now()
    );
  `);

  // 2. Executar migrations na ordem
  console.log('1. Executando migrations das Fases 1 a 4...');
  await db.exec(phase1Migration.replace(/notify pgrst.*/g, ''));
  await db.exec(phase2Migration.replace(/notify pgrst.*/g, ''));
  await db.exec(phase2FixMigration.replace(/notify pgrst.*/g, ''));
  await db.exec(phase3Migration.replace(/notify pgrst.*/g, ''));
  await db.exec(phase4Migration.replace(/notify pgrst.*/g, ''));
  console.log('   ✓ Migrations 1-4 aplicadas.');

  console.log('2. Aplicando migration corrigida da Fase 4.1 (Custo Manual & SG Refresh)...');
  await db.exec(manualCostMigration.replace(/notify pgrst.*/g, ''));
  console.log('   ✓ Migration 4.1 aplicada com sucesso no PostgreSQL!');

  // 3. Criar usuário admin e loja de teste
  const adminId = '11111111-1111-1111-1111-111111111111';
  await db.exec(`
    insert into auth.users (id, email, raw_app_meta_data)
    values ('${adminId}', 'admin@skalee.com.br', '{"access_role": "platform_admin"}'::jsonb);
  `);

  const locRes = await db.query(`
    insert into public.retail_locations (name, code, address)
    values ('Supermercado Sol 01', 'SOL1', 'Rua Central, 100')
    returning id;
  `);
  const locId = locRes.rows[0].id;

  // Set session context as admin
  await db.exec(`
    select set_config('request.jwt.claim.sub', '${adminId}', false);
    select set_config('request.jwt.claims', '{"sub":"${adminId}","app_metadata":{"access_role":"platform_admin"}}', false);
  `);

  // Criar auditoria
  const auditRes = await db.query(`
    select private.create_or_get_monthly_audit('${locId}', '2026-10-01') as audit;
  `);
  const auditId = auditRes.rows[0].audit.id;
  assert.ok(auditId, 'Auditoria deve ser criada');

  // Criar 3 itens de auditoria:
  // Item 1: Tem custo SG (R$ 10.00)
  // Item 2: Sem custo SG, receberá custo manual (R$ 15.50)
  // Item 3: Sem nenhum custo (permanecerá não apurado)
  const item1Res = await db.query(`
    insert into public.validity_audit_items (
      audit_id, source_type, product_name, expiry_date, unit_cost_snapshot, stock_quantity_snapshot, financial_snapshot_origin
    ) values (
      '${auditId}', 'monitored', 'Item SG Original', '2026-10-05', 10.00, 20, 'product_stock_snapshots'
    ) returning id;
  `);
  const item1Id = item1Res.rows[0].id;

  const item2Res = await db.query(`
    insert into public.validity_audit_items (
      audit_id, source_type, product_name, expiry_date, unit_cost_snapshot
    ) values (
      '${auditId}', 'monitored', 'Item Sem Custo SG', '2026-10-06', null
    ) returning id;
  `);
  const item2Id = item2Res.rows[0].id;

  const item3Res = await db.query(`
    insert into public.validity_audit_items (
      audit_id, source_type, product_name, expiry_date, unit_cost_snapshot
    ) values (
      '${auditId}', 'monitored', 'Item Sem Nenhum Custo', '2026-10-07', null
    ) returning id;
  `);
  const item3Id = item3Res.rows[0].id;

  // --------------------------------------------------------------------------
  // CENÁRIO 1: Apuração de Item 1 (com custo SG)
  // --------------------------------------------------------------------------
  console.log('\n3. Testando apuração com custo SG (Item 1)...');
  await db.query(`
    select private.record_audit_item_count(
      '${item1Id}'::uuid,
      5::numeric,
      'Falha no PVPS'::text,
      null::text,
      'Descarte'::text,
      'Obs 1'::text
    );
  `);
  const row1 = (await db.query(`select * from public.validity_audit_items where id = '${item1Id}'`)).rows[0];
  assert.equal(Number(row1.quantity_audited), 5);
  assert.equal(Number(row1.financial_cost_impact), 50.00, 'Impacto: 5 un * R$ 10.00 = R$ 50.00');
  assert.equal(row1.cost_source, 'sg');
  assert.equal(row1.manual_unit_cost, null);
  console.log('   ✓ Item 1 apurado com sucesso (Custo SG R$ 10.00, Impacto R$ 50.00)');

  // --------------------------------------------------------------------------
  // CENÁRIO 2: Apuração de Item 2 com CUSTO MANUAL explícito
  // --------------------------------------------------------------------------
  console.log('\n4. Testando apuração com Custo Manual explícito (Item 2)...');
  await db.query(`
    select private.record_audit_item_count(
      '${item2Id}'::uuid,
      4::numeric,
      'Oferta tardia'::text,
      null::text,
      'Troca fornecedor'::text,
      'Obs 2'::text,
      'manual'::text,
      15.50::numeric,
      'Nota fiscal de compra'::text,
      null::text,
      'NF 987654'::text
    );
  `);
  const row2 = (await db.query(`select * from public.validity_audit_items where id = '${item2Id}'`)).rows[0];
  assert.equal(Number(row2.quantity_audited), 4);
  assert.equal(row2.cost_source, 'manual');
  assert.equal(Number(row2.manual_unit_cost), 15.50);
  assert.equal(Number(row2.financial_cost_impact), 62.00, 'Impacto: 4 un * R$ 15.50 = R$ 62.00');
  assert.equal(row2.cost_source_detail, 'Nota fiscal de compra');
  assert.equal(row2.cost_reference_notes, 'NF 987654');
  assert.equal(row2.cost_updated_by, adminId);
  assert.ok(row2.cost_updated_at !== null, 'Data do custo manual registrada');
  console.log('   ✓ Item 2 apurado com sucesso (Custo Manual R$ 15.50, Impacto R$ 62.00, NF 987654)');

  // --------------------------------------------------------------------------
  // CENÁRIO 3: Validação de consistência (Outra fonte sem descrição obrigatória)
  // --------------------------------------------------------------------------
  console.log('\n5. Testando bloqueio quando "Outra fonte" não tem descrição detalhada...');
  let errorOther = false;
  try {
    await db.query(`
      select private.record_audit_item_count(
        '${item2Id}'::uuid,
        4::numeric,
        'Oferta tardia'::text,
        null::text,
        null::text,
        null::text,
        'manual'::text,
        20.00::numeric,
        'Outra fonte'::text,
        ''::text               -- Vazio! Deve falhar
      );
    `);
  } catch (err) {
    errorOther = true;
    assert.match(err.message, /outra fonte/i);
  }
  assert.ok(errorOther, 'Deve barrar Outra fonte sem descrição');
  console.log('   ✓ Validação de descrição obrigatória para "Outra fonte" aprovada!');

  // --------------------------------------------------------------------------
  // CENÁRIO 4: PRESERVAÇÃO DO CUSTO MANUAL ao editar apenas quantidade/motivo
  // --------------------------------------------------------------------------
  console.log('\n6. Testando PRESERVAÇÃO do custo manual ao editar apenas quantidade/motivo (p_cost_source = NULL)...');
  await db.query(`
    select private.record_audit_item_count(
      '${item2Id}'::uuid,
      6::numeric,                          -- Mudou de 4 para 6 unidades
      'Baixo giro'::text,                  -- Mudou motivo
      null::text,
      'Ação atualizada'::text,
      'Nova observação'::text,
      null::text                           -- p_cost_source = NULL: DEVE PRESERVAR O CUSTO MANUAL!
    );
  `);
  const row2Preserved = (await db.query(`select * from public.validity_audit_items where id = '${item2Id}'`)).rows[0];
  assert.equal(Number(row2Preserved.quantity_audited), 6);
  assert.equal(row2Preserved.expiry_reason, 'Baixo giro');
  assert.equal(row2Preserved.cost_source, 'manual', 'Origem manual DEVE ser preservada!');
  assert.equal(Number(row2Preserved.manual_unit_cost), 15.50, 'Custo manual DEVE ser preservado!');
  assert.equal(Number(row2Preserved.financial_cost_impact), 93.00, 'Impacto recalculado: 6 * 15.50 = 93.00');
  assert.equal(row2Preserved.cost_reference_notes, 'NF 987654', 'Nota da referência DEVE ser preservada!');
  console.log('   ✓ Custo manual e metadados preservados 100% intactos com impacto recalculado!');

  // --------------------------------------------------------------------------
  // CENÁRIO 5: Reversão para SG sem custo SG exige confirmação explícita
  // --------------------------------------------------------------------------
  console.log('\n7. Testando bloqueio ao reverter para SG quando produto não possui custo SG...');
  let revertBlocked = false;
  try {
    await db.query(`
      select private.record_audit_item_count(
        '${item2Id}'::uuid,
        6::numeric,
        'Baixo giro'::text,
        null::text,
        null::text,
        null::text,
        'sg'::text,       -- Reversão para SG
        null::numeric,
        null::text,
        null::text,
        null::text,
        false::boolean    -- Sem confirmação explícita: DEVE FALHAR!
      );
    `);
  } catch (err) {
    revertBlocked = true;
    assert.match(err.message, /não possui custo disponível na carga SG/i);
  }
  assert.ok(revertBlocked, 'Deve exigir p_confirm_revert_without_sg_cost se não há custo SG');
  console.log('   ✓ Bloqueio e aviso com exigência de confirmação aprovados!');

  // --------------------------------------------------------------------------
  // CENÁRIO 6: Reversão para SG com confirmação explícita aceita
  // --------------------------------------------------------------------------
  console.log('\n8. Testando reversão para SG com confirmação explícita aceita...');
  await db.query(`
    select private.record_audit_item_count(
      '${item2Id}'::uuid,
      6::numeric,
      'Baixo giro'::text,
      null::text,
      null::text,
      null::text,
      'sg'::text,
      null::numeric,
      null::text,
      null::text,
      null::text,
      true::boolean       -- Confirmação explícita: DEVE PERMITIR
    );
  `);
  const row2RevertedWithoutSG = (await db.query(`select * from public.validity_audit_items where id = '${item2Id}'`)).rows[0];
  assert.equal(row2RevertedWithoutSG.cost_source, 'sg');
  assert.equal(row2RevertedWithoutSG.manual_unit_cost, null);
  assert.equal(row2RevertedWithoutSG.financial_cost_impact, null, 'Sem custo SG nem manual, impacto é NULL');
  console.log('   ✓ Reversão autorizada e impacto mantido como NULL ("Não apurado").');

  // Devolver item 2 para custo manual para os testes subsequentes
  await db.query(`
    select private.record_audit_item_count(
      '${item2Id}'::uuid,
      4::numeric,
      'Oferta tardia'::text,
      null::text,
      'Troca fornecedor'::text,
      'Obs 2'::text,
      'manual'::text,
      15.00::numeric,
      'Nota fiscal de compra'::text,
      null::text,
      'NF 100'::text
    );
  `);

  // --------------------------------------------------------------------------
  // CENÁRIO 7: Item sem custo algum (salvo normalmente, impacto permanece NULL)
  // --------------------------------------------------------------------------
  console.log('\n9. Testando Item 3 sem nenhum custo (Impacto deve ser NULL, nunca 0.00)...');
  await db.query(`
    select private.record_audit_item_count(
      '${item3Id}'::uuid,
      3::numeric,
      'Excesso de compra'::text,
      null::text,
      'Descarte'::text,
      null::text
    );
  `);
  const row3 = (await db.query(`select * from public.validity_audit_items where id = '${item3Id}'`)).rows[0];
  assert.equal(Number(row3.quantity_audited), 3);
  assert.equal(row3.financial_cost_impact, null, 'Impacto deve ser NULL (não apurado)');
  console.log('   ✓ Item 3 sem custo salvo com sucesso (Impacto é estritamente NULL = Não apurado)');

  // --------------------------------------------------------------------------
  // CENÁRIO 8: Atualização de referência SG sem sobrescrever custo manual
  // --------------------------------------------------------------------------
  console.log('\n10. Testando Atualizar Referência SG preservando custo manual...');
  await db.exec(`
    insert into public.product_stock_snapshots (
      retail_location_id, internal_code, stock_quantity, cost_price, snapshot_date
    ) values (
      '${locId}', 'COD-ITEM2', 50, 12.00, '2026-10-07'
    );
    update public.validity_audit_items set product_code = 'COD-ITEM2' where id = '${item2Id}';
  `);

  const refreshRes = await db.query(`
    select private.refresh_audit_item_sg_reference('${item2Id}'::uuid, false) as ref;
  `);
  const refData = refreshRes.rows[0].ref;
  assert.equal(refData.found, true);
  assert.equal(refData.preserved_manual_cost, true);

  const row2AfterRefresh = (await db.query(`select * from public.validity_audit_items where id = '${item2Id}'`)).rows[0];
  assert.equal(row2AfterRefresh.cost_source, 'manual', 'Custo manual NÃO pode ser sobrescrito!');
  assert.equal(Number(row2AfterRefresh.manual_unit_cost), 15.00);
  assert.equal(Number(row2AfterRefresh.unit_cost_snapshot), 12.00, 'Snapshot SG atualizado em segundo plano');
  console.log('   ✓ Referência SG atualizou baseline mas preservou custo manual do auditor!');

  // --------------------------------------------------------------------------
  // CENÁRIO 9: Bloqueio ao aplicar custo SG quando não há custo SG
  // --------------------------------------------------------------------------
  console.log('\n11. Testando bloqueio em refresh com apply_to_cost em produto sem custo SG...');
  let refreshWithoutCostBlocked = false;
  try {
    await db.query(`
      select private.refresh_audit_item_sg_reference('${item3Id}'::uuid, true);
    `);
  } catch (err) {
    refreshWithoutCostBlocked = true;
    assert.match(err.message, /nenhum custo disponível/i);
  }
  assert.ok(refreshWithoutCostBlocked, 'Deve barrar apply_to_cost em item sem custo SG');
  console.log('   ✓ Proteção contra aplicação de custo SG inexistente validada!');

  // --------------------------------------------------------------------------
  // CENÁRIO 10: Diagnóstico Pré-Fechamento com Alertas e Métricas Parciais
  // --------------------------------------------------------------------------
  console.log('\n12. Testando Diagnóstico Pré-Fechamento (review_validity_audit)...');
  const reviewRes = await db.query(`
    select private.review_validity_audit('${auditId}'::uuid) as diag;
  `);
  const diag = reviewRes.rows[0].diag;
  assert.equal(diag.total_items, 3);
  assert.equal(diag.audited_items, 3);
  assert.equal(diag.pending_items, 0);
  assert.equal(diag.can_close, true, 'Deve permitir fechamento quando todos os itens estão apurados');
  assert.equal(diag.has_uncosted_loss, true, 'Identifica perda não apurada');
  assert.equal(diag.is_partial_impact, true, 'Identifica impacto parcial');
  assert.equal(diag.missing_cost_count, 1, '1 item sem custo');
  assert.equal(diag.manual_cost_count, 1, '1 item com custo manual');
  assert.equal(Number(diag.manual_cost_total), 60.00, 'Impacto manual: 4 * 15 = 60.00');
  assert.equal(Number(diag.total_loss_cost), 110.00, 'Total apurado: 50 (SG) + 60 (Manual) = 110.00');
  console.log('   ✓ Diagnóstico aprovado com diferenciação precisa de custos SG, Manuais e Parciais!');

  // --------------------------------------------------------------------------
  // CENÁRIO 11: Fechamento sem confirmação de impacto parcial DEVE FALHAR
  // --------------------------------------------------------------------------
  console.log('\n13. Testando bloqueio de fechamento sem confirmação explícita de impacto parcial...');
  let closureBlocked = false;
  try {
    await db.query(`
      select private.close_validity_audit(
        '${auditId}'::uuid,
        'Conclusão da auditoria'::text,
        'Pontos críticos'::text,
        'Recomendações'::text,
        'Notas gerais'::text,
        '[]'::jsonb,
        false::boolean      -- Sem confirmação: DEVE BLOQUEAR!
      );
    `);
  } catch (err) {
    closureBlocked = true;
    assert.match(err.message, /p_confirm_partial_closure/i);
  }
  assert.ok(closureBlocked, 'Fechamento DEVE exigir confirmação explícita do administrador!');
  console.log('   ✓ Bloqueio de fechamento não confirmado validado com sucesso!');

  // --------------------------------------------------------------------------
  // CENÁRIO 12: Fechamento com confirmação explícita do administrador
  // --------------------------------------------------------------------------
  console.log('\n14. Testando Fechamento Oficial COM confirmação do administrador...');
  await db.query(`
    select private.close_validity_audit(
      '${auditId}'::uuid,
      'Conclusão da Revisão 1'::text,
      'Pontos críticos Rev 1'::text,
      'Recomendações Rev 1'::text,
      'Notas gerais Rev 1'::text,
      '[]'::jsonb,
      true::boolean,        -- Confirmação explícita!
      'Aprovado fechamento com 1 produto sem custo SG de referência.'::text
    );
  `);
  const closedAudit = (await db.query(`select * from public.validity_audits where id = '${auditId}'`)).rows[0];
  assert.equal(closedAudit.status, 'completed');
  assert.equal(closedAudit.revision_number, 1);
  assert.equal(closedAudit.partial_closure_confirmed, true);
  assert.equal(closedAudit.partial_closure_confirmed_by, adminId);
  assert.match(closedAudit.partial_closure_justification, /Aprovado fechamento/);
  assert.ok(closedAudit.closure_snapshot.items.length === 3, 'Todos os 3 itens congelados no snapshot');
  assert.equal(closedAudit.closure_snapshot.conclusion.diagnostic_text, 'Conclusão da Revisão 1');
  console.log('   ✓ Auditoria finalizada (Rev 1), justificativa registrada e snapshot congelado!');

  // --------------------------------------------------------------------------
  // CENÁRIO 13: Tentativa de edição pós-fechamento (imutabilidade)
  // --------------------------------------------------------------------------
  console.log('\n15. Testando bloqueio de edição em auditoria finalizada...');
  let editBlocked = false;
  try {
    await db.query(`
      select private.record_audit_item_count(
        '${item1Id}'::uuid, 10::numeric, 'Falha no PVPS'::text
      );
    `);
  } catch (e) {
    editBlocked = true;
    assert.match(e.message, /imutável/i);
  }
  assert.ok(editBlocked, 'Tentativa de edição em auditoria finalizada DEVE falhar!');
  console.log('   ✓ Imutabilidade pós-fechamento confirmada (Trigger/RPC 42501).');

  // --------------------------------------------------------------------------
  // CENÁRIO 14: Reabertura Controlada e Incremento de Revisão para 2
  // --------------------------------------------------------------------------
  console.log('\n16. Testando Reabertura Controlada para Revisão 2...');
  await db.query(`
    select private.reopen_validity_audit('${auditId}'::uuid, 'Reabertura para inclusão de itens e ajuste de quantidade'::text);
  `);
  const reopenedAudit = (await db.query(`select * from public.validity_audits where id = '${auditId}'`)).rows[0];
  assert.equal(reopenedAudit.status, 'open');
  assert.equal(reopenedAudit.revision_number, 2, 'Revisão incrementada para 2');
  console.log('   ✓ Auditoria reaberta com sucesso (Revisão 2 ativa).');

  // --------------------------------------------------------------------------
  // CENÁRIO 15: Edição de itens na Revisão 2
  // --------------------------------------------------------------------------
  console.log('\n17. Modificando itens na Revisão 2 (Item 1 alterado para 8 un, e novo Item 4 adicionado)...');
  // Alterar Item 1 de 5 para 8 un
  await db.query(`
    select private.record_audit_item_count(
      '${item1Id}'::uuid,
      8::numeric,
      'Falha no PVPS'::text,
      null::text,
      'Descarte'::text,
      'Qtd ajustada na Rev 2'::text
    );
  `);

  // Adicionar Item 4 na Rev 2
  const item4Res = await db.query(`
    insert into public.validity_audit_items (
      audit_id, source_type, product_name, expiry_date, unit_cost_snapshot
    ) values (
      '${auditId}', 'audit_found', 'Item Novo Criado na Rev 2', '2026-10-09', 20.00
    ) returning id;
  `);
  const item4Id = item4Res.rows[0].id;
  await db.query(`
    select private.record_audit_item_count(
      '${item4Id}'::uuid,
      2::numeric,
      'Falha de acompanhamento'::text,
      null::text,
      'Descarte'::text,
      'Achado na Rev 2'::text
    );
  `);
  console.log('   ✓ Itens modificados na Revisão 2.');

  // --------------------------------------------------------------------------
  // CENÁRIO 16: ISOLAMENTO TOTAL DA REVISÃO 1 HISTÓRICA
  // --------------------------------------------------------------------------
  console.log('\n18. Testando consulta do relatório histórico da Revisão 1...');
  const repRev1Res = await db.query(`
    select private.get_validity_audit_report_data('${auditId}'::uuid, 1) as rep;
  `);
  const repRev1 = repRev1Res.rows[0].rep;

  assert.equal(repRev1.revision_number, 1, 'Deve ser estritamente Revisão 1');
  assert.equal(repRev1.is_frozen_revision, true, 'Deve ser marcada como revisão congelada');
  assert.equal(repRev1.status, 'completed', 'Status da revisão 1 congelada deve ser completed');
  assert.equal(repRev1.conclusion.diagnostic_text, 'Conclusão da Revisão 1');
  assert.equal(repRev1.executive_summary.partial_closure_confirmed, true);
  assert.equal(repRev1.items.length, 3, 'Revisão 1 DEVE ter exatamente 3 itens (Item 4 da Rev 2 NÃO pode aparecer!)');

  const repRev1Item1 = repRev1.items.find(i => i.id === item1Id);
  assert.equal(Number(repRev1Item1.quantity_audited), 5, 'Item 1 na Revisão 1 DEVE ter 5 un (NÃO as 8 un da Rev 2!)');
  assert.equal(Number(repRev1Item1.financial_cost_impact), 50.00, 'Impacto do Item 1 na Rev 1 DEVE ser 50.00');

  const repRev1Item4 = repRev1.items.find(i => i.id === item4Id);
  assert.equal(repRev1Item4, undefined, 'Item 4 NÃO pode existir no relatório da Revisão 1');
  console.log('   ✓ ISOLAMENTO ABSOLUTO CONFIRMADO: Revisão 1 permaneceu 100% imutável e intacta!');

  // --------------------------------------------------------------------------
  // CENÁRIO 17: Consulta a Revisão Inexistente
  // --------------------------------------------------------------------------
  console.log('\n19. Testando consulta a revisão inexistente (deve falhar)...');
  let nonExistentFailed = false;
  try {
    await db.query(`
      select private.get_validity_audit_report_data('${auditId}'::uuid, 99);
    `);
  } catch (err) {
    nonExistentFailed = true;
    assert.match(err.message, /não encontrada/i);
  }
  assert.ok(nonExistentFailed, 'Consulta a revisão inexistente DEVE lançar erro P0002');
  console.log('   ✓ Erro ao consultar revisão inexistente validado!');

  // --------------------------------------------------------------------------
  // CENÁRIO 18: Fechamento da Revisão 2
  // --------------------------------------------------------------------------
  console.log('\n20. Fechando oficialmente a Revisão 2...');
  await db.query(`
    select private.close_validity_audit(
      '${auditId}'::uuid,
      'Conclusão da Revisão 2 Final'::text,
      'Pontos críticos Rev 2'::text,
      'Recomendações Rev 2'::text,
      'Notas gerais Rev 2'::text,
      '[]'::jsonb,
      true::boolean,
      'Revisão 2 aprovada com ajuste de PVPS e achado físico.'::text
    );
  `);
  console.log('   ✓ Revisão 2 finalizada com sucesso!');

  // --------------------------------------------------------------------------
  // CENÁRIO 19: Consulta a ambas as revisões congeladas
  // --------------------------------------------------------------------------
  console.log('\n21. Verificando independência entre as duas revisões congeladas...');
  const repRev2Res = await db.query(`
    select private.get_validity_audit_report_data('${auditId}'::uuid, 2) as rep;
  `);
  const repRev2 = repRev2Res.rows[0].rep;
  assert.equal(repRev2.revision_number, 2);
  assert.equal(repRev2.items.length, 4, 'Revisão 2 possui 4 itens');
  const repRev2Item1 = repRev2.items.find(i => i.id === item1Id);
  assert.equal(Number(repRev2Item1.quantity_audited), 8, 'Item 1 na Revisão 2 possui 8 un');
  assert.equal(Number(repRev2Item1.financial_cost_impact), 80.00);

  // Rechecar Rev 1
  const checkRev1Res = await db.query(`
    select private.get_validity_audit_report_data('${auditId}'::uuid, 1) as rep;
  `);
  const checkRev1 = checkRev1Res.rows[0].rep;
  assert.equal(checkRev1.revision_number, 1);
  assert.equal(checkRev1.items.length, 3);
  assert.equal(Number(checkRev1.items.find(i => i.id === item1Id).quantity_audited), 5);
  console.log('   ✓ Ambas as revisões (Rev 1 com 3 itens e Rev 2 com 4 itens) coexistem imutáveis e auditáveis!');

  console.log('\n=============================================================');
  console.log(' TODOS OS 19 TESTES LOCAIS PASSARAM COM 100% DE SUCESSO! 🎉');
  console.log('=============================================================\n');
}

run().catch((err) => {
  console.error('\n❌ FALHA NOS TESTES LOCAIS:', err);
  process.exit(1);
});
