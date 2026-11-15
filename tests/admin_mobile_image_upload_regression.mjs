import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
assert.match(source, /const uploadFileSnapshots=new WeakMap\(\)/);
assert.match(source, /async function stableUploadFile\(file\)/);
assert.match(source, /const stableFile=await stableUploadFile\(file\)/);
assert.match(source, /primeUploadFileSnapshot\(file\)/);
assert.match(source, /function repairAdminVariantConflicts\(\)/);
assert.match(source, /Resolver duplicadas/);
assert.match(source, /No se modificó ninguna variante/);
console.log('admin_mobile_image_upload_regression: PASS');
