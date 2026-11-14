import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20261114010000_admin_suppliers_expenses.sql', import.meta.url), 'utf8');

for (const table of ['suppliers', 'expenses']) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  assert.match(migration, new RegExp(`${table}_admin_select`));
  assert.match(migration, new RegExp(`${table}_admin_insert`));
  assert.match(migration, new RegExp(`${table}_admin_delete`));
  assert.match(migration, new RegExp(`user_id = auth\\.uid\\(\\)`));
}
assert.match(migration, /REVOKE ALL ON TABLE public\.suppliers, public\.expenses FROM PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.suppliers, public\.expenses TO authenticated/);
assert.match(admin, /from\("suppliers"\)\.insert\(\{user_id:user\.id/);
assert.match(admin, /from\("expenses"\)\.insert\(\{user_id:user\.id/);
console.log('admin_suppliers_expenses_schema_regression: PASS (candidate only; no production DDL).');
