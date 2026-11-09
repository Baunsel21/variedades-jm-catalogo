import assert from 'node:assert/strict';
import {
  DEFAULT_LIMITS,
  PRODUCT_COLUMNS,
  normalizeCode,
  previewProductsCsv,
} from '../scripts/fase7_csv_preview.mjs';

const header = PRODUCT_COLUMNS.join(',');
const row = 'P-001,Camisa,Ropa,12000,25000,3';

// El módulo es un dry-run puro: nunca habilita commit ni reporta escritura.
{
  const result = previewProductsCsv(`${header}\r\n${row}\r\n`);
  assert.equal(result.canCommit, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.writePerformed, false);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.rows[0], {
    row: 2,
    code: 'P-001',
    name: 'Camisa',
    category: 'Ropa',
    cost: 12000,
    sale_price: 25000,
    quantity: 3,
  });
  assert.match(result.message, /no se escribe/i);
}

// BOM, CRLF, comas, dobles comillas y salto de línea dentro de un campo.
{
  const csv =
    `\uFEFF${header}\r\n` +
    'P-002,"Camisa, ""M""","Ropa femenina",0,10000,0\r\n' +
    'P-003,"Línea uno\r\nLínea dos",Ropa,1,2,4\r\n';
  const result = previewProductsCsv(csv);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].name, 'Camisa, "M"');
  assert.equal(result.rows[0].cost, 0, 'cero explícito se conserva como cero');
  assert.equal(result.rows[0].quantity, 0, 'quantity cero explícito se conserva');
  assert.equal(result.rows[1].name, 'Línea uno\r\nLínea dos');
}

// La última celda quoted no se agrega dos veces al cerrar la fila.
for (const ending of ['\n', '\r\n', '']) {
  const csv = PRODUCT_COLUMNS.map(name => `"${name}"`).join(',') + '\r\n' +
    'P-004,Última celda,Ropa,1,2,"3"' + ending;
  const result = previewProductsCsv(csv);
  assert.equal(result.errors.length, 0, 'Cabecera y última celda quoted válidas');
  assert.equal(result.rows[0].quantity, 3);
}

// Límites UTF-8 y filas de datos (el encabezado no cuenta como fila de producto).
{
  const csv = `${header}\n${row}\nP-002,Otro,Ropa,1,2,1\n`;
  const bytes = new TextEncoder().encode(csv).byteLength;
  const byBytes = previewProductsCsv(csv, { maxBytes: bytes - 1 });
  assert.ok(byBytes.errors.some(error => error.code === 'MAX_BYTES_EXCEEDED'));
  assert.equal(byBytes.rows.length, 0);
  assert.equal(byBytes.canCommit, false);

  const byRows = previewProductsCsv(csv, { maxRows: 1 });
  assert.ok(byRows.errors.some(error => error.code === 'MAX_ROWS_EXCEEDED'));
  assert.equal(byRows.rows.length, 0);

  const exact = previewProductsCsv(`${header}\n${row}\n`, {
    limits: { maxBytes: bytes, maxRows: 1 },
  });
  assert.equal(exact.errors.length, 0);
  assert.deepEqual(exact.summary.limits, { maxBytes: bytes, maxRows: 1 });
}

// COP no negativo y enteros seguros; los inválidos no se convierten a 0.
{
  const decimal = previewProductsCsv(`${header}\nP-010,Decimal,Ropa,12.50,25000,1\n`);
  assert.ok(decimal.errors.some(error => error.field === 'cost' && error.code === 'INVALID_INTEGER'));
  assert.equal(decimal.rows.length, 0);

  const negative = previewProductsCsv(`${header}\nP-011,Negativo,Ropa,-1,25000,-2\n`);
  assert.ok(negative.errors.some(error => error.field === 'cost' && error.code === 'INVALID_INTEGER'));
  assert.ok(negative.errors.some(error => error.field === 'quantity' && error.code === 'INVALID_INTEGER'));
  assert.equal(negative.rows.length, 0);

  const huge = previewProductsCsv(
    `${header}\nP-012,Grande,Ropa,999999999999999999999999,25000,1\n`,
  );
  assert.ok(huge.errors.some(error => error.code === 'INTEGER_OUT_OF_RANGE'));
  assert.equal(huge.rows.length, 0);

  const malformedPrice = previewProductsCsv(`${header}\nP-013,Texto,Ropa,abc,25000,1\n`);
  assert.ok(malformedPrice.errors.some(error => error.field === 'cost'));
  assert.equal(malformedPrice.rows.length, 0);
}

// Cabeceras desconocidas, extras, duplicadas y ausentes rechazan el contrato exacto.
{
  const extra = previewProductsCsv(`${header},supplier\n${row},Acme\n`);
  assert.ok(extra.errors.some(error => error.code === 'UNKNOWN_HEADER'));
  assert.equal(extra.canCommit, false);

  const duplicate = previewProductsCsv(
    'code,name,category,cost,sale_price,quantity,code\nP-020,Duplicado,Ropa,1,2,1,P-021\n',
  );
  assert.ok(duplicate.errors.some(error => error.code === 'DUPLICATE_HEADER'));
  assert.equal(duplicate.rows.length, 0);

  const missing = previewProductsCsv('code,name,category,cost,sale_price\nP-021,Falta,Ropa,1,2\n');
  assert.ok(missing.errors.some(error => error.code === 'MISSING_HEADER' && error.field === 'quantity'));
  assert.equal(missing.rows.length, 0);

  const variant = previewProductsCsv(
    `${header},variant_size\nP-022,Variante,Ropa,1,2,1,M\n`,
  );
  assert.ok(variant.errors.some(error => error.code === 'VARIANT_DATA_NOT_SUPPORTED'));
}

// Duplicados normalizados contra el CSV y contra existingCodes; no hay red.
{
  assert.equal(normalizeCode('  P-030  '), 'p-030');
  const csv = `${header}\nP-030,Primero,Ropa,1,2,1\np-030,Repetido,Ropa,1,2,1\nP-031,Nuevo,Ropa,1,2,1\n`;
  const local = previewProductsCsv(csv);
  assert.ok(local.errors.some(error => error.row === 3 && error.code === 'DUPLICATE_CODE'));
  assert.equal(local.rows.length, 2);

  const existing = previewProductsCsv(`${header}\n p-031 ,Ya existe,Ropa,1,2,1\n`, {
    existingCodes: ['P-031'],
  });
  assert.ok(existing.errors.some(error => error.row === 2 && error.code === 'EXISTING_CODE'));
  assert.equal(existing.rows.length, 0);

  const positional = previewProductsCsv(`${header}\nP-032,Iterable,Ropa,1,2,1\n`, new Set(['p-032']));
  assert.ok(positional.errors.some(error => error.code === 'EXISTING_CODE'));
}

// Fórmulas y CSV malformado se rechazan como texto, sin evaluar ni convertir precios.
{
  const formulaPrice = previewProductsCsv(`${header}\nP-040,Fórmula,Ropa,=1+1,25000,1\n`);
  assert.ok(formulaPrice.errors.some(error => error.code === 'FORMULA_NOT_ALLOWED'));
  assert.equal(formulaPrice.rows.length, 0);

  const formulaText = previewProductsCsv(
    `${header}\nP-041,"=HYPERLINK(""https://example.test"")",Ropa,1,2,1\n`,
  );
  assert.ok(formulaText.errors.some(error => error.field === 'name' && error.code === 'FORMULA_NOT_ALLOWED'));
  assert.equal(formulaText.rows.length, 0);

  const unterminated = previewProductsCsv(`${header}\nP-042,"Sin cierre,Ropa,1,2,1\n`);
  assert.ok(unterminated.errors.some(error => error.code === 'MALFORMED_CSV'));
  assert.equal(unterminated.rows.length, 0);

  const malformedAfterMultiline = previewProductsCsv(
    `${header}\nP-044,"Línea uno\nLínea dos",Ropa,1,2,1\nP-045,"Sin cierre\ncontinúa`,
  );
  assert.equal(malformedAfterMultiline.errors.length, 1);
  assert.equal(malformedAfterMultiline.errors[0].code, 'MALFORMED_CSV');
  assert.equal(malformedAfterMultiline.errors[0].row, 3, 'Conserva la fila lógica tras un campo multilinea previo');
  assert.equal(malformedAfterMultiline.errors[0].physicalLine, 5, 'Indica la línea física de EOF, no la línea inicial del campo');
  assert.equal(malformedAfterMultiline.summary.invalidRows, 1);
  assert.equal(malformedAfterMultiline.canCommit, false);

  const strayQuote = previewProductsCsv(`${header}\nP-043,Nombre"roto,Ropa,1,2,1\n`);
  assert.ok(strayQuote.errors.some(error => error.code === 'MALFORMED_CSV'));
}

// Archivo con solo cabeceras es una previsualización vacía válida, no una escritura.
{
  const result = previewProductsCsv(`${header}\n`);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.dataRows, 0);
  assert.equal(DEFAULT_LIMITS.maxRows, 10_000);
}

console.log('OK fase7_csv_preview: CSV estricto, límites, COP, duplicados, variantes y dry-run sin escritura.');
