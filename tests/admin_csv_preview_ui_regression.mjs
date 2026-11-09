import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_LIMITS, PRODUCT_COLUMNS } from '../scripts/fase7_csv_preview.mjs';
import {
  buildCsvPreviewReportCsv,
  initializeCsvPreviewUi,
  previewCsvFile,
  renderCsvPreviewResult,
} from '../scripts/admin_csv_preview.mjs';

function csvFile(text) {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function countCsvFields(record) {
  let fields = 1;
  let quoted = false;
  for (let index = 0; index < record.length; index += 1) {
    const character = record[index];
    if (character === '"') {
      if (quoted && record[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields += 1;
    }
  }
  return fields;
}

class FakeNode {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = new Map();
    this.files = [];
    this.value = '';
    this.clicked = false;
    this.removed = false;
    this.parentNode = null;
    this.href = '';
    this.download = '';
  }
  appendChild(node) {
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  replaceChildren(...nodes) {
    this.children = [...nodes];
    for (const node of this.children) node.parentNode = this;
  }
  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }
  async trigger(type) {
    return this.listeners.get(type)?.({});
  }
  click() {
    this.clicked = true;
  }
  remove() {
    this.removed = true;
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);
  }
}

class FakeDocument {
  constructor(ids) {
    this.nodes = new Map(Object.entries(ids).map(([id, node]) => [id, node]));
    this.body = new FakeNode('body');
    this.createdNodes = [];
  }
  getElementById(id) {
    return this.nodes.get(id) || null;
  }
  createElement(tagName) {
    const node = new FakeNode(tagName);
    this.createdNodes.push(node);
    return node;
  }
}

const header = PRODUCT_COLUMNS.join(',');

// El módulo del navegador reutiliza el parser puro y marca duplicados cargados en memoria.
{
  const result = await previewCsvFile(csvFile(`${header}\nSKU-001,Corset,Accesorios,12000,25000,2\n`), ['sku-001']);
  assert.equal(result.canCommit, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.writePerformed, false);
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.some(error => error.code === 'EXISTING_CODE'));
}

// Un archivo sobre 5 MB se rechaza antes de leer su contenido.
{
  let readAttempted = false;
  const result = await previewCsvFile({
    size: DEFAULT_LIMITS.maxBytes + 123,
    arrayBuffer: async () => { readAttempted = true; throw new Error('No debe leerse'); },
  });
  assert.equal(readAttempted, false);
  assert.equal(result.errors[0].code, 'MAX_BYTES_EXCEEDED');
  assert.equal(result.summary.inputBytes, DEFAULT_LIMITS.maxBytes + 123);
  assert.equal(result.canCommit, false);
}

// Los bytes UTF-8 inválidos no se convierten silenciosamente en texto reparado.
{
  const invalid = new Uint8Array([0xff]);
  const result = await previewCsvFile({ size: invalid.byteLength, arrayBuffer: async () => invalid.buffer });
  assert.ok(result.errors.some(error => error.code === 'INVALID_UTF8'));
}

// El render usa textContent y conserva el valor como texto, nunca como markup ejecutable.
{
  const hostileName = '<img src=x onerror=alert(1)>';
  const result = await previewCsvFile(csvFile(`${header}\nSKU-002,"${hostileName}",Accesorios,12000,25000,2\n`));
  const ids = {
    csvPreviewStatus: new FakeNode(),
    csvPreviewSummary: new FakeNode(),
    csvPreviewErrors: new FakeNode(),
    csvPreviewErrorList: new FakeNode('ul'),
    csvPreviewErrorsNote: new FakeNode(),
    csvPreviewRows: new FakeNode('tbody'),
    csvPreviewRowsNote: new FakeNode(),
  };
  const documentRef = new FakeDocument(ids);
  renderCsvPreviewResult(result, documentRef);
  assert.equal(ids.csvPreviewRows.children.length, 1);
  assert.equal(ids.csvPreviewRows.children[0].children[2].textContent, hostileName);
  assert.equal(ids.csvPreviewErrors.hidden, true);
  assert.match(ids.csvPreviewStatus.textContent, /No se guardó ni subió ningún dato/);
  assert.match(ids.csvPreviewSummary.textContent, /escritura: no/);
}

// Errores y nombres maliciosos también permanecen como texto dentro de nodos.
{
  const ids = {
    csvPreviewStatus: new FakeNode(),
    csvPreviewSummary: new FakeNode(),
    csvPreviewErrors: new FakeNode(),
    csvPreviewErrorList: new FakeNode('ul'),
    csvPreviewErrorsNote: new FakeNode(),
    csvPreviewRows: new FakeNode('tbody'),
    csvPreviewRowsNote: new FakeNode(),
  };
  const result = {
    rows: [],
    errors: [{ row: 2, field: 'name', message: '<script>alert(1)</script>' }],
    summary: { dataRows: 1, validRows: 0, errorCount: 1, inputBytes: 20, limits: DEFAULT_LIMITS },
    canCommit: false,
    dryRun: true,
    writePerformed: false,
  };
  renderCsvPreviewResult(result, new FakeDocument(ids));
  assert.equal(ids.csvPreviewErrors.hidden, false);
  assert.equal(ids.csvPreviewErrorList.children[0].textContent, 'Fila 2 · name: <script>alert(1)</script>');
}

// Un error tras campos multilinea informa tanto el registro lógico como la línea física exacta.
{
  const malformed = await previewCsvFile(csvFile(
    `${header}\nP-044,"Línea uno\nLínea dos",Ropa,1,2,1\nP-045,"Sin cierre\ncontinúa`,
  ));
  const ids = {
    csvPreviewErrors: new FakeNode(),
    csvPreviewErrorList: new FakeNode('ul'),
  };
  renderCsvPreviewResult(malformed, new FakeDocument(ids));
  assert.equal(ids.csvPreviewErrorList.children[0].textContent,
    'Fila 3 · línea física 5: El último campo entre comillas no tiene comilla de cierre.');

  const report = buildCsvPreviewReportCsv(malformed);
  const reportLines = report.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  assert.equal(countCsvFields(reportLines[0]), 16);
  assert.match(reportLines[0], /"fila","linea_fisica","campo"/);
  assert.equal(countCsvFields(reportLines[2]), 16);
  assert.match(reportLines[2], /,"3","5","","MALFORMED_CSV",/);
}

// El reporte no contiene filas de productos y neutraliza celdas de diagnóstico con fórmulas.
{
  const result = {
    rows: [{ code: 'SKU-MUST-NOT-EXPORT', name: 'Nombre privado de producto' }],
    errors: [
      { row: 2, field: 'name', code: 'FORMULA_NOT_ALLOWED', message: '@SUM(1,2)' },
      { row: 1, field: 'owner@example.com', code: 'UNKNOWN_HEADER', message: 'La columna owner@example.com no pertenece al contrato.' },
    ],
    summary: { inputBytes: 128, dataRows: 1, validRows: 0, invalidRows: 2, errorCount: 2, limits: DEFAULT_LIMITS },
    canCommit: false,
    dryRun: true,
    writePerformed: false,
  };
  const report = buildCsvPreviewReportCsv(result);
  assert.ok(report.startsWith('\uFEFF'));
  assert.match(report, /RESUMEN/);
  assert.ok(report.includes('"\'@SUM(1,2)"'));
  assert.ok(report.includes('"cabecera"'));
  assert.doesNotMatch(report, /SKU-MUST-NOT-EXPORT|Nombre privado de producto|owner@example\.com/);
  const reportLines = report.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  assert.equal(reportLines.length, 4);
  assert.ok(reportLines.every(line => countCsvFields(line) === 16));
  assert.throws(() => buildCsvPreviewReportCsv({ ...result, canCommit: true }), /dry-run/);
}

// El botón solo se habilita tras validar y la descarga se mantiene en un Blob local.
{
  const productCode = 'SKU-LOCAL-SECRET';
  const productName = 'Producto local que no debe ir al reporte';
  const fileInput = new FakeNode('input');
  fileInput.files = [csvFile(`${header}\n${productCode},"${productName}",Accesorios,12000,25000,2\n`)];
  const ids = {
    csvProductFile: fileInput,
    csvPreviewButton: new FakeNode('button'),
    csvPreviewClear: new FakeNode('button'),
    csvPreviewDownloadReport: new FakeNode('button'),
    csvPreviewStatus: new FakeNode(),
    csvPreviewSummary: new FakeNode(),
    csvPreviewErrors: new FakeNode(),
    csvPreviewErrorList: new FakeNode('ul'),
    csvPreviewErrorsNote: new FakeNode(),
    csvPreviewRows: new FakeNode('tbody'),
    csvPreviewRowsNote: new FakeNode(),
  };
  const documentRef = new FakeDocument(ids);
  let downloadedBlob = null;
  let revoked = false;
  const browserRef = {
    Blob: class {
      constructor(parts, options) { this.parts = parts; this.type = options.type; }
      async text() { return this.parts.join(''); }
    },
    URL: {
      createObjectURL(blob) { downloadedBlob = blob; return 'blob:local-csv-report'; },
      revokeObjectURL(url) { assert.equal(url, 'blob:local-csv-report'); revoked = true; },
    },
    setTimeout(callback) { callback(); return 1; },
  };

  initializeCsvPreviewUi(documentRef, browserRef);
  assert.equal(ids.csvPreviewDownloadReport.disabled, true);
  await ids.csvPreviewDownloadReport.trigger('click');
  assert.equal(downloadedBlob, null);

  await fileInput.trigger('change');
  await ids.csvPreviewButton.trigger('click');
  assert.equal(ids.csvPreviewDownloadReport.disabled, false);
  await ids.csvPreviewDownloadReport.trigger('click');

  const anchor = documentRef.createdNodes.find(node => node.tagName === 'a');
  assert.ok(anchor);
  assert.equal(anchor.download, 'sirevya-csv-preview-validation.csv');
  assert.equal(anchor.href, 'blob:local-csv-report');
  assert.equal(anchor.clicked, true);
  assert.equal(anchor.removed, true);
  assert.equal(revoked, true);
  const report = await downloadedBlob.text();
  assert.match(report, /RESUMEN/);
  assert.doesNotMatch(report, /SKU-LOCAL-SECRET|Producto local que no debe ir al reporte/);
  assert.match(ids.csvPreviewStatus.textContent, /descargado localmente/);

  await ids.csvPreviewClear.trigger('click');
  assert.equal(ids.csvPreviewDownloadReport.disabled, true);
}

// El módulo de integración no contiene clientes, almacenamiento ni solicitudes de red.
{
  const source = await readFile(new URL('../scripts/admin_csv_preview.mjs', import.meta.url), 'utf8');
  const adminHtml = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|supabase|\.rpc\s*\(|\.from\s*\(/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|sendBeacon|WebSocket|EventSource/i);
  assert.match(source, /URL\.createObjectURL/);
  assert.match(adminHtml, /id="csvPreviewDownloadReport"[^>]*disabled/);
  assert.match(adminHtml, /<script type="module" src="\.\/scripts\/admin_csv_preview\.mjs"><\/script>/);
}

console.log('OK admin_csv_preview_ui: lectura local, límites, duplicados existentes, UTF-8 y render sin HTML ni escritura.');
