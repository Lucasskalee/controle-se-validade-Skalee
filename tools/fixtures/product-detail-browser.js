// Local browser-only fixture; never submits to the production database.
window.modalTestHistoryCalls = 0;
window.modalTestSaved = [];
window.modalTestFailSave = false;
window.modalTestProduct = {
 id: 'modal-fixture', name: 'REFRIG.H2O 500ML LIMAO', code: '16743', barcode: '7892840812423', supplierCode: '139',
 store: 'Supermercado Sol Dourados', qty: 18, expiry: '2026-10-06', createdAt: '2026-09-23T18:01:00Z', updatedAt: '2026-10-03T13:23:00Z',
 updatedByEmail: 'operador@example.test', canDelete: true, catalogProductId: 'catalog-fixture', retailLocationId: 'store-fixture',
 // No invented product photo: the production modal must show its normal empty state.
 photo: '', photoPath: '',
 stockMovement: { catalog_product_id:'catalog-fixture', retail_location_id:'store-fixture', snapshot_date:'2026-10-03', stock_quantity:47, previous_snapshot_date:'2026-09-29', previous_stock_quantity:53, interval_days:4, movement_type:'decrease', estimated_outflow:6 }
};
window.skaleeDb = {
 getStockMovement: () => window.modalTestProduct.stockMovement,
 loadProductStockHistory: async () => {
  window.modalTestHistoryCalls++;
  return [53,51,49,47].map((stock_quantity,i) => ({ stock_quantity, snapshot_date:['2026-09-29','2026-09-30','2026-10-01','2026-10-03'][i] }));
 },
 findKnownProductImage: async () => null,
 updateProduct: async (id, changes) => {
  window.modalTestSaved.push(changes);
  if (window.modalTestFailSave) throw new Error('Falha de upload simulada');
  return { ...window.modalTestProduct, qty:changes.qty, photo:changes.removePhoto ? '' : changes.processedPhoto?.previewUrl || window.modalTestProduct.photo, photoPath:changes.removePhoto ? '' : changes.processedPhoto ? 'new.webp' : window.modalTestProduct.photoPath };
 }
};
products = [window.modalTestProduct];
isViewer = false;
document.documentElement.dataset.theme = 'light';
document.querySelectorAll('.auth-overlay').forEach(el => el.remove());
openProductDetailModal(window.modalTestProduct);
'Fixture ready';
