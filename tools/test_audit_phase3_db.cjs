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

async function run() {
  console.log('=== TESTES DE INTEGRIDADE, RLS E OPERAÇÕES - FASE 3 AUDITORIA ===\n');
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
      catalog_product_id uuid references public.catalog_products(id),
      retail_location_id uuid references public.retail_locations(id),
      internal_code text,
      snapshot_date date not null,
      stock_quantity numeric not null,
      sale_price numeric,
      cost_price numeric,
      created_at timestamptz default now()
    );
    create table public.sg_stock_current (
      retail_location_id uuid references public.retail_locations(id),
      internal_code text not null,
      catalog_product_id uuid references public.catalog_products(id),
      stock_quantity numeric,
      snapshot_date date,
      last_seen_at timestamptz default now()
    );

    grant usage on schema public, auth, private to authenticated, anon;
    grant select, insert, update on public.retail_locations, public.catalog_products, public.validity_products, public.product_stock_snapshots, public.sg_stock_current to authenticated;
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

  // 2. Aplica Migrations Fase 2 (base e fix)
  console.log('\n2. Aplicando Migrations da Fase 2...');
  await db.exec(phase2Migration);
  await db.exec(phase2FixMigration);
  console.log('   ✓ Migrations da Fase 2 aplicadas com sucesso.');

  // 3. Aplica Migration Fase 3
  console.log('\n3. Aplicando Migration da Fase 3 (sincronização de monitorados, apuração física e audit_found)...');
  await db.exec(phase3Migration);
  console.log('   ✓ Migration Fase 3 aplicada com sucesso.');

  // Inserção de dados operacionais para os testes
  const catProd1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const catProd2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await db.exec(`
    insert into public.catalog_products (id, name, barcode, internal_code, active, photo_path) values
      ('${catProd1}', 'Café Caboclo 500g', '7896089016215', '44388', true, 'photos/cafe.jpg'),
      ('${catProd2}', 'Biscoito Recheado 140g', '7891000100010', '12345', true, 'photos/biscoito.jpg');

    -- Snapshots SG de referência para a Loja 1
    insert into public.product_stock_snapshots (catalog_product_id, retail_location_id, internal_code, snapshot_date, stock_quantity, sale_price, cost_price) values
      ('${catProd1}', '${store1Id}', '44388', '2026-09-08', 50, 27.90, 18.00),
      ('${catProd2}', '${store1Id}', '12345', '2026-09-08', 20, 5.00, null); -- sem custo

    -- sg_stock_current com estoque mais recente para Café na Loja 1
    insert into public.sg_stock_current (retail_location_id, internal_code, catalog_product_id, stock_quantity, snapshot_date) values
      ('${store1Id}', '44388', '${catProd1}', 48, '2026-09-09');

    -- Produtos monitorados em validity_products para Loja 1 e Loja 2
    -- P1: Competência Setembro/2026, Loja 1, active
    insert into public.validity_products (id, catalog_product_id, retail_location_id, product_code, barcode, name, quantity, expiry_date, completed_at, photo_path) values
      ('11110000-0000-0000-0000-000000000001', '${catProd1}', '${store1Id}', '44388', '7896089016215', 'Café Caboclo 500g', 30, '2026-09-15', null, 'photos/cafe.jpg'),
      -- P2: Competência Setembro/2026, Loja 1, COMPLETED (completed_at preenchido!)
      ('11110000-0000-0000-0000-000000000002', '${catProd2}', '${store1Id}', '12345', '7891000100010', 'Biscoito Recheado 140g', 15, '2026-09-20', '2026-09-20 10:00:00+00', 'photos/biscoito.jpg'),
      -- P3: Competência OUTUBRO/2026, Loja 1 (outro mês - NÃO DEVE ENTRAR)
      ('11110000-0000-0000-0000-000000000003', '${catProd1}', '${store1Id}', '44388', '7896089016215', 'Café Caboclo Outubro', 10, '2026-10-15', null, null),
      -- P4: Competência Setembro/2026, LOJA 2 (outra loja - NÃO DEVE ENTRAR)
      ('11110000-0000-0000-0000-000000000004', '${catProd1}', '${store2Id}', '44388', '7896089016215', 'Café Caboclo Loja 2', 20, '2026-09-15', null, null);
  `);

  // Criar auditoria para Loja 1 na competência 2026-09-01
  await db.exec(`set request.jwt.claim.sub = '${adminId}'; set role authenticated;`);
  const createRes = await db.query(`select public.create_or_get_monthly_audit('${store1Id}', '2026-09-01'::date) as audit;`);
  const auditId = createRes.rows[0].audit.id;
  assert.ok(auditId, 'Auditoria deve ser criada com sucesso');

  // TESTES 1 A 7: Sincronização e Idempotência
  console.log('\n4. Validando sync_validity_audit_monitored_items...');
  const sync1 = await db.query(`select public.sync_validity_audit_monitored_items('${auditId}') as res;`);
  assert.equal(sync1.rows[0].res.synced_count, 2, 'Validação 1 e 2: Deve sincronizar exatamente 2 produtos (inclusive o com completed_at)');

  const items1 = await db.query(`select * from public.validity_audit_items where audit_id = '${auditId}' order by expiry_date;`);
  assert.equal(items1.rows.length, 2, 'Auditoria deve conter 2 itens');
  
  // Validação 1 e 2: Conferir que o item completed entrou
  const completedItem = items1.rows.find(i => i.validity_product_id === '11110000-0000-0000-0000-000000000002');
  assert.ok(completedItem, 'Validação 2: Produto com completed_at deve entrar na auditoria');

  // Validação 3 e 4: Outro mês e outra loja não entraram
  const outroMes = items1.rows.find(i => i.validity_product_id === '11110000-0000-0000-0000-000000000003');
  assert.equal(outroMes, undefined, 'Validação 3: Produto de outro mês não deve entrar');
  const outraLoja = items1.rows.find(i => i.validity_product_id === '11110000-0000-0000-0000-000000000004');
  assert.equal(outraLoja, undefined, 'Validação 4: Produto de outra loja não deve entrar');

  // Validação 5: Sincronização repetida não duplica
  const sync2 = await db.query(`select public.sync_validity_audit_monitored_items('${auditId}') as res;`);
  assert.equal(sync2.rows[0].res.synced_count, 0, 'Validação 5: Sincronização repetida deve inserir 0 novos itens');
  const items2 = await db.query(`select count(*) as count from public.validity_audit_items where audit_id = '${auditId}';`);
  assert.equal(Number(items2.rows[0].count), 2, 'Validação 5: Quantidade total deve permanecer 2');

  // Validação 8 e 9: quantity_audited e audited_at nascem estritamente NULL
  const cafeItem = items1.rows.find(i => i.validity_product_id === '11110000-0000-0000-0000-000000000001');
  assert.equal(cafeItem.quantity_audited, null, 'Validação 8: quantity_audited inicial deve ser NULL');
  assert.equal(cafeItem.audited_at, null, 'Validação 9: audited_at inicial deve ser NULL');
  assert.equal(cafeItem.item_status, 'pending', 'item_status inicial deve ser pending');
  assert.equal(cafeItem.financial_cost_impact, null, 'impacto financeiro inicial deve ser NULL');

  // Snapshots capturados corretamente
  assert.equal(Number(cafeItem.stock_quantity_snapshot), 48, 'Estoque SG deve priorizar sg_stock_current (48 un)');
  assert.equal(Number(cafeItem.unit_cost_snapshot), 18.00, 'Custo unitário congelado de product_stock_snapshots (18.00)');
  assert.equal(Number(cafeItem.sale_price_snapshot), 27.90, 'Preço de venda congelado (27.90)');
  console.log('   ✓ Sincronização, filtro de competência, produtos completed e snapshots validados com perfeição.');

  // TESTES 10, 11, 12, 13: Apuração Física e Cálculo Financeiro
  console.log('\n5. Validando apuração física com record_audit_item_count...');
  // 10: Apuração com 0
  const countZeroRes = await db.query(`
    select public.record_audit_item_count(
      '${completedItem.id}',
      0,
      'Falha de acompanhamento',
      null,
      'Descarte prevenido',
      'Nenhum produto vencido encontrado fisicamente'
    ) as res;
  `);
  assert.equal(Number(countZeroRes.rows[0].res.quantity_audited), 0, 'Validação 10: quantity_audited deve ser 0');
  assert.equal(countZeroRes.rows[0].res.item_status, 'counted', 'item_status deve ser counted');
  assert.notEqual(countZeroRes.rows[0].res.audited_at, null, 'audited_at deve ser preenchido');
  // completedItem não tinha custo -> impacto continua NULL mesmo com zero? Wait, 0 * null = null
  assert.equal(countZeroRes.rows[0].res.financial_cost_impact, null, 'Validação 12: Custo ausente mantém impacto NULL');

  // 11 e 13: Apuração positiva e cálculo correto
  const countPosRes = await db.query(`
    select public.record_audit_item_count(
      '${cafeItem.id}',
      5,
      'Falha no PVPS',
      null,
      'Descarte',
      'Conferência física realizada'
    ) as res;
  `);
  assert.equal(Number(countPosRes.rows[0].res.quantity_audited), 5, 'Validação 11: quantity_audited deve ser 5');
  assert.equal(Number(countPosRes.rows[0].res.financial_cost_impact), 90.00, 'Validação 13: Impacto financeiro deve ser 5 * 18.00 = 90.00');
  assert.equal(Number(countPosRes.rows[0].res.potential_sales_loss), 139.50, 'Perda de venda deve ser 5 * 27.90 = 139.50');
  console.log('   ✓ Apuração com zero, positiva, ausência de custo e impacto financeiro validados.');

  // Validação 6 e 7: Nova sincronização adiciona novos e NÃO sobrescreve apurações
  console.log('\n6. Validando que re-sincronização não sobrescreve itens apurados...');
  // Insere novo produto monitorado posterior
  await db.exec(`
    insert into public.validity_products (id, catalog_product_id, retail_location_id, product_code, barcode, name, quantity, expiry_date)
    values ('11110000-0000-0000-0000-000000000099', '${catProd1}', '${store1Id}', '44388', '7896089016215', 'Café Adicionado Posteriormente', 5, '2026-09-25');
  `);
  const sync3 = await db.query(`select public.sync_validity_audit_monitored_items('${auditId}') as res;`);
  assert.equal(sync3.rows[0].res.synced_count, 1, 'Validação 6: Deve adicionar exatamente 1 novo produto');

  // Verifica que o item do café apurado anteriormente (quantity=5) permanece intocado
  const cafeRecheck = await db.query(`select * from public.validity_audit_items where id = '${cafeItem.id}';`);
  assert.equal(Number(cafeRecheck.rows[0].quantity_audited), 5, 'Validação 7: Item já apurado NÃO pode ter quantidade sobrescrita');
  assert.equal(cafeRecheck.rows[0].expiry_reason, 'Falha no PVPS', 'Motivo não pode ser sobrescrito');
  console.log('   ✓ Idempotência refinada comprovada: novos produtos são agregados sem alterar apurações.');

  // Validação 14 e 15: Produto Encontrado na Auditoria (audit_found)
  console.log('\n7. Validando add_audit_found_item...');
  const vpCountBefore = (await db.query(`select count(*) as c from public.validity_products;`)).rows[0].c;
  const foundRes = await db.query(`
    select public.add_audit_found_item(
      '${auditId}',
      '2026-09-10'::date,
      3,
      '${catProd1}',
      '7896089016215',
      '44388',
      'Café Achado na Gôndola',
      'Produto não cadastrado no Controle de Validades',
      null,
      'Retirado de venda',
      'Encontrado durante varredura'
    ) as res;
  `);
  const foundItem = foundRes.rows[0].res;
  assert.equal(foundItem.source_type, 'audit_found', 'Validação 14: source_type deve ser audit_found');
  assert.equal(foundItem.validity_product_id, null, 'Validação 14: validity_product_id deve ser estritamente NULL');
  assert.equal(Number(foundItem.quantity_audited), 3, 'quantity_audited deve ser 3');
  assert.equal(Number(foundItem.financial_cost_impact), 54.00, 'Impacto financeiro deve ser 3 * 18.00 = 54.00');

  // Validação 15: audit_found NÃO cria validity_product
  const vpCountAfter = (await db.query(`select count(*) as c from public.validity_products;`)).rows[0].c;
  assert.equal(vpCountAfter, vpCountBefore, 'Validação 15: audit_found NUNCA deve criar registro em validity_products');
  console.log('   ✓ Produto avulso audit_found criado com snapshots automáticos e isolamento operacional comprovado.');

  // Validação 16 e 17: Isolamento operacional absoluto de validity_products e estoque SG
  console.log('\n8. Validando isolamento absoluto de validity_products e estoques SG...');
  const vpOriginal = await db.query(`select quantity from public.validity_products where id = '11110000-0000-0000-0000-000000000001';`);
  assert.equal(Number(vpOriginal.rows[0].quantity), 30, 'Validação 17: validity_products.quantity deve permanecer 30');

  const sgStock = await db.query(`select stock_quantity from public.sg_stock_current where retail_location_id = '${store1Id}' and internal_code = '44388';`);
  assert.equal(Number(sgStock.rows[0].stock_quantity), 48, 'Validação 16: sg_stock_current.stock_quantity deve permanecer 48');
  console.log('   ✓ Isolamento absoluto confirmado: nenhuma quantidade operacional foi afetada.');

  // Validação 18, 19, 20: Permissões de Usuário Comum, Responsável e Admin
  console.log('\n9. Validando regras de permissão (Usuário Comum, Responsável e Admin)...');
  // Usuário comum bloqueado
  await db.exec(`set request.jwt.claim.sub = '${commonUserId}';`);
  await assert.rejects(
    async () => db.query(`select public.sync_validity_audit_monitored_items('${auditId}');`),
    /Acesso negado para a loja selecionada/,
    'Validação 18: Usuário comum deve ser bloqueado na sincronização'
  );
  await assert.rejects(
    async () => db.query(`select public.record_audit_item_count('${cafeItem.id}', 10);`),
    /Acesso negado para a loja selecionada/,
    'Validação 18: Usuário comum deve ser bloqueado na apuração'
  );

  // Responsável na loja 1 (permitido)
  await db.exec(`set request.jwt.claim.sub = '${responsibleId}';`);
  const respSync = await db.query(`select public.sync_validity_audit_monitored_items('${auditId}') as res;`);
  assert.ok(respSync.rows[0].res, 'Validação 19: Responsável da loja 1 tem permissão para sincronizar');

  // Responsável na loja 2 (bloqueado)
  await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
  const auditStore2 = await db.query(`
    select public.create_or_get_monthly_audit('${store2Id}', '2026-09-01'::date) as audit;
  `);
  const audit2Id = auditStore2.rows[0].audit.id;
  await db.exec(`set request.jwt.claim.sub = '${responsibleId}';`);
  await assert.rejects(
    async () => db.query(`select public.sync_validity_audit_monitored_items('${audit2Id}');`),
    /Acesso negado para a loja selecionada/,
    'Validação 19: Responsável deve ser bloqueado em loja não atribuída'
  );
  console.log('   ✓ Permissões e RLS validados com rigor para todos os papéis.');

  // Validação 21 e 22: Imutabilidade em completed e restauração em reopen
  console.log('\n10. Validando imutabilidade de auditoria completed e reabertura...');
  await db.exec(`set request.jwt.claim.sub = '${adminId}';`);
  await db.query(`select public.close_validity_audit('${auditId}');`);

  // Tentativa de sincronizar em auditoria completed
  await assert.rejects(
    async () => db.query(`select public.sync_validity_audit_monitored_items('${auditId}');`),
    /Auditoria finalizada é imutável/,
    'Validação 21: sync_validity_audit_monitored_items deve falhar em auditoria completed'
  );
  // Tentativa de apurar em auditoria completed
  await assert.rejects(
    async () => db.query(`select public.record_audit_item_count('${cafeItem.id}', 99);`),
    /Auditoria finalizada é imutável/,
    'Validação 21: record_audit_item_count deve falhar em auditoria completed'
  );
  // Tentativa de adicionar avulso em auditoria completed
  await assert.rejects(
    async () => db.query(`select public.add_audit_found_item('${auditId}', '2026-09-10'::date, 1);`),
    /Auditoria finalizada é imutável/,
    'Validação 21: add_audit_found_item deve falhar em auditoria completed'
  );

  // Validação 22: Reopen restaura edição
  await db.query(`select public.reopen_validity_audit('${auditId}');`);
  const reopenCount = await db.query(`select public.record_audit_item_count('${cafeItem.id}', 6) as res;`);
  assert.equal(Number(reopenCount.rows[0].res.quantity_audited), 6, 'Validação 22: Reopen deve restaurar edição de itens');
  console.log('   ✓ Imutabilidade total em completed e restauração por reopen aprovados.');

  console.log('\n=============================================================');
  console.log(' TODOS OS 23 TESTES DA FASE 3 FORAM APROVADOS COM SUCESSO! 🎉');
  console.log('=============================================================\n');
}

run().catch(err => {
  console.error('\n[ERRO NOS TESTES DA FASE 3]:', err);
  process.exitCode = 1;
});
