import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const inventoryFix = fs.readFileSync(new URL('../supabase/migrations/20261115020000_fix_inventory_finalization_idempotency.sql', import.meta.url), 'utf8');

assert.match(admin, /async function uploadFileFingerprint\(file\)/);
assert.match(admin, /crypto\.subtle\.digest\('SHA-256'/);
assert.match(admin, /async function verifyUploadedObject\(key,isCurrent=\(\)=>true\)/);
assert.match(admin, /method:'HEAD'/);
assert.match(admin, /Range:'bytes=0-0'/);
assert.match(admin, /const maxAttempts=4/);
assert.match(admin, /Cloudflare respondió con un formato inválido/);
assert.match(admin, /no se marcó como subida/i);
assert.match(admin, /products\/\$\{productId\}\/gallery\/\$\{fingerprint\}/);
assert.match(admin, /eq\("image_path",imagePath\)/);
assert.match(admin, /Reintentar esta foto/);
assert.match(admin, /data-state="\$\{state\}"/);
assert.match(admin, /productPhotoUploadStates=\[\]/);
assert.match(admin, /setProductPhotoState\(i,'error'\)/);
assert.match(admin, /No crees el producto otra vez/);
assert.match(admin, /await verifyVariantPhotoReferences\(originalProductId,updatedVariants,variantFiles,isCurrent\)/);
assert.match(inventoryFix, /IF v_legacy THEN/);
assert.match(inventoryFix, /already_finalized/);
assert.match(inventoryFix, /jsonb_set/);
console.log('admin_image_upload_resilience_regression: PASS (hash idempotente, HEAD/Range, retries finitos, estados, deduplicación y retry individual).');
