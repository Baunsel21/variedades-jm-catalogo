import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
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
function listItemCount(value) { return (value.match(/class="listItem"/g) || []).length; }

const elements = {
  buscarVenta: { value: '' }, salesCount: { textContent: '' }, listaVentas: { innerHTML: '' }, ventasPagination: { innerHTML: '' },
  gastoTotal: { textContent: '' }, listaGastos: { innerHTML: '' }, gastosPagination: { innerHTML: '' },
  movementLogSearch: { value: '' }, movementLogType: { value: '' }, movementLogFrom: { value: '' }, movementLogTo: { value: '' },
  movementLogStatus: { textContent: '' }, listaMovimientos: { innerHTML: '' }, movimientosPagination: { innerHTML: '' },
};
const context = vm.createContext({
  ADMIN_HISTORY_PAGE_SIZE: 100,
  salesHistoryPage: 1, salesHistoryQuery: null, expensesHistoryPage: 1,
  inventoryMovementLogPage: 1, inventoryMovementLogFilterKey: null,
  ventas: Array.from({ length: 205 }, (_, i) => ({
    id: `sale-${i}`, product_code: `V-${String(i).padStart(3, '0')}`, product_name: `Venta fila ${i}`,
    sale_date: '2026-11-10', quantity: 1, sale_price: 100, cost_price: 40, client_id: null,
  })),
  gastos: Array.from({ length: 205 }, (_, i) => ({ id: `expense-${i}`, concept: `Gasto fila ${i}`, amount: 1, expense_date: '2026-11-10', category: 'Prueba' })),
  movimientos: Array.from({ length: 205 }, (_, i) => ({
    type: 'entrada', created_at: '2026-11-01T12:00:00Z', product_code: `M-${String(i).padStart(3, '0')}`,
    product_name: `Movimiento fila ${i}`, quantity: 1, motive: 'Fixture local',
  })),
  moduleLoadErrors: { expenses: '', movements: '' },
  INVENTORY_MOVEMENT_LOG_TIME_ZONE: 'America/Bogota',
  $: id => elements[id] ?? null,
  esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
  money: value => `$${Number(value) || 0}`,
  isValidAdminReportDate: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')),
  Date,
});
const names = [
  'adminHistoryPageInfo', 'adminHistoryPaginationMarkup', 'resetAdminHistoryPagination',
  'setSalesHistoryPage', 'renderVentas', 'setExpensesHistoryPage', 'renderGastos',
  'inventoryMovementLogDateKey', 'getInventoryMovementLogDateRange', 'normalizeMovementSearchValue',
  'filterInventoryMovementLog', 'setInventoryMovementLogPage', 'renderMovimientos',
];
vm.runInContext(names.map(extractFunction).join('\n'), context);

// Ventas: todas las páginas son accesibles y la búsqueda vuelve al primer resultado.
context.renderVentas();
assert.equal(listItemCount(elements.listaVentas.innerHTML), 100);
assert.match(elements.listaVentas.innerHTML, /V-000/);
assert.doesNotMatch(elements.listaVentas.innerHTML, /V-100/);
assert.match(elements.ventasPagination.innerHTML, /Mostrando 1–100 de 205/);
assert.match(elements.ventasPagination.innerHTML, /Página 1 de 3/);
assert.match(elements.ventasPagination.innerHTML, /disabled/);
context.setSalesHistoryPage(2);
assert.match(elements.listaVentas.innerHTML, /V-100/);
assert.doesNotMatch(elements.listaVentas.innerHTML, /V-000/);
context.setSalesHistoryPage(3);
assert.match(elements.listaVentas.innerHTML, /V-200/);
assert.match(elements.ventasPagination.innerHTML, /Mostrando 201–205 de 205/);
elements.buscarVenta.value = 'venta fila 1';
context.renderVentas();
assert.match(elements.ventasPagination.innerHTML, /Página 1 de 2/, 'A changed search resets page to 1.');
assert.match(elements.listaVentas.innerHTML, /V-001/);

// Gastos: el total es global y el cambio de tamaño del dataset limita la página vigente.
context.renderGastos();
assert.equal(elements.gastoTotal.textContent, '$205');
assert.match(elements.gastosPagination.innerHTML, /Mostrando 1–100 de 205/);
context.setExpensesHistoryPage(3);
assert.match(elements.listaGastos.innerHTML, /Gasto fila 200/);
context.gastos = context.gastos.slice(0, 50);
context.renderGastos();
assert.match(elements.gastosPagination.innerHTML, /Mostrando 1–50 de 50/);
assert.doesNotMatch(elements.gastosPagination.innerHTML, /Página 3/);
context.moduleLoadErrors.expenses = 'permission denied';
context.renderGastos();
assert.match(elements.listaGastos.innerHTML, /No se pudieron cargar/);
assert.equal(elements.gastosPagination.innerHTML, '', 'No pagination is presented as successful when the source query failed.');
context.moduleLoadErrors.expenses = '';

// Movimientos: pagina después del filtro y reinicia al cambiar búsqueda/filtros.
context.renderMovimientos();
assert.equal(listItemCount(elements.listaMovimientos.innerHTML), 100);
assert.match(elements.movimientosPagination.innerHTML, /Mostrando 1–100 de 205/);
context.setInventoryMovementLogPage(2);
assert.match(elements.listaMovimientos.innerHTML, /M-100/);
assert.doesNotMatch(elements.listaMovimientos.innerHTML, /M-000/);
elements.movementLogSearch.value = 'movimiento fila 1';
context.renderMovimientos();
assert.match(elements.movimientosPagination.innerHTML, /Página 1 de 2/);
assert.match(elements.listaMovimientos.innerHTML, /M-001/);
context.moduleLoadErrors.movements = 'permission denied';
context.renderMovimientos();
assert.match(elements.listaMovimientos.innerHTML, /No se pudieron cargar/);
assert.equal(elements.movimientosPagination.innerHTML, '');

context.salesHistoryPage = 3;
context.salesHistoryQuery = 'old';
context.expensesHistoryPage = 3;
context.inventoryMovementLogPage = 3;
context.inventoryMovementLogFilterKey = 'old';
context.resetAdminHistoryPagination();
assert.equal(context.salesHistoryPage, 1);
assert.equal(context.salesHistoryQuery, null);
assert.equal(context.expensesHistoryPage, 1);
assert.equal(context.inventoryMovementLogPage, 1);
assert.equal(context.inventoryMovementLogFilterKey, null);
for (const id of ['ventasPagination', 'gastosPagination', 'movimientosPagination']) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} exists in admin markup`);
  assert.match(html, new RegExp(`'${id}'`), `${id} is cleared during admin-session reset`);
}
assert.doesNotMatch(names.map(extractFunction).join('\n'), /\bsb\.(?:from|rpc)|\bfetch\s*\(/, 'Pagination remains local-only and makes no backend request.');
console.log('PASS admin history pagination (sales, expenses, movements, filters, errors, session reset).');
