import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const helperStart = admin.indexOf('function normalizeOrderFilterValue(value){');
const helperEnd = admin.indexOf('/* ORDER_FILTER_HELPERS_END */', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'el bloque de filtros reutilizado por el panel debe estar delimitado');

const sandbox = { pedidos: [] };
vm.createContext(sandbox);
vm.runInContext(`${admin.slice(helperStart, helperEnd)}\nglobalThis.orderFilters={isContraDeliveryOrder,contraDeliveryOrders,codOrderStatusBucket,buildCODStatusFilterOptions,wompiFinancialStatusBucket,buildWompiStatusFilterOptions,filterWompiOrders,filterAdminOrders,paginateAdminOrders};`, sandbox);
const f = sandbox.orderFilters;
const plain = value => JSON.parse(JSON.stringify(value));

const mixedWebRows = [
  { payment_method: 'Contra entrega', status: 'confirmado', customer_name: 'Cliente A' },
  { payment_method: 'Contra entrega', status: 'enviado', customer_name: 'Cliente B' },
  { payment_method: 'Contra entrega', status: 'entregado', customer_name: 'Cliente C' },
  { payment_method: 'Contra entrega', status: 'pendiente', customer_name: 'Cliente D' },
  { payment_method: 'Contra entrega', status: 'rechazado', customer_name: 'Cliente E' },
  { payment_method: 'Contra entrega', status: 'cancelado', customer_name: 'Cliente F' },
  { payment_method: 'Contra entrega', status: 'devuelto', customer_name: 'Cliente G' },
  { payment_method: 'Wompi', status: 'pendiente', customer_name: 'No debe aparecer en COD' },
];
sandbox.pedidos = mixedWebRows;
const codRows = plain(f.contraDeliveryOrders());
assert.equal(codRows.length, 7, 'COD excluye los registros cuyo método es Wompi');
assert.equal(codRows.some(row => row.payment_method === 'Wompi'), false);
assert.equal(f.filterAdminOrders(codRows, { status: 'comercial_aprobado' }).length, 3,
  'Confirmados incluye estados comerciales confirmados/enviados/entregados');
assert.equal(f.filterAdminOrders(codRows, { status: 'pendiente' }).length, 1);
assert.equal(f.filterAdminOrders(codRows, { status: 'rechazado' }).length, 1);
assert.equal(f.filterAdminOrders(codRows, { status: 'cancelado' }).length, 1);
assert.equal(f.filterAdminOrders(codRows, { status: 'devuelto' }).length, 1);
const codOptions = plain(f.buildCODStatusFilterOptions(codRows));
assert.deepEqual(codOptions.map(({ value, label, count }) => [value, label, count]), [
  ['', 'Todos', 7],
  ['comercial_aprobado', 'Confirmados', 3],
  ['pendiente', 'Pendientes', 1],
  ['rechazado', 'Rechazados', 1],
  ['cancelado', 'Cancelados', 1],
  ['devuelto', 'Devueltos', 1],
]);
assert.equal(plain(f.buildCODStatusFilterOptions(codRows.filter(row => row.status !== 'cancelado'))).some(option => option.value === 'cancelado'), false,
  'el filtro Cancelados solo aparece cuando existe ese estado comercial');

const wompiRows = [
  { payment_status: 'APPROVED', status: 'APPROVED', reference: 'REF-APPROVED', items: [{ code: 'COR-038', name: 'Corset' }] },
  { payment_status: 'PENDING', status: 'APPROVED', reference: 'REF-PENDING', items: [] },
  { payment_status: 'DECLINED', reference: 'REF-DECLINED', items: [] },
  { payment_status: 'VOIDED', reference: 'REF-VOIDED', items: [] },
  { payment_status: 'ERROR', reference: 'REF-ERROR', items: [] },
];
assert.equal(f.filterWompiOrders(wompiRows, { status: 'approved' }).length, 1,
  'solo payment_status=APPROVED se clasifica como pago aprobado');
assert.equal(f.filterWompiOrders(wompiRows, { status: 'pending' }).length, 1,
  'un pedido existente o status general aprobado no convierte PENDING en pagado');
assert.equal(f.filterWompiOrders(wompiRows, { status: 'rejected' }).length, 1);
assert.equal(f.filterWompiOrders(wompiRows, { status: 'cancelled' }).length, 1);
assert.equal(f.filterWompiOrders(wompiRows, { status: 'error' }).length, 1);
assert.equal(f.filterWompiOrders(wompiRows, { search: 'cor-038' }).length, 1,
  'la búsqueda incluye referencia/código de producto sin alterar el filtro financiero');
const wompiOptions = plain(f.buildWompiStatusFilterOptions(wompiRows));
assert.deepEqual(wompiOptions.map(({ value, label, count }) => [value, label, count]), [
  ['all', 'Todos', 5],
  ['approved', 'Aprobados', 1],
  ['pending', 'Pendientes', 1],
  ['rejected', 'Rechazados', 1],
  ['cancelled', 'Cancelados', 1],
  ['error', 'Errores', 1],
]);
assert.equal(plain(f.buildWompiStatusFilterOptions(wompiRows.filter(row => row.payment_status !== 'VOIDED'))).some(option => option.value === 'cancelled'), false,
  'el filtro Cancelados solo aparece si existe un estado financiero cancelado/anulado');
const page = plain(f.paginateAdminOrders(Array.from({ length: 25 }, (_, i) => i), 2, 20));
assert.equal(page.total, 25);
assert.equal(page.items.length, 5);

for (const id of ['ordersCategoryTabs', 'ordersCategoryCodTab', 'ordersCategoryWompiTab', 'codOrdersPanel', 'wompiOrdersPanel', 'ordersCODCount', 'ordersWompiCount', 'wompiOrdersStatusFilter', 'wompiOrdersSearch']) {
  assert.match(admin, new RegExp(`id="${id}"`), `falta el control ${id}`);
}
const wompiRenderer = admin.slice(admin.indexOf('function renderAdminWompiOrders(){'), admin.indexOf('function updateOrderTrackingStatus(){'));
assert.match(wompiRenderer, /filterWompiOrders\(wompiAdminOrders/);
assert.match(wompiRenderer, /buildWompiStatusFilterOptions\(wompiAdminOrders\)/);
assert.match(wompiRenderer, /getImageUrl\(item\.image_url\|\|product\?\.image_url/);
assert.doesNotMatch(wompiRenderer, /admin_update_web_order_status|data-order-action/,
  'los filtros de Wompi permanecen de solo lectura y separados de las acciones COD');
const codRenderer = admin.slice(admin.indexOf('function renderPedidos(){'), admin.indexOf('function applyDefaultSirevyaCategoryOrder'));
assert.match(codRenderer, /const codRows=contraDeliveryOrders\(\)/);
assert.match(codRenderer, /filterAdminOrders\(codRows/);
assert.match(admin, /payment_status/);

console.log('admin_orders_categories_regression: PASS — separación por método; filtros comerciales y financieros; contadores; cancelados condicionales; búsqueda y paginación; Wompi sin acciones de escritura.');

assert.match(admin, /onkeydown="handleOrdersCategoryTabKeydown\(event\)"/,
  'las pestañas deben poder recorrerse con el teclado');
assert.match(admin, /function handleOrdersCategoryTabKeydown\(event\)/);
