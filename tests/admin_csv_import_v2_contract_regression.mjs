import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [parser, adapter, admin, migration, runbook] = await Promise.all([
  readFile(new URL('../scripts/fase7_csv_preview.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/admin_csv_preview.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20261113010000_admin_csv_product_import_images_variants_v2.sql', import.meta.url), 'utf8'),
  readFile(new URL('../docs/deployment/csv-transactional-import-runbook.md', import.meta.url), 'utf8'),
]);

assert.match(parser, /schemaVersion === undefined \? 1/);
assert.match(parser, /PRODUCT_COLUMNS_V2/);
assert.match(parser, /isSafeCsvImageUrl/);
assert.match(parser, /https:/i);
assert.match(parser, /stockTotal !== quantity/);
assert.match(parser, /parsed\.length > 100/);
assert.match(adapter, /checkAdminCsvImportRpcReady\(schemaVersion\)/);
assert.match(adapter, /commitAdminCsvProducts\(payload, lastSchemaVersion\)/);
assert.match(adapter, /RPC v2.*no está disponible/i);
assert.match(admin, /admin_import_products_csv_v2/);
assert.match(admin, /csvPreviewSchemaVersion/);
assert.match(admin, /id="csvPreviewImportButton"[^>]*disabled/);

assert.match(migration, /Candidate only/i);
assert.match(migration, /CSV_V2_PREFLIGHT_AUTH_HELPER_MISSING/);
assert.match(migration, /CSV_V2_PREFLIGHT_PRODUCTS_RLS_DISABLED/);
assert.match(migration, /admin_import_products_csv_v2\(p_rows jsonb\)/);
assert.match(migration, /SECURITY INVOKER/);
assert.match(migration, /SET search_path = public, pg_temp/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_import_products_csv_v2\(jsonb\) FROM anon/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_import_products_csv_v2\(jsonb\) TO authenticated/);
assert.match(migration, /LOCK TABLE public\.products IN SHARE ROW EXCLUSIVE MODE/);
assert.doesNotMatch(migration, /ALTER TABLE public\.products/);
assert.match(runbook, /No está aplicado en producción/);
assert.match(runbook, /no sube archivos de imagen/);

console.log('admin_csv_import_v2_contract_regression: PASS (explicit v2, fail-closed RPC, SECURITY INVOKER candidate, v1 preserved)');
