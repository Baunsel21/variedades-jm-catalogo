import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const extract = (pattern, message) => {
  const source = admin.match(pattern)?.[0];
  assert.ok(source, message);
  return source;
};
const run = (source, globals = {}) => {
  const context = vm.createContext(globals);
  new vm.Script(source).runInContext(context);
  return context;
};
const deferredValue = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const consoleStub = { debug() {}, error() {}, log() {}, warn() {} };
const authCurrent = (context, userId, epoch) => !!context && context.adminSessionAuthorized && context.adminSessionUserId === userId && context.adminAuthEpoch === epoch;

// Pagos: una respuesta de guardado de A no puede cambiar el toggle, estado o botón de B.
const savePaymentSource = extract(/async function saveOnlinePaymentSettings\(\)\{[\s\S]*?\n\}/, 'Debe existir el guardado de pagos en línea');
const paymentWriteA = deferredValue();
const paymentWriteStarted = deferredValue();
let paymentSaveContext;
const paymentToggle = { checked: true, disabled: false };
const paymentButton = { disabled: false, textContent: 'Guardar' };
const paymentStatus = { textContent: '' };
const paymentToasts = [];
const paymentSave = run(savePaymentSource, {
  adminSessionAuthorized: true, adminSessionUserId: 'account-A', adminAuthEpoch: 101,
  adminAuthOperationStillCurrent: (userId, epoch) => authCurrent(paymentSaveContext, userId, epoch),
  onlinePaymentSettingLoaded: true, onlinePaymentSettingOriginal: false,
  sb: { rpc: () => { paymentWriteStarted.resolve(); return paymentWriteA.promise; } },
  $: id => ({ onlinePaymentsToggle: paymentToggle, saveOnlinePaymentsBtn: paymentButton, onlinePaymentsStateText: paymentStatus }[id] || null),
  setOnlinePaymentAdminStatus: message => { paymentStatus.textContent = message; },
  updateOnlinePaymentAdminLabel() {}, toast: message => paymentToasts.push(message), console: consoleStub,
});
paymentSaveContext = paymentSave;
const pendingPaymentSave = paymentSave.saveOnlinePaymentSettings();
await paymentWriteStarted.promise;
paymentSave.adminAuthEpoch++;
paymentSave.adminSessionAuthorized = false;
paymentSave.adminSessionUserId = '';
paymentSave.onlinePaymentSettingLoaded = false;
paymentSave.onlinePaymentSettingOriginal = null;
paymentToggle.checked = false;
paymentToggle.disabled = false;
paymentButton.disabled = false;
paymentButton.textContent = 'B: configuración lista';
paymentStatus.textContent = 'B: estado cargado';
paymentSave.adminSessionUserId = 'account-B';
paymentSave.adminSessionAuthorized = true;
paymentSave.onlinePaymentSettingLoaded = true;
paymentSave.onlinePaymentSettingOriginal = false;
paymentWriteA.resolve({ data: { online_payments_enabled: true }, error: null });
assert.equal(await pendingPaymentSave, false, 'La respuesta de guardado de A se descarta.');
assert.equal(paymentToggle.checked, false, 'El toggle de B no se reemplaza por el valor de A.');
assert.equal(paymentStatus.textContent, 'B: estado cargado', 'A no sobrescribe el estado visible de B.');
assert.equal(paymentButton.textContent, 'B: configuración lista', 'El finally de A no pisa el botón de B.');
assert.equal(paymentButton.disabled, false);
assert.deepEqual(paymentToasts, [], 'A no emite un toast de éxito después del cambio de sesión.');

// Conciliación Wompi: una lectura de A tardía no renderiza transacciones en el panel de B.
const wompiSource = extract(/async function loadWompiReconciliation\(showStatus=true\)\{[\s\S]*?\n\}/, 'Debe existir la carga de conciliación Wompi');
const wompiA = deferredValue();
const wompiAStarted = deferredValue();
let wompiContext;
const wompiStatus = { className: '', textContent: '' };
const wompiList = { innerHTML: '' };
const wompiButton = { disabled: false };
const wompiQuery = () => {
  const query = { select() { return query; }, eq() { return query; }, order() { return query; }, limit() {
    if (wompiContext.adminSessionUserId === 'account-A') { wompiAStarted.resolve(); return wompiA.promise; }
    return Promise.resolve({ data: [{ reference: 'B-REF', transaction_id: 'B-TX', amount_in_cents: 5900000, last_seen_at: '2026-11-08', reason: 'Synthetic B row' }], error: null });
  } };
  return query;
};
const wompiLoader = run(wompiSource, {
  adminSessionAuthorized: true, adminSessionUserId: 'account-A', adminAuthEpoch: 110,
  adminAuthOperationStillCurrent: (userId, epoch) => authCurrent(wompiContext, userId, epoch),
  sb: { from: wompiQuery },
  $: id => ({ wompiReconciliationStatus: wompiStatus, wompiReconciliationList: wompiList, refreshWompiReconciliationBtn: wompiButton }[id] || null),
  esc: value => String(value ?? ''), money: value => `$${value}`, console: consoleStub,
});
wompiContext = wompiLoader;
const wompiLoadA = wompiLoader.loadWompiReconciliation();
await wompiAStarted.promise;
wompiLoader.adminAuthEpoch++;
wompiLoader.adminSessionAuthorized = false;
wompiLoader.adminSessionUserId = '';
wompiLoader.adminSessionUserId = 'account-B';
wompiLoader.adminSessionAuthorized = true;
assert.equal(await wompiLoader.loadWompiReconciliation(), undefined);
const wompiBHtml = wompiList.innerHTML;
const wompiBStatus = wompiStatus.textContent;
wompiA.resolve({ data: [{ reference: 'A-PRIVATE-REF', transaction_id: 'A-TX', amount_in_cents: 100, last_seen_at: '2026-11-07', reason: 'Old A row' }], error: null });
assert.equal(await wompiLoadA, false, 'La respuesta Wompi de A se descarta.');
assert.equal(wompiList.innerHTML, wompiBHtml);
assert.equal(wompiStatus.textContent, wompiBStatus);
assert.ok(!wompiList.innerHTML.includes('A-PRIVATE-REF'));
assert.equal(wompiButton.disabled, false);

// Categorías: la respuesta antigua no contamina categorías/localStorage del usuario nuevo.
const categoriesSource = extract(/async function loadCategoriesFromTable\(\)\{[\s\S]*?\n\}/, 'Debe existir la carga de categorías');
const categoriesA = deferredValue();
const categoriesAStarted = deferredValue();
const categoriesB = deferredValue();
let categoriesContext;
const categorySelect = { disabled: false, value: '', innerHTML: '' };
const categoryStatus = { textContent: '' };
const categorySaves = [];
const categoryQuery = promise => {
  const query = { select() { return query; }, order() { return query; }, then(resolve, reject) { return promise.then(resolve, reject); } };
  return query;
};
const categories = run(categoriesSource, {
  adminSessionAuthorized: true, adminSessionUserId: 'account-A', adminAuthEpoch: 120,
  adminAuthOperationStillCurrent: (userId, epoch) => authCurrent(categoriesContext, userId, epoch),
  sb: { from: () => {
    if (categoriesContext.adminSessionUserId === 'account-A') { categoriesAStarted.resolve(); return categoryQuery(categoriesA.promise); }
    return categoryQuery(categoriesB.promise);
  } },
  $: id => ({ pCategoria: categorySelect, categoryLoadStatus: categoryStatus }[id] || null),
  categoryRecords: [], categorias: [], productos: [],
  applyDefaultSirevyaCategoryOrder: rows => rows,
  saveCategoriesLocal: () => categorySaves.push(Array.from(categoriesContext.categorias)),
  refreshCategorySelects() {}, localStorage: { getItem: () => '[]' }, console: consoleStub,
});
categoriesContext = categories;
const categoryLoadA = categories.loadCategoriesFromTable();
await categoriesAStarted.promise;
categories.adminAuthEpoch++;
categories.adminSessionAuthorized = false;
categories.adminSessionUserId = '';
categories.adminSessionUserId = 'account-B';
categories.adminSessionAuthorized = true;
categoriesB.resolve({ data: [{ id: 'b', name: 'B-category', sort_order: 100 }], error: null });
assert.deepEqual(Array.from(await categories.loadCategoriesFromTable()), ['B-category']);
const categoriesBRecords = Array.from(categories.categoryRecords, row => row.name);
const categorySaveCountB = categorySaves.length;
categoriesA.resolve({ data: [{ id: 'a', name: 'A-private-category', sort_order: 100 }], error: null });
assert.deepEqual(Array.from(await categoryLoadA), []);
assert.deepEqual(Array.from(categories.categoryRecords, row => row.name), categoriesBRecords);
assert.deepEqual(Array.from(categories.categorias), ['B-category']);
assert.equal(categorySaves.length, categorySaveCountB, 'La respuesta antigua no vuelve a escribir la caché local.');
assert.equal(categorySelect.disabled, false);

// Métricas: A no puede limpiar el busy token de B ni renderizar su campaña en Reportes.
const metricsSource = extract(/async function refreshStorefrontMarketingMetrics\(\)\{[\s\S]*?\n\}/, 'Debe existir el refresco de métricas');
const metricsA = deferredValue();
const metricsAStarted = deferredValue();
const metricsB = deferredValue();
let metricsContext;
const metricsStatus = { textContent: '' };
const metricsHost = { innerHTML: '' };
const metrics = run(`let storefrontMarketingMetricsBusy=false,storefrontMarketingMetricsToken=0;\n${metricsSource}\nfunction invalidateMetrics(){storefrontMarketingMetricsToken++;storefrontMarketingMetricsBusy=false}\nfunction metricsState(){return {busy:storefrontMarketingMetricsBusy,token:storefrontMarketingMetricsToken}}`, {
  adminSessionAuthorized: true, adminSessionUserId: 'account-A', adminAuthEpoch: 130,
  adminAuthOperationStillCurrent: (userId, epoch) => authCurrent(metricsContext, userId, epoch),
  sb: { rpc: () => {
    if (metricsContext.adminSessionUserId === 'account-A') { metricsAStarted.resolve(); return metricsA.promise; }
    return metricsB.promise;
  } },
  $: id => ({ storefrontMarketingMetricsStatus: metricsStatus, storefrontMarketingMetricsReport: metricsHost }[id] || null),
  esc: value => String(value ?? ''), console: consoleStub,
});
metricsContext = metrics;
const metricsLoadA = metrics.refreshStorefrontMarketingMetrics();
await metricsAStarted.promise;
metrics.adminAuthEpoch++;
metrics.adminSessionAuthorized = false;
metrics.adminSessionUserId = '';
metrics.invalidateMetrics();
metrics.adminSessionUserId = 'account-B';
metrics.adminSessionAuthorized = true;
const metricsLoadB = metrics.refreshStorefrontMarketingMetrics();
metricsA.resolve({ data: [{ campaign_type: 'popup', campaign_id: 'A-private-campaign', event_type: 'impression', event_count: 1 }], error: null });
await metricsLoadA;
assert.equal(metrics.metricsState().busy, true, 'El finally viejo no libera el busy de B.');
assert.ok(!metricsHost.innerHTML.includes('A-private-campaign'));
metricsB.resolve({ data: [{ campaign_type: 'popup', campaign_id: 'B-campaign', event_type: 'impression', event_count: 7 }], error: null });
await metricsLoadB;
assert.ok(metricsHost.innerHTML.includes('B-campaign'));
assert.ok(!metricsHost.innerHTML.includes('A-private-campaign'));
assert.equal(metrics.metricsState().busy, false);

// Guardado de producto: la respuesta de A no debe limpiar ni notificar el editor abierto por B.
const saveProductSource = extract(/async function guardarProducto\(agregarOtro=false\)\{[\s\S]*?\n\}/, 'Debe existir el guardado de producto');
const productUpdateA = deferredValue();
const productUpdateStarted = deferredValue();
let productSaveContext;
let productNotifications = 0, productToasts = 0, productCleanups = 0, productAlerts = 0;
const productFields = {
  pNombre: { value: 'Producto A' }, pFoto: { files: [] }, pGuiaTallasFoto: { files: [] },
  pColores: { value: '' }, pTallas: { value: '' }, pCantidad: { value: '1' }, pCompra: { value: '100' }, pVenta: { value: '200' },
  pCategoria: { value: 'Ropa' }, pUbicacion: { value: '' }, pDescripcion: { value: '' }, pGuiaTallas: { value: '' },
};
const productSaver = run(saveProductSource, {
  adminSessionAuthorized: true, adminSessionUserId: 'account-A', adminAuthEpoch: 140,
  adminAuthOperationStillCurrent: (userId, epoch) => authCurrent(productSaveContext, userId, epoch),
  editingProductImageLoadToken: 4, editingId: 'A-product', editingSizeGuideImagePath: '', sizeGuideImageRemoveRequested: false,
  productos: [{ id: 'A-product', image_url: 'a.jpg', size_guide_image: '' }], variantDraft: [],
  sb: {
    auth: { getUser: async () => ({ data: { user: { id: 'account-A' } }, error: null }) },
    from: () => ({ update: () => ({ eq: () => { productUpdateStarted.resolve(); return productUpdateA.promise; } }) }),
  },
  $: id => productFields[id] || (id === 'formTitle' ? { textContent: '' } : null),
  document: { querySelector: () => null }, collectVariantDraft: () => [], selectedVariantFiles: () => ({}), totalVariantStock: () => 1,
  uploadProductImages: async () => [], uploadVariantPhotos: async () => [], uploadSizeGuidePhoto: async () => '',
  notifyPublicCatalogChanged() { productNotifications++; }, limpiarProducto() { productCleanups++; }, cargarTodo: async () => {},
  toast() { productToasts++; }, alert() { productAlerts++; }, console: consoleStub,
});
productSaveContext = productSaver;
const productSaveA = productSaver.guardarProducto();
await productUpdateStarted.promise;
productSaver.adminAuthEpoch++;
productSaver.adminSessionAuthorized = false;
productSaver.adminSessionUserId = '';
productSaver.editingProductImageLoadToken++;
productSaver.editingId = null;
productSaver.adminSessionUserId = 'account-B';
productSaver.adminSessionAuthorized = true;
productSaver.editingId = 'B-product';
productSaver.productos = [{ id: 'B-product', image_url: 'b.jpg' }];
productUpdateA.resolve({ error: null });
assert.equal(await productSaveA, false);
assert.equal(productSaver.editingId, 'B-product');
assert.deepEqual(Array.from(productSaver.productos, row => row.id), ['B-product']);
assert.equal(productNotifications, 0);
assert.equal(productToasts, 0);
assert.equal(productCleanups, 0);
assert.equal(productAlerts, 0);

// Eliminación de foto: una escritura primaria iniciada por A no puede cambiar el editor de B.
const deletePhotoSource = extract(/async function eliminarFotoProducto\(index\)\{[\s\S]*?\n\}/, 'Debe existir la eliminación de una foto de producto');
const photoPrimaryA = deferredValue();
const photoPrimaryStarted = deferredValue();
let photoContext;
let photoRenders = 0, photoNotifications = 0, photoFetches = 0;
const photoDelete = run(deletePhotoSource, {
  adminSessionAuthorized: true, adminSessionUserId: 'account-A', adminAuthEpoch: 150,
  adminAuthOperationStillCurrent: (userId, epoch) => authCurrent(photoContext, userId, epoch),
  editingId: 'A-product', editingProductImageLoadToken: 9, editingProductImagesLoadError: null,
  editingProductImages: [{ path: 'products/A/hero.jpg', isPrimary: true, inGallery: false }],
  productos: [{ id: 'A-product', image_url: 'products/A/hero.jpg', variants: [] }],
  sb: { from: () => ({ update: () => ({ eq: () => ({ select: () => ({ maybeSingle: () => { photoPrimaryStarted.resolve(); return photoPrimaryA.promise; } }) }) }) }) },
  confirm: () => true, imageObjectKey: value => value, parseVariants: () => [],
  renderExistingProductPhotoPreview() { photoRenders++; }, notifyPublicCatalogChanged() { photoNotifications++; },
  deleteSingleProductImageFromR2: async () => { photoFetches++; }, console: consoleStub,
});
photoContext = photoDelete;
const photoDeleteA = photoDelete.eliminarFotoProducto(0);
await photoPrimaryStarted.promise;
photoDelete.adminAuthEpoch++;
photoDelete.adminSessionAuthorized = false;
photoDelete.adminSessionUserId = '';
photoDelete.editingProductImageLoadToken++;
photoDelete.editingId = null;
photoDelete.adminSessionUserId = 'account-B';
photoDelete.adminSessionAuthorized = true;
photoDelete.editingId = 'B-product';
photoDelete.editingProductImages = [{ path: 'products/B/keep.jpg', isPrimary: true }];
photoDelete.productos = [{ id: 'B-product', image_url: 'products/B/keep.jpg', variants: [] }];
photoPrimaryA.resolve({ error: null, data: { id: 'A-product' } });
assert.equal(await photoDeleteA, false);
assert.equal(photoDelete.editingId, 'B-product');
assert.deepEqual(Array.from(photoDelete.editingProductImages, row => row.path), ['products/B/keep.jpg']);
assert.equal(photoRenders, 0);
assert.equal(photoNotifications, 0);
assert.equal(photoFetches, 0, 'La sesión nueva no ejecuta el borrado físico de la operación anterior.');

// Contratos estáticos para los demás guardados y las rutas de imágenes, que usan Supabase/R2 reales en el panel.
for (const name of ['saveStorefrontShippingSettings', 'saveCODCitiesSettings', 'saveStorefrontProductCombo', 'saveSeasonalPromoSettings']) {
  const source = extract(new RegExp(`async function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`), `Debe existir ${name}`);
  assert.match(source, /const userId=adminSessionUserId,authEpoch=adminAuthEpoch/);
  assert.match(source, /if\(!isCurrent\(\)\)return false;/, `${name} descarta trabajo obsoleto.`);
  assert.match(source, /catch\(error\)\{\s*if\(!isCurrent\(\)\)return false;/, `${name} no pinta errores de otra sesión.`);
  assert.match(source, /finally\s*\{\s*if\(isCurrent\(\)\)/, `${name} no cambia controles de otra sesión desde finally.`);
}
const deleteComboSource = extract(/async function deleteStorefrontProductCombo\(id\)\{[\s\S]*?\n\}/, 'Debe existir la eliminación de combos');
assert.match(deleteComboSource, /const userId=adminSessionUserId,authEpoch=adminAuthEpoch/);
assert.match(deleteComboSource, /await sb\.rpc\([\s\S]*?\);if\(!isCurrent\(\)\)return false/);
assert.match(deleteComboSource, /catch\(error\)\{if\(!isCurrent\(\)\)return false/);
for (const name of ['uploadProductImages', 'uploadVariantPhotos', 'uploadSizeGuidePhoto', 'deleteSingleProductImageFromR2']) {
  const source = admin.match(new RegExp(`async function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(source, `Debe existir ${name}`);
  assert.match(source, /isCurrent=\(\)=>true/);
  assert.match(source, /ensureAdminOperationCurrent/);
}
assert.match(saveProductSource, /uploadProductImages\([^;]*,isCurrent\)/);
assert.match(saveProductSource, /uploadVariantPhotos\([^;]*,isCurrent\)/);
assert.match(saveProductSource, /uploadSizeGuidePhoto\([^;]*,isCurrent\)/);

console.log('OK admin_account_async_session_regression: pagos, Wompi, categorías, métricas, editor de producto y galería A→B; sin llamadas reales.');
