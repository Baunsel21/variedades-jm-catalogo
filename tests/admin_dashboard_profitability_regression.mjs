import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Existe ${name}.`);
  const open = source.indexOf('{', start);
  let depth = 0; let quote = ''; let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth += 1;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`No se pudo cerrar ${name}.`);
}
const context = vm.createContext({ orderDateKeyColombia: () => '2026-11-14', pedidoEstado: row => String(row?.status || '').toLowerCase() });
vm.runInContext([
  extractFunction('calculatePosSalesDashboardSummary'),
  extractFunction('dashboardOrderIsPaid'),
  extractFunction('calculateDashboardWebOrderSummary'),
  extractFunction('calculateAdminProfitabilitySummary'),
].join('\n'), context);

const periods = context.calculatePosSalesDashboardSummary([
  { sale_date: '2026-11-14', quantity: 2, sale_price: 100 },
  { sale_date: '2026-11-13', quantity: 1, sale_price: 50 },
  { sale_date: '2026-11-01', quantity: 1, sale_price: 25 },
  { sale_date: '2025-11-14', quantity: 20, sale_price: 999 },
], '2026-11-14');
assert.equal(periods.todayRevenue, 200);
assert.equal(periods.yesterdayRevenue, 50);
assert.equal(periods.monthRevenue, 275);
assert.equal(periods.yearRevenue, 275);
assert.equal(periods.totalLines, 4);

const orders = context.calculateDashboardWebOrderSummary([
  { status: 'pendiente', payment_status: 'pending' },
  { status: 'confirmado', payment_status: 'approved' },
  { status: 'despachado', payment_status: 'paid' },
  { status: 'cancelado', payment_status: 'rejected' },
]);
assert.deepEqual({ total: orders.total, pending: orders.pending, paid: orders.paid, dispatch: orders.dispatch, cancelled: orders.cancelled }, { total: 4, pending: 1, paid: 2, dispatch: 2, cancelled: 1 });

const profitability = context.calculateAdminProfitabilitySummary([
  { product_name: 'A', quantity: 2, sale_price: 100, cost_price: 40, discount_total: 10, shipping_assumed: 5 },
  { product_name: 'B', quantity: 1, sale_price: 80, cost_price: null },
], [{ amount: 20 }], []);
assert.equal(profitability.revenue, 280);
assert.equal(profitability.netRevenue, 270);
assert.equal(profitability.cost, 80);
assert.equal(profitability.expenses, 20);
assert.equal(profitability.shippingAssumed, 5);
assert.equal(profitability.missingCostLines, 1);
assert.equal(profitability.estimatedProfit, 165);
assert.equal(Math.round(profitability.margin * 1000) / 1000, 0.611);
console.log('admin_dashboard_profitability_regression: PASS (periodos, estados web separados, descuentos, costes faltantes, gastos, envío y margen).');
