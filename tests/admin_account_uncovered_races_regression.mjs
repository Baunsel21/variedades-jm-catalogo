import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const extract = (name) => {
  const source = admin.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(source, `Debe existir ${name}`);
  return source;
};
const run = (source, globals = {}) => {
  const context = vm.createContext(globals);
  new vm.Script(source).runInContext(context);
  return context;
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const consoleStub = { debug() {}, error() {}, log() {}, warn() {} };
const authState = { value: null };
const authStillCurrent = (userId, epoch) => !!authState.value
  && authState.value.adminSessionAuthorized
  && authState.value.adminSessionUserId === userId
  && authState.value.adminAuthEpoch === epoch;
const authGlobals = (userId = 'A', epoch = 1) => ({
  adminSessionAuthorized: true,
  adminSessionUserId: userId,
  adminAuthEpoch: epoch,
  adminAuthOperationStillCurrent: authStillCurrent,
});
const switchToB = context => {
  context.adminAuthEpoch++;
  context.adminSessionAuthorized = false;
  context.adminSessionUserId = '';
  context.adminSessionUserId = 'B';
  context.adminSessionAuthorized = true;
};
const helperSource = [
  extract('ensureAdminOperationCurrent'),
  extract('captureAdminOperationContext'),
  extract('assertAdminSessionUserMatches'),
].join('\n');

// saveBrand: la operación A queda pendiente al subir; no actualiza el perfil/cache de B.
const uploadStarted = deferred(), uploadResult = deferred();
let brandContext, profileWrites = 0, localWrites = 0, brandApplyCalls = 0, brandToasts = 0;
const brandSave = run(extract('saveBrand'), {
  ...authGlobals('A', 10), sb: { auth: {
    getUser: async () => ({ data: { user: { id: 'A', email: 'a@example.invalid' } }, error: null }),
    updateUser: async () => { profileWrites++; return { error: null }; },
  } },
  brandName: 'Marca anterior', brandIcon: '', brandIconPath: '',
  $: id => ({
    businessName: { value: 'Marca de A' },
    businessIcon: { files: [{ size: 100, name: 'brand.png' }] },
  }[id] || null),
  uploadImageToR2: (_path, _file, isCurrent) => { assert.equal(isCurrent(), true); uploadStarted.resolve(); return uploadResult.promise; },
  publicWorkerImage: value => `/local/${value}`, storeAdminBrandCache() { localWrites++; },
  localStorage: { setItem() { localWrites++; } }, applyBrand() { brandApplyCalls++; },
  toast() { brandToasts++; }, alert() {},
});
brandContext = brandSave; authState.value = brandSave;
const brandPending = brandSave.saveBrand();
await uploadStarted.promise;
switchToB(brandSave);
uploadResult.resolve({ key: 'branding/A.png' });
assert.equal(await brandPending, false, 'La subida de marca de A se descarta al cambiar a B.');
assert.equal(profileWrites, 0, 'A no escribe metadatos del perfil después de cambiar la sesión.');
assert.equal(localWrites, 0, 'A no sobrescribe el caché local visible para B.');
assert.equal(brandApplyCalls, 0);
assert.equal(brandToasts, 0);

// resetBrand: una respuesta tardía de updateUser no limpia los valores locales de B.
const resetWrite = deferred(), resetStarted = deferred();
let resetContext, resetLocalRemovals = 0, resetApplyCalls = 0, resetToasts = 0;
const brandReset = run(extract('resetBrand'), {
  ...authGlobals('A', 20), sb: { auth: { updateUser: () => { resetStarted.resolve(); return resetWrite.promise; } } },
  confirm: () => true, $: id => id === 'businessIcon' ? { value: 'B-icon' } : null,
  localStorage: { removeItem() { resetLocalRemovals++; } }, clearAdminBrandCache() { resetLocalRemovals++; }, applyBrand() { resetApplyCalls++; }, toast() { resetToasts++; },
  brandName: 'Marca A', brandIcon: 'a.png', brandIconPath: 'branding/a.png',
});
resetContext = brandReset; authState.value = brandReset;
const resetPending = brandReset.resetBrand();
await resetStarted.promise;
switchToB(brandReset);
resetWrite.resolve({ error: null });
assert.equal(await resetPending, false);
assert.equal(resetLocalRemovals, 0, 'El reset obsoleto no limpia el caché de la sesión B.');
assert.equal(resetApplyCalls, 0);
assert.equal(resetToasts, 0);

// R2: un token devuelto para B no puede usarse en una operación capturada por A.
for (const name of ['uploadImageToR2', 'deleteProductImagesFromR2']) {
  let networkCalls = 0, imagePreparationCalls = 0;
  const source = `${helperSource}\n${extract(name)}`;
  const context = run(source, {
    ...authGlobals('A', 30),
    sb: { auth: { getSession: async () => ({ data: { session: { user: { id: 'B' }, access_token: 'synthetic-B-token' } } }) } },
    prepareImageForUpload: async file => { imagePreparationCalls++; return file; },
    fetch: async () => { networkCalls++; return { ok: true, text: async () => '{"ok":true}' }; },
    IMAGE_WORKER_URL: '/__preview_assets', R2_MIME_EXTENSION: {}, R2_ALLOWED_IMAGE_TYPES: new Set(),
    R2_EXTENSION_MIME: {}, workerObjectUrl: () => '/blocked', uploadExtension: () => 'png',
  });
  await assert.rejects(
    () => name === 'uploadImageToR2'
      ? context.uploadImageToR2('branding/A.png', { name: 'a.png', type: 'image/png' })
      : context.deleteProductImagesFromR2('A-product'),
    error => error?.name === 'StaleAdminOperationError',
  );
  assert.equal(networkCalls, 0, `${name} no usa un token de otra cuenta.`);
  assert.equal(imagePreparationCalls, 0, `${name} corta antes de preparar/subir datos obsoletos.`);
}

// Borrado de producto: la respuesta de la RPC A no altera el estado ni inicia limpieza R2 bajo B.
const deleteStarted = deferred(), deleteResult = deferred();
let deleteContext, deleteR2Calls = 0, deleteRenders = 0, deleteNotices = 0, deleteToasts = 0;
const deleteProduct = run(extract('borrarProducto'), {
  ...authGlobals('A', 40), productos: [{ id: 'product-A', code: 'A-1', name: 'Producto de A' }],
  sb: { rpc: () => { deleteStarted.resolve(); return deleteResult.promise; } },
  confirm: () => true, alert() {},
  populateFilters() { deleteRenders++; }, renderProductos() { deleteRenders++; }, refrescarSelects() { deleteRenders++; },
  renderVentaCatalogo() { deleteRenders++; }, renderInicio() { deleteRenders++; }, renderReportes() { deleteRenders++; },
  notifyPublicCatalogChanged() { deleteNotices++; }, toast() { deleteToasts++; },
  cargarTodo: async () => {}, deleteProductImagesFromR2: async () => { deleteR2Calls++; }, console: consoleStub,
});
deleteContext = deleteProduct; authState.value = deleteProduct;
const deletePending = deleteProduct.borrarProducto('product-A');
await deleteStarted.promise;
switchToB(deleteProduct);
deleteProduct.productos = [{ id: 'product-B', code: 'B-1', name: 'Producto de B' }];
deleteResult.resolve({ data: { success: true }, error: null });
assert.equal(await deletePending, false);
assert.deepEqual(Array.from(deleteProduct.productos, row => row.id), ['product-B']);
assert.equal(deleteRenders, 0);
assert.equal(deleteNotices, 0);
assert.equal(deleteR2Calls, 0);
assert.equal(deleteToasts, 0);

// Alta desde el editor: no selecciona en el editor B una categoría que creó A.
const addCategoryStarted = deferred(), addCategoryWrite = deferred();
let addCategoryContext, categoryLoads = 0, categoryToasts = 0;
const categorySelect = { value: 'B-category' };
const addCategory = run(extract('addCategoryFromProduct'), {
  ...authGlobals('A', 50), categorias: ['Existente'],
  prompt: () => 'Nueva de A', insertCategorySafely: () => { addCategoryStarted.resolve(); return addCategoryWrite.promise; },
  loadCategoriesFromTable: async () => { categoryLoads++; return ['Nueva de A']; },
  $: id => id === 'pCategoria' ? categorySelect : null,
  toast() { categoryToasts++; }, alert() {},
});
addCategoryContext = addCategory; authState.value = addCategory;
const addCategoryPending = addCategory.addCategoryFromProduct();
await addCategoryStarted.promise;
switchToB(addCategory);
categorySelect.value = 'B-category';
addCategoryWrite.resolve({ success: true });
assert.equal(await addCategoryPending, false);
assert.equal(categorySelect.value, 'B-category');
assert.equal(categoryLoads, 0);
assert.equal(categoryToasts, 0);

// Reordenamiento: detener la secuencia al cambiar de usuario y no hacer rollback/render con B.
const reorderStarted = deferred(), reorderWrite = deferred();
let reorderContext, reorderWrites = 0, reorderLocalSaves = 0, reorderRenders = 0;
const categoryRows = [{ id: 'cat-1', name: 'Uno', sort_order: 100 }, { id: 'cat-2', name: 'Dos', sort_order: 200 }];
const reorderCategory = run(extract('reorderCategory'), {
  ...authGlobals('A', 60), categoryOrderSaving: false, categorias: ['Uno', 'Dos'], categoryRecords: categoryRows,
  sb: { from: () => ({ update() { return { eq() { reorderWrites++; reorderStarted.resolve(); return { select() { return { maybeSingle: () => reorderWrite.promise }; } }; } }; } }) },
  renderCategoryManager() { reorderRenders++; }, saveCategoriesLocal() { reorderLocalSaves++; },
  loadCategoriesFromTable: async () => [], toast() {}, alert() {}, console: consoleStub,
});
reorderContext = reorderCategory; authState.value = reorderCategory;
const reorderPending = reorderCategory.reorderCategory(0, 1);
await reorderStarted.promise;
switchToB(reorderCategory);
reorderCategory.categoryOrderSaving = false; // estado restablecido por lockAdminPanel para B
reorderCategory.categorias = ['B-category'];
reorderWrite.resolve({ data: { id: 'cat-2' }, error: null });
assert.equal(await reorderPending, false);
assert.equal(reorderWrites, 1, 'No se envían más actualizaciones ni rollback con la cuenta B.');
assert.equal(reorderLocalSaves, 0);
assert.deepEqual(Array.from(reorderCategory.categorias), ['B-category']);

// Rename: una RPC tardía de A no recarga ni notifica en la sesión B.
const renameStarted = deferred(), renameWrite = deferred();
let renameContext, renameLoads = 0, renameToasts = 0;
const renameCategory = run(extract('renameCategory'), {
  ...authGlobals('A', 70), categorias: ['A-category'],
  prompt: () => 'Renombrada por A', sb: { rpc: () => { renameStarted.resolve(); return renameWrite.promise; } },
  loadCategoriesFromTable: async () => { renameLoads++; }, cargarTodo: async () => {},
  alert() {}, toast() { renameToasts++; },
});
renameContext = renameCategory; authState.value = renameCategory;
const renamePending = renameCategory.renameCategory('A-category');
await renameStarted.promise;
switchToB(renameCategory);
renameWrite.resolve({ data: { success: true }, error: null });
assert.equal(await renamePending, false);
assert.equal(renameLoads, 0);
assert.equal(renameToasts, 0);

// Guardas estáticas complementarias para add/delete de categoría y limpieza de busy.
for (const name of ['addCategory', 'deleteCategory']) {
  const source = extract(name);
  assert.match(source, /const userId=adminSessionUserId,authEpoch=adminAuthEpoch/);
  assert.match(source, /if\(!isCurrent\(\)\)return false/);
}
assert.match(extract('lockAdminPanel'), /categoryOrderSaving=false/);

console.log('OK admin_account_uncovered_races_regression: marca, reset, tokens R2, borrado de producto y mutaciones de categoría A→B; sin llamadas reales.');
