import { DEFAULT_LIMITS, PRODUCT_COLUMNS, previewProductsCsv } from './fase7_csv_preview.mjs';

const MAX_VISIBLE_ROWS = 50;
const MAX_VISIBLE_ERRORS = 100;
const MAX_IMPORT_ROWS = 250;
// El RPC limita pg_column_size(jsonb) a 1 MiB. El preview limita el JSON UTF-8
// a 900 KiB para dejar margen al overhead binario de jsonb en PostgreSQL.
export const CONSERVATIVE_MAX_IMPORT_PAYLOAD_BYTES = 900 * 1024;
const CURRENCY_FORMAT = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
let previewGeneration = 0;
let lastPreviewResult = null;
let importRpcReady = false;

function buildImportPayload(rows) {
  return rows.map(row => ({
    row: row.row,
    code: row.code,
    name: row.name,
    category: row.category,
    cost: row.cost,
    sale_price: row.sale_price,
    quantity: row.quantity,
  }));
}

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
  const result = previewProductsCsv(bytes, { existingCodes });
  if (result.errors.length === 0 && result.rows.length > 0 && result.rows.length <= MAX_IMPORT_ROWS) {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(buildImportPayload(result.rows))).byteLength;
    result.summary.importPayloadBytes = payloadBytes;
    if (payloadBytes > CONSERVATIVE_MAX_IMPORT_PAYLOAD_BYTES) {
      result.errors.push({
        row: 0,
        field: 'archivo',
        code: 'IMPORT_LIMIT_EXCEEDED',
        message: 'El lote supera el límite preventivo de 900 KiB para la solicitud; reduce filas o campos.',
      });
      result.summary.errorCount += 1;
    }
  }
  return result;
}

const REPORT_FILENAME = 'sirevya-csv-preview-validation.csv';
const REPORT_COLUMNS = Object.freeze([
  'tipo', 'bytes_entrada', 'limite_bytes', 'limite_filas', 'filas_datos',
  'filas_validas', 'filas_invalidas', 'errores_totales', 'fila', 'linea_fisica', 'campo',
  'codigo', 'mensaje', 'puede_aplicar', 'dry_run', 'escritura_realizada',
]);
const REPORTABLE_FIELDS = new Set(PRODUCT_COLUMNS);
const HEADER_ERROR_MESSAGES = Object.freeze({
  UNKNOWN_HEADER: 'La cabecera no pertenece al contrato CSV permitido.',
  DUPLICATE_HEADER: 'Hay una cabecera duplicada; revisa los nombres de columnas.',
  VARIANT_DATA_NOT_SUPPORTED: 'La cabecera sugiere variantes, que no están admitidas en esta vista previa.',
});

function reportCell(value) {
  const text = String(value ?? '');
  const spreadsheetSafe = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${spreadsheetSafe.replace(/"/g, '""')}"`;
}

function reportCount(value, fallback = '') {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : fallback;
}

function reportErrorDetails(error) {
  const rawCode = String(error?.code ?? '');
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(rawCode) ? rawCode : 'VALIDATION_ERROR';
  const isHeaderError = Object.prototype.hasOwnProperty.call(HEADER_ERROR_MESSAGES, code);
  const field = REPORTABLE_FIELDS.has(error?.field) ? error.field : isHeaderError ? 'cabecera' : '';
  const message = HEADER_ERROR_MESSAGES[code] ?? String(error?.message ?? code ?? 'Error de validación.');
  return { code, field, message };
}

export function buildCsvPreviewReportCsv(result) {
  if (!result || result.canCommit !== false || result.writePerformed !== false || result.dryRun !== true) {
    throw new TypeError('El reporte solo acepta resultados dry-run sin escritura.');
  }

  const summary = result.summary || {};
  const limits = summary.limits || DEFAULT_LIMITS;
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const rows = [
    REPORT_COLUMNS,
    [
      'RESUMEN',
      reportCount(summary.inputBytes),
      reportCount(limits.maxBytes),
      reportCount(limits.maxRows),
      reportCount(summary.dataRows),
      reportCount(summary.validRows, Array.isArray(result.rows) ? result.rows.length : 0),
      reportCount(summary.invalidRows),
      reportCount(summary.errorCount, errors.length),
      '', '', '', '', '', false, true, false,
    ],
    ...errors.map(error => {
      const details = reportErrorDetails(error);
      return [
        'ERROR', '', '', '', '', '', '', '',
        reportCount(error?.row), reportCount(error?.physicalLine), details.field, details.code, details.message,
        false, true, false,
      ];
    }),
  ];

  return `\uFEFF${rows.map(row => row.map(reportCell).join(',')).join('\r\n')}\r\n`;
}

export function downloadCsvPreviewReport(result, documentRef = globalThis.document, browserRef = globalThis) {
  const csv = buildCsvPreviewReportCsv(result);
  if (!documentRef?.createElement || !documentRef.body?.appendChild ||
      typeof browserRef?.Blob !== 'function' || typeof browserRef?.URL?.createObjectURL !== 'function') {
    throw new TypeError('La descarga local no está disponible en este navegador.');
  }

  const blob = new browserRef.Blob([csv], { type: 'text/csv;charset=utf-8' });
  const objectUrl = browserRef.URL.createObjectURL(blob);
  const link = documentRef.createElement('a');
  link.href = objectUrl;
  link.download = REPORT_FILENAME;
  link.hidden = true;
  documentRef.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove?.();
    const revoke = () => browserRef.URL.revokeObjectURL?.(objectUrl);
    if (typeof browserRef.setTimeout === 'function') browserRef.setTimeout(revoke, 0);
    else revoke();
  }
  return { fileName: REPORT_FILENAME, csv };
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

  lastPreviewResult = result;
  const reportButton = documentRef.getElementById('csvPreviewDownloadReport');
  if (reportButton) reportButton.disabled = false;

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const summary = result.summary || {};
  const validRows = Number(summary.validRows) || rows.length;
  const dataRows = Number(summary.dataRows) || 0;
  const errorCount = Number(summary.errorCount) || errors.length;
  const importButton = documentRef.getElementById('csvPreviewImportButton');
  if (importButton) {
    const canImport = importRpcReady && errors.length === 0 && rows.length > 0 && rows.length <= MAX_IMPORT_ROWS &&
      typeof globalThis.commitAdminCsvProducts === 'function';
    importButton.disabled = !canImport;
  }

  const status = documentRef.getElementById('csvPreviewStatus');
  if (status) {
    if (errors.some(error => error.code === 'IMPORT_LIMIT_EXCEEDED' && error.field === 'archivo' &&
        Number.isFinite(Number(summary.importPayloadBytes)))) {
      status.textContent = 'El lote supera el límite preventivo de 900 KiB. Reduce filas o campos antes de importar; no se guardó ningún dato.';
    } else if (rows.length > MAX_IMPORT_ROWS && errorCount === 0) {
      status.textContent = `Vista previa lista: ${validRows} filas válidas de ${dataRows}; máximo 250 por lote de importación. No se guardó ningún dato.`;
    } else if (errors.length === 0 && rows.length > 0 && !importRpcReady) {
      status.textContent = `Vista previa lista: ${validRows} filas válidas. La importación transaccional aún no está disponible para esta sesión. No se guardó ni subió ningún dato.`;
    } else {
      status.textContent = `Vista previa lista: ${validRows} filas válidas de ${dataRows}; ${errorCount} errores. No se guardó ni subió ningún dato.`;
    }
  }

  const summaryNode = documentRef.getElementById('csvPreviewSummary');
  if (summaryNode) {
    const inputBytes = Number(summary.inputBytes);
    const limits = summary.limits || DEFAULT_LIMITS;
    const sizeText = Number.isFinite(inputBytes) ? `${inputBytes.toLocaleString('es-CO')} bytes` : 'tamaño no disponible';
    const payloadSize = Number(summary.importPayloadBytes);
    const payloadText = Number.isFinite(payloadSize)
      ? ` · payload JSON ${payloadSize.toLocaleString('es-CO')} / ${CONSERVATIVE_MAX_IMPORT_PAYLOAD_BYTES.toLocaleString('es-CO')} bytes`
      : '';
    summaryNode.textContent = `${sizeText} · Límite ${limits.maxBytes.toLocaleString('es-CO')} bytes / ${limits.maxRows.toLocaleString('es-CO')} filas${payloadText} · dry-run: sí · escritura: no`;
  }

  const errorList = documentRef.getElementById('csvPreviewErrorList');
  const errorNote = documentRef.getElementById('csvPreviewErrorsNote');
  const errorsBox = documentRef.getElementById('csvPreviewErrors');
  if (errorList) {
    errorList.replaceChildren();
    for (const error of errors.slice(0, MAX_VISIBLE_ERRORS)) {
      const item = documentRef.createElement('li');
      const logicalLocation = Number.isInteger(error.row) && error.row > 0 ? `Fila ${error.row}` : 'Archivo';
      const physicalLocation = Number.isInteger(error.physicalLine) && error.physicalLine > 0
        ? ` · línea física ${error.physicalLine}`
        : '';
      const field = error.field ? ` · ${error.field}` : '';
      item.textContent = `${logicalLocation}${physicalLocation}${field}: ${error.message || error.code || 'Error de validación.'}`;
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
        ? `Se muestran las ${rows.length} filas válidas; el lote solo se habilita si todo el archivo no tiene errores.`
        : 'No hay filas válidas para mostrar.';
  }
}

function resetCsvPreviewUi(documentRef) {
  lastPreviewResult = null;
  importRpcReady = false;
  const reportButton = documentRef.getElementById('csvPreviewDownloadReport');
  if (reportButton) reportButton.disabled = true;
  const importButton = documentRef.getElementById('csvPreviewImportButton');
  if (importButton) importButton.disabled = true;
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

export function initializeCsvPreviewUi(documentRef = globalThis.document, browserRef = globalThis) {
  lastPreviewResult = null;
  const fileInput = documentRef?.getElementById('csvProductFile');
  const previewButton = documentRef?.getElementById('csvPreviewButton');
  const clearButton = documentRef?.getElementById('csvPreviewClear');
  if (!fileInput || !previewButton || !clearButton) return;
  const downloadButton = documentRef.getElementById('csvPreviewDownloadReport');
  const importButton = documentRef.getElementById('csvPreviewImportButton');
  if (downloadButton) downloadButton.disabled = true;
  if (importButton) importButton.disabled = true;

  fileInput.addEventListener('change', () => {
    previewGeneration += 1;
    previewButton.disabled = false;
    if (importButton) importButton.disabled = true;
    resetCsvPreviewUi(documentRef);
    const status = documentRef.getElementById('csvPreviewStatus');
    if (status && fileInput.files?.[0]) status.textContent = 'Archivo listo. La previsualización se ejecuta solo en este navegador.';
  });

  previewButton.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    const generation = ++previewGeneration;
    lastPreviewResult = null;
    importRpcReady = false;
    if (downloadButton) downloadButton.disabled = true;
    if (importButton) importButton.disabled = true;
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
      let rpcReady = false;
      if (result.errors.length === 0 && result.rows.length > 0 && result.rows.length <= MAX_IMPORT_ROWS &&
          typeof globalThis.checkAdminCsvImportRpcReady === 'function') {
        try { rpcReady = await globalThis.checkAdminCsvImportRpcReady() === true; } catch { rpcReady = false; }
      }
      if (generation === previewGeneration) {
        importRpcReady = rpcReady;
        renderCsvPreviewResult(result, documentRef);
      }
    } catch {
      if (generation === previewGeneration && status) {
        status.textContent = 'No se pudo leer el archivo. No se envió ni guardó ningún dato.';
      }
    } finally {
      if (generation === previewGeneration) previewButton.disabled = false;
    }
  });

  downloadButton?.addEventListener('click', () => {
    if (!lastPreviewResult) return;
    const status = documentRef.getElementById('csvPreviewStatus');
    try {
      downloadCsvPreviewReport(lastPreviewResult, documentRef, browserRef);
      if (status) status.textContent = 'Reporte descargado localmente. No se importó ni se envió ningún dato.';
    } catch {
      if (status) status.textContent = 'No se pudo generar el reporte local. El CSV no se envió ni se guardó.';
    }
  });

  importButton?.addEventListener('click', async () => {
    const result = lastPreviewResult;
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const status = documentRef.getElementById('csvPreviewStatus');
    if (!importRpcReady || !result || result.errors?.length || rows.length < 1 || rows.length > MAX_IMPORT_ROWS ||
        typeof globalThis.commitAdminCsvProducts !== 'function') {
      if (status) status.textContent = 'No hay una vista previa válida para importar. Selecciona y previsualiza el archivo otra vez.';
      importButton.disabled = true;
      return;
    }
    if (typeof browserRef.confirm !== 'function' || !browserRef.confirm(
      `Se agregarán ${rows.length} productos nuevos. No se actualizarán productos existentes ni se importarán fotos o variantes. Si un código ya existe, el lote completo se rechazará. ¿Continuar?`,
    )) return;

    importButton.disabled = true;
    previewButton.disabled = true;
    clearButton.disabled = true;
    fileInput.disabled = true;
    if (status) status.textContent = `Enviando ${rows.length} filas validadas al importador transaccional…`;
    try {
      const payload = buildImportPayload(rows);
      const response = await globalThis.commitAdminCsvProducts(payload);
      if (response?.ok !== true) {
        const safeMessages = {
          DUPLICATE_CODE_IN_FILE: 'El código se repite dentro del archivo.',
          EXISTING_CODE: 'El código ya existe; no se modificó ningún producto.',
          CSV_FIELDS_NOT_ALLOWED: 'La fila contiene campos no permitidos.',
          CSV_TYPES_INVALID: 'Una fila contiene tipos de datos no válidos.',
          CSV_TEXT_INVALID: 'Código, nombre o categoría no cumplen la validación.',
          CSV_INTEGER_INVALID: 'Costo, precio o cantidad no cumplen la validación.',
          IMPORT_LIMIT_EXCEEDED: 'El lote supera los límites del importador.',
        };
        const serverErrors = Array.isArray(response?.errors) ? response.errors : [];
        const errors = serverErrors.slice(0, MAX_VISIBLE_ERRORS).map(error => ({
          row: Number.isSafeInteger(error?.row) && error.row > 0 ? error.row : null,
          field: ['archivo', 'fila', 'code', 'name', 'category', 'cost', 'sale_price', 'quantity'].includes(error?.field)
            ? error.field : null,
          code: Object.hasOwn(safeMessages, error?.code) ? error.code : 'IMPORT_REJECTED',
          message: safeMessages[error?.code] || 'El servidor rechazó el lote; no se confirmó ninguna importación.',
        }));
        lastPreviewResult = { ...result, errors: errors.length ? errors : [{ row: null, field: null, code: 'IMPORT_REJECTED', message: 'El servidor rechazó el lote; no se confirmó ninguna importación.' }] };
        renderCsvPreviewResult(lastPreviewResult, documentRef);
        if (status) status.textContent = 'El servidor rechazó el lote completo. No se aplicaron productos; corrige los errores y vuelve a previsualizar.';
        const summaryNode = documentRef.getElementById('csvPreviewSummary');
        if (summaryNode) summaryNode.textContent += ' · RPC rechazada antes de aplicar filas.';
        return;
      }

      const inserted = response?.inserted;
      if (!Number.isSafeInteger(inserted) || inserted !== rows.length) {
        lastPreviewResult = null;
        if (downloadButton) downloadButton.disabled = true;
        if (status) status.textContent = 'El servidor no confirmó un resultado completo. Actualiza el catálogo y vuelve a previsualizar antes de reintentar.';
        const summaryNode = documentRef.getElementById('csvPreviewSummary');
        if (summaryNode) summaryNode.textContent = summaryNode.textContent.replace(' · dry-run: sí · escritura: no', '') + ' · resultado de importación no confirmado.';
        return;
      }
      lastPreviewResult = null;
      if (downloadButton) downloadButton.disabled = true;
      if (status) status.textContent = `Importación confirmada: ${inserted} ${inserted === 1 ? 'producto nuevo' : 'productos nuevos'}.`;
      const summaryNode = documentRef.getElementById('csvPreviewSummary');
      if (summaryNode) summaryNode.textContent = summaryNode.textContent.replace(' · dry-run: sí · escritura: no', '') + ` · importación confirmada: ${inserted} nuevos.`;
      if (typeof globalThis.refreshAdminAfterCsvImport === 'function') {
        try {
          const refreshed = await globalThis.refreshAdminAfterCsvImport();
          if (refreshed === false && status) status.textContent += ' Actualiza el panel para recargar el catálogo.';
        } catch {
          if (status) status.textContent += ' Actualiza el panel para recargar el catálogo.';
        }
      }
    } catch {
      lastPreviewResult = null;
      if (downloadButton) downloadButton.disabled = true;
      if (status) status.textContent = 'No se confirmó el resultado. Actualiza el catálogo y vuelve a previsualizar antes de cualquier reintento.';
      const summaryNode = documentRef.getElementById('csvPreviewSummary');
      if (summaryNode) summaryNode.textContent = summaryNode.textContent.replace(' · dry-run: sí · escritura: no', '') + ' · resultado de importación no confirmado.';
    } finally {
      previewButton.disabled = false;
      clearButton.disabled = false;
      fileInput.disabled = false;
      importButton.disabled = true;
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
    document.addEventListener('DOMContentLoaded', () => initializeCsvPreviewUi(document, globalThis), { once: true });
  } else {
    initializeCsvPreviewUi(document, globalThis);
  }
}
