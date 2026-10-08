const SUPABASE_URL = 'https://scetuqugfbhozikridaw.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZXR1cXVnZmJob3ppa3JpZGF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjAwOTU3NSwiZXhwIjoyMTAxNTg1NTc1fQ.bwKZVNzfZ3DK8RvAVYkmkF5KL8684S5Cmj4PcVx3RJI';

async function fetchRaw(path, options = {}) {
  const url = `${SUPABASE_URL}${path}`;
  const headers = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
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
  return { status: res.status, ok: res.ok, data: json };
}

async function check() {
  console.log('=== VERIFICANDO ESTADO REMOTO DO SUPABASE (FASE 4) ===\n');

  // 1. Verificar tabela validity_audit_lifecycle_events
  const eventsRes = await fetchRaw('/rest/v1/validity_audit_lifecycle_events?limit=1');
  console.log('1. Tabela validity_audit_lifecycle_events:');
  if (eventsRes.ok) {
    console.log('   ✓ EXISTE no banco remoto.');
  } else {
    console.log(`   ✗ NÃO EXISTE ou erro (status ${eventsRes.status}):`, eventsRes.data?.message || eventsRes.data);
  }

  // 2. Verificar colunas em validity_audits
  const auditsRes = await fetchRaw('/rest/v1/validity_audits?select=id,status,revision_number,reopen_reason,conclusion_summary,closure_snapshot,action_plan&limit=1');
  console.log('\n2. Colunas da Fase 4 em validity_audits:');
  if (auditsRes.ok) {
    console.log('   ✓ Colunas revision_number, reopen_reason, conclusion_summary, closure_snapshot, action_plan EXISTEM.');
  } else {
    console.log(`   ✗ Erro ao consultar colunas (status ${auditsRes.status}):`, auditsRes.data?.message || auditsRes.data);
  }

  // 3. Verificar RPC review_validity_audit
  const rpcReview = await fetchRaw('/rest/v1/rpc/review_validity_audit', {
    method: 'POST',
    body: JSON.stringify({ p_audit_id: '00000000-0000-0000-0000-000000000000' })
  });
  console.log('\n3. RPC review_validity_audit:');
  console.log(`   Status ${rpcReview.status}:`, rpcReview.data?.message || rpcReview.data);

  // 4. Verificar RPC mark_audit_ready_for_review
  const rpcReady = await fetchRaw('/rest/v1/rpc/mark_audit_ready_for_review', {
    method: 'POST',
    body: JSON.stringify({ p_audit_id: '00000000-0000-0000-0000-000000000000' })
  });
  console.log('\n4. RPC mark_audit_ready_for_review:');
  console.log(`   Status ${rpcReady.status}:`, rpcReady.data?.message || rpcReady.data);

  // 5. Verificar RPC list_validity_audits_history
  const rpcHist = await fetchRaw('/rest/v1/rpc/list_validity_audits_history', {
    method: 'POST',
    body: JSON.stringify({})
  });
  console.log('\n5. RPC list_validity_audits_history:');
  console.log(`   Status ${rpcHist.status}:`, rpcHist.data?.message || rpcHist.data);

  // 6. Verificar RPC get_validity_audit_report_data
  const rpcReport = await fetchRaw('/rest/v1/rpc/get_validity_audit_report_data', {
    method: 'POST',
    body: JSON.stringify({ p_audit_id: '00000000-0000-0000-0000-000000000000' })
  });
  console.log('\n6. RPC get_validity_audit_report_data:');
  console.log(`   Status ${rpcReport.status}:`, rpcReport.data?.message || rpcReport.data);
}

check().catch(console.error);

