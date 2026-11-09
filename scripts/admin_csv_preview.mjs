import { DEFAULT_LIMITS, previewProductsCsv } from './fase7_csv_preview.mjs';

const MAX_VISIBLE_ROWS = 50;
const MAX_VISIBLE_ERRORS = 100;
const CURRENCY_FORMAT = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
let previewGeneration = 0;

export async function previewCsvFile(file, existingCodes = []) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    return previewProductsCsv(null, { existingCodes });
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    return previewProductsCsv(null, { existingCodes });
  }
  if (file.size > DEFAULT_LIMITS.maxBytes) {
    const result = previewProductsCsv(new Uint8Array(DEFAULT_LIMITS.maxBytes + 1), { existingCodes });
    if (result.summary) result.summary.inputBytes = file.size;
    return result;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return previewProductsCsv(bytes, { existingCodes });
}

function formatCop(value) {
  return CURRENCY_FORMAT.format(value);
}

function appendCell(documentRef, row, value, heading = false) {
  const cell = documentRef.createElement(heading ? 'th' : 'td');
  cell.textContent = String(value ?? '');
  row.appendChild(cell);
}

export function renderCsvPreviewResult(result, documentRef = globalThis.document) {
  if (!documentRef) return;
  if (!result || result.canCommit !== false || result.writePerformed !== false || result.dryRun !== true) {
    throw new TypeError('La interfaz solo acepta resultados dry-run sin escritura.');
  }

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const summary = result.summary || {};
  const validRows = Number(summary.validRows) || rows.length;
  const dataRows = Number(summary.dataRows) || 0;
  const errorCount = Number(summary.errorCount) || errors.length;

  const status = documentRef.getElementById('csvPreviewStatus');
  if (status) {
    status.textContent = `Vista previa lista: ${validRows} filas válidas de ${dataRows}; ${errorCount} errores. No se guardó ni subió ningún dato.`;
  }

  const summaryNode = documentRef.getElementById('csvPreviewSummary');
  if (summaryNode) {
    const inputBytes = Number(summary.inputBytes);
    const limits = summary.limits || DEFAULT_LIMITS;
    const sizeText = Number.isFinite(inputBytes) ? `${inputBytes.toLocaleString('es-CO')} bytes` : 'tamaño no disponible';
    summaryNode.textContent = `${sizeText} · Límite ${limits.maxBytes.toLocaleString('es-CO')} bytes / ${limits.maxRows.toLocaleString('es-CO')} filas · dry-run: sí · escritura: no`;
  }

  const errorList = documentRef.getElementById('csvPreviewErrorList');
  const errorNote = documentRef.getElementById('csvPreviewErrorsNote');
  const errorsBox = documentRef.getElementById('csvPreviewErrors');
  if (errorList) {
    errorList.replaceChildren();
    for (const error of errors.slice(0, MAX_VISIBLE_ERRORS)) {
      const item = documentRef.createElement('li');
      const location = Number.isInteger(error.row) && error.row > 0 ? `Fila ${error.row}` : 'Archivo';
      const field = error.field ? ` · ${error.field}` : '';
      item.textContent = `${location}${field}: ${error.message || error.code || 'Error de validación.'}`;
      errorList.appendChild(item);
    }
  }
  if (errorNote) {
    errorNote.textContent = errors.length > MAX_VISIBLE_ERRORS
      ? `Se muestran ${MAX_VISIBLE_ERRORS} de ${errors.length} errores; el resumen incluye todas las filas.`
      : '';
  }
  if (errorsBox) errorsBox.hidden = errors.length === 0;

  const tableBody = documentRef.getElementById('csvPreviewRows');
  if (tableBody) {
    tableBody.replaceChildren();
    for (const item of rows.slice(0, MAX_VISIBLE_ROWS)) {
      const row = documentRef.createElement('tr');
      appendCell(documentRef, row, item.row);
      appendCell(documentRef, row, item.code);
      appendCell(documentRef, row, item.name);
      appendCell(documentRef, row, item.category);
      appendCell(documentRef, row, formatCop(item.cost));
      appendCell(documentRef, row, formatCop(item.sale_price));
      appendCell(documentRef, row, item.quantity);
      tableBody.appendChild(row);
    }
  }
  const rowsNote = documentRef.getElementById('csvPreviewRowsNote');
  if (rowsNote) {
    rowsNote.textContent = rows.length > MAX_VISIBLE_ROWS
      ? `Se muestran ${MAX_VISIBLE_ROWS} de ${rows.length} filas válidas; la validación cubrió el archivo completo.`
      : rows.length > 0
        ? `Se muestran las ${rows.length} filas válidas; no hay acción para aplicarlas.`
        : 'No hay filas válidas para mostrar.';
  }
}

function resetCsvPreviewUi(documentRef) {
  for (const id of ['csvPreviewSummary', 'csvPreviewErrorsNote', 'csvPreviewRowsNote']) {
    const node = documentRef.getElementById(id);
    if (node) node.textContent = '';
  }
  const status = documentRef.getElementById('csvPreviewStatus');
  if (status) status.textContent = 'Selecciona un CSV para revisar sus filas localmente.';
  const errorList = documentRef.getElementById('csvPreviewErrorList');
  if (errorList) errorList.replaceChildren();
  const errorsBox = documentRef.getElementById('csvPreviewErrors');
  if (errorsBox) errorsBox.hidden = true;
  const tableBody = documentRef.getElementById('csvPreviewRows');
  if (tableBody) tableBody.replaceChildren();
}

function initializeCsvPreviewUi() {
  const documentRef = globalThis.document;
  const fileInput = documentRef?.getElementById('csvProductFile');
  const previewButton = documentRef?.getElementById('csvPreviewButton');
  const clearButton = documentRef?.getElementById('csvPreviewClear');
  if (!fileInput || !previewButton || !clearButton) return;

  fileInput.addEventListener('change', () => {
    previewGeneration += 1;
    previewButton.disabled = false;
    resetCsvPreviewUi(documentRef);
    const status = documentRef.getElementById('csvPreviewStatus');
    if (status && fileInput.files?.[0]) status.textContent = 'Archivo listo. La previsualización se ejecuta solo en este navegador.';
  });

  previewButton.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    const generation = ++previewGeneration;
    const status = documentRef.getElementById('csvPreviewStatus');
    if (!file) {
      if (status) status.textContent = 'Selecciona un archivo CSV antes de previsualizar.';
      return;
    }
    previewButton.disabled = true;
    if (status) status.textContent = 'Leyendo y validando el archivo en este navegador…';
    try {
      const existingCodes = typeof globalThis.getAdminCsvPreviewExistingCodes === 'function'
        ? globalThis.getAdminCsvPreviewExistingCodes()
        : [];
      const result = await previewCsvFile(file, Array.isArray(existingCodes) ? existingCodes : []);
      if (generation === previewGeneration) renderCsvPreviewResult(result, documentRef);
    } catch {
      if (generation === previewGeneration && status) {
        status.textContent = 'No se pudo leer el archivo. No se envió ni guardó ningún dato.';
      }
    } finally {
      if (generation === previewGeneration) previewButton.disabled = false;
    }
  });

  clearButton.addEventListener('click', () => {
    previewGeneration += 1;
    fileInput.value = '';
    previewButton.disabled = false;
    resetCsvPreviewUi(documentRef);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCsvPreviewUi, { once: true });
  } else {
    initializeCsvPreviewUi();
  }
}
