import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_LIMITS, PRODUCT_COLUMNS, previewProductsCsv } from '../scripts/fase7_csv_preview.mjs';

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

const safeCellSource = extract(/function safeCSVCell\(value\)\{[\s\S]*?\n\}/, 'Debe existir el escape seguro compartido de CSV');
const exportSource = extract(/function exportCSVForPreview\(\)\{[\s\S]*?\n\}/, 'Debe existir la exportación compatible con vista previa');
assert.doesNotMatch(exportSource, /\bsb\b|\bfetch\s*\(|\.rpc\s*\(|\.from\s*\(/, 'La exportación local no consulta ni modifica Supabase');
assert.ok(admin.includes('onclick="exportCSVForPreview()"'), 'El botón nuevo está enlazado desde Configuración');
assert.ok(admin.includes('onclick="exportCSV()"'), 'Se conserva el exportador de inventario existente');
assert.equal(DEFAULT_LIMITS.maxRows, 10_000);
assert.equal(DEFAULT_LIMITS.maxBytes, 5 * 1024 * 1024);

function createExporter(products, authorized = true) {
  const downloads = [];
  const messages = [];
  const context = run(`${safeCellSource}\n${exportSource}`, {
    adminSessionAuthorized: authorized,
    productos: products,
    TextEncoder,
    downloadFile: (...args) => downloads.push(args),
    toast: message => messages.push(message),
  });
  return { context, downloads, messages };
}

const products = [
  {
    code: 'SKU-101',
    name: 'Blusa, "lino"\nazul',
    category: 'Ropa',
    cost_price: 12000,
    sale_price: 24000,
    quantity: 4,
  },
  {
    code: 'SKU-102',
    name: '=SUM(1,1)',
    category: '@formula',
    cost_price: 9000,
    sale_price: 15000,
    quantity: 2,
  },
];
const exporter = createExporter(products);
assert.equal(exporter.context.exportCSVForPreview(), true);
assert.equal(exporter.downloads.length, 1, 'Genera una descarga local');
assert.equal(exporter.downloads[0][0], 'sirevya_productos_vista_previa.csv');
assert.equal(exporter.downloads[0][2], 'text/csv;charset=utf-8');
assert.ok(exporter.downloads[0][1].startsWith('\uFEFF'), 'Incluye BOM UTF-8');
assert.match(exporter.downloads[0][1], /"'=SUM\(1,1\)"/, 'Neutraliza fórmulas antes de abrir el CSV en una hoja de cálculo');
assert.match(exporter.messages[0], /solo para vista previa/);

const preview = previewProductsCsv(exporter.downloads[0][1], { existingCodes: [] });
assert.deepEqual(PRODUCT_COLUMNS, ['code', 'name', 'category', 'cost', 'sale_price', 'quantity']);
assert.equal(preview.summary.headerValid, true, 'El formato cumple el contrato exacto del parser');
assert.equal(preview.rows.length, 2, 'RFC 4180 conserva comas, comillas y saltos de línea dentro de celdas');
assert.deepEqual(preview.errors, []);
assert.equal(preview.rows[0].code, 'SKU-101');
assert.equal(preview.rows[0].name, 'Blusa, "lino"\nazul');
assert.equal(preview.rows[1].name, "'=SUM(1,1)", 'La fórmula queda como texto literal no ejecutable');
assert.equal(preview.rows[1].category, "'@formula");
assert.equal(preview.canCommit, false);
assert.equal(preview.writePerformed, false);

const unauthorized = createExporter(products, false);
assert.equal(unauthorized.context.exportCSVForPreview(), false);
assert.equal(unauthorized.downloads.length, 0, 'Sin autorización no se descarga una copia del catálogo');

const tooManyRows = createExporter(Array.from({ length: DEFAULT_LIMITS.maxRows + 1 }, (_, index) => ({
  code: `SKU-${index}`,
  name: 'Producto',
  category: 'Ropa',
  cost_price: 1,
  sale_price: 2,
  quantity: 1,
})));
assert.equal(tooManyRows.context.exportCSVForPreview(), false);
assert.equal(tooManyRows.downloads.length, 0, 'No crea un CSV incompatible si supera el máximo de filas');
assert.match(tooManyRows.messages[0], /10.000 productos/);

const tooManyBytes = createExporter([{
  code: 'SKU-LARGE',
  name: 'x'.repeat(DEFAULT_LIMITS.maxBytes),
  category: 'Ropa',
  cost_price: 1,
  sale_price: 2,
  quantity: 1,
}]);
assert.equal(tooManyBytes.context.exportCSVForPreview(), false);
assert.equal(tooManyBytes.downloads.length, 0, 'No descarga un archivo que la vista previa rechazaría por tamaño');
assert.match(tooManyBytes.messages[0], /5 MiB/);

console.log('OK admin_csv_export_preview_contract_regression: formato RFC4180, escape de fórmulas, autorización y límites dry-run.');
