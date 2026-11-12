const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
const MIME_BY_EXTENSION = Object.freeze({
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
});
export const ZIP_IMAGE_LIMITS = Object.freeze({ maxBytes: 50 * 1024 * 1024, maxEntries: 500, maxImageBytes: 15 * 1024 * 1024 });

function u16(view, offset) { return view.getUint16(offset, true); }
function u32(view, offset) { return view.getUint32(offset, true); }
function normalizePath(value) {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!raw || raw.startsWith('/') || raw.includes('\0') || raw.split('/').some(part => part === '..' || part === '')) return '';
  const clean = raw.split('/').filter(Boolean).join('/');
  if (clean.length > 240 || /[\u0000-\u001f\u007f]/.test(clean)) return '';
  return clean;
}
function extension(path) {
  const value = String(path || '').toLowerCase();
  const match = value.match(/\.([a-z0-9]{1,8})$/);
  return match ? match[1] : '';
}
function stem(path) {
  const clean = String(path || '').split('/').pop() || '';
  return clean.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function keyVariants(value) {
  const raw = String(value || '').toLowerCase().normalize('NFKC').replace(/\.[a-z0-9]{1,8}$/, '');
  const base = raw.split('/').pop().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return [...new Set([raw, base, base.replace(/ /g, '_'), base.replace(/ /g, '-')].filter(Boolean))];
}
function findEndRecord(bytes) {
  const min = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= min; offset -= 1) {
    if (u32(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset) === 0x06054b50) return offset;
  }
  return -1;
}
function decodeName(bytes) { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('ZIP_DEFLATE_UNSUPPORTED');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const output = await new Response(stream).arrayBuffer();
  return new Uint8Array(output);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function readZipImageEntries(file, limits = ZIP_IMAGE_LIMITS) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('ZIP_FILE_REQUIRED');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > limits.maxBytes) throw new Error('ZIP_LIMIT_EXCEEDED');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndRecord(bytes);
  if (eocd < 0) throw new Error('ZIP_INVALID');
  const count = u16(view, eocd + 10);
  const centralSize = u32(view, eocd + 12);
  const centralOffset = u32(view, eocd + 16);
  if (!Number.isSafeInteger(count) || count < 1 || count > limits.maxEntries || centralOffset + centralSize > bytes.byteLength) throw new Error('ZIP_LIMIT_EXCEEDED');
  const entries = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.byteLength || u32(view, cursor) !== 0x02014b50) throw new Error('ZIP_INVALID');
    const flags = u16(view, cursor + 8);
    const method = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const crc = u32(view, cursor + 16);
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLength);
    const path = normalizePath(decodeName(nameBytes));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!path || path.endsWith('/') || (flags & 0x1) !== 0) continue;
    const ext = extension(path);
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    if (uncompressedSize > limits.maxImageBytes || compressedSize > bytes.byteLength) throw new Error('ZIP_IMAGE_LIMIT_EXCEEDED');
    entries.push({ path, ext, method, compressedSize, uncompressedSize, localOffset, crc });
  }
  if (!entries.length) throw new Error('ZIP_NO_IMAGES');
  return { bytes, entries };
}

export async function extractZipImage(zip, entry) {
  const view = new DataView(zip.bytes.buffer, zip.bytes.byteOffset, zip.bytes.byteLength);
  const offset = entry.localOffset;
  if (u32(view, offset) !== 0x04034b50) throw new Error('ZIP_INVALID');
  const nameLength = u16(view, offset + 26);
  const extraLength = u16(view, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = zip.bytes.slice(start, start + entry.compressedSize);
  const output = entry.method === 0 ? compressed : entry.method === 8 ? await inflateRaw(compressed) : null;
  if (!output || output.byteLength !== entry.uncompressedSize || crc32(output) !== entry.crc) throw new Error('ZIP_IMAGE_CORRUPT');
  return new File([output], entry.path.split('/').pop(), { type: MIME_BY_EXTENSION[entry.ext] || 'application/octet-stream' });
}

export function associateZipImages(rows, entries) {
  const byKey = new Map();
  for (const entry of entries) for (const key of keyVariants(stem(entry.path))) if (!byKey.has(key)) byKey.set(key, entry);
  return rows.map(row => {
    const keys = [row.code, row.name].flatMap(keyVariants);
    const main = keys.map(key => byKey.get(key)).find(Boolean) || null;
    const variants = Array.isArray(row.variants) ? row.variants.map(variant => {
      const variantKeys = [
        `${row.code} ${variant.color || ''} ${variant.size || ''}`,
        `${row.name} ${variant.color || ''} ${variant.size || ''}`,
      ].flatMap(keyVariants);
      const image = variantKeys.map(key => byKey.get(key)).find(Boolean) || null;
      return image ? { ...variant, zipImagePath: image.path } : variant;
    }) : [];
    return { ...row, zipImagePath: main?.path || '', variants };
  });
}

export function zipImageExtension(path) { return MIME_BY_EXTENSION[extension(path)] || ''; }
