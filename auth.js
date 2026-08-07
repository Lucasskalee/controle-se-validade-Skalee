import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

const SUPABASE_URL = "https://scetuqugfbhozikridaw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_RUy69LJc14uWrn0H9WgvKQ_ebicHtdN";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const LEGACY_STORAGE_KEY = "validade_demo_completa";
const body = document.body;
const app = document.querySelector("#protectedApp");
const form = document.querySelector("#authForm");
const email = document.querySelector("#authEmail");
const password = document.querySelector("#authPassword");
const message = document.querySelector("#authMessage");
const submit = document.querySelector("#authSubmit");
const modeButton = document.querySelector("#authMode");
const userLabel = document.querySelector("#authUser");
const signOutButton = document.querySelector("#signOut");
const authRing = document.querySelector(".auth-ring");
let mode = "sign-in";
let activeUserId;
let manualAuthInProgress = false;

function fromDatabase(row) {
 return {
  id: row.id,
  barcode: row.barcode,
  code: row.product_code,
  name: row.name,
  store: row.store,
  qty: row.quantity,
  expiry: row.expiry_date,
  offer: row.offer,
  photo: row.photo || "",
  createdAt: row.created_at,
  updatedAt: row.updated_at || row.created_at,
  completedAt: row.completed_at,
  ownerId: row.user_id,
  updatedByEmail: row.updated_by_email || "",
  canEdit: true,
  canDelete: row.user_id === activeUserId
 };
}

function toDatabase(product) {
 return {
  barcode: String(product.barcode || ""),
  product_code: String(product.code || ""),
  name: String(product.name || ""),
  store: String(product.store || ""),
  quantity: Number(product.qty),
  expiry_date: product.expiry,
  offer: Boolean(product.offer),
  photo: product.photo || ""
 };
}

async function migrateLegacyProducts() {
 const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
 if (!raw) return;
 let legacyProducts;
 try { legacyProducts = JSON.parse(raw); } catch { return; }
 if (!Array.isArray(legacyProducts) || legacyProducts.length === 0) {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  return;
 }
 const { error } = await supabase.from("validity_products").insert(legacyProducts.map(toDatabase));
 if (error) throw error;
 localStorage.removeItem(LEGACY_STORAGE_KEY);
}

window.skaleeDb = {
 async loadProducts() {
  await migrateLegacyProducts();
  const { data, error } = await supabase
   .from("validity_products")
   .select("id,user_id,barcode,product_code,name,store,quantity,expiry_date,offer,photo,created_at,updated_at,completed_at,updated_by_email")
   .is("completed_at", null)
   .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(fromDatabase);
 },
 async saveProduct(product) {
  const { data, error } = await supabase
   .from("validity_products")
   .insert(toDatabase(product))
   .select("id,user_id,barcode,product_code,name,store,quantity,expiry_date,offer,photo,created_at,updated_at,completed_at,updated_by_email")
   .single();
  if (error) throw error;
  return fromDatabase(data);
 },
 async updateProduct(id, changes) {
  const { data, error } = await supabase
   .from("validity_products")
   .update({ quantity: Number(changes.qty), offer: Boolean(changes.offer) })
   .eq("id", id)
   .select("id,user_id,barcode,product_code,name,store,quantity,expiry_date,offer,photo,created_at,updated_at,completed_at,updated_by_email")
   .single();
  if (error) throw error;
  return fromDatabase(data);
 },
 async completeProduct(id) {
  const { data, error } = await supabase
   .from("validity_products")
   .update({ completed_at: new Date().toISOString() })
   .eq("id", id)
   .select("id")
   .single();
  if (error) throw error;
  return data.id;
 },
 async deleteProduct(id) {
  const { data, error } = await supabase
   .from("validity_products")
   .delete()
   .eq("id", id)
   .select("id")
   .single();
  if (error) throw error;
  return data.id;
 },
 async listUsers() {
  const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "list" } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.users || [];
 },
 async createUser(email, password) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "create", email, password } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.user;
 },
 async setUserActive(id, active) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "set_active", id, active } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.success;
 }
};

function showMessage(text = "", type = "") {
 message.textContent = text;
 message.className = `auth-message ${type}`.trim();
}

function showSession(session) {
 const authenticated = Boolean(session?.user);
 const nextUserId = session?.user?.id || null;
 body.classList.remove("auth-loading", "auth-anonymous", "auth-authenticated");
 body.classList.add(authenticated ? "auth-authenticated" : "auth-anonymous");
 app.setAttribute("aria-hidden", String(!authenticated));
 const accessRole = session?.user?.app_metadata?.access_role || "editor";
 userLabel.textContent = authenticated ? `${session.user.email}${accessRole === "viewer" ? " · Visualizador" : ""}` : "";
 if (!authenticated) password.value = "";
 if (activeUserId !== nextUserId) {
  activeUserId = nextUserId;
  window.dispatchEvent(new CustomEvent(authenticated ? "skalee:authenticated" : "skalee:signed-out", {
   detail: { email: session?.user?.email || "", accessRole }
  }));
 }
}

function setMode(nextMode) {
 mode = nextMode;
 const signingUp = mode === "sign-up";
 document.querySelector("#authTitle").textContent = signingUp ? "Criar sua conta" : "Acessar controle de validades";
 document.querySelector("#authSubtitle").textContent = signingUp ? "Cadastre um e-mail e uma senha para começar." : "Entre com seu e-mail e senha para continuar.";
 submit.textContent = signingUp ? "Criar conta" : "Entrar";
 modeButton.textContent = signingUp ? "Já tenho uma conta" : "Criar uma conta";
 password.autocomplete = signingUp ? "new-password" : "current-password";
 showMessage();
}

form.addEventListener("submit", async (event) => {
 event.preventDefault();
 submit.disabled = true;
 manualAuthInProgress = true;
 authRing?.classList.add("is-authenticating");
 showMessage("Validando credenciais...");
 const credentials = { email: email.value.trim(), password: password.value };
 const result = mode === "sign-up" ? await supabase.auth.signUp(credentials) : await supabase.auth.signInWithPassword(credentials);
 if (result.error) {
  submit.disabled = false;
  manualAuthInProgress = false;
  authRing?.classList.remove("is-authenticating");
  showMessage(result.error.message, "error");
  return;
 }
 if (mode === "sign-up" && !result.data.session) {
  submit.disabled = false;
  manualAuthInProgress = false;
  authRing?.classList.remove("is-authenticating");
  setMode("sign-in");
  showMessage("Conta criada. Confirme o e-mail recebido antes de entrar.", "success");
  return;
 }
 showMessage("Acesso liberado. Abrindo o Controle de Validades...", "success");
 authRing?.classList.add("is-unlocking");
 await new Promise((resolve) => setTimeout(resolve, 420));
 submit.disabled = false;
 manualAuthInProgress = false;
 showSession(result.data.session);
 window.setTimeout(() => {
  authRing?.classList.remove("is-authenticating", "is-unlocking");
 }, 600);
});

email.addEventListener("focus", () => authRing?.setAttribute("data-auth-focus", "email"));
password.addEventListener("focus", () => authRing?.setAttribute("data-auth-focus", "password"));

modeButton.addEventListener("click", () => setMode(mode === "sign-in" ? "sign-up" : "sign-in"));
signOutButton.addEventListener("click", async () => {
 signOutButton.disabled = true;
 const { error } = await supabase.auth.signOut();
 signOutButton.disabled = false;
 if (error) window.alert(`Não foi possível sair: ${error.message}`);
});
supabase.auth.onAuthStateChange((_event, session) => {
 if (!manualAuthInProgress) showSession(session);
});
const { data: { session }, error } = await supabase.auth.getSession();
if (error) showMessage("Não foi possível verificar sua sessão. Tente novamente.", "error");
showSession(session);
