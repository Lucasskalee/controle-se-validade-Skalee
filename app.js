const DBF_URL = "consulta03.dbf";
const STORAGE_KEY = "skalee.validities.v1";

const state = {
  products: [],
  records: loadRecords(),
  selectedProduct: null,
};

const elements = {
  databaseStatus: document.querySelector("#databaseStatus"),
  productSearch: document.querySelector("#productSearch"),
  productResults: document.querySelector("#productResults"),
  selectedProduct: document.querySelector("#selectedProduct"),
  selectedProductCode: document.querySelector("#selectedProductCode"),
  validityForm: document.querySelector("#validityForm"),
  expiryDate: document.querySelector("#expiryDate"),
  quantity: document.querySelector("#quantity"),
  lot: document.querySelector("#lot"),
  formMessage: document.querySelector("#formMessage"),
  clearFormButton: document.querySelector("#clearFormButton"),
  recordSearch: document.querySelector("#recordSearch"),
  statusFilter: document.querySelector("#statusFilter"),
  recordsBody: document.querySelector("#recordsBody"),
  emptyState: document.querySelector("#emptyState"),
};

function loadRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function readText(bytes) {
  return new TextDecoder("windows-1252").decode(bytes).replace(/\0/g, "").trim();
}

function parseDbf(buffer) {
  const view = new DataView(buffer);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const bytes = new Uint8Array(buffer);
  const fields = [];

  for (let offset = 32; offset < headerLength && bytes[offset] !== 0x0d; offset += 32) {
    fields.push({
      name: readText(bytes.subarray(offset, offset + 11)),
      type: String.fromCharCode(bytes[offset + 11]),
      length: bytes[offset + 16],
    });
  }

  const products = [];
  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = headerLength + index * recordLength;
    if (recordOffset + recordLength > bytes.length || bytes[recordOffset] === 0x2a) continue;

    let position = recordOffset + 1;
    const record = {};
    for (const field of fields) {
      const value = readText(bytes.subarray(position, position + field.length));
      record[field.name] = field.type === "N" && value !== "" ? Number(value) : value;
      position += field.length;
    }

    if (record.CODBAR || record.CODPROD) {
      products.push({
        barcode: String(record.CODBAR || ""),
        code: String(record.CODPROD || ""),
        description: String(record.DESCRICAO || "Produto sem descrição"),
        price: Number(record.PRVENDA || 0),
        stock: Number(record.ESTOQ || 0),
      });
    }
  }
  return products;
}

async function loadDatabase() {
  try {
    const response = await fetch(DBF_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.products = parseDbf(await response.arrayBuffer());
    elements.databaseStatus.classList.add("ready");
    elements.databaseStatus.innerHTML = `<span class="status-dot"></span>${state.products.length.toLocaleString("pt-BR")} produtos carregados`;
  } catch (error) {
    elements.databaseStatus.classList.add("error");
    elements.databaseStatus.innerHTML = '<span class="status-dot"></span>Não foi possível abrir o DBF';
    showMessage("Abra o projeto por um servidor local para carregar o consulta03.dbf.", "error");
    console.error("Erro ao carregar DBF:", error);
  }
}

function normalize(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function findProducts(query) {
  const term = normalize(query);
  if (term.length < 2) return [];
  const terms = term.split(/\s+/);
  const results = [];
  for (const product of state.products) {
    const haystack = normalize(`${product.barcode} ${product.code} ${product.description}`);
    if (terms.every((part) => haystack.includes(part))) {
      results.push(product);
      if (results.length === 12) break;
    }
  }
  return results;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function renderProductResults() {
  const query = elements.productSearch.value;
  if (query.trim().length < 2) {
    elements.productResults.hidden = true;
    return;
  }

  const matches = findProducts(query);
  elements.productResults.innerHTML = matches.length
    ? matches.map((product, index) => `
      <button class="product-option" type="button" data-product-index="${index}">
        <span><strong>${escapeHtml(product.description)}</strong><small>${escapeHtml(product.barcode || `Cód. ${product.code}`)} · Estoque: ${product.stock.toLocaleString("pt-BR")}</small></span>
        <span class="price">${product.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
      </button>`).join("")
    : '<div class="no-results">Nenhum produto encontrado.</div>';
  elements.productResults.hidden = false;

  elements.productResults.querySelectorAll("[data-product-index]").forEach((button) => {
    button.addEventListener("click", () => selectProduct(matches[Number(button.dataset.productIndex)]));
  });
}

function selectProduct(product) {
  state.selectedProduct = product;
  elements.selectedProductCode.value = product.barcode || product.code;
  elements.productSearch.value = product.description;
  elements.selectedProduct.textContent = `Selecionado: ${product.description} · ${product.barcode || `código ${product.code}`}`;
  elements.selectedProduct.hidden = false;
  elements.productResults.hidden = true;
  elements.expiryDate.focus();
}

function clearForm() {
  elements.validityForm.reset();
  elements.quantity.value = "1";
  state.selectedProduct = null;
  elements.selectedProductCode.value = "";
  elements.selectedProduct.hidden = true;
  elements.productResults.hidden = true;
  elements.formMessage.textContent = "";
  elements.formMessage.className = "form-message";
}

function showMessage(text, type) {
  elements.formMessage.textContent = text;
  elements.formMessage.className = `form-message ${type}`;
}

function daysUntil(dateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${dateString}T00:00:00`);
  return Math.round((expiry - today) / 86400000);
}

function getStatus(dateString) {
  const days = daysUntil(dateString);
  if (days < 0) return { key: "expired", label: `Vencido há ${Math.abs(days)} dia${Math.abs(days) === 1 ? "" : "s"}` };
  if (days <= 7) return { key: "urgent", label: days === 0 ? "Vence hoje" : `${days} dia${days === 1 ? "" : "s"}` };
  if (days <= 30) return { key: "attention", label: `${days} dias` };
  return { key: "ok", label: `${days} dias` };
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${dateString}T00:00:00Z`));
}

function persistRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
}

function updateSummary() {
  const counts = { expired: 0, urgent: 0, attention: 0, ok: 0 };
  state.records.forEach((record) => { counts[getStatus(record.expiryDate).key] += 1; });
  document.querySelector("#expiredCount").textContent = counts.expired;
  document.querySelector("#urgentCount").textContent = counts.urgent;
  document.querySelector("#attentionCount").textContent = counts.attention;
  document.querySelector("#okCount").textContent = counts.ok;
}

function renderRecords() {
  const query = normalize(elements.recordSearch.value);
  const statusFilter = elements.statusFilter.value;
  const records = [...state.records]
    .filter((record) => !query || normalize(`${record.description} ${record.barcode} ${record.lot}`).includes(query))
    .filter((record) => statusFilter === "all" || getStatus(record.expiryDate).key === statusFilter)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  elements.recordsBody.innerHTML = records.map((record) => {
    const status = getStatus(record.expiryDate);
    return `<tr>
      <td>${escapeHtml(record.description)}</td>
      <td>${escapeHtml(record.barcode)}</td>
      <td>${formatDate(record.expiryDate)}</td>
      <td>${record.quantity}</td>
      <td>${escapeHtml(record.lot || "—")}</td>
      <td><span class="badge ${status.key}">${status.label}</span></td>
      <td><button class="delete-button" type="button" data-delete-id="${record.id}" aria-label="Excluir ${escapeHtml(record.description)}">Excluir</button></td>
    </tr>`;
  }).join("");

  elements.emptyState.hidden = records.length > 0;
  elements.recordsBody.closest("table").hidden = records.length === 0;
  elements.recordsBody.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => deleteRecord(button.dataset.deleteId));
  });
  updateSummary();
}

function deleteRecord(id) {
  const record = state.records.find((item) => item.id === id);
  if (!record || !window.confirm(`Excluir a validade de ${record.description}?`)) return;
  state.records = state.records.filter((item) => item.id !== id);
  persistRecords();
  renderRecords();
}

elements.productSearch.addEventListener("input", () => {
  state.selectedProduct = null;
  elements.selectedProductCode.value = "";
  elements.selectedProduct.hidden = true;
  renderProductResults();
});

elements.productSearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") elements.productResults.hidden = true;
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".product-field")) elements.productResults.hidden = true;
});

elements.validityForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.selectedProduct) {
    showMessage("Selecione um produto na lista de resultados.", "error");
    elements.productSearch.focus();
    return;
  }

  state.records.push({
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    barcode: state.selectedProduct.barcode || state.selectedProduct.code,
    productCode: state.selectedProduct.code,
    description: state.selectedProduct.description,
    expiryDate: elements.expiryDate.value,
    quantity: Number(elements.quantity.value),
    lot: elements.lot.value.trim(),
    createdAt: new Date().toISOString(),
  });
  persistRecords();
  renderRecords();
  clearForm();
  showMessage("Validade cadastrada com sucesso.", "success");
});

elements.clearFormButton.addEventListener("click", clearForm);
elements.recordSearch.addEventListener("input", renderRecords);
elements.statusFilter.addEventListener("change", renderRecords);

renderRecords();
loadDatabase();
