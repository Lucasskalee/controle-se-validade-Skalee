(() => {
 const section = document.querySelector("#multiCompanySection");
 if (!section) return;

 const el = (id) => document.getElementById(id);
 const message = el("registryMessage");
 const state = { organizations: [], brands: [], products: [], locations: [], registeredProducts: [], users: [], promoters: [] };
 const typeLabels = { industry: "Indústria", agency: "Agência", retailer: "Rede varejista" };
 let editingOrganizationId = null;
 let editingLocationId = null;

 function text(value) { return String(value ?? "").trim(); }
 function nullable(value) { return text(value) || null; }
 function setMessage(value = "", type = "") { message.textContent = value; message.className = `user-message ${type}`.trim(); }
 function fillSelect(select, rows, placeholder, selected = "") {
  select.replaceChildren(new Option(placeholder, ""));
  rows.filter((row) => row.active !== false).forEach((row) => select.add(new Option(row.name, row.id)));
  select.value = selected || "";
 }
 function empty(container, label) { container.innerHTML = `<div class="registry-empty">Nenhum ${label} cadastrado.</div>`; }
 function registryRow({ title, detail, badge, active, table, id, onEdit }) {
  const row = document.createElement("div"); row.className = `registry-row${active ? "" : " inactive"}`;
  const info = document.createElement("div"); info.className = "registry-info";
  const strong = document.createElement("strong"); strong.textContent = title;
  const small = document.createElement("small"); small.textContent = detail;
  info.append(strong, small);
  const actions = document.createElement("div"); actions.className = "registry-actions";
  const status = document.createElement("span"); status.className = "registry-badge"; status.textContent = badge;
  if (onEdit) {
   const edit = document.createElement("button"); edit.type = "button"; edit.className = "btn2"; edit.textContent = "Editar";
   edit.addEventListener("click", onEdit);
   actions.append(edit);
  }
  const button = document.createElement("button"); button.type = "button"; button.className = "btn2"; button.textContent = active ? "Inativar" : "Ativar";
  button.addEventListener("click", async () => {
   button.disabled = true; setMessage("Salvando alteração...");
   try { await window.skaleeDb.setRegistryActive(table, id, !active); await loadAll(); setMessage("Situação atualizada com sucesso.", "success"); }
   catch (error) { console.error(error); setMessage(error.message || "Não foi possível atualizar o cadastro.", "error"); button.disabled = false; }
  });
  actions.append(status, button); row.append(info, actions); return row;
 }
 function labeledSelect(label, rows, placeholder, selected) {
  const wrap = document.createElement("div");
  const labelElement = document.createElement("label"); labelElement.className = "label"; labelElement.textContent = label;
  const select = document.createElement("select"); fillSelect(select, rows, placeholder, selected);
  wrap.append(labelElement, select); return { wrap, select };
 }
 function renderRegisteredProducts() {
  const list = el("registeredProductList"); list.replaceChildren();
  state.registeredProducts.forEach((item) => {
   const editor = document.createElement("div"); editor.className = "registry-link-editor";
   const title = document.createElement("div"); title.className = "registry-link-title";
   const strong = document.createElement("strong"); strong.textContent = item.name;
   const small = document.createElement("small"); small.textContent = `${item.barcode || item.code || "Sem código"} · ${item.store}`;
   title.append(strong, small);
   const catalog = labeledSelect("Produto de catálogo", state.products, "Não vinculado", item.catalogProductId);
   const brands = labeledSelect("Marca", state.brands, "Sem marca", item.brandId);
   const locations = labeledSelect("Local", state.locations, "Sem local", item.retailLocationId);
   catalog.select.addEventListener("change", () => {
    const selectedProduct = state.products.find((product) => product.id === catalog.select.value);
    if (selectedProduct?.brand_id) brands.select.value = selectedProduct.brand_id;
   });
   const save = document.createElement("button"); save.type = "button"; save.className = "btn"; save.textContent = "Salvar vínculo";
   save.addEventListener("click", async () => {
    save.disabled = true; setMessage("Salvando vínculos do produto...");
    try {
     await window.skaleeDb.updateRegisteredProductLinks(item.id, { catalogProductId: catalog.select.value, brandId: brands.select.value, retailLocationId: locations.select.value });
     await loadAll(); setMessage("Produto registrado atualizado com sucesso.", "success");
    } catch (error) { console.error(error); setMessage(error.message || "Não foi possível atualizar o produto.", "error"); save.disabled = false; }
   });
   editor.append(title, catalog.wrap, brands.wrap, locations.wrap, save); list.append(editor);
  });
  if (!state.registeredProducts.length) empty(list, "produto registrado");
 }
 function renderPromoterBrandChecks(selectedBrandIds = []) {
  const container = el("promoterBrands"); container.replaceChildren();
  state.brands.filter((brand) => brand.active).forEach((brand) => {
   const label = document.createElement("label"); label.className = "registry-check";
   const input = document.createElement("input"); input.type = "checkbox"; input.value = brand.id; input.checked = selectedBrandIds.includes(brand.id);
   const span = document.createElement("span"); span.textContent = brand.name;
   label.append(input, span); container.append(label);
  });
  if (!state.brands.some((brand) => brand.active)) container.textContent = "Cadastre uma marca antes de configurar o promotor.";
 }
 function renderPromoterLocationChecks(selectedLocationIds = []) {
  const container = el("promoterLocations"); container.replaceChildren();
  state.locations.filter((location) => location.active).forEach((location) => {
   const label = document.createElement("label"); label.className = "registry-check";
   const input = document.createElement("input"); input.type = "checkbox"; input.value = location.id; input.checked = selectedLocationIds.includes(location.id);
   const span = document.createElement("span"); span.textContent = [location.name, location.organizations?.name].filter(Boolean).join(" · ");
   label.append(input, span); container.append(label);
  });
  if (!state.locations.some((location) => location.active)) container.textContent = "Cadastre um local antes de configurar o promotor.";
 }
 function selectedPromoter() { return state.promoters.find((profile) => profile.user_id === el("promoterUser").value); }
 function loadPromoterForm() {
  const user = state.users.find((item) => item.id === el("promoterUser").value);
  const promoter = selectedPromoter();
  el("promoterName").value = promoter?.user_profiles?.full_name || user?.email?.split("@")[0] || "";
  el("promoterAgency").value = promoter?.agency_organization_id || "";
  renderPromoterBrandChecks((promoter?.promoter_brand_assignments || []).filter((item) => item.active).map((item) => item.brand_id));
  renderPromoterLocationChecks((promoter?.promoter_location_assignments || []).filter((item) => item.active).map((item) => item.location_id));
 }
 function renderPromoters() {
  const userSelect = el("promoterUser"); userSelect.replaceChildren(new Option("Selecione o usuário", ""));
  state.users.filter((user) => !user.isAdmin).forEach((user) => userSelect.add(new Option(user.email, user.id)));
  fillSelect(el("promoterAgency"), state.organizations.filter((item) => item.organization_type === "agency"), "Sem agência");
  renderPromoterBrandChecks();
  renderPromoterLocationChecks();
  const list = el("promoterList"); list.replaceChildren();
  state.promoters.forEach((profile) => {
   const user = state.users.find((item) => item.id === profile.user_id);
   const brandNames = (profile.promoter_brand_assignments || []).filter((item) => item.active).map((assignment) => state.brands.find((brand) => brand.id === assignment.brand_id)?.name).filter(Boolean);
   const locationNames = (profile.promoter_location_assignments || []).filter((item) => item.active).map((assignment) => state.locations.find((location) => location.id === assignment.location_id)?.name).filter(Boolean);
   const agency = state.organizations.find((item) => item.id === profile.agency_organization_id)?.name;
   const row = document.createElement("div"); row.className = "registry-row";
   const info = document.createElement("div"); info.className = "registry-info";
   const name = document.createElement("strong"); name.textContent = profile.user_profiles?.full_name || user?.email || "Promotor";
   const details = document.createElement("small"); details.textContent = [user?.email, agency].filter(Boolean).join(" · ");
   const brands = document.createElement("div"); brands.className = "registry-promoter-brands"; brands.textContent = brandNames.length ? brandNames.join(", ") : "Nenhuma marca atribuída";
   const locations = document.createElement("div"); locations.className = "registry-promoter-brands"; locations.textContent = locationNames.length ? locationNames.join(", ") : "Nenhum local atribuído";
   info.append(name, details, brands, locations);
   const edit = document.createElement("button"); edit.type = "button"; edit.className = "btn2"; edit.textContent = "Editar";
   edit.addEventListener("click", () => { userSelect.value = profile.user_id; loadPromoterForm(); el("promoterForm").scrollIntoView({ behavior: "smooth", block: "center" }); });
   row.append(info, edit); list.append(row);
  });
  if (!state.promoters.length) empty(list, "promotor");
 }
 function populateRegistrationOptions() {
  const store = el("store"); if (!store) return;
  const selected = store.value;
  store.replaceChildren(new Option(state.locations.length ? "Selecione o local" : "Nenhum local permitido", ""));
 state.locations.filter((location) => location.active).forEach((location) => {
   const option = new Option(location.name, location.id); option.dataset.name = location.name; store.add(option);
  });
  if ([...store.options].some((option) => option.value === selected)) store.value = selected;
  [el("storeFilter"), el("reportStore")].filter(Boolean).forEach((filter) => {
   const selectedFilter = filter.value;
   filter.replaceChildren(new Option("Todas as lojas", ""));
   state.locations.filter((location) => location.active).forEach((location) => {
    filter.add(new Option(location.name, location.name));
   });
   if ([...filter.options].some((option) => option.value === selectedFilter)) filter.value = selectedFilter;
  });
 }
 function organizationValues() {
  return {
   name: text(el("organizationName").value),
   organization_type: el("organizationType").value,
   legal_name: nullable(el("organizationLegalName").value),
   tax_id: nullable(el("organizationTaxId").value),
   contact_email: nullable(el("organizationEmail").value),
   contact_phone: nullable(el("organizationPhone").value)
  };
 }
 function setOrganizationFormMode(organization = null) {
  editingOrganizationId = organization?.id || null;
  if (organization) {
   el("organizationName").value = organization.name || "";
   el("organizationType").value = organization.organization_type || "industry";
   el("organizationLegalName").value = organization.legal_name || "";
   el("organizationTaxId").value = organization.tax_id || "";
   el("organizationEmail").value = organization.contact_email || "";
   el("organizationPhone").value = organization.contact_phone || "";
  } else {
   el("organizationForm").reset();
  }
  el("organizationSubmit").textContent = editingOrganizationId ? "Salvar alterações" : "Cadastrar empresa";
  el("cancelOrganizationEdit").hidden = !editingOrganizationId;
 }
 function locationValues() {
  return {
   retailer_organization_id: el("locationRetailer").value,
   name: text(el("locationName").value),
   code: nullable(el("locationCode").value),
   address_line: nullable(el("locationAddress").value),
   city: nullable(el("locationCity").value),
   state: nullable(el("locationState").value)?.toUpperCase()
  };
 }
 function setLocationFormMode(location = null) {
  editingLocationId = location?.id || null;
  if (location) {
   el("locationRetailer").value = location.retailer_organization_id || "";
   el("locationName").value = location.name || "";
   el("locationCode").value = location.code || "";
   el("locationAddress").value = location.address_line || "";
   el("locationCity").value = location.city || "";
   el("locationState").value = location.state || "";
  } else {
   el("retailLocationForm").reset();
  }
  el("locationSubmit").textContent = editingLocationId ? "Salvar alterações" : "Cadastrar local";
  el("cancelLocationEdit").hidden = !editingLocationId;
 }
 function render() {
  const orgList = el("organizationList"); orgList.replaceChildren();
  state.organizations.forEach((item) => orgList.append(registryRow({ title:item.name, detail:[typeLabels[item.organization_type],item.tax_id,item.contact_email].filter(Boolean).join(" · "), badge:item.active?"Ativa":"Inativa", active:item.active, table:"organizations", id:item.id, onEdit:() => { setOrganizationFormMode(item); el("organizationForm").scrollIntoView({ behavior:"smooth", block:"center" }); setMessage(`Editando empresa: ${item.name}`); } })));
  if (!state.organizations.length) empty(orgList, "empresa");
  const brandList = el("brandList"); brandList.replaceChildren();
  state.brands.forEach((item) => brandList.append(registryRow({ title:item.name, detail:item.organizations?.name || "Empresa não identificada", badge:item.active?"Ativa":"Inativa", active:item.active, table:"brands", id:item.id })));
  if (!state.brands.length) empty(brandList, "marca");
  const productList = el("catalogProductList"); productList.replaceChildren();
  state.products.forEach((item) => productList.append(registryRow({ title:item.name, detail:[item.organizations?.name,item.brands?.name,item.category,item.internal_code].filter(Boolean).join(" · "), badge:item.active?"Ativo":"Inativo", active:item.active, table:"catalog_products", id:item.id })));
  if (!state.products.length) empty(productList, "produto");
  const locationList = el("retailLocationList"); locationList.replaceChildren();
  state.locations.forEach((item) => locationList.append(registryRow({ title:item.name, detail:[item.organizations?.name,item.code,item.city,item.state].filter(Boolean).join(" · "), badge:item.active?"Ativo":"Inativo", active:item.active, table:"retail_locations", id:item.id, onEdit:() => { setLocationFormMode(item); el("retailLocationForm").scrollIntoView({ behavior:"smooth", block:"center" }); setMessage(`Editando local: ${item.name}`); } })));
  if (!state.locations.length) empty(locationList, "local");
  fillSelect(el("brandOrganization"), state.organizations.filter((item) => item.organization_type !== "retailer"), "Selecione a empresa");
  fillSelect(el("productOrganization"), state.organizations.filter((item) => item.organization_type !== "retailer"), "Selecione a empresa");
  fillSelect(el("locationRetailer"), state.organizations.filter((item) => item.organization_type === "retailer"), "Selecione a rede");
  if (editingOrganizationId) setOrganizationFormMode(state.organizations.find((item) => item.id === editingOrganizationId));
  if (editingLocationId) setLocationFormMode(state.locations.find((item) => item.id === editingLocationId));
  filterProductBrands(); renderRegisteredProducts(); renderPromoters(); populateRegistrationOptions();
 }
 function filterProductBrands() {
  const organizationId = el("productOrganization").value;
  fillSelect(el("productBrand"), state.brands.filter((item) => !organizationId || item.owner_organization_id === organizationId), "Sem marca");
 }
 async function loadRegistrationOptions() {
  try {
   const [products, locations] = await Promise.all([window.skaleeDb.listCatalogProducts(), window.skaleeDb.listAllowedRetailLocationsForCurrentUser()]);
   state.products = products; state.locations = locations; populateRegistrationOptions();
  } catch (error) { console.error("Falha ao carregar opções de registro.", error); }
 }
 async function loadAll() {
  setMessage("Carregando cadastros...");
  try {
   const [organizations, brands, products, locations, registeredProducts] = await Promise.all([
    window.skaleeDb.listOrganizations(), window.skaleeDb.listBrands(), window.skaleeDb.listCatalogProducts(), window.skaleeDb.listRetailLocations(), window.skaleeDb.listRegisteredProductsForAdmin()
   ]);
   let users = [];
   let promoters = [];
   let usersLoadError = null;
   try {
    [users, promoters] = await Promise.all([window.skaleeDb.listUsers(), window.skaleeDb.listPromoterProfiles()]);
   } catch (error) {
    usersLoadError = error;
    console.error("Falha ao carregar usuários/promotores.", error);
   }
   Object.assign(state, { organizations, brands, products, locations, registeredProducts, users, promoters }); render();
   if (usersLoadError) {
    setMessage(`${organizations.length} empresa(s), ${brands.length} marca(s), ${products.length} produto(s) e ${locations.length} local(is). Usuários/promotores não carregaram: ${usersLoadError.message || "verifique a Edge Function admin-users."}`, "error");
   } else {
    setMessage(`${organizations.length} empresa(s), ${brands.length} marca(s), ${products.length} produto(s), ${locations.length} local(is) e ${promoters.length} promotor(es).`);
   }
  } catch (error) { console.error(error); setMessage(error.message || "Não foi possível carregar os cadastros.", "error"); }
 }
 async function submit(form, action, successMessage, afterSuccess = null) {
  const button = form.querySelector("button[type=submit]"); button.disabled = true; setMessage("Salvando cadastro...");
  try { await action(); form.reset(); if (afterSuccess) afterSuccess(); await loadAll(); setMessage(successMessage, "success"); }
  catch (error) { console.error(error); setMessage(error.message || "Não foi possível salvar o cadastro.", "error"); }
  finally { button.disabled = false; }
 }

 window.skaleeCatalogMatch = (barcode, internalCode) => state.products.find((product) => (barcode && product.barcode === barcode) || (internalCode && product.internal_code === internalCode)) || null;
 document.querySelectorAll(".registry-tab").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".registry-tab").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".registry-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.registryPanel === button.dataset.registry));
 }));
 el("productOrganization").addEventListener("change", filterProductBrands); el("promoterUser").addEventListener("change", loadPromoterForm); el("refreshRegistries").addEventListener("click", loadAll);
 el("organizationForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const values = organizationValues();
  submit(event.currentTarget, () => editingOrganizationId ? window.skaleeDb.updateOrganization(editingOrganizationId, values) : window.skaleeDb.createOrganization(values), editingOrganizationId ? "Empresa atualizada com sucesso." : "Empresa cadastrada com sucesso.", () => { editingOrganizationId = null; setOrganizationFormMode(); });
 });
 el("cancelOrganizationEdit").addEventListener("click", () => { setOrganizationFormMode(); setMessage("Edição de empresa cancelada."); });
 el("brandForm").addEventListener("submit", (event) => { event.preventDefault(); submit(event.currentTarget, () => window.skaleeDb.createBrand({ owner_organization_id:el("brandOrganization").value, name:text(el("brandName").value) }), "Marca cadastrada com sucesso."); });
 el("catalogProductForm").addEventListener("submit", (event) => { event.preventDefault(); submit(event.currentTarget, () => window.skaleeDb.createCatalogProduct({ owner_organization_id:el("productOrganization").value, brand_id:el("productBrand").value || null, name:text(el("productName").value), category:nullable(el("productCategory").value), barcode:nullable(el("productBarcode").value), internal_code:nullable(el("productInternalCode").value) }), "Produto cadastrado com sucesso."); });
 el("retailLocationForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const values = locationValues();
  submit(event.currentTarget, () => editingLocationId ? window.skaleeDb.updateRetailLocation(editingLocationId, values) : window.skaleeDb.createRetailLocation(values), editingLocationId ? "Local atualizado com sucesso." : "Local cadastrado com sucesso.", () => { editingLocationId = null; setLocationFormMode(); });
 });
 el("cancelLocationEdit").addEventListener("click", () => { setLocationFormMode(); setMessage("Edição de local cancelada."); });
 el("promoterForm").addEventListener("submit", (event) => { event.preventDefault(); submit(event.currentTarget, () => window.skaleeDb.configurePromoter({ userId:el("promoterUser").value, fullName:text(el("promoterName").value), agencyOrganizationId:el("promoterAgency").value, brandIds:[...el("promoterBrands").querySelectorAll("input:checked")].map((input) => input.value), locationIds:[...el("promoterLocations").querySelectorAll("input:checked")].map((input) => input.value) }), "Promotor, marcas e locais atualizados com sucesso."); });

 window.addEventListener("skalee:authenticated", (event) => {
  const isPlatformAdmin = event.detail?.accessRole === "platform_admin"; section.hidden = !isPlatformAdmin;
  if (isPlatformAdmin) void loadAll(); else void loadRegistrationOptions();
 });
 window.addEventListener("skalee:signed-out", () => { section.hidden = true; setMessage(); });
})();
