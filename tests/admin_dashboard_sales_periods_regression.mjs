import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const orderDateHelper = html.match(/function orderDateKeyColombia\(value\)[\s\S]*?\n\}/)?.[0];
const helper = html.match(/function calculatePosSalesDashboardSummary\(rows,todayKey=[\s\S]*?\n\}/)?.[0];
const inventorySummary = html.match(/function calculateDashboardInventoryAttentionSummary\(rows,lowThreshold=[\s\S]*?\n\}/)?.[0];
const pendingSummary = html.match(/function calculatePendingWebOrdersDashboardSummary\(rows\)[\s\S]*?\n\}/)?.[0];
const pendingRender = html.match(/function renderDashboardPendingWebOrders\(\)[\s\S]*?\n\}/)?.[0];
const render = html.match(/function renderInicio\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(orderDateHelper, 'Se reutiliza el helper existente de America/Bogota.');
assert.ok(helper, 'Se declara el helper de resumen por fecha.');
assert.ok(inventorySummary, 'Se declara la dependencia del dashboard de inventario.');
assert.ok(pendingSummary&&pendingRender, 'Se declara el contador de pedidos web y su estado diferido.');
assert.ok(render, 'Se declara renderInicio.');
assert.match(render, /calculatePosSalesDashboardSummary\(ventas\)/, 'Dashboard calcula desde ventas ya cargadas.');
assert.doesNotMatch(`${orderDateHelper}\n${helper}\n${inventorySummary}\n${pendingSummary}\n${pendingRender}\n${render}`, /\bsb\.(?:from|rpc)|\bfetch\s*\(/, 'Las métricas no agregan consultas ni escrituras externas.');
assert.match(html, /id="dashboardSalesTodayRevenue"/);
assert.match(html, /id="dashboardSalesWeekRevenue"/);
assert.match(html, /id="dashboardPendingWebOrdersCount"/);
assert.match(html, /id="dashboardPendingWebOrdersMeta"/);

const rows = [
  { sale_date: '2026-11-09', quantity: 2, sale_price: 100, cost_price: 40, product_code: 'DEMO-1', product_name: 'Artículo ficticio' },
  { sale_date: '2026-11-09', quantity: 1, sale_price: 50, cost_price: 20, product_code: 'DEMO-2', product_name: 'Artículo ficticio' },
  { sale_date: '2026-11-03', quantity: 3, sale_price: 25, cost_price: 10, product_code: 'DEMO-3', product_name: 'Artículo ficticio' },
  { sale_date: '2026-11-02', quantity: 5, sale_price: 20, cost_price: 8, product_code: 'DEMO-4', product_name: 'Artículo ficticio' },
  { sale_date: '2026-11-10', quantity: 9, sale_price: 1000, cost_price: 500, product_code: 'DEMO-5', product_name: 'Artículo ficticio' },
  { sale_date: 'fecha-inválida', quantity: 4, sale_price: 100, cost_price: 50, product_code: 'DEMO-6', product_name: 'Artículo ficticio' },
];
const ids = [
  'nProductos', 'nUnidades', 'nVendidos', 'nGanancia', 'heroProducts', 'heroUnits', 'heroSales',
  'dashboardSalesTodayRevenue', 'dashboardSalesTodayMeta', 'dashboardSalesWeekRevenue',
  'dashboardSalesWeekMeta', 'dashboardPendingWebOrdersCount', 'dashboardPendingWebOrdersMeta',
  'lowCount', 'stockBajo', 'recentSales',
];
const elements = Object.fromEntries(ids.map(id => [id, { textContent: '', innerHTML: '' }]));
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : ['2026-11-10T04:30:00.000Z'])); }
}
const context = {
  Date: FixedDate,
  productos: [],
  ventas: rows,
  saleAvailableQuantity: product => Number(product?.quantity) || 0,
  pedidos: [],
  pedidosLoadError: '',
  adminDeferredModuleLoaded: { orders: false },
  $: id => elements[id] ?? null,
  money: amount => `$${amount}`,
  availableQuantity: () => 0,
  esc: value => String(value ?? ''),
  stockBadge: () => '',
};
vm.runInNewContext(`${orderDateHelper}\n${helper}\n${inventorySummary}\n${pendingSummary}\n${pendingRender}\n${render}\nrenderInicio();`, context);

assert.equal(elements.dashboardSalesTodayRevenue.textContent, '$250');
assert.match(elements.dashboardSalesTodayMeta.textContent, /2026-11-09 · 2 líneas · 3 unidades/);
assert.equal(elements.dashboardSalesWeekRevenue.textContent, '$325');
assert.match(elements.dashboardSalesWeekMeta.textContent, /2026-11-03 a 2026-11-09 · 3 líneas · 6 unidades/);
assert.match(elements.dashboardSalesWeekMeta.textContent, /excluye pedidos web/);
assert.equal(elements.dashboardPendingWebOrdersCount.textContent, '—');
assert.match(elements.dashboardPendingWebOrdersMeta.textContent, /Abre Pedidos para consultar/);

console.log('admin_dashboard_sales_periods_regression: PASS');
