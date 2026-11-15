import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
assert.match(source, /const adminUploadFileSnapshots=new WeakMap\(\)/);
assert.match(source, /async function snapshotAdminUploadFile\(file\)/);
assert.match(source, /async function warmAdminUploadFiles\(input,statusId=''\)/);
assert.match(source, /await snapshotAdminUploadFile\(file\)/);
assert.match(source, /FileReader/);
assert.match(source, /function repairAdminVariantConflicts\(\)/);
assert.match(source, /Resolver duplicadas/);
assert.match(source, /No se modificó ninguna variante/);
console.log('admin_mobile_image_upload_regression: PASS');
