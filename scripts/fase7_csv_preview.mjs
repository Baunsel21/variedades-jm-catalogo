/**
 * Previsualización/dry-run de productos CSV para Fase 7.
 *
 * Este módulo no importa Supabase, red, navegador, filesystem ni una capa de
 * persistencia. Solo decodifica y valida una entrada recibida por el llamador.
 * El resultado siempre es canCommit:false: la importación real queda fuera de
 * este contrato y debe implementar su propia transacción/staging.
 */

export const PRODUCT_COLUMNS = Object.freeze([
  'code',
  'name',
  'category',
  'cost',
  'sale_price',
  'quantity',
]);

// Contrato opt-in. v1 permanece como default y sigue rechazando estos campos.
export const PRODUCT_COLUMNS_V2 = Object.freeze([
  ...PRODUCT_COLUMNS,
  'image_url',
  'variants',
]);

export const DEFAULT_LIMITS = Object.freeze({
  // Límites de seguridad de esta previsualización; no son reglas comerciales.
  maxBytes: 5 * 1024 * 1024,
  maxRows: 10_000,
});

const MAX_TEXT_BYTES = 4096;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const FORMULA_START = /^[=+@]/;
const FORMULA_MINUS_START = /^-(?!\d+$)/;
const FORMULA_PLUS_START = /^\+(?!\d+$)/;
const VARIANT_HEADER_HINT = /(variant|sku|talla|size|color|colour|option|opcion)/i;

function makeError(row, code, message, field = null, details = {}) {
  return {
    row,
    field,
    code,
    message,
    ...details,
  };
}

function baseResult(overrides = {}) {
  return {
    rows: [],
    errors: [],
    canCommit: false,
    dryRun: true,
    writePerformed: false,
    message: 'Previsualización dry-run: no se escribe en base de datos.',
    ...overrides,
    // Estos campos son invariantes aunque un llamador intente sobrescribirlos.
    canCommit: false,
    dryRun: true,
    writePerformed: false,
  };
}

function resultSummary(inputBytes, dataRows, validRows, errors, limits, extra = {}) {
  const errorRows = new Set(
    errors.filter(error => Number.isInteger(error.row) && error.row > 0).map(error => error.row),
  );
  return {
    inputBytes,
    dataRows,
    validRows,
    invalidRows: errorRows.size,
    errorCount: errors.length,
    limits,
    ...extra,
  };
}

function readLimit(value, fallback) {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function looksLikeFormula(value) {
  const text = String(value ?? '').trim();
  if (text === '') return false;
  if (FORMULA_START.test(text)) return true;
  if (FORMULA_MINUS_START.test(text)) return true;
  if (FORMULA_PLUS_START.test(text)) return true;
  return false;
}

function decodeInput(input) {
  if (typeof input === 'string') {
    const bytes = new TextEncoder().encode(input);
    return { text: input, bytes: bytes.byteLength };
  }

  let bytes;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else {
    return {
      error: makeError(
        0,
        'INVALID_INPUT',
        'La entrada debe ser texto UTF-8, Uint8Array o ArrayBuffer.',
      ),
    };
  }

  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      bytes: bytes.byteLength,
    };
  } catch {
    return {
      error: makeError(0, 'INVALID_UTF8', 'La entrada contiene bytes UTF-8 inválidos.'),
    };
  }
}

function finishCsvRecord(records, fields, field, rowStartLine, sawContent) {
  // Una línea completamente vacía, incluida la final producida por un salto,
  // no es un producto. Una fila de comas sí tiene sawContent=true y se valida.
  if (!sawContent && fields.length === 0 && field === '') return;
  records.push({
    fields: [...fields, field],
    startLine: rowStartLine,
  });
}

/**
 * Parser CSV RFC 4180 estricto, con comas, comillas dobles, saltos internos y
 * terminadores LF/CRLF/CR. Devuelve registros lógicos, no ejecuta contenido.
 */
function parseCsvRecords(text) {
  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let afterClosingQuote = false;
  let sawContent = false;
  let rowStartLine = 1;
  let physicalLine = 1;

  const malformed = (message, line = physicalLine) => ({
    error: makeError(records.length + 1, 'MALFORMED_CSV', message, null, { physicalLine: line }),
  });

  const startNextRecord = () => {
    fields = [];
    field = '';
    inQuotes = false;
    afterClosingQuote = false;
    sawContent = false;
    rowStartLine = physicalLine;
  };

  const endRecord = () => {
    finishCsvRecord(records, fields, field, rowStartLine, sawContent);
    fields = [];
    field = '';
    inQuotes = false;
    afterClosingQuote = false;
    sawContent = false;
    rowStartLine = physicalLine;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
        continue;
      }
      if (character === '\r') {
        field += '\r';
        if (text[index + 1] === '\n') {
          field += '\n';
          index += 1;
        }
        physicalLine += 1;
        continue;
      }
      if (character === '\n') {
        field += '\n';
        physicalLine += 1;
        continue;
      }
      field += character;
      continue;
    }

    if (afterClosingQuote) {
      if (character === ',') {
        fields.push(field);
        field = '';
        afterClosingQuote = false;
        sawContent = true;
        continue;
      }
      if (character === '\r' || character === '\n') {
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        if (character === '\r' || character === '\n') physicalLine += 1;
        endRecord();
        continue;
      }
      return malformed(
        'Hay contenido después de una comilla de cierre; se esperaba coma o salto de línea.',
        physicalLine,
      );
    }

    if (character === '"') {
      // Una comilla solo puede iniciar un campo; `abc"def` no es CSV válido.
      if (field !== '') {
        return malformed('Una comilla apareció dentro de un campo no entrecomillado.', physicalLine);
      }
      inQuotes = true;
      sawContent = true;
      continue;
    }

    if (character === ',') {
      fields.push(field);
      field = '';
      sawContent = true;
      continue;
    }

    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      physicalLine += 1;
      endRecord();
      continue;
    }

    field += character;
    sawContent = true;
  }

  if (inQuotes) {
    return malformed('El último campo entre comillas no tiene comilla de cierre.', physicalLine);
  }
  if (afterClosingQuote || sawContent || fields.length > 0 || field !== '') {
    finishCsvRecord(records, fields, field, rowStartLine, sawContent);
  }
  return { records };
}

function isVariantHeader(header) {
  return VARIANT_HEADER_HINT.test(header.replace(/[\s_-]+/g, ''));
}

function normalizeOptions(options, legacyOptions) {
  // La forma documentada es options.existingCodes. Se acepta también un
  // iterable como segundo argumento para que el helper sea cómodo de integrar.
  const looksLikeExistingCodes =
    typeof options === 'string' ||
    Array.isArray(options) ||
    options instanceof Set ||
    options instanceof Map;
  if (looksLikeExistingCodes) {
    return { ...(legacyOptions ?? {}), existingCodes: options };
  }
  return options && typeof options === 'object' ? options : {};
}

function getExistingCodes(value) {
  if (value === undefined || value === null) return { set: new Set() };
  const values = typeof value === 'string' ? [value] : value;
  if (!values || typeof values[Symbol.iterator] !== 'function') {
    return {
      error: makeError(0, 'INVALID_EXISTING_CODES', 'existingCodes debe ser iterable o una cadena.'),
    };
  }
  const set = new Set();
  for (const code of values) set.add(normalizeCode(code));
  return { set };
}

function validateText(value, field, row, errors) {
  const text = String(value ?? '');
  if (text.trim() === '') {
    errors.push(makeError(row, 'REQUIRED_FIELD', `${field} es obligatorio.`, field));
    return false;
  }
  if (looksLikeFormula(text)) {
    errors.push(
      makeError(
        row,
        'FORMULA_NOT_ALLOWED',
        `${field} parece una fórmula y se rechaza sin evaluarla.`,
        field,
      ),
    );
    return false;
  }
  if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) {
    errors.push(makeError(
      row,
      'CSV_TEXT_INVALID',
      `${field} supera el máximo de ${MAX_TEXT_BYTES} bytes UTF-8.`,
      field,
    ));
    return false;
  }
  return true;
}

function parseNonNegativeInteger(value, field, row, errors, label) {
  const text = String(value ?? '').trim();
  if (text === '') {
    errors.push(makeError(row, 'REQUIRED_FIELD', `${field} es obligatorio.`, field));
    return null;
  }
  // Un signo negativo seguido solo de dígitos conserva el diagnóstico de valor
  // negativo; cualquier expresión/signo no entero se marca como fórmula o texto.
  if (looksLikeFormula(text) && !/^-?\d+$/.test(text)) {
    errors.push(
      makeError(
        row,
        'FORMULA_NOT_ALLOWED',
        `${field} parece una fórmula y no se evalúa ni se convierte a cero.`,
        field,
      ),
    );
    return null;
  }
  if (!/^\d+$/.test(text)) {
    errors.push(
      makeError(row, 'INVALID_INTEGER', `${field} debe ser un ${label} entero no negativo.`, field),
    );
    return null;
  }

  let integer;
  try {
    integer = BigInt(text);
  } catch {
    errors.push(makeError(row, 'INVALID_INTEGER', `${field} debe ser un entero válido.`, field));
    return null;
  }
  if (integer > MAX_SAFE_INTEGER_BIGINT) {
    errors.push(
      makeError(row, 'INTEGER_OUT_OF_RANGE', `${field} supera el rango entero seguro de JavaScript.`, field),
    );
    return null;
  }
  return Number(integer);
}

function isSafeCsvImageUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  if (new TextEncoder().encode(text).byteLength > 2048 || /[\\\s\u0000-\u001f]/.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function parseCsvVariantList(value, row, quantity, errors) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    errors.push(makeError(row, 'VARIANTS_INVALID', 'Las variantes deben ser un arreglo JSON válido.', 'variants'));
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length > 100) {
    errors.push(makeError(row, 'VARIANTS_INVALID', 'Las variantes admiten un arreglo de hasta 100 combinaciones.', 'variants'));
    return [];
  }
  const allowed = new Set(['color', 'size', 'stock', 'color_hex', 'image_path']);
  const seen = new Set();
  const variants = [];
  let stockTotal = 0;
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !allowed.has(key)) ||
        typeof item.color !== 'string' || typeof item.size !== 'string' || !Number.isSafeInteger(item.stock) || item.stock < 0 || item.stock > 2147483647) {
      errors.push(makeError(row, 'VARIANTS_INVALID', 'Cada variante requiere color/talla de texto y stock entero no negativo; solo se permiten color_hex e image_path opcionales.', 'variants'));
      return [];
    }
    const color = item.color.trim(), size = item.size.trim();
    if ((!color && !size) || (color && (!validateText(color, 'variants.color', row, errors))) ||
        (size && (!validateText(size, 'variants.size', row, errors)))) {
      errors.push(makeError(row, 'VARIANTS_INVALID', 'Color y talla no pueden estar vacíos al mismo tiempo ni parecer una fórmula.', 'variants'));
      return [];
    }
    if (item.color_hex !== undefined && (typeof item.color_hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(item.color_hex))) {
      errors.push(makeError(row, 'VARIANTS_INVALID', 'color_hex debe tener formato #RRGGBB.', 'variants'));
      return [];
    }
    if (item.image_path !== undefined && (typeof item.image_path !== 'string' || !isSafeCsvImageUrl(item.image_path))) {
      errors.push(makeError(row, 'VARIANTS_INVALID', 'image_path solo admite una URL HTTPS segura.', 'variants'));
      return [];
    }
    const key = `${normalizeCode(color)}||${normalizeCode(size)}`;
    if (seen.has(key)) {
      errors.push(makeError(row, 'VARIANTS_INVALID', 'La fila repite una combinación de color y talla.', 'variants'));
      return [];
    }
    seen.add(key);
    stockTotal += item.stock;
    if (!Number.isSafeInteger(stockTotal)) {
      errors.push(makeError(row, 'VARIANTS_INVALID', 'La suma de stock por variante supera el rango entero seguro.', 'variants'));
      return [];
    }
    const variant = { color, size, stock: item.stock };
    if (item.color_hex !== undefined) variant.color_hex = item.color_hex.toLowerCase();
    if (item.image_path) variant.image_path = item.image_path.trim();
    variants.push(variant);
  }
  if (variants.length && stockTotal !== quantity) {
    errors.push(makeError(row, 'VARIANTS_STOCK_MISMATCH', 'La suma del stock de variantes debe coincidir con quantity.', 'variants'));
    return [];
  }
  return variants;
}

function validateLimits(options) {
  const limitSource = options.limits && typeof options.limits === 'object' ? options.limits : options;
  const maxBytes = readLimit(limitSource.maxBytes, DEFAULT_LIMITS.maxBytes);
  const maxRows = readLimit(limitSource.maxRows, DEFAULT_LIMITS.maxRows);
  if (maxBytes === null || maxRows === null) {
    return {
      error: makeError(
        0,
        'INVALID_LIMIT',
        'maxBytes y maxRows deben ser enteros seguros no negativos.',
      ),
    };
  }
  return { limits: { maxBytes, maxRows } };
}

/**
 * Previsualiza un CSV de productos sin escribir ni conectarse a ningún sistema.
 *
 * @param {string|Uint8Array|ArrayBuffer} input CSV UTF-8.
 * @param {object|Iterable<string>} [options] Opciones o existingCodes legacy.
 * @param {object} [legacyOptions] Opciones cuando el segundo argumento es existingCodes.
 * @returns {{rows: Array, errors: Array, canCommit: false, dryRun: true, writePerformed: false}}
 */
export function previewProductsCsv(input, options = {}, legacyOptions = {}) {
  const resolvedOptions = normalizeOptions(options, legacyOptions);
  const schemaVersion = resolvedOptions.schemaVersion === undefined ? 1 : Number(resolvedOptions.schemaVersion);
  if (![1, 2].includes(schemaVersion)) {
    const error = makeError(0, 'INVALID_SCHEMA_VERSION', 'La versión del contrato CSV debe ser 1 o 2.');
    return baseResult({ errors: [error] });
  }
  const columns = schemaVersion === 2 ? PRODUCT_COLUMNS_V2 : PRODUCT_COLUMNS;
  const limitsResult = validateLimits(resolvedOptions);
  if (limitsResult.error) return baseResult({ errors: [limitsResult.error] });
  const { limits } = limitsResult;

  const decoded = decodeInput(input);
  if (decoded.error) return baseResult({ errors: [decoded.error] });
  if (decoded.bytes > limits.maxBytes) {
    const error = makeError(
      0,
      'MAX_BYTES_EXCEEDED',
      `El CSV supera el límite UTF-8 de ${limits.maxBytes} bytes.`,
      null,
      { inputBytes: decoded.bytes, maxBytes: limits.maxBytes },
    );
    return baseResult({
      errors: [error],
      summary: resultSummary(decoded.bytes, 0, 0, [error], limits),
    });
  }

  let text = decoded.text;
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  if (text === '') {
    const error = makeError(1, 'EMPTY_CSV', 'El CSV está vacío.');
    return baseResult({
      errors: [error],
      summary: resultSummary(decoded.bytes, 0, 0, [error], limits),
    });
  }

  const parsed = parseCsvRecords(text);
  if (parsed.error) {
    const error = parsed.error;
    return baseResult({
      errors: [error],
      summary: resultSummary(decoded.bytes, 0, 0, [error], limits),
    });
  }
  if (parsed.records.length === 0) {
    const error = makeError(1, 'EMPTY_CSV', 'El CSV no contiene registros.');
    return baseResult({
      errors: [error],
      summary: resultSummary(decoded.bytes, 0, 0, [error], limits),
    });
  }

  const headerRecord = parsed.records[0];
  const headers = headerRecord.fields.map(value => String(value).trim());
  const headerErrors = [];
  const headerIndex = new Map();

  headers.forEach((header, index) => {
    if (headerIndex.has(header)) {
      headerErrors.push(
        makeError(1, 'DUPLICATE_HEADER', `La cabecera ${header || '(vacía)'} está duplicada.`, header || null, {
          column: index + 1,
        }),
      );
      return;
    }
    headerIndex.set(header, index);
    if (!columns.includes(header)) {
      const code = isVariantHeader(header) ? 'VARIANT_DATA_NOT_SUPPORTED' : 'UNKNOWN_HEADER';
      const message =
        code === 'VARIANT_DATA_NOT_SUPPORTED'
          ? `La columna ${header || '(vacía)'} sugiere datos de variantes; el contrato no importa variantes.`
          : `La columna ${header || '(vacía)'} no pertenece al contrato CSV de productos.`;
      headerErrors.push(makeError(1, code, message, header || null, { column: index + 1 }));
    }
  });

  for (const requiredHeader of columns) {
    if (!headerIndex.has(requiredHeader)) {
      headerErrors.push(
        makeError(1, 'MISSING_HEADER', `Falta la cabecera obligatoria ${requiredHeader}.`, requiredHeader),
      );
    }
  }

  const dataRecords = parsed.records.slice(1);
  if (headerErrors.length > 0) {
    return baseResult({
      errors: headerErrors,
      summary: resultSummary(decoded.bytes, dataRecords.length, 0, headerErrors, limits, {
        headerValid: false,
      }),
    });
  }

  if (dataRecords.length > limits.maxRows) {
    const error = makeError(
      0,
      'MAX_ROWS_EXCEEDED',
      `El CSV contiene ${dataRecords.length} filas de datos; el límite es ${limits.maxRows}.`,
      null,
      { dataRows: dataRecords.length, maxRows: limits.maxRows },
    );
    return baseResult({
      errors: [error],
      summary: resultSummary(decoded.bytes, dataRecords.length, 0, [error], limits, {
        headerValid: true,
      }),
    });
  }

  const existingResult = getExistingCodes(resolvedOptions.existingCodes);
  if (existingResult.error) {
    return baseResult({
      errors: [existingResult.error],
      summary: resultSummary(decoded.bytes, dataRecords.length, 0, [existingResult.error], limits, {
        headerValid: true,
      }),
    });
  }

  const existingCodes = existingResult.set;
  const seenCodes = new Set();
  const rows = [];
  const errors = [];
  const indexOf = field => headerIndex.get(field);

  dataRecords.forEach((record, recordIndex) => {
    const rowNumber = recordIndex + 2;
    const rowErrors = [];
    const fields = record.fields;

    if (fields.length !== columns.length) {
      rowErrors.push(
        makeError(
          rowNumber,
          'COLUMN_COUNT',
          `La fila tiene ${fields.length} columnas; se esperan ${columns.length}.`,
          null,
          { expectedColumns: columns.length, receivedColumns: fields.length },
        ),
      );
    }

    const values = Object.fromEntries(
      columns.map(field => [field, fields[indexOf(field)] ?? '']),
    );
    const code = String(values.code).trim();
    const normalized = normalizeCode(code);

    if (!validateText(code, 'code', rowNumber, rowErrors)) {
      // El código inválido no participa en el conjunto de duplicados.
    } else if (seenCodes.has(normalized)) {
      rowErrors.push(
        makeError(rowNumber, 'DUPLICATE_CODE', 'El código se repite dentro del CSV.', 'code'),
      );
    } else if (existingCodes.has(normalized)) {
      rowErrors.push(
        makeError(rowNumber, 'EXISTING_CODE', 'El código ya existe en existingCodes.', 'code'),
      );
    }
    if (normalized !== '') seenCodes.add(normalized);

    const name = String(values.name);
    const category = String(values.category);
    validateText(name, 'name', rowNumber, rowErrors);
    validateText(category, 'category', rowNumber, rowErrors);

    const cost = parseNonNegativeInteger(values.cost, 'cost', rowNumber, rowErrors, 'valor COP');
    const salePrice = parseNonNegativeInteger(
      values.sale_price,
      'sale_price',
      rowNumber,
      rowErrors,
      'valor COP',
    );
    const quantity = parseNonNegativeInteger(
      values.quantity,
      'quantity',
      rowNumber,
      rowErrors,
      'quantity',
    );

    let imageUrl = '';
    let variants = [];
    if (schemaVersion === 2) {
      imageUrl = String(values.image_url ?? '').trim();
      if (!isSafeCsvImageUrl(imageUrl)) {
        rowErrors.push(makeError(rowNumber, 'IMAGE_URL_INVALID', 'image_url debe estar vacío o ser una URL HTTPS sin credenciales.', 'image_url'));
      }
      variants = parseCsvVariantList(values.variants, rowNumber, quantity, rowErrors);
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    rows.push({
      row: rowNumber,
      code,
      name,
      category,
      cost,
      sale_price: salePrice,
      quantity,
      ...(schemaVersion === 2 ? { image_url: imageUrl, variants } : {}),
    });
  });

  return baseResult({
    rows,
    errors,
    summary: resultSummary(decoded.bytes, dataRecords.length, rows.length, errors, limits, {
      headerValid: true,
    }),
  });
}

// Alias explícito para integradores que nombren el recurso en singular.
export const previewProductCsv = previewProductsCsv;

export default Object.freeze({
  PRODUCT_COLUMNS,
  PRODUCT_COLUMNS_V2,
  DEFAULT_LIMITS,
  normalizeCode,
  previewProductsCsv,
  previewProductCsv,
});

/** Normalización local usada solo para detectar códigos repetidos. */
export function normalizeCode(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}
