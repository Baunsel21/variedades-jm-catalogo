import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_LIMITS, PRODUCT_COLUMNS } from '../scripts/fase7_csv_preview.mjs';
import { previewCsvFile, renderCsvPreviewResult } from '../scripts/admin_csv_preview.mjs';

function csvFile(text) {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

class FakeNode {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.textContent = '';
    this.hidden = false;
  }
  appendChild(node) {
    this.children.push(node);
    return node;
  }
  replaceChildren(...nodes) {
    this.children = [...nodes];
  }
}

class FakeDocument {
  constructor(ids) {
    this.nodes = new Map(Object.entries(ids).map(([id, node]) => [id, node]));
  }
  getElementById(id) {
    return this.nodes.get(id) || null;
  }
  createElement(tagName) {
    return new FakeNode(tagName);
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

// El módulo de integración no contiene clientes, almacenamiento ni solicitudes de red.
{
  const source = await readFile(new URL('../scripts/admin_csv_preview.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|supabase|\.rpc\s*\(|\.from\s*\(/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|sendBeacon|WebSocket|EventSource/i);
}

console.log('OK admin_csv_preview_ui: lectura local, límites, duplicados existentes, UTF-8 y render sin HTML ni escritura.');
