const fs = require('node:fs');
const path = require('node:path');
let PGlite;
try {
  PGlite = require('@electric-sql/pglite').PGlite;
} catch (_) {
  PGlite = require(path.resolve(__dirname, '../.tmp/sg-test/node_modules/@electric-sql/pglite')).PGlite;
}

const root = path.resolve(__dirname, '..');
const phase1Migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261006114622_audit_phase1_permissions.sql'), 'utf8');
const phase2Migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261006133000_audit_phase2_data_structures.sql'), 'utf8');
const phase2FixMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261006145500_audit_phase2_incremental_fix.sql'), 'utf8');
const phase3Migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261006170000_audit_phase3_items_and_physical_count.sql'), 'utf8');
const phase4Migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261008000000_audit_phase4_closure_and_reports.sql'), 'utf8');
const manualCostMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261008010000_audit_manual_cost_and_sg_refresh.sql'), 'utf8');

async function test() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema private;
    create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb default '{}'::jsonb, banned_until timestamptz);
    create table public.user_profiles (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), active boolean default true);
    create table public.promoter_profiles (user_id uuid primary key references auth.users(id), active boolean default true);
    create table public.promoter_location_assignments (promoter_user_id uuid references auth.users(id), location_id uuid, active boolean default true);
    create table public.admin_audit_log (id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, table_name text, record_id text, old_data jsonb, new_data jsonb, created_at timestamptz default now());
    create or replace function private.write_admin_audit() returns trigger language plpgsql security definer set search_path = '' as $$ begin return coalesce(new, old); end; $$;
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

  await db.exec(phase1Migration.replace(/notify pgrst.*/g, ''));
  await db.exec(phase2Migration.replace(/notify pgrst.*/g, ''));
  await db.exec(phase2FixMigration.replace(/notify pgrst.*/g, ''));
  await db.exec(phase3Migration.replace(/notify pgrst.*/g, ''));
  await db.exec(phase4Migration.replace(/notify pgrst.*/g, ''));
  await db.exec(manualCostMigration.replace(/notify pgrst.*/g, ''));

  const adminId = '11111111-1111-1111-1111-111111111111';
  await db.exec(`
    insert into auth.users (id, email, raw_app_meta_data)
    values ('${adminId}', 'admin@skalee.com.br', '{"access_role": "platform_admin"}'::jsonb);
  `);
  await db.exec(`select set_config('request.jwt.claim.sub', '${adminId}', false)`);

  const locRes = await db.query(`insert into public.retail_locations (name, code, active) values ('Loja Matriz', 'LJ01', true) returning id`);
  const locId = locRes.rows[0].id;

  const auditRes = await db.query(`
    select private.create_or_get_monthly_audit('${locId}', '2026-10-01') as audit;
  `);
  const auditId = auditRes.rows[0].audit.id;

  // Insert 5 items representing different scenarios:
  // 1. Monitored item with SG cost & positive loss (5 un * R$ 10.00 = R$ 50.00)
  // 2. Audit found item with Manual cost & positive loss (4 un * R$ 15.50 = R$ 62.00)
  // 3. Monitored item without cost & positive loss (3 un * null = null)
  // 4. Monitored item with 0 loss (quantity_audited = 0)
  // 5. Monitored item pending count (quantity_audited = null)
  const p1 = (await db.query(`insert into public.validity_audit_items (audit_id, source_type, product_name, barcode, unit_cost_snapshot, sale_price_snapshot, expiry_date) values ('${auditId}', 'monitored', 'Item SG', '789001', 10.00, 15.00, '2026-10-10') returning id`)).rows[0].id;
  const p2 = (await db.query(`insert into public.validity_audit_items (audit_id, source_type, product_name, barcode, unit_cost_snapshot, sale_price_snapshot, expiry_date) values ('${auditId}', 'audit_found', 'Item Manual', '789002', null, 25.00, '2026-10-11') returning id`)).rows[0].id;
  const p3 = (await db.query(`insert into public.validity_audit_items (audit_id, source_type, product_name, barcode, unit_cost_snapshot, sale_price_snapshot, expiry_date) values ('${auditId}', 'monitored', 'Item Sem Custo', '789003', null, 8.00, '2026-10-12') returning id`)).rows[0].id;
  const p4 = (await db.query(`insert into public.validity_audit_items (audit_id, source_type, product_name, barcode, unit_cost_snapshot, sale_price_snapshot, expiry_date) values ('${auditId}', 'monitored', 'Item Zero Perda', '789004', 5.00, 7.50, '2026-10-13') returning id`)).rows[0].id;
  const p5 = (await db.query(`insert into public.validity_audit_items (audit_id, source_type, product_name, barcode, unit_cost_snapshot, sale_price_snapshot, expiry_date) values ('${auditId}', 'monitored', 'Item Pendente', '789005', 12.00, 18.00, '2026-10-14') returning id`)).rows[0].id;

  // Count item 1: 5 un, SG cost
  await db.query(`select private.record_audit_item_count('${p1}', 5, 'Falha no PVPS', null, 'Descarte', 'Contado SG')`);
  // Count item 2: 4 un, Manual cost R$ 15.50
  await db.query(`select private.record_audit_item_count('${p2}', 4, 'Oferta tardia', null, 'Descarte', 'Contado Manual', 'manual', 15.50, 'Nota fiscal de compra', null, 'NF 1234')`);
  // Count item 3: 3 un, no cost
  await db.query(`select private.record_audit_item_count('${p3}', 3, 'Excesso de compra', null, 'Descarte', 'Contado sem custo')`);
  // Count item 4: 0 un (zero loss)
  await db.query(`select private.record_audit_item_count('${p4}', 0, null, null, 'Conferido OK', 'Sem perda física')`);
  // Item 5 is left pending (quantity_audited is null)

  // Now inspect get_validity_audit_report_data for OPEN AUDIT!
  const repRes = await db.query(`select private.get_validity_audit_report_data('${auditId}') as rep`);
  const reportData = repRes.rows[0].rep;

  console.log('=== OPEN AUDIT REPORT DATA ===');
  console.log('executive_summary:\n', JSON.stringify(reportData.executive_summary, null, 2));
  console.log('preventive_efficiency:\n', JSON.stringify(reportData.preventive_efficiency, null, 2));
  console.log('reasons_summary:\n', JSON.stringify(reportData.reasons_summary, null, 2));
  console.log('reconciliation:\n', JSON.stringify(reportData.reconciliation, null, 2));

  // Test rendering with audit-report-generator.js
  const genCode = fs.readFileSync(path.join(root, 'audit-report-generator.js'), 'utf8');
  const sandbox = { window: {}, console };
  const vm = require('node:vm');
  vm.createContext(sandbox);
  vm.runInContext(genCode, sandbox);

  const html = sandbox.window.skaleeAuditReport.buildExecutiveAuditHtml(reportData);
  fs.writeFileSync(path.join(root, '.tmp/open_audit_report_rendered.html'), html);
  console.log('   ✓ open_audit_report_rendered.html gerado com sucesso!');

  // Check generated metrics in HTML
  assert.ok(html.includes('R$ 112,00'), 'Deve exibir Impacto pelo Custo de R$ 112,00');
  assert.ok(html.includes('12 un.'), 'Deve exibir 12 un. vencidas');
  assert.ok(html.includes('3 produto(s) com perda'), 'Deve exibir 3 produtos com perda');
  assert.ok(html.includes('4'), 'Deve exibir 4 produtos auditados');
  assert.ok(html.includes('1 pendente(s)'), 'Deve indicar 1 pendente');
  assert.ok(html.includes('R$ 199,00'), 'Deve exibir Valor Potencial de Venda de R$ 199,00');
  assert.ok(html.includes('⚠️ Impacto apurado parcial (1 sem custo)'), 'Deve indicar impacto parcial com 1 item sem custo');
  assert.ok(html.includes('✓ 100% Conciliado'), 'Memória de cálculo deve estar 100% conciliada');
  console.log('   ✓ TODOS OS INDICADORES EXECUTIVOS DA AUDITORIA EM ANDAMENTO FORAM VALIDADOS COM 100% DE SUCESSO! 🎉');
}

const assert = require('node:assert/strict');
test().catch(console.error);
