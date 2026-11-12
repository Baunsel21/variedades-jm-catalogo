import assert from 'node:assert/strict';
import { associateZipImages, extractZipImage, readZipImageEntries } from '../scripts/csv_zip_images.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function storedZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name);
    const body = Buffer.from(data);
    const crc = crc32(body);
    const local = Buffer.alloc(30 + nameBytes.length + body.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30); body.copy(local, 30 + nameBytes.length);
    chunks.push(local);
    const entry = Buffer.alloc(46 + nameBytes.length);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0, 8);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(body.length, 24); entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42); nameBytes.copy(entry, 46);
    central.push(entry); offset += local.length;
  }
  const centralBody = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBody.length, 12); eocd.writeUInt32LE(offset, 16);
  return new File([Buffer.concat([...chunks, centralBody, eocd])], 'images.zip', { type: 'application/zip' });
}

const zipFile = storedZip([
  { name: 'SKU-001.jpg', data: 'main image' },
  { name: 'SKU-001_Rojo_S.png', data: 'red small' },
  { name: 'SKU-001_Azul_M.webp', data: 'blue medium' },
  { name: 'not-an-image.txt', data: 'ignored' },
]);
const zip = await readZipImageEntries(zipFile);
assert.equal(zip.entries.length, 3);
const rows = associateZipImages([
  { code: 'SKU-001', name: 'Vestido', variants: [
    { color: 'Rojo', size: 'S', stock: 1 },
    { color: 'Azul', size: 'M', stock: 1 },
  ] },
], zip.entries);
assert.equal(rows[0].zipImagePath, 'SKU-001.jpg');
assert.equal(rows[0].variants[0].zipImagePath, 'SKU-001_Rojo_S.png');
assert.equal(rows[0].variants[1].zipImagePath, 'SKU-001_Azul_M.webp');
const extracted = await extractZipImage(zip, zip.entries[1]);
assert.equal(extracted.name, 'SKU-001_Rojo_S.png');
assert.equal(await extracted.text(), 'red small');
await assert.rejects(() => readZipImageEntries(new File([Buffer.alloc(10)], 'bad.zip')), /ZIP_INVALID/);
console.log('csv_zip_images_regression: PASS');
