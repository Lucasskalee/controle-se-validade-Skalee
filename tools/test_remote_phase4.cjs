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
  return { status: res.status, ok: res.ok, data: json };
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
  console.log('Obtendo token para skalee.razarth@gmail.com...');
  const token = await getUserToken('skalee.razarth@gmail.com');
  console.log('Token obtido com sucesso!');

  console.log('\nTestando RPC review_validity_audit com token autenticado...');
  const resReview = await fetchRaw('/rest/v1/rpc/review_validity_audit', {
    method: 'POST',
    body: JSON.stringify({ p_audit_id: '00000000-0000-0000-0000-000000000000' })
  }, token);
  console.log('Resultado review_validity_audit:', resReview.status, resReview.data);

  console.log('\nTestando RPC list_validity_audits_history com token autenticado...');
  const resHist = await fetchRaw('/rest/v1/rpc/list_validity_audits_history', {
    method: 'POST',
    body: JSON.stringify({})
  }, token);
  console.log('Resultado list_validity_audits_history:', resHist.status, resHist.data);
}

run().catch(console.error);

