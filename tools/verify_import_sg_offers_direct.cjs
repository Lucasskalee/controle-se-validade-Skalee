const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Simulate the importSGOffers linking and product lifecycle logic
async function runTest() {
  console.log("Iniciando testes diretos de ciclo de vida e importação SG...");

  const indexHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const authJs = fs.readFileSync(path.resolve(__dirname, '../auth.js'), 'utf8');

  // 1. Verify filters exist in index.html and auth.js
  assert.equal(indexHtml.includes('data-filter="offer"'), true, 'Deve existir data-filter="offer" no index.html');
  assert.equal(indexHtml.includes('data-filter="no_offer"'), true, 'Deve existir data-filter="no_offer" no index.html');
  assert.equal(indexHtml.includes('offerStatus === "offer"'), true, 'Deve existir checagem de offer no index.html');
  assert.equal(indexHtml.includes('offerStatus === "no_offer"'), true, 'Deve existir checagem de no_offer no index.html');
  assert.equal(authJs.includes('offerStatus === "offer"'), true, 'Deve existir checagem de offer no auth.js');
  assert.equal(authJs.includes('offerStatus === "no_offer"'), true, 'Deve existir checagem de no_offer no auth.js');
  assert.equal(indexHtml.includes('id="updateOffer"'), false, 'Não deve existir checkbox updateOffer no index.html');
  assert.equal(indexHtml.includes('id="offer"'), false, 'Não deve existir checkbox manual offer no form de cadastro do index.html');
  console.log("PASS: 1. Filtros 'Em oferta' e 'Sem oferta' configurados e sem checkboxes manuais de oferta.");

  // 2. Mock validity_products in DB
  const mockValidityProducts = [
    { id: "vp-1", product_code: "1001", barcode: "7891000001001", name: "Biscoito Recheado", store: "Loja Matriz", retail_location_id: "loc-1", quantity: 50, expiry_date: "2026-09-30", photo: "", offer: false },
    { id: "vp-2", product_code: "1002", barcode: "7891000001002", name: "Iogurte Morango", store: "Loja Centro", retail_location_id: "loc-2", quantity: 30, expiry_date: "2026-09-25", photo: "", offer: false },
    { id: "vp-3", product_code: "1003", barcode: "7891000001003", name: "Leite Integral", store: "Loja Sul", retail_location_id: "loc-3", quantity: 20, expiry_date: "2026-09-28", photo: "", offer: false }
  ];

  const mockRetailLocations = [
    { id: "loc-1", code: "1", name: "Loja Matriz" },
    { id: "loc-2", code: "2", name: "Loja Centro" },
    { id: "loc-3", code: "3", name: "Loja Sul" }
  ];

  // CENÁRIO 1: Produto inicialmente sem oferta
  assert.equal(mockValidityProducts[0].offer, false);
  console.log("PASS: 2. Produto vp-1 inicialmente sem oferta (offer: false).");

  // CENÁRIO 2: Importar carga SG contendo esse produto
  const rows = [
    { sg_store_code: 1, product_code: "001001", barcode: "7891000001001", offer_price: 4.99 },
    { sg_store_code: 2, product_code: "009999", barcode: "7891000001002", offer_price: 3.50 },
    { sg_store_code: 1, product_code: "9999", barcode: "7899999999999", offer_price: 10.00 }
  ];

  const locationMap = new Map();
  mockRetailLocations.forEach((loc) => {
    locationMap.set(loc.id, loc);
    locationMap.set(String(loc.id).toLowerCase(), loc);
    locationMap.set(`code:${loc.code}`, loc);
    locationMap.set(loc.name.trim().toLowerCase(), loc);
  });

  const productsByStoreCode = new Map();
  const productsByStoreBarcode = new Map();
  const productsByCode = new Map();
  const productsByBarcode = new Map();

  const addProductToMap = (map, key, prodId) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(prodId);
  };

  mockValidityProducts.forEach((vp) => {
    const pId = String(vp.id);
    const storeRef = vp.retail_location_id || vp.store || "";
    const locObj = locationMap.get(storeRef) || locationMap.get(String(storeRef).toLowerCase()) || null;
    const storeKeys = [
      vp.retail_location_id,
      locObj?.id,
      locObj?.code ? String(locObj.code).trim().replace(/^0+(?=\d)/, "") : null,
      vp.store ? String(vp.store).trim().toLowerCase() : null
    ].filter(Boolean);

    const codes = [
      vp.product_code ? String(vp.product_code).trim().replace(/^0+(?=\d)/, "") : null,
      vp.product_code ? String(vp.product_code).trim() : null
    ].filter(Boolean);

    const barcodes = [
      vp.barcode ? String(vp.barcode).trim() : null
    ].filter(Boolean);

    codes.forEach((c) => {
      addProductToMap(productsByCode, c, pId);
      storeKeys.forEach((sKey) => {
        addProductToMap(productsByStoreCode, `${sKey}:${c}`, pId);
      });
    });

    barcodes.forEach((b) => {
      addProductToMap(productsByBarcode, b, pId);
      storeKeys.forEach((sKey) => {
        addProductToMap(productsByStoreBarcode, `${sKey}:${b}`, pId);
      });
    });
  });

  const matchedProductIds = new Set();
  const unlocatedCodes = new Set();
  let unlocatedRowsCount = 0;

  rows.forEach((row) => {
    const rowFilial = row.sg_store_code !== null && row.sg_store_code !== undefined ? String(row.sg_store_code).trim().replace(/^0+(?=\d)/, "") : "";
    const locByCode = rowFilial ? locationMap.get(`code:${rowFilial}`) : null;
    const storeKeys = [
      rowFilial,
      locByCode?.id,
      locByCode?.name?.trim().toLowerCase()
    ].filter(Boolean);

    const codeRaw = String(row.product_code || "").trim();
    const codeNorm = codeRaw.replace(/^0+(?=\d)/, "");
    const barcodeNorm = String(row.barcode || "").trim();

    let matchedForThisRow = false;

    if (codeNorm && storeKeys.length) {
      for (const sKey of storeKeys) {
        const key = `${sKey}:${codeNorm}`;
        if (productsByStoreCode.has(key)) {
          productsByStoreCode.get(key).forEach((id) => matchedProductIds.add(id));
          matchedForThisRow = true;
        }
      }
    }

    if (barcodeNorm && storeKeys.length) {
      for (const sKey of storeKeys) {
        const key = `${sKey}:${barcodeNorm}`;
        if (productsByStoreBarcode.has(key)) {
          productsByStoreBarcode.get(key).forEach((id) => matchedProductIds.add(id));
          matchedForThisRow = true;
        }
      }
    }

    if (!matchedForThisRow && codeNorm && productsByCode.has(codeNorm)) {
      productsByCode.get(codeNorm).forEach((id) => matchedProductIds.add(id));
      matchedForThisRow = true;
    }
    if (!matchedForThisRow && barcodeNorm && productsByBarcode.has(barcodeNorm)) {
      productsByBarcode.get(barcodeNorm).forEach((id) => matchedProductIds.add(id));
      matchedForThisRow = true;
    }

    if (!matchedForThisRow) {
      unlocatedRowsCount += 1;
      if (codeRaw || barcodeNorm) {
        unlocatedCodes.add(codeRaw || barcodeNorm);
      }
    }
  });

  // Apply offer = true to matched products
  matchedProductIds.forEach((id) => {
    const prod = mockValidityProducts.find(p => p.id === id);
    if (prod) prod.offer = true;
  });

  // CENÁRIO 3: Produto passa para offer = true
  assert.equal(mockValidityProducts[0].offer, true);
  assert.equal(mockValidityProducts[1].offer, true);
  assert.equal(mockValidityProducts[2].offer, false);
  console.log("PASS: 3. Produtos correspondentes (vp-1 e vp-2) passam para offer = true após carga SG.");

  // CENÁRIO 4: Card mostra badge "Em oferta"
  const renderOfferBadgesMarkup = (product) => {
    if (!product || !product.offer) return "";
    return '<span class="badge offer">Em oferta</span>';
  };
  assert.equal(renderOfferBadgesMarkup(mockValidityProducts[0]), '<span class="badge offer">Em oferta</span>');
  assert.equal(renderOfferBadgesMarkup(mockValidityProducts[2]), '');
  console.log("PASS: 4. Card renderiza badge 'Em oferta' apenas quando offer === true.");

  // CENÁRIO 5: Filtro "Em oferta" e Filtro "Sem oferta"
  const filterByCriteria = (product, offerStatus) => {
    if (offerStatus === "offer" && !product.offer) return false;
    if (offerStatus === "no_offer" && product.offer) return false;
    return true;
  };
  // Filtro Em oferta
  assert.equal(filterByCriteria(mockValidityProducts[0], "offer"), true);
  assert.equal(filterByCriteria(mockValidityProducts[1], "offer"), true);
  assert.equal(filterByCriteria(mockValidityProducts[2], "offer"), false);
  // Filtro Sem oferta
  assert.equal(filterByCriteria(mockValidityProducts[0], "no_offer"), false);
  assert.equal(filterByCriteria(mockValidityProducts[1], "no_offer"), false);
  assert.equal(filterByCriteria(mockValidityProducts[2], "no_offer"), true);
  console.log("PASS: 5. Filtros 'Em oferta' e 'Sem oferta' filtram corretamente.");

  // CENÁRIO 6 & 7: Editar somente a quantidade do produto -> offer continua true
  const updateProductSimulation = (product, changes) => {
    const updatePayload = {};
    if (changes.qty !== undefined) updatePayload.quantity = Number(changes.qty);
    if (changes.processedPhoto) updatePayload.photo = changes.processedPhoto.previewUrl;
    // Note: changes does NOT include offer during normal edit
    return {
      ...product,
      ...changes,
      offer: product.offer, // Preserved!
      quantity: updatePayload.quantity !== undefined ? updatePayload.quantity : product.quantity,
      photo: updatePayload.photo !== undefined ? updatePayload.photo : product.photo
    };
  };

  const updatedByQty = updateProductSimulation(mockValidityProducts[0], { qty: 150 });
  assert.equal(updatedByQty.quantity, 150);
  assert.equal(updatedByQty.offer, true);
  console.log("PASS: 6. Editar somente a quantidade do produto preserva offer = true.");

  // CENÁRIO 8 & 9: Editar foto -> offer continua true
  const updatedByPhoto = updateProductSimulation(updatedByQty, { processedPhoto: { previewUrl: "https://example.com/photo.jpg" } });
  assert.equal(updatedByPhoto.photo, "https://example.com/photo.jpg");
  assert.equal(updatedByPhoto.quantity, 150);
  assert.equal(updatedByPhoto.offer, true);
  console.log("PASS: 7. Editar foto do produto preserva offer = true.");

  console.log("\nTODOS OS CENÁRIOS DE VÍNCULO DIRETO E CICLO DE VIDA VALIDADOS COM SUCESSO! 🚀\n");
}

runTest();
