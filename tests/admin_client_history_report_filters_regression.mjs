import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
function extractFunction(name) {
  const marker = `function ${name}(`;
  let start = html.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const open = html.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
  for (let i = open; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

const historySales = [
  { client_id: 'client-a', sale_date: '2026-11-01', quantity: 2, sale_price: 100, product_code: 'POS-1', product_name: 'Bolso' },
  { client_id: 'client-a', sale_date: '2026-11-03', quantity: 1, sale_price: 300, product_code: 'POS-2', product_name: 'Blusa <script>alert(1)</script>' },
  { client_id: 'client-a', sale_date: '2026-10-31', quantity: 5, sale_price: 20, product_code: 'POS-3', product_name: 'Pañuelo' },
  { client_id: 'client-a', sale_date: '2026-11-02', quantity: 9, sale_price: 500, archived_at: '2026-11-04', product_name: 'Archivada' },
  { client_id: 'client-b', sale_date: '2026-11-02', quantity: 8, sale_price: 700, product_name: 'Otro cliente' },
  { sale_date: '2026-11-02', customer_name: 'Cliente A', quantity: 7, sale_price: 900, product_name: 'Pedido web sin FK' },
];
const clientHistoryContext = vm.createContext({
  ventas: historySales,
  summarizeClientPosHistory: null,
  esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
  money: value => `$${Number(value)}`,
});
vm.runInContext(`${extractFunction('summarizeClientPosHistory')}\n${extractFunction('renderClientPosHistory')}`, clientHistoryContext);
const clientSummary = clientHistoryContext.summarizeClientPosHistory(historySales, 'client-a');
assert.equal(clientSummary.recordCount, 3, 'only active POS sales with the exact client_id are linked');
assert.equal(clientSummary.units, 8);
assert.equal(clientSummary.revenue, 600);
assert.equal(clientSummary.latest.length, 3);
const clientHtml = clientHistoryContext.renderClientPosHistory('client-a');
assert.match(clientHtml, /clients\.id → sales\.client_id/);
assert.match(clientHtml, /No se unen pedidos web por nombre o teléfono/);
assert.doesNotMatch(clientHtml, /<script>alert\(1\)<\/script>/, 'product names in history are escaped');
assert.match(clientHtml, /&lt;script&gt;/);

const elements = {
  reportFromDate: { value: '2026-11-01' },
  reportToDate: { value: '2026-11-03' },
  rVentas: { textContent: '' }, rIngresos: { textContent: '' }, rCostos: { textContent: '' },
  rGanancia: { textContent: '' }, rGastos: { textContent: '' }, rNeta: { textContent: '' },
  inventoryValue: { textContent: '' }, reportDateFilterStatus: { textContent: '' },
  bestSellingProducts: { innerHTML: '' }, cats: { innerHTML: '' },
};
const reportSales = [
  { sale_date: '2026-11-01', quantity: 2, sale_price: 100, cost_price: 50, product_id: 'a', product_code: 'POS-1', product_name: 'Bolso' },
  { sale_date: '2026-11-03', quantity: 1, sale_price: 300, cost_price: 120, product_id: 'b', product_code: 'POS-2', product_name: 'Blusa' },
  { sale_date: '2026-10-31', quantity: 5, sale_price: 20, cost_price: 10, product_id: 'c', product_code: 'POS-3', product_name: 'Pañuelo' },
  { sale_date: '2026-11-02', quantity: 50, sale_price: 999, cost_price: 0, archived_at: '2026-11-04', product_id: 'd', product_code: 'OLD', product_name: 'Archivada' },
];
const gastos = [
  { expense_date: '2026-11-02', amount: 50 },
  { expense_date: '2026-11-04', amount: 99 },
  { expense_date: '2026-10-31', amount: 25 },
];
let download = null;
const reportContext = vm.createContext({
  ventas: reportSales, gastos, productos: [{ category: 'Accesorios', quantity: 10, cost_price: 20 }],
  moduleLoadErrors: {}, adminDeferredModuleLoaded: { expenses: true },
  $: id => elements[id] ?? null,
  money: value => `$${Number(value)}`,
  esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
  safeCSVCell: value => String(value ?? ''),
  downloadFile(name, content) { download = { name, content }; },
  toast() {},
});
const reportFunctions = ['isValidAdminReportDate', 'getAdminReportDateRange', 'filterAdminReportRows', 'getAdminReportData', 'renderReportes', 'exportSalesReportCSV'].map(extractFunction);
vm.runInContext(reportFunctions.join('\n'), reportContext);
reportContext.renderReportes();
assert.equal(elements.rVentas.textContent, 2);
assert.equal(elements.rIngresos.textContent, '$500');
assert.equal(elements.rCostos.textContent, '$220');
assert.equal(elements.rGanancia.textContent, '$280');
assert.equal(elements.rGastos.textContent, '$50');
assert.equal(elements.rNeta.textContent, '$230');
assert.equal(elements.inventoryValue.textContent, '$200', 'inventory valuation is unaffected by sale date filters');
assert.match(elements.reportDateFilterStatus.textContent, /2026-11-01 a 2026-11-03/);
assert.match(elements.bestSellingProducts.innerHTML, /Bolso/);
assert.doesNotMatch(elements.bestSellingProducts.innerHTML, /Pañuelo|Archivada|Sin relación POS/);
assert.equal(reportContext.exportSalesReportCSV(), true);
assert.match(download.name, /2026-11-01_2026-11-03/);
assert.match(download.content, /POS-1/);
assert.doesNotMatch(download.content, /POS-3|OLD|WEB/);

// Invalid or reversed ranges fail closed instead of silently showing all-time totals.
elements.reportFromDate.value = '2026-11-04';
elements.reportToDate.value = '2026-11-02';
reportContext.renderReportes();
assert.equal(elements.rVentas.textContent, 0);
assert.match(elements.reportDateFilterStatus.textContent, /Rango de fechas no válido/);
assert.equal(reportContext.exportSalesReportCSV(), false);
assert.equal(download.name, 'sirevya_reporte_ventas_2026-11-01_2026-11-03.csv', 'invalid range does not start a download');
elements.reportFromDate.value = '2026-02-30';
assert.equal(reportContext.getAdminReportDateRange().valid, false, 'impossible calendar dates are rejected');

assert.doesNotMatch(`${reportFunctions.join('\n')}\n${extractFunction('renderClientPosHistory')}`, /\bsb\.(?:from|rpc)|\bfetch\s*\(/, 'new views use only already-loaded authorized data');
assert.match(html, /id="reportFromDate" type="date"/);
assert.match(html, /id="reportToDate" type="date"/);
assert.match(html, /reportClear\?\.addEventListener\('click',clearAdminReportDateFilters\)/);
console.log('PASS client POS history and local report date/export regressions.');
