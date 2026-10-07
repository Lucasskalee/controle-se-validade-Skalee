import { createClient } from "npm:@supabase/supabase-js@2.55.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sessão não encontrada." }, 401);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user) return json({ error: "Sessão inválida ou expirada." }, 401);
  const { data: permissions, error: permissionError } = await userClient.rpc("get_audit_access_context");
  if (permissionError || permissions?.is_admin !== true) return json({ error: "Acesso restrito ao administrador." }, 403);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }

  const action = String(body.action || "");

  if (action === "list") {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return json({ error: error.message }, 400);
    const users = data.users.map((item) => ({
      id: item.id,
      email: item.email || "",
      createdAt: item.created_at,
      lastSignInAt: item.last_sign_in_at || null,
      bannedUntil: item.banned_until || null,
      active: !item.banned_until || new Date(item.banned_until).getTime() <= Date.now(),
      isAdmin: item.app_metadata?.access_role === "platform_admin",
    }));
    return json({ users });
  }

  if (action === "create") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Informe um e-mail válido." }, 400);
    if (password.length < 8) return json({ error: "A senha precisa ter pelo menos 8 caracteres." }, 400);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ user: { id: data.user.id, email: data.user.email } }, 201);
  }

  if (action === "set_active") {
    const id = String(body.id || "");
    const active = body.active === true;
    if (!id) return json({ error: "Usuário não informado." }, 400);
    if (id === user.id && !active) return json({ error: "Você não pode inativar sua própria conta administrativa." }, 400);
    const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(id);
    if (targetError || !targetData.user) return json({ error: "Usuário não encontrado." }, 404);
    if (targetData.user.app_metadata?.access_role === "platform_admin" && !active) {
      return json({ error: "Contas platform_admin não podem ser inativadas por esta ação." }, 400);
    }
    const { error } = await admin.auth.admin.updateUserById(id, {
      ban_duration: active ? "none" : "876000h",
    });
    if (error) return json({ error: error.message }, 400);
    return json({ success: true });
  }

  return json({ error: "Ação desconhecida." }, 400);
});
