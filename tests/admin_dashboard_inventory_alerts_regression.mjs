import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const saleQuantity = html.match(/function saleAvailableQuantity\(p\)\{[\s\S]*?\n\}/)?.[0];
const summarySource = html.match(/function calculateDashboardInventoryAttentionSummary\(rows,lowThreshold=2\)\{[\s\S]*?\n\}/)?.[0];
const render = html.match(/function renderInicio\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(saleQuantity, 'El dashboard reutiliza el helper canónico de disponibilidad para ventas.');
assert.ok(summarySource, 'Existe un resumen puro de stock bajo y agotado.');
assert.ok(render, 'Existe renderInicio.');
assert.match(render, /calculateDashboardInventoryAttentionSummary\(productos\)/, 'La vista usa productos ya cargados.');
assert.match(render, /inventoryAttentionSummary/, 'La vista informa por separado los productos bajos y agotados.');
assert.doesNotMatch(`${summarySource}\n${render}`, /\bsb\.(?:from|rpc)|\bfetch\s*\(/, 'El resumen no agrega consultas ni escrituras remotas.');
assert.match(html, /id="inventoryAttentionSummary"[^>]*role="status"[^>]*aria-live="polite"/, 'El resumen se comunica de forma accesible.');

const productos = [
  { id: 'variant-low', code: 'V-LOW', name: 'Variante baja', quantity: 50, availableQuantity: 50, availableVariants: [{ stock: 1 }] },
  { id: 'variant-out', code: 'V-OUT', name: 'Variante agotada', quantity: 10, availableQuantity: 10, availableVariants: [{ stock: 0 }] },
  { id: 'plain-low', code: 'P-LOW', name: 'Stock bajo', quantity: 2, availableQuantity: 2, availableVariants: [] },
  { id: 'healthy', code: 'OK', name: 'Stock normal', quantity: 3, availableQuantity: 3, availableVariants: [] },
  { id: 'plain-out', code: 'P-OUT', name: 'Sin unidades', quantity: 0, availableQuantity: 0, availableVariants: [] },
  { id: 'reserved-stock', code: 'RSV', name: 'Unidades reservadas', quantity: 17, availableQuantity: 8, availableVariants: [] },
];
const ids = [
  'nProductos', 'nUnidades', 'nVendidos', 'nGanancia', 'heroProducts', 'heroUnits', 'heroSales',
  'dashboardSalesTodayRevenue', 'dashboardSalesTodayMeta', 'dashboardSalesWeekRevenue',
  'dashboardSalesWeekMeta', 'lowCount', 'inventoryAttentionSummary', 'stockBajo', 'recentSales',
];
const elements = Object.fromEntries(ids.map(id => [id, { textContent: '', innerHTML: '' }]));
const context = {
  productos,
  ventas: [],
  availableQuantity: product => Number(product?.availableQuantity ?? product?.quantity) || 0,
  availableVariants: product => Array.isArray(product?.availableVariants) && product.availableVariants.length
    ? product.availableVariants
    : (Array.isArray(product?.variants) ? product.variants : []),
  $: id => elements[id] ?? null,
  money: amount => `$${amount}`,
  esc: value => String(value ?? ''),
  stockBadge: quantity => `<badge>${quantity}</badge>`,
  calculatePosSalesDashboardSummary: () => ({
    todayKey: '2026-11-09', weekStartKey: '2026-11-03', todayRevenue: 0, todayUnits: 0, todayLines: 0,
    weekRevenue: 0, weekUnits: 0, weekLines: 0,
  }),
  renderDashboardPendingWebOrders() {},
  loadDashboardWompiReviewCount() { return Promise.resolve(true); },
};
vm.runInNewContext(`${saleQuantity}\n${summarySource}\n${render}\nrenderInicio();`, context);

const summary = JSON.parse(JSON.stringify(vm.runInContext('calculateDashboardInventoryAttentionSummary(productos)', context)));
assert.equal(summary.low, 2, 'Cuenta 1–2 unidades disponibles y no usa el quantity físico si hay variantes live.');
assert.equal(summary.out, 2, 'Cuenta como agotado un producto cuyas variantes disponibles suman cero.');
assert.equal(summary.total, 4);
assert.deepEqual(summary.items.map(item => [item.product.id, item.quantity]), [
  ['variant-low', 1], ['variant-out', 0], ['plain-low', 2], ['plain-out', 0],
]);
assert.equal(elements.lowCount.textContent, '4');
assert.equal(elements.nUnidades.textContent, 14, 'El KPI suma disponibilidad real, no las 82 unidades físicas.');
assert.equal(elements.heroUnits.textContent, 14, 'El resumen superior usa el mismo conteo disponible.');
assert.match(elements.inventoryAttentionSummary.textContent, /2 con 1–2 unidades · 2 agotados/);
assert.match(elements.inventoryAttentionSummary.textContent, /stock físico/);
assert.match(elements.stockBajo.innerHTML, /Variante agotada/);
assert.match(elements.stockBajo.innerHTML, /Variante baja/);
assert.doesNotMatch(elements.stockBajo.innerHTML, /Stock normal/);

console.log('admin_dashboard_inventory_alerts_regression: PASS (variantes/reservas, bajo/agotado y resumen accesible)');
