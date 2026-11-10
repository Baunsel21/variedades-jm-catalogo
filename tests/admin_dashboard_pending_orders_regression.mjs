import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const extract = (signature, nextSignature) => {
  const start = html.indexOf(signature);
  assert.notEqual(start, -1, `Se encuentra ${signature}`);
  const end = nextSignature ? html.indexOf(nextSignature, start) : html.indexOf('\n}', start) + 2;
  assert.notEqual(end, -1, `Se encuentra el cierre de ${signature}`);
  return html.slice(start, end);
};
const summary = extract('function calculatePendingWebOrdersDashboardSummary(rows)', 'function renderDashboardPendingWebOrders');
const renderPending = extract('function renderDashboardPendingWebOrders()', 'function renderInicio');
const dateHelper = extract('function orderDateKeyColombia(value)', 'function filterAdminOrders');
const posSummary = extract('function calculatePosSalesDashboardSummary(rows,', 'function calculatePendingWebOrdersDashboardSummary');
const inventorySummary = extract('function calculateDashboardInventoryAttentionSummary(rows,', 'function renderInicio');
const renderInicio = extract('function renderInicio()', 'function refrescarSelects');
const loadOrders = extract('async function cargarPedidos()', 'function pedidoEstado(p)');

assert.match(html, /id="dashboardPendingWebOrdersCount"/);
assert.match(html, /id="dashboardPendingWebOrdersMeta"/);
assert.match(renderInicio, /renderDashboardPendingWebOrders\(\)/, 'El dashboard actualiza la tarjeta desde el render habitual.');
assert.match(loadOrders, /pedidos=data\|\|\[\];[\s\S]*?renderInicio\(\)/, 'El éxito de cargarPedidos refresca el indicador.');
assert.match(loadOrders, /pedidosLoadError=describeAdminTableError\('web_orders',[\s\S]*?renderInicio\(\)/, 'El fallo de carga cambia el indicador a estado de error.');
assert.doesNotMatch(`${summary}\n${renderPending}`, /\bsb\.(?:from|rpc)|\bfetch\s*\(/, 'El cálculo y render del indicador no añaden consultas ni mutaciones.');

function renderCase({ loaded, error = '', orders = [] }) {
  const ids = [
    'dashboardPendingWebOrdersCount', 'dashboardPendingWebOrdersMeta',
    'nProductos', 'nUnidades', 'nVendidos', 'nGanancia', 'heroProducts', 'heroUnits', 'heroSales',
    'dashboardSalesTodayRevenue', 'dashboardSalesTodayMeta', 'dashboardSalesWeekRevenue',
    'dashboardSalesWeekMeta', 'lowCount', 'stockBajo', 'recentSales',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, { textContent: '', innerHTML: '' }]));
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-09T12:00:00.000Z'])); }
  }
  const context = {
    Date: FixedDate,
    productos: [],
    ventas: [],
    pedidos: orders,
    pedidosLoadError: error,
    adminDeferredModuleLoaded: { orders: loaded },
    loadDashboardWompiReviewCount: () => Promise.resolve(true),
    $: id => elements[id] ?? null,
    money: amount => `$${amount}`,
    availableQuantity: () => 0,
    esc: value => String(value ?? ''),
    stockBadge: () => '',
  };
  vm.runInNewContext(`${dateHelper}\n${posSummary}\n${inventorySummary}\n${summary}\n${renderPending}\n${renderInicio}\nrenderInicio();`, context);
  return elements;
}

let elements = renderCase({ loaded: false });
assert.equal(elements.dashboardPendingWebOrdersCount.textContent, '—');
assert.match(elements.dashboardPendingWebOrdersMeta.textContent, /Abre Pedidos para consultar/);
assert.match(elements.dashboardPendingWebOrdersMeta.textContent, /Wompi/);

elements = renderCase({ loaded: true, orders: [
  { status: 'Pendiente' }, { status: ' pendiente ' }, { status: 'confirmado' }, { status: '' },
] });
assert.equal(elements.dashboardPendingWebOrdersCount.textContent, '2');
assert.match(elements.dashboardPendingWebOrdersMeta.textContent, /^2 de 4 pedidos web consultados/);
assert.match(elements.dashboardPendingWebOrdersMeta.textContent, /Wompi orders se administra aparte/);

elements = renderCase({ loaded: true, error: 'synthetic read failure', orders: [{ status: 'pendiente' }] });
assert.equal(elements.dashboardPendingWebOrdersCount.textContent, '—', 'Un error nunca muestra el snapshot anterior como actual.');
assert.match(elements.dashboardPendingWebOrdersMeta.textContent, /No fue posible cargar/);

elements = renderCase({ loaded: true, orders: [] });
assert.equal(elements.dashboardPendingWebOrdersCount.textContent, '0');
assert.match(elements.dashboardPendingWebOrdersMeta.textContent, /^0 de 0 pedidos web consultados/);

console.log('admin_dashboard_pending_orders_regression: PASS');
