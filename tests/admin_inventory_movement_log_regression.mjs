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

const elements = {
  movementLogSearch: { value: '' }, movementLogType: { value: '' },
  movementLogFrom: { value: '' }, movementLogTo: { value: '' },
  movementLogStatus: { textContent: '' }, listaMovimientos: { innerHTML: '' },
};
const rows = [
  { type: 'entrada', created_at: '2026-11-01T12:00:00Z', product_code: 'A-1', product_name: 'Bálsamo', quantity: 5, motive: 'Compra' },
  { type: 'salida', created_at: '2026-11-03T12:00:00Z', product_code: 'B-2', product_name: 'Cadena', quantity: 1, motive: '=HYPERLINK("https://example.invalid")' },
  { type: 'ajuste', created_at: '2026-11-04T12:00:00Z', product_code: 'C-3', product_name: 'Top', quantity: 2, motive: 'Conteo físico' },
  { type: 'reserva', created_at: '2026-11-02T12:00:00Z', product_code: 'D-4', product_name: 'Accesorio', quantity: 1, motive: 'Evento legado' },
  { type: 'entrada', created_at: '2026-11-03T02:00:00Z', product_code: 'UTC-BOUNDARY', product_name: 'Límite UTC', quantity: 1, motive: 'Prueba de zona' },
];
const safeCsvSource = html.match(/function safeCSVCell\(value\)\{[\s\S]*?\n\}/)?.[0];
const timeZoneSource = html.match(/const INVENTORY_MOVEMENT_LOG_TIME_ZONE='America\/Bogota';/)?.[0];
assert.ok(timeZoneSource, 'La bitácora fija una zona horaria explícita America/Bogota.');
assert.ok(safeCsvSource, 'safe CSV helper exists');
let downloaded = null;
const alerts = [];
const context = vm.createContext({
  movimientos: rows,
  moduleLoadErrors: { movements: '' },
  $: id => elements[id] ?? null,
  isValidAdminReportDate: null,
  esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
  safeCSVCell: null,
  downloadFile(name, body) { downloaded = { name, body }; },
  toast(message) { alerts.push(message); },
  Date,
});
const renderMovimientosSource = extractFunction('renderMovimientos');
assert.match(renderMovimientosSource, /toLocaleString\("es-CO",\{timeZone:INVENTORY_MOVEMENT_LOG_TIME_ZONE\}\)/, 'El render usa la misma zona que el filtro.');
const functions = [
  timeZoneSource, extractFunction('isValidAdminReportDate'), safeCsvSource,
  extractFunction('getInventoryMovementLogDateRange'), extractFunction('normalizeMovementSearchValue'),
  extractFunction('inventoryMovementLogDateKey'), extractFunction('filterInventoryMovementLog'), renderMovimientosSource,
  extractFunction('exportInventoryMovementLogCSV'),
];
vm.runInContext(functions.join('\n'), context);
assert.equal(context.filterInventoryMovementLog().length, 5, 'empty filters preserve all loaded movement types');

elements.movementLogSearch.value = 'balsamo';
assert.deepEqual(Array.from(context.filterInventoryMovementLog()).map(row => row.product_code), ['A-1'], 'search is accent-insensitive');
elements.movementLogSearch.value = '';
elements.movementLogType.value = 'salida';
elements.movementLogFrom.value = '2026-11-03';
elements.movementLogTo.value = '2026-11-03';
assert.deepEqual(Array.from(context.filterInventoryMovementLog()).map(row => row.product_code), ['B-2'], 'type and inclusive day filters compose');

context.renderMovimientos();
assert.match(elements.movementLogStatus.textContent, /Coincidencias: 1 de 5/);
assert.match(elements.listaMovimientos.innerHTML, /B-2/);
assert.doesNotMatch(elements.listaMovimientos.innerHTML, /<script>/);
assert.equal(context.exportInventoryMovementLogCSV(), true);
assert.equal(downloaded.name, 'sirevya_bitacora_movimientos.csv');
assert.match(downloaded.body, /B-2/);
assert.match(downloaded.body, /"'=HYPERLINK\(""https:\/\/example\.invalid""\)"/);
assert.doesNotMatch(downloaded.body, /user_id|movement-id|D-4/);

// El límite UTC debe filtrarse y mostrarse como 2 de noviembre en America/Bogota.
elements.movementLogType.value = '';
elements.movementLogFrom.value = '2026-11-02';
elements.movementLogTo.value = '2026-11-02';
assert.equal(context.inventoryMovementLogDateKey('2026-11-03T02:00:00Z'), '2026-11-02');
assert.deepEqual(Array.from(context.filterInventoryMovementLog()).map(row => row.product_code), ['D-4', 'UTC-BOUNDARY']);
context.renderMovimientos();
assert.match(elements.listaMovimientos.innerHTML, /UTC-BOUNDARY/);

// Invalid ranges hide all results and block export.
elements.movementLogFrom.value = '2026-11-05';
elements.movementLogTo.value = '2026-11-02';
assert.equal(context.filterInventoryMovementLog().length, 0);
context.renderMovimientos();
assert.match(elements.movementLogStatus.textContent, /Rango de fechas no válido/);
assert.equal(context.exportInventoryMovementLogCSV(), false);
assert.equal(downloaded.body.includes('B-2'), true, 'invalid range does not replace a prior valid download');

// Export has a bounded row count to avoid an oversized client-side file.
elements.movementLogFrom.value = '';
elements.movementLogTo.value = '';
elements.movementLogType.value = '';
elements.movementLogSearch.value = '';
const tooMany = Array.from({ length: 20001 }, (_, index) => ({ ...rows[0], product_code: `X-${index}` }));
context.movimientos = tooMany;
assert.equal(context.exportInventoryMovementLogCSV(), false);
assert.match(alerts.at(-1), /Reduce el rango/);

// A real query error is not presented as an empty, successful log.
context.movimientos = rows;
context.moduleLoadErrors.movements = 'permission denied';
context.renderMovimientos();
assert.match(elements.listaMovimientos.innerHTML, /No se pudieron cargar/);
assert.match(elements.movementLogStatus.textContent, /no se pudo cargar/i);
assert.doesNotMatch(`${functions.join('\n')}`, /\bsb\.(?:from|rpc)|\bfetch\s*\(/, 'filters are local and do not query Supabase');
assert.match(html, /id="movementLogSearch"/);
assert.match(html, /id="movementLogFrom"/);
assert.match(html, /movementExport\?\.addEventListener\('click',exportInventoryMovementLogCSV\)/);
console.log('PASS admin inventory movement log filters/export/error handling.');
