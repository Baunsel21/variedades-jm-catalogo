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
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const consoleStub = { debug() {}, error() {}, log() {}, warn() {} };

// Dashboard: A queda en vuelo; B inicia su propia carga y el resultado tardío de A nunca se publica.
const dashboardSource = extract(/const adminDashboardLoadPromises=new Map\(\);[\s\S]*?async function cargarTodo\(userId=adminSessionUserId,authEpoch=adminAuthEpoch\)\{[\s\S]*?\n\}/, 'Debe existir un loader de dashboard deduplicado por sesión');
const dashboardProductA = deferredValue();
const dashboardSalesA = deferredValue();
const dashboardAStarted = deferredValue();
let dashboardARequests = 0;
let dashboardContext;
const dashboardSnapshots = [];
const dashboard = run(dashboardSource, {
  adminAuthEpoch: 1,
  adminSessionAuthorized: true,
  adminSessionUserId: 'account-A',
  adminDeferredModuleLoaded: { clients: false, suppliers: false, expenses: false, movements: false, orders: false },
  moduleLoadErrors: {},
  productos: [], ventas: [], clientes: [], proveedores: [], gastos: [], movimientos: [], pedidos: [],
  adminAuthOperationStillCurrent: (userId, epoch) => !!dashboardContext && dashboardContext.adminSessionAuthorized && dashboardContext.adminSessionUserId === userId && dashboardContext.adminAuthEpoch === epoch,
  assertCurrentAdminAuthorization: async (userId, epoch) => {
    if (!dashboardContext.adminAuthOperationStillCurrent(userId, epoch)) throw new Error('stale dashboard authorization');
    return { id: userId };
  },
  fetchAllTableRows: table => {
    if (dashboardContext.adminSessionUserId === 'account-A') {
      dashboardARequests++;
      if (table === 'products') return dashboardProductA.promise;
      if (table === 'sales') { if (dashboardARequests === 2) dashboardAStarted.resolve(); return dashboardSalesA.promise; }
    }
    if (table === 'products') return Promise.resolve({ data: [{ id: 'B-product', quantity: 2, variants: [] }], error: null });
    if (table === 'sales') return Promise.resolve({ data: [{ id: 'B-sale' }], error: null });
    return Promise.resolve({ data: [], error: null });
  },
  sb: { rpc: async name => ({ data: [], error: name === 'get_public_catalog' ? null : null }) },
  parseVariants: value => value || [],
  describeAdminTableError: () => 'synthetic error',
  setOrdersUpdatedAt() {}, populateFilters() {}, renderProductos() {}, renderVentas() {}, renderReportes() {},
  refrescarSelects() {}, renderVentaCatalogo() {}, renderClientes() {}, renderProveedores() {}, renderGastos() {}, renderMovimientos() {}, renderPedidos() {},
  renderInicio() { dashboardSnapshots.push({ userId: dashboardContext.adminSessionUserId, productIds: dashboardContext.productos.map(row => row.id), saleIds: dashboardContext.ventas.map(row => row.id) }); },
  alert: message => { throw new Error(`Unexpected alert: ${message}`); }, toast() {}, console: consoleStub,
});
dashboardContext = dashboard;
const dashboardLoadA = dashboard.cargarTodo();
await dashboardAStarted.promise;
dashboard.adminSessionUserId = 'account-B';
dashboard.adminAuthEpoch = 2;
const dashboardLoadB = dashboard.cargarTodo('account-B', 2);
await dashboardLoadB;
dashboardProductA.resolve({ data: [{ id: 'A-product', quantity: 99, variants: [] }], error: null });
dashboardSalesA.resolve({ data: [{ id: 'A-sale' }], error: null });
await dashboardLoadA;
assert.deepEqual(dashboard.productos.map(row => row.id), ['B-product'], 'El dashboard conserva exclusivamente productos de B');
assert.deepEqual(dashboard.ventas.map(row => row.id), ['B-sale'], 'El dashboard conserva exclusivamente ventas de B');
assert.ok(dashboardSnapshots.length > 0 && dashboardSnapshots.every(row => row.userId === 'account-B' && row.productIds.every(id => id === 'B-product') && row.saleIds.every(id => id === 'B-sale')), 'Ningún render publica datos tardíos de A bajo B');

// Clientes: el loader diferido tiene una promesa por sesión y descarta el resultado del usuario previo.
const deferredModuleSource = extract(/async function loadAdminDeferredModule\(key,force=false\)\{[\s\S]*?\n\}/, 'Debe existir el loader diferido de Clientes');
const clientsAResult = deferredValue();
const clientsAStarted = deferredValue();
let clientsContext;
const clientsSnapshots = [];
const clientsLoader = run(deferredModuleSource, {
  adminAuthEpoch: 4,
  adminSessionAuthorized: true,
  adminSessionUserId: 'account-A',
  adminDeferredModuleLoaded: { clients: false, suppliers: false, expenses: false, movements: false, orders: false },
  adminDeferredModuleInFlight: {},
  moduleLoadErrors: {},
  clientes: [], proveedores: [], gastos: [], movimientos: [],
  adminAuthOperationStillCurrent: (userId, epoch) => !!clientsContext && clientsContext.adminSessionAuthorized && clientsContext.adminSessionUserId === userId && clientsContext.adminAuthEpoch === epoch,
  assertCurrentAdminAuthorization: async (userId, epoch) => {
    if (!clientsContext.adminAuthOperationStillCurrent(userId, epoch)) throw new Error('stale clients authorization');
    return { id: userId };
  },
  fetchAllTableRows: async table => {
    if (table === 'clients' && clientsContext.adminSessionUserId === 'account-A') { clientsAStarted.resolve(); return clientsAResult.promise; }
    if (table === 'clients') return { data: [{ id: 'B-client', name: 'Cliente sintético B' }], error: null };
    throw new Error(`Unexpected table ${table}`);
  },
  $: () => ({ innerHTML: '' }),
  describeAdminTableError: () => 'synthetic error',
  renderClientes() { clientsSnapshots.push({ userId: clientsContext.adminSessionUserId, ids: clientsContext.clientes.map(row => row.id) }); },
  renderProveedores() {}, renderGastos() {}, renderReportes() {}, renderMovimientos() {},
  lockAdminPanel() { throw new Error('Unexpected lock'); },
  sb: { auth: { signOut: async () => ({ error: null }) } },
  console: consoleStub,
});
clientsContext = clientsLoader;
const clientsLoadA = clientsLoader.loadAdminDeferredModule('clients');
await clientsAStarted.promise;
clientsLoader.adminSessionUserId = 'account-B';
clientsLoader.adminAuthEpoch = 5;
const clientsLoadB = clientsLoader.loadAdminDeferredModule('clients');
assert.equal(await clientsLoadB, true);
clientsAResult.resolve({ data: [{ id: 'A-client', name: 'Cliente sintético A' }], error: null });
assert.equal(await clientsLoadA, false);
assert.deepEqual(clientsLoader.clientes.map(row => row.id), ['B-client'], 'La carga de Clientes no puede repoblar datos de A');
assert.ok(clientsSnapshots.length === 1 && clientsSnapshots[0].userId === 'account-B' && clientsSnapshots[0].ids[0] === 'B-client', 'Solo se renderiza la lista de Clientes de B');

// Pedidos COD: el refresh manual también descarta páginas que terminan tras cambiar la sesión.
const ordersSource = extract(/const cargarPedidosInFlight=new Map\(\);[\s\S]*?async function cargarPedidos\(\)\{[\s\S]*?\n\}/, 'Debe existir el loader paginado de pedidos por sesión');
const ordersAResult = deferredValue();
const ordersAStarted = deferredValue();
let ordersAStartedOnce = false;
let ordersContext;
const orderSnapshots = [];
const refreshButton = { disabled: false, textContent: '↻ Actualizar pedidos' };
const ordersLoader = run(ordersSource, {
  adminAuthEpoch: 8,
  adminSessionAuthorized: true,
  adminSessionUserId: 'account-A',
  adminDeferredModuleLoaded: { orders: false },
  moduleLoadErrors: {},
  pedidos: [],
  adminAuthOperationStillCurrent: (userId, epoch) => !!ordersContext && ordersContext.adminSessionAuthorized && ordersContext.adminSessionUserId === userId && ordersContext.adminAuthEpoch === epoch,
  assertCurrentAdminAuthorization: async (userId, epoch) => {
    if (!ordersContext.adminAuthOperationStillCurrent(userId, epoch)) throw new Error('stale order authorization');
    return { id: userId };
  },
  fetchAllTableRows: async () => {
    if (ordersContext.adminSessionUserId === 'account-A') { if (!ordersAStartedOnce) { ordersAStartedOnce = true; ordersAStarted.resolve(); } return ordersAResult.promise; }
    return { data: [{ id: 'B-order', status: 'pendiente' }], error: null };
  },
  $: id => id === 'refreshOrdersBtn' ? refreshButton : null,
  setOrdersUpdatedAt() {}, renderPedidos() { orderSnapshots.push({ userId: ordersContext.adminSessionUserId, ids: ordersContext.pedidos.map(row => row.id) }); },
  toast() {}, lockAdminPanel() { throw new Error('Unexpected lock'); },
  sb: { auth: { signOut: async () => ({ error: null }) } }, console: consoleStub,
});
ordersContext = ordersLoader;
const ordersLoadA = ordersLoader.cargarPedidos();
await ordersAStarted.promise;
ordersLoader.adminSessionUserId = 'account-B';
ordersLoader.adminAuthEpoch = 9;
const ordersLoadB = ordersLoader.cargarPedidos();
assert.equal(await ordersLoadB, true);
ordersAResult.resolve({ data: [{ id: 'A-order', status: 'pendiente' }], error: null });
assert.equal(await ordersLoadA, false);
assert.deepEqual(ordersLoader.pedidos.map(row => row.id), ['B-order'], 'El refresh de pedidos conserva solo pedidos de B');
assert.ok(orderSnapshots.length === 1 && orderSnapshots[0].userId === 'account-B' && orderSnapshots[0].ids[0] === 'B-order', 'No se renderizan pedidos de A bajo B');
assert.equal(refreshButton.disabled, false, 'El refresh sigue disponible después de terminar la carga actual');

// startApp: un SIGNED_IN/PASSWORD_RECOVERY que llega mientras otro arranque está ocupado queda pendiente y se ejecuta.
const startSource = extract(/async function startApp\(\)\{[\s\S]*?\n\}/, 'Debe existir startApp con cola de reinicio');
const initialAuth = deferredValue();
const firstDashboardLoad = deferredValue();
const queuedTimers = [];
const loadedSessions = [];
const user = { id: 'current-admin', email: 'admin@example.test', user_metadata: {} };
let startContext;
let getUserCalls = 0;
const elements = new Map();
const elementFor = id => {
  if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false, classList: { add() {}, remove() {} } });
  return elements.get(id);
};
const startLoader = run(startSource, {
  adminStartBusy: false, adminStartPending: false, adminAuthEpoch: 0,
  adminSessionAuthorized: false, adminSessionUserId: '', adminPasswordRecoveryMode: false,
  sb: { auth: { getUser: () => { getUserCalls++; return getUserCalls === 1 ? initialAuth.promise : Promise.resolve({ data: { user }, error: null }); } }, rpc: async () => ({ data: true, error: null }) },
  $: elementFor,
  document: { querySelector: () => null },
  localStorage: { setItem() {} },
  startAdminCatalogRealtime() {}, loadAdminBrandForUser() {}, publicWorkerImage: value => value, applyBrand() {}, setDateText() {}, refreshTelegramTestButton() {},
  cargarTodo: (userId, epoch) => { loadedSessions.push([userId, epoch]); return loadedSessions.length === 1 ? firstDashboardLoad.promise : Promise.resolve(true); },
  setInventoryMode() {}, inventoryMode: 'all',
  brandName: 'Variedades JM', brandIcon: '', brandIconPath: '',
  adminAuthOperationStillCurrent: () => true,
  lockAdminPanel() { throw new Error('Unexpected lock'); },
  setTimeout: callback => { queuedTimers.push(callback); return queuedTimers.length; },
  console: consoleStub,
});
startContext = startLoader;
const firstStart = startLoader.startApp();
assert.equal(getUserCalls, 1, 'El primer arranque queda esperando la respuesta Auth');
await startLoader.startApp();
assert.equal(startLoader.adminStartPending, true, 'El arranque concurrente queda marcado pendiente');
initialAuth.resolve({ data: { user }, error: null });
await firstStart;
assert.equal(startLoader.adminStartBusy, false);
assert.equal(startLoader.adminStartPending, false);
assert.equal(queuedTimers.length, 1, 'El finally agenda el arranque que se había quedado pendiente');
queuedTimers.shift()();
await nextTurn();
assert.equal(getUserCalls, 4, 'El arranque pendiente vuelve a consultar Auth y revalida la identidad');
assert.equal(startLoader.adminStartBusy, false);
assert.deepEqual(loadedSessions, [['current-admin', 0], ['current-admin', 0]], 'Cada arranque asocia la carga a usuario/época explícitos');
firstDashboardLoad.resolve(true);
await nextTurn();

// El refresco público de stock queda invalidado al cambiar la época, y su finally no libera el busy de otra sesión.
const availabilitySource = extract(/async function refreshPublicAvailability\(\)\{[\s\S]*?\n\}/, 'Debe existir el refresco de disponibilidad con guard de sesión');
const availabilityA = deferredValue();
const availabilityAStarted = deferredValue();
let availabilityContext;
let availabilityRpcCalls = 0;
const availabilityRenders = [];
const availability = run(`let availabilityRefreshBusy=false,availabilityRefreshToken=0;\n${availabilitySource}\nfunction invalidateAvailabilityForTest(){availabilityRefreshToken++;availabilityRefreshBusy=false;}\nfunction availabilityBusyForTest(){return availabilityRefreshBusy;}`, {
  sb: { rpc: () => {
    availabilityRpcCalls++;
    if (availabilityContext.adminSessionUserId === 'account-A') { availabilityAStarted.resolve(); return availabilityA.promise; }
    return Promise.resolve({ data: [{ id: 'B-product', name: 'B', code: 'B', category: 'CAT', sale_price: 100, image_url: '', quantity: 5, variants: [] }], error: null });
  } },
  adminSessionAuthorized: true, adminSessionUserId: 'account-A', adminAuthEpoch: 10,
  document: { hidden: false, getElementById: () => ({ classList: { contains: () => false } }) },
  adminViewNeedsLiveAvailability: () => true,
  adminAuthOperationStillCurrent: (userId, epoch) => !!availabilityContext && availabilityContext.adminSessionAuthorized && availabilityContext.adminSessionUserId === userId && availabilityContext.adminAuthEpoch === epoch,
  productos: [{ id: 'A-product', name: 'A', code: 'A', category: 'CAT', sale_price: 100, image_url: '', quantity: 1, availableQuantity: 1, variants: [], availableVariants: [] }],
  parseVariants: value => value || [], availableQuantity: product => Number(product.availableQuantity ?? product.quantity) || 0,
  availableVariants: product => product.availableVariants ?? product.variants ?? [],
  adminDashboardLoadIsBusy: () => false,
  cargarTodo: async () => { throw new Error('No se esperaba una recarga completa en este test.'); },
  renderProductos() { availabilityRenders.push(availabilityContext.productos.map(product => product.id)); },
  refrescarSelects() {}, renderVentaCatalogo() {}, renderInicio() { availabilityRenders.push(availabilityContext.productos.map(product => product.id)); }, renderReportes() {},
  console: consoleStub,
});
availabilityContext = availability;
const availabilityLoadA = availability.refreshPublicAvailability();
await availabilityAStarted.promise;
assert.match(admin, /availabilityRefreshToken\+\+;availabilityRefreshBusy=false;/, 'El lock invalida un refresco que quedó en vuelo.');
assert.match(admin, /editingProductImageLoadToken\+\+/, 'El lock invalida la carga de imágenes del editor.');
availability.invalidateAvailabilityForTest();
availability.adminAuthEpoch++;
availability.adminSessionAuthorized = false;
availability.adminSessionUserId = '';
availability.adminSessionUserId = 'account-B';
availability.adminSessionAuthorized = true;
availability.productos = [{ id: 'B-product', name: 'B', code: 'B', category: 'CAT', sale_price: 100, image_url: '', quantity: 1, availableQuantity: 1, variants: [], availableVariants: [] }];
await availability.refreshPublicAvailability();
availabilityA.resolve({ data: [{ id: 'A-product', name: 'A stale', code: 'A', category: 'CAT', sale_price: 900, image_url: '', quantity: 99, variants: [] }], error: null });
await availabilityLoadA;
assert.equal(availabilityRpcCalls, 2, 'B puede iniciar su propio refresco luego del lock.');
assert.deepEqual(availability.productos.map(product => product.id), ['B-product'], 'La respuesta tardía de stock de A no reemplaza productos de B.');
assert.equal(availability.productos[0].availableQuantity, 5);
assert.ok(availabilityRenders.length > 0 && availabilityRenders.every(ids => ids.length === 1 && ids[0] === 'B-product'), 'Ningún render publica el stock antiguo de A.');
assert.equal(availability.availabilityBusyForTest(), false);

// La galería de A tampoco puede renderizar ni reemplazar el editor de B después del lock.
const imageSource = extract(/async function loadExistingProductImages\(productId,primaryImage\)\{[\s\S]*?\n\}/, 'Debe existir la carga de imágenes del producto');
const imageA = deferredValue();
const imageAStarted = deferredValue();
let imageContext;
let imageRenderCalls = 0;
const imageNodes = { existingPhotoStatus: { textContent: '' }, existingPhotoPreview: { innerHTML: '' } };
const imageLoader = run(imageSource, {
  adminSessionAuthorized: true, adminSessionUserId: 'account-A', adminAuthEpoch: 20,
  adminAuthOperationStillCurrent: (userId, epoch) => !!imageContext && imageContext.adminSessionAuthorized && imageContext.adminSessionUserId === userId && imageContext.adminAuthEpoch === epoch,
  editingProductImageLoadToken: 0, editingId: 'A-product', editingProductImages: [], editingProductImagesLoadError: null,
  sb: { from: () => ({ select: () => ({ eq: () => ({ order: () => { imageAStarted.resolve(); return imageA.promise; } }) }) }) },
  $: id => imageNodes[id] ?? null, getImageUrl: value => value, isMissingTableError: () => false,
  renderExistingProductPhotoPreview() { imageRenderCalls++; }, console: consoleStub,
});
imageContext = imageLoader;
const imageLoadA = imageLoader.loadExistingProductImages('A-product', 'a.jpg');
await imageAStarted.promise;
imageLoader.adminAuthEpoch++;
imageLoader.adminSessionAuthorized = false;
imageLoader.adminSessionUserId = '';
imageLoader.editingProductImageLoadToken++;
imageLoader.editingId = null;
imageLoader.adminSessionUserId = 'account-B';
imageLoader.adminSessionAuthorized = true;
imageLoader.editingId = 'B-product';
imageLoader.editingProductImages = [{ path: 'b.jpg', url: '/b.jpg' }];
imageA.resolve({ data: [{ image_path: 'a-only.jpg' }], error: null });
await imageLoadA;
assert.deepEqual(Array.from(imageLoader.editingProductImages, image => image.path), ['b.jpg'], 'La respuesta de galería de A no reemplaza el editor de B.');
assert.equal(imageRenderCalls, 0, 'La galería de A no se vuelve a pintar tras el lock.');

// Las cargas de configuración también quedan asociadas a sesión, incluida su UI.
const paymentLoaderSource = extract(/async function loadOnlinePaymentSettingsAdmin\(\)\{[\s\S]*?\n\}/, 'Debe existir la carga de configuración de pagos');
const paymentA = deferredValue();
const paymentAStarted = deferredValue();
let paymentContext;
const paymentStatuses = [];
const paymentToggle = { disabled: false, checked: true };
const paymentSave = { disabled: false };
const paymentLoader = run(paymentLoaderSource, {
  sb: { rpc: () => {
    if (paymentContext.adminSessionUserId === 'account-A') { paymentAStarted.resolve(); return paymentA.promise; }
    return Promise.resolve({ data: { online_payments_enabled: false }, error: null });
  } },
  adminSessionAuthorized: true, adminSessionUserId: 'account-A', adminAuthEpoch: 30,
  adminAuthOperationStillCurrent: (userId, epoch) => !!paymentContext && paymentContext.adminSessionAuthorized && paymentContext.adminSessionUserId === userId && paymentContext.adminAuthEpoch === epoch,
  onlinePaymentSettingLoaded: true, onlinePaymentSettingOriginal: true,
  $: id => ({ onlinePaymentsToggle: paymentToggle, saveOnlinePaymentsBtn: paymentSave, onlinePaymentsStateText: { textContent: '' } }[id] || null),
  setOnlinePaymentAdminStatus: message => paymentStatuses.push(message), updateOnlinePaymentAdminLabel() {}, console: consoleStub,
});
paymentContext = paymentLoader;
const paymentLoadA = paymentLoader.loadOnlinePaymentSettingsAdmin();
await paymentAStarted.promise;
paymentLoader.adminAuthEpoch++;
paymentLoader.adminSessionAuthorized = false;
paymentLoader.adminSessionUserId = '';
paymentLoader.onlinePaymentSettingLoaded = false;
paymentLoader.onlinePaymentSettingOriginal = null;
paymentLoader.adminSessionUserId = 'account-B';
paymentLoader.adminSessionAuthorized = true;
const paymentLoadB = paymentLoader.loadOnlinePaymentSettingsAdmin();
assert.equal(await paymentLoadB, true);
const paymentStatusCountForB = paymentStatuses.length;
paymentA.resolve({ data: { online_payments_enabled: true }, error: null });
assert.equal(await paymentLoadA, false, 'La respuesta de pago tardía se descarta para A.');
assert.equal(paymentLoader.onlinePaymentSettingOriginal, false, 'La opción de B no se reemplaza por la de A.');
assert.equal(paymentToggle.checked, false);
assert.equal(paymentStatuses.length, paymentStatusCountForB, 'La respuesta vieja no publica mensajes de estado.');

for (const name of ['loadOnlinePaymentSettingsAdmin', 'loadStorefrontShippingSettingsAdmin', 'loadCODCitiesSettingsAdmin', 'loadStorefrontProductCombosAdmin', 'loadSeasonalPromoSettingsAdmin']) {
  const source = extract(new RegExp(`async function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`), `Debe existir ${name}`);
  assert.match(source, /const userId=adminSessionUserId,authEpoch=adminAuthEpoch/);
  assert.match(source, /await sb\.rpc\([\s\S]*?if\(!isCurrent\(\)\)return false;/, `${name} debe descartar la RPC si cambió la sesión.`);
  assert.match(source, /catch\(error\)\{\s*if\(!isCurrent\(\)\)return false;/, `${name} no debe pintar errores de otra sesión.`);
}
assert.ok(admin.includes('onlinePaymentSettingLoaded=false;onlinePaymentSettingOriginal=null;'), 'El lock invalida el estado de pagos.');
assert.ok(admin.includes('storefrontCombosAdminLoaded=false;storefrontProductCombosAdmin=[];'), 'El lock descarta combinaciones de la cuenta anterior.');
assert.ok(admin.includes('seasonalPromoSettingsLoaded=false;seasonalPromoSettingsOriginal=null;'), 'El lock invalida los settings de campaña.');

const lockSource = extract(/function lockAdminPanel\(message='[^']*'\)\{[\s\S]*?\n\}/, 'Debe existir invalidación de estado al cerrar la sesión');
const shippingRulesResetSource = extract(/function resetStorefrontShippingRulesAdminState\(\)\{[\s\S]*?\n\}/, 'Debe existir reset del estado de reglas por destino');
const shippingRuleFormResetSource = extract(/function resetStorefrontShippingRuleForm\(\)\{[\s\S]*?\n\}/, 'Debe existir reset de formulario de reglas por destino');
let editorClearCalls = 0;
const lockNodes = Object.fromEntries(['app','loginScreen','refreshOrdersBtn','accountEmail','securityAccountEmail','password','currentAdminPassword','newAdminPassword','confirmAdminPassword','changeAdminPasswordBtn','adminCurrentPasswordField','onlinePaymentsToggle','saveOnlinePaymentsBtn','onlinePaymentsStateText','shippingNationalCost','shippingFreeThreshold','shippingFreeThresholdEnabled','saveStorefrontShippingSettingsBtn','refreshStorefrontShippingSettingsBtn','shippingRulesSearch','refreshStorefrontShippingRulesBtn','storefrontShippingRulesAdminList','shippingRuleEditId','shippingRuleScope','shippingRuleName','shippingRuleDestinations','shippingRulePriority','shippingRuleCost','shippingRuleThresholdEnabled','shippingRuleThreshold','shippingRuleEnabled','saveStorefrontShippingRuleBtn','resetStorefrontShippingRuleBtn','codPaymentsToggle','saveCODCitiesBtn'].map(id => [id, { value: 'stale', checked: true, disabled: true, textContent: 'stale', classList: { add() {}, remove() {} } }]));
const locked = run(`let availabilityRefreshBusy=true,availabilityRefreshToken=4,storefrontMarketingMetricsBusy=true,storefrontMarketingMetricsToken=12,editingProductImageLoadToken=7;\n${shippingRuleFormResetSource}\n${shippingRulesResetSource}\n${lockSource}\nfunction lockStateForTest(){return {busy:availabilityRefreshBusy,refreshToken:availabilityRefreshToken,marketingBusy:storefrontMarketingMetricsBusy,marketingToken:storefrontMarketingMetricsToken,imageToken:editingProductImageLoadToken};}`, {
  adminAuthEpoch: 11, adminSessionAuthorized: true, adminSessionUserId: 'account-A', adminPasswordRecoveryMode: true,
  adminCatalogRealtimeChannel: null, sb: null, adminCatalogRealtimeReady: true, adminCatalogRealtimePending: [],
  productos: [{}], ventas: [{}], clientes: [{}], proveedores: [{}], gastos: [{}], movimientos: [{}], pedidos: [{}], categorias: [{}], categoryRecords: [{}],
  moduleLoadErrors: { stale: true }, adminDeferredModuleLoaded: { clients: true, orders: true },
  onlinePaymentSettingLoaded: true, onlinePaymentSettingOriginal: true,
  codCitiesSettingsLoaded: true, codCitiesSettingsOriginal: { enabled: true, allowed_cities: ['Cali'] },
  storefrontShippingAdminLoaded: true, storefrontShippingAdminOriginal: { fee: 1000, threshold: 2000 }, storefrontShippingAdminSaving: true,
  storefrontShippingRulesAdminLoaded: true, storefrontShippingRulesAdmin: [{ id: 'stale-rule' }], storefrontShippingRuleSaving: true,
  storefrontCombosAdminLoaded: true, storefrontProductCombosAdmin: [{}], storefrontComboSaving: true, storefrontComboEditingId: 'stale',
  seasonalPromoSettingsLoaded: true, seasonalPromoSettingsOriginal: { enabled: true }, seasonalPromoSaving: true, seasonalPromoAutoCloseTimer: 0,
  $: id => lockNodes[id] || null, document: { querySelectorAll: () => [] }, clearTimeout() {}, loginMsg() {}, console: consoleStub,
  limpiarProducto() { editorClearCalls++; }, updateStorefrontShippingAdminForm() {}, updateStorefrontShippingRuleAdminForm() {}, renderStorefrontShippingRulesAdmin() {}, setStorefrontShippingRulesAdminStatus() {}, setStorefrontComboFormDisabled() {}, renderStorefrontCombosAdminList() {}, setSeasonalPromoFormDisabled() {},
});
locked.lockAdminPanel('Cuenta cerrada.');
const lockedState = locked.lockStateForTest();
assert.equal(locked.adminAuthEpoch, 12);
assert.equal(locked.adminSessionAuthorized, false);
assert.equal(locked.adminSessionUserId, '');
assert.equal(lockedState.busy, false);
assert.equal(lockedState.refreshToken, 5);
assert.equal(lockedState.marketingBusy, false);
assert.equal(lockedState.marketingToken, 13);
assert.equal(lockedState.imageToken, 8);
assert.equal(locked.onlinePaymentSettingLoaded, false);
assert.equal(locked.storefrontShippingAdminLoaded, false);
assert.equal(locked.storefrontShippingRulesAdminLoaded, false);
assert.equal(locked.storefrontShippingRulesAdmin.length, 0);
assert.equal(locked.storefrontShippingRuleSaving, false);
assert.equal(lockNodes.shippingRulesSearch.value, '');
assert.equal(lockNodes.refreshStorefrontShippingRulesBtn.disabled, false);
assert.equal(lockNodes.shippingRuleEditId.value, '');
assert.equal(lockNodes.shippingRuleName.value, '');
assert.equal(lockNodes.shippingRuleDestinations.value, '');
assert.equal(lockNodes.shippingRuleScope.value, 'city');
assert.equal(lockNodes.shippingRulePriority.value, '0');
assert.equal(lockNodes.shippingRuleCost.value, '15000');
assert.equal(lockNodes.shippingRuleThreshold.value, '130000');
assert.equal(locked.codCitiesSettingsLoaded, false);
assert.equal(locked.storefrontCombosAdminLoaded, false);
assert.equal(locked.seasonalPromoSettingsLoaded, false);
assert.equal(locked.productos.length + locked.ventas.length + locked.clientes.length + locked.pedidos.length, 0);
assert.equal(lockNodes.changeAdminPasswordBtn.disabled, false);
assert.equal(lockNodes.password.value, '');
assert.equal(editorClearCalls, 1, 'El lock limpia el editor de producto de la sesión anterior.');

// Revalidación: una respuesta de rol tardía no bloquea a la cuenta nueva y la revalidación pendiente se ejecuta.
const revalidateSource = extract(/async function revalidateAdminAuthorization\(\)\{[\s\S]*?\n\}/, 'Debe existir revalidación de rol con guards');
const roleA = deferredValue();
const revalidateTimers = [];
let revalidateContext;
let roleCalls = 0;
let lockCount = 0;
const revalidate = run(revalidateSource, {
  sb: { rpc: () => { roleCalls++; return roleCalls === 1 ? roleA.promise : Promise.resolve({ data: true, error: null }); } },
  adminSessionAuthorized: true, adminSessionUserId: 'account-A', adminAuthEpoch: 3,
  adminAuthorizationBusy: false, adminAuthorizationPending: false,
  adminAuthOperationStillCurrent: (userId, epoch) => !!revalidateContext && revalidateContext.adminSessionAuthorized && revalidateContext.adminSessionUserId === userId && revalidateContext.adminAuthEpoch === epoch,
  document: { hidden: false },
  lockAdminPanel() { lockCount++; },
  setTimeout: callback => { revalidateTimers.push(callback); return revalidateTimers.length; },
  console: consoleStub,
});
revalidateContext = revalidate;
const oldRoleCheck = revalidate.revalidateAdminAuthorization();
revalidate.adminSessionUserId = 'account-B';
revalidate.adminAuthEpoch = 4;
await revalidate.revalidateAdminAuthorization();
assert.equal(revalidate.adminAuthorizationPending, true, 'La revalidación de B queda pendiente detrás de la de A');
roleA.resolve({ data: false, error: null });
await oldRoleCheck;
assert.equal(lockCount, 0, 'La respuesta negativa de A no bloquea a B');
assert.equal(revalidateTimers.length, 1, 'El guard agenda la verificación de B');
revalidateTimers.shift()();
await nextTurn();
assert.equal(roleCalls, 2, 'La autorización del usuario actual se vuelve a consultar');
assert.equal(lockCount, 0);

console.log('OK admin_account_session_race_regression: dashboard/clientes/pedidos, stock, imágenes, settings A→B y lock limpian estado de sesión.');
