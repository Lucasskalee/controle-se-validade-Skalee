const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(path.resolve(__dirname, '../.tmp/sg-test/node_modules/@electric-sql/pglite'));

const phase1Migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261006114622_audit_phase1_permissions.sql'), 'utf8');
const phase2Migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261006133000_audit_phase2_data_structures.sql'), 'utf8');

async function run() {
  console.log('=== TESTES DE INTEGRIDADE, RLS E CONSTRAINTS - FASE 2 AUDITORIA ===\n');
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
      active boolean not null default true
    );
    create table public.catalog_products (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      barcode text,
      internal_code text,
      active boolean default true
    );
    create table public.validity_products (
      id uuid primary key default gen_random_uuid(),
      catalog_product_id uuid references public.catalog_products(id),
      retail_location_id uuid references public.retail_locations(id),
      product_code text,
      barcode text,
      name text not null,
      quantity numeric not null,
      expiry_date date not null
    );

    grant usage on schema public, auth, private to authenticated, anon;
    grant select, insert, update on public.retail_locations, public.catalog_products, public.validity_products to authenticated;
  `);

  // Fixtures: Lojas e Usuários
  const adminId = '11111111-1111-4111-8111-111111111111';
  const responsibleId = '22222222-2222-4222-8222-222222222222';
  const commonUserId = '33333333-3333-4333-8333-333333333333';

  const store1Id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const store2Id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  await db.exec(`
    insert into auth.users (id, email, raw_app_meta_data) values
      ('${adminId}', 'admin@skalee.invalid', '{"access_role":"platform_admin"}'::jsonb),
      ('${responsibleId}', 'auditor@skalee.invalid', '{}'::jsonb),
      ('${commonUserId}', 'comum@skalee.invalid', '{}'::jsonb);

    insert into public.retail_locations (id, name, active) values
      ('${store1Id}', 'Supermercado Sol 01', true),
      ('${store2Id}', 'Supermercado Sol 02', true);
  `);

  // 1. Aplica Migration Fase 1
  console.log('1. Aplicando Migration da Fase 1...');
  await db.exec(phase1Migration);
  console.log('   ✓ Migration Fase 1 aplicada com sucesso.');

  // Atribui store1 ao responsibleId na Fase 1
  await db.exec(`
    set request.jwt.claim.sub = '${adminId}';
    select public.set_audit_user_locations('${responsibleId}', array['${store1Id}'::uuid]);
  `);

  // 2. Aplica Migration Fase 2
  console.log('\n2. Aplicando Migration da Fase 2 (validity_audits & validity_audit_items)...');
  await db.exec(phase2Migration);
  console.log('   ✓ Migration Fase 2 aplicada com sucesso.');

  // 3. Teste de Constraints e Unicidade em validity_audits
  console.log('\n3. Validando constraints e unicidade em validity_audits...');
  await db.exec(`set request.jwt.claim.sub = '${adminId}'; set role authenticated;`);

  // Deve permitir competência válida
  const audit1 = await db.query(`
    insert into public.validity_audits (retail_location_id, competence_month, status)
    values ('${store1Id}', '2026-10-01', 'open')
    returning id, status;
  `);
  const auditId = audit1.rows[0].id;
  assert.equal(audit1.rows[0].status, 'open');

  // Competência que não é primeiro dia deve ser rejeitada pela constraint
  await assert.rejects(async () => {
    await db.exec(`
      insert into public.validity_audits (retail_location_id, competence_month, status)
      values ('${store1Id}', '2026-10-15', 'open');
    `);
  }, /validity_audits_competence_first_day/, "Competência fora do 1º dia do mês deve ser rejeitada");

  // Duplicidade de competência na mesma loja deve ser rejeitada
  await assert.rejects(async () => {
    await db.exec(`
      insert into public.validity_audits (retail_location_id, competence_month, status)
      values ('${store1Id}', '2026-10-01', 'open');
    `);
  }, /validity_audits_store_competence_unique/, "Duplicidade de competência na mesma loja deve ser rejeitada");

  // Status inválido deve ser rejeitado
  await assert.rejects(async () => {
    await db.exec(`
      insert into public.validity_audits (retail_location_id, competence_month, status)
      values ('${store2Id}', '2026-10-01', 'status_invalido');
    `);
  }, /validity_audits_status_check/, "Status fora de ('open', 'ready_for_review', 'completed') deve ser rejeitado");
  console.log('   ✓ Constraints de competência mensal, unicidade por loja e status aprovadas.');

  // 4. Teste da Regra Financeira de Impacto a Custo (Stored Generated Column)
  console.log('\n4. Validando cálculo financeiro exato e tratamento de NULL em validity_audit_items...');
  const catProd = await db.query(`
    insert into public.catalog_products (name, barcode, internal_code)
    values ('Iogurte Morango 170g', '7891000100011', '1001')
    returning id;
  `);
  const catId = catProd.rows[0].id;

  // Caso 1: Item nasce PENDENTE antes da contagem física (quantity_audited = NULL)
  // Mesmo com custo e preço de venda fornecidos, o impacto DEVE ser NULL!
  // audited_at DEVE ser NULL pois itens automáticos entram pendentes antes da apuração física
  const itemPending = await db.query(`
    insert into public.validity_audit_items (
      audit_id, source_type, catalog_product_id, product_name, expiry_date,
      unit_cost_snapshot, sale_price_snapshot
    ) values (
      '${auditId}', 'monitored', '${catId}', 'Iogurte Morango 170g', '2026-10-05',
      3.50, 5.99
    ) returning quantity_audited, item_status, financial_cost_impact, potential_sales_loss, audited_at;
  `);
  assert.equal(itemPending.rows[0].quantity_audited, null, "quantity_audited deve nascer NULL quando não apurado");
  assert.equal(itemPending.rows[0].item_status, 'pending', "item_status deve ser 'pending' por padrão");
  assert.equal(itemPending.rows[0].audited_at, null, "audited_at DEVE ser null para itens pendentes");
  assert.equal(itemPending.rows[0].financial_cost_impact, null, "Impacto financeiro DEVE ser NULL quando quantity_audited for NULL");
  assert.equal(itemPending.rows[0].potential_sales_loss, null, "Perda potencial de venda DEVE ser NULL quando quantity_audited for NULL");

  // Caso 2: Auditor confirma fisicamente ZERO unidades vencidas (quantity_audited = 0)
  // Impacto financeiro e potencial de perda tornam-se confirmados como 0.00
  const itemZero = await db.query(`
    insert into public.validity_audit_items (
      audit_id, source_type, catalog_product_id, product_name, expiry_date,
      quantity_audited, unit_cost_snapshot, sale_price_snapshot, item_status, expiry_reason, audited_at
    ) values (
      '${auditId}', 'audit_found', '${catId}', 'Iogurte Morango 170g', '2026-10-06',
      0, 3.50, 5.99, 'counted', 'Sem classificação', now()
    ) returning quantity_audited, item_status, financial_cost_impact, potential_sales_loss, audited_at;
  `);
  assert.equal(Number(itemZero.rows[0].quantity_audited), 0, "quantity_audited = 0 confirmado");
  assert.equal(itemZero.rows[0].item_status, 'counted', "item_status passa para 'counted'");
  assert.notEqual(itemZero.rows[0].audited_at, null, "audited_at preenchido quando contado");
  assert.equal(Number(itemZero.rows[0].financial_cost_impact), 0.00, "Impacto financeiro deve ser exatamente 0.00 quando quantity_audited for 0");
  assert.equal(Number(itemZero.rows[0].potential_sales_loss), 0.00, "Perda potencial de venda deve ser exatamente 0.00 quando quantity_audited for 0");


  // Caso 3: Quantidade positiva (quantity_audited = 10, Custo = 3.50, Preço = 5.99)
  const itemPositive = await db.query(`
    insert into public.validity_audit_items (
      audit_id, source_type, catalog_product_id, product_name, expiry_date,
      quantity_audited, unit_cost_snapshot, sale_price_snapshot, item_status, expiry_reason
    ) values (
      '${auditId}', 'audit_found', '${catId}', 'Iogurte Morango 170g', '2026-10-07',
      10, 3.50, 5.99, 'counted', 'Falha no PVPS'
    ) returning financial_cost_impact, potential_sales_loss;
  `);
  assert.equal(Number(itemPositive.rows[0].financial_cost_impact), 35.00, "Impacto financeiro deve ser 10 * 3.50 = 35.00");
  assert.equal(Number(itemPositive.rows[0].potential_sales_loss), 59.90, "Perda potencial de venda deve ser 10 * 5.99 = 59.90");

  // Caso 4: Quantidade positiva (5), mas custo desconhecido (NULL) -> Impacto financeiro DEVE ser NULL!
  const itemNoCost = await db.query(`
    insert into public.validity_audit_items (
      audit_id, source_type, catalog_product_id, product_name, expiry_date,
      quantity_audited, unit_cost_snapshot, sale_price_snapshot, expiry_reason
    ) values (
      '${auditId}', 'audit_found', '${catId}', 'Iogurte Morango 170g', '2026-10-08',
      5, null, 5.99, 'Baixo giro'
    ) returning financial_cost_impact, potential_sales_loss;
  `);
  assert.equal(itemNoCost.rows[0].financial_cost_impact, null, "Impacto DEVE permanecer NULL quando custo for NULL (nunca assumir zero)");
  assert.equal(Number(itemNoCost.rows[0].potential_sales_loss), 29.95, "Perda potencial de venda calculada");

  // Caso 5: Motivo 'Outro' sem preencher expiry_reason_other deve falhar
  await assert.rejects(async () => {
    await db.exec(`
      insert into public.validity_audit_items (
        audit_id, source_type, product_name, expiry_date, quantity_audited, expiry_reason
      ) values (
        '${auditId}', 'audit_found', 'Produto X', '2026-10-09', 1, 'Outro'
      );
    `);
  }, /validity_audit_items_other_reason_check/, "Motivo 'Outro' exige descrição em expiry_reason_other");

  // Caso 6: Motivo 'Outro' com descrição deve passar
  await db.exec(`
    insert into public.validity_audit_items (
      audit_id, source_type, product_name, expiry_date, quantity_audited, expiry_reason, expiry_reason_other
    ) values (
      '${auditId}', 'audit_found', 'Produto X', '2026-10-09', 1, 'Outro', 'Embalagem violada no recebimento'
    );
  `);
  console.log('   ✓ Comportamentos validados: NULL (pendente -> impacto NULL), 0 (zero vencidos -> impacto 0.00), positivo (35.00), sem custo (impacto NULL).');

  // 5. Teste de Isolamento Operacional (quantity_audited NÃO altera tabelas externas)
  console.log('\n5. Validando isolamento absoluto de quantity_audited...');
  const valProd = await db.query(`
    insert into public.validity_products (retail_location_id, catalog_product_id, product_code, name, quantity, expiry_date)
    values ('${store1Id}', '${catId}', '1001', 'Iogurte Morango 170g', 50, '2026-10-05')
    returning id, quantity;
  `);
  const valProdId = valProd.rows[0].id;

  // Insere item de auditoria referenciando o produto monitorado
  await db.query(`
    insert into public.validity_audit_items (
      audit_id, source_type, validity_product_id, catalog_product_id, product_name, expiry_date,
      quantity_audited, expiry_reason
    ) values (
      '${auditId}', 'monitored', '${valProdId}', '${catId}', 'Iogurte Morango 170g', '2026-10-05',
      12, 'Oferta tardia'
    );
  `);

  // Verifica que validity_products.quantity permaneceu 50 intacto
  const valProdCheck = await db.query(`select quantity from public.validity_products where id = '${valProdId}';`);
  assert.equal(Number(valProdCheck.rows[0].quantity), 50, "validity_products.quantity DEVE permanecer inalterado (50)");
  console.log('   ✓ Isolamento confirmado: validity_products.quantity permaneceu 50 sem nenhuma mutação.');

  // 6. Teste de RLS: Responsável vs Lojas Atribuídas
  console.log('\n6. Validando RLS do Responsável pela Auditoria...');
  await db.exec(`set request.jwt.claim.sub = '${responsibleId}'; set role authenticated;`);

  // Responsável lê auditoria da store1 (atribuída)
  const respStore1 = await db.query(`select id, retail_location_id from public.validity_audits where id = '${auditId}';`);
  assert.equal(respStore1.rows.length, 1, "Responsável DEVE ler auditoria de loja atribuída");

  // Responsável NÃO pode criar nem ler auditoria na store2 (não atribuída)
  await db.exec('set role postgres;');
  const audit2Admin = await db.query(`
    insert into public.validity_audits (retail_location_id, competence_month, status)
    values ('${store2Id}', '2026-10-01', 'open') returning id;
  `);
  const audit2Id = audit2Admin.rows[0].id;

  await db.exec(`set request.jwt.claim.sub = '${responsibleId}'; set role authenticated;`);
  const respStore2 = await db.query(`select id from public.validity_audits where id = '${audit2Id}';`);
  assert.equal(respStore2.rows.length, 0, "Responsável NÃO DEVE ver auditoria de loja não atribuída");

  // Responsável NÃO pode inserir item na auditoria de loja não atribuída
  await assert.rejects(async () => {
    await db.exec(`
      insert into public.validity_audit_items (
        audit_id, source_type, product_name, expiry_date, quantity_audited
      ) values (
        '${audit2Id}', 'audit_found', 'Item Proibido', '2026-10-05', 2
      );
    `);
  }, /new row violates row-level security policy/, "Responsável não pode inserir itens em loja não autorizada");
  console.log('   ✓ RLS do Responsável validado: acesso garantido na Loja 1 e bloqueado na Loja 2.');

  // 7. Teste de RLS: Auditoria Finalizada ('completed') é Imutável Operacionalmente
  console.log('\n7. Validando imutabilidade de auditoria finalizada...');
  // Responsável tenta finalizar auditoria -> BLOQUEADO
  await assert.rejects(async () => {
    await db.exec(`update public.validity_audits set status = 'completed' where id = '${auditId}';`);
  }, /new row violates row-level security policy/, "Responsável NÃO pode alterar status para 'completed'");

  // Admin finaliza a auditoria via RPC close_validity_audit
  await db.exec(`set request.jwt.claim.sub = '${adminId}'; set role authenticated;`);
  const closeResult = await db.query(`select public.close_validity_audit('${auditId}') as audit;`);
  assert.equal(closeResult.rows[0].audit.status, 'completed', "Admin deve finalizar auditoria com sucesso");

  // Agora que está completed, Responsável NÃO pode adicionar nem editar itens
  await db.exec(`set request.jwt.claim.sub = '${responsibleId}'; set role authenticated;`);
  await assert.rejects(async () => {
    await db.exec(`
      insert into public.validity_audit_items (
        audit_id, source_type, product_name, expiry_date, quantity_audited
      ) values (
        '${auditId}', 'audit_found', 'Tentativa Pós Fechamento', '2026-10-05', 1
      );
    `);
  }, /Auditoria finalizada é imutável/, "Responsável não pode inserir itens em auditoria finalizada");

  await assert.rejects(async () => {
    await db.exec(`update public.validity_audit_items set quantity_audited = 999 where audit_id = '${auditId}';`);
  }, /Auditoria finalizada é imutável/, "Responsável não pode alterar itens em auditoria finalizada");

  // Admin TAMBÉM é bloqueado de mutações diretas em auditoria completed (imutabilidade total)
  await db.exec(`set request.jwt.claim.sub = '${adminId}'; set role authenticated;`);
  await assert.rejects(async () => {
    await db.exec(`
      insert into public.validity_audit_items (
        audit_id, source_type, product_name, expiry_date, quantity_audited
      ) values (
        '${auditId}', 'audit_found', 'Tentativa Admin Pós Fechamento', '2026-10-05', 1
      );
    `);
  }, /Auditoria finalizada é imutável/, "Admin NÃO pode inserir itens em auditoria finalizada sem reabrir");

  await assert.rejects(async () => {
    await db.exec(`update public.validity_audit_items set quantity_audited = 999 where audit_id = '${auditId}';`);
  }, /Auditoria finalizada é imutável/, "Admin NÃO pode alterar itens em auditoria finalizada sem reabrir");

  // Admin NÃO pode excluir auditoria finalizada (proteção contra DELETE)
  await assert.rejects(async () => {
    await db.exec(`delete from public.validity_audits where id = '${auditId}';`);
  }, /Auditoria finalizada não pode ser excluída/, "Admin NÃO pode excluir auditoria com status completed");

  const checkAuditStillExists = await db.query(`select id, status from public.validity_audits where id = '${auditId}';`);
  assert.equal(checkAuditStillExists.rows.length, 1, "Auditoria finalizada continua existindo e protegida");
  assert.equal(checkAuditStillExists.rows[0].status, 'completed', "Status continua completed");

  console.log('   ✓ Auditoria finalizada bloqueia inserção, edição e exclusão inclusive para Administrador.');

  // 8. Teste de Reabertura pelo Administrador
  console.log('\n8. Validando reabertura pelo Administrador...');
  await db.exec(`set request.jwt.claim.sub = '${adminId}'; set role authenticated;`);
  const reopenResult = await db.query(`select public.reopen_validity_audit('${auditId}') as audit;`);
  assert.equal(reopenResult.rows[0].audit.status, 'open', "Admin deve reabrir auditoria");
  assert.ok(reopenResult.rows[0].audit.reopened_at, "reopened_at deve ser preenchido");

  // Após reabertura, o Responsável volta a conseguir registrar itens
  await db.exec(`set request.jwt.claim.sub = '${responsibleId}'; set role authenticated;`);
  await db.exec(`
    insert into public.validity_audit_items (
      audit_id, source_type, product_name, expiry_date, quantity_audited
    ) values (
      '${auditId}', 'audit_found', 'Item Pós Reabertura', '2026-10-05', 3
    );
  `);
  console.log('   ✓ Reabertura pelo Admin validada e restauração operacional confirmada.');

  // 9. Teste de Bloqueio de Usuário Comum e Anônimo
  console.log('\n9. Validando bloqueio total de usuário comum e anônimo...');
  await db.exec(`set request.jwt.claim.sub = '${commonUserId}'; set role authenticated;`);
  const commonAudits = await db.query(`select count(*) as c from public.validity_audits;`);
  assert.equal(Number(commonAudits.rows[0].c), 0, "Usuário comum não deve ver nenhuma auditoria");
  const commonItems = await db.query(`select count(*) as c from public.validity_audit_items;`);
  assert.equal(Number(commonItems.rows[0].c), 0, "Usuário comum não deve ver nenhum item de auditoria");

  await assert.rejects(async () => {
    await db.exec(`
      insert into public.validity_audits (retail_location_id, competence_month)
      values ('${store1Id}', '2026-11-01');
    `);
  }, /new row violates row-level security policy/, "Usuário comum não pode criar auditoria");

  await db.exec(`set role anon; reset request.jwt.claim.sub;`);
  await assert.rejects(async () => {
    await db.exec(`select * from public.validity_audits;`);
  }, /permission denied/, "Anônimo não tem permissão SELECT");
  await assert.rejects(async () => {
    await db.exec(`select * from public.validity_audit_items;`);
  }, /permission denied/, "Anônimo não tem permissão SELECT em itens");
  console.log('   ✓ Bloqueio de usuário comum e anônimo validado com rigor.');

  console.log('\n=============================================================');
  console.log(' TODOS OS 9 TESTES DE BANCO DA FASE 2 PASSARAM COM SUCESSO! 🎉');
  console.log('=============================================================\n');
}

run().catch(err => {
  console.error('FALHA NOS TESTES DA FASE 2:', err);
  process.exit(1);
});
