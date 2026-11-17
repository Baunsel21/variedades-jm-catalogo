import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const migration = readFileSync(new URL('../supabase/migrations/20261117185200_wompi_rpc_service_role_permissions.sql', import.meta.url), 'utf8');
const link = readFileSync(new URL('../supabase/migrations/20261117162000_sandbox_wompi_atomic_transaction_link.sql', import.meta.url), 'utf8');
const recovery = readFileSync(new URL('../supabase/migrations/20261117171300_wompi_one_time_approved_recovery.sql', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../supabase/functions/admin-wompi-approved-recovery/index.ts', import.meta.url), 'utf8');
for (const fn of ['link_storefront_wompi_transaction(text, text)', 'recover_storefront_wompi_approved_payment_once(text, text, text, uuid, bigint)']) {
  assert.match(migration, new RegExp(`revoke execute on function public\\.${fn.replace(/[() ,]/g, m => '\\'+m)} from public, anon, authenticated`, 'i'));
  assert.match(migration, new RegExp(`grant execute on function public\\.${fn.replace(/[() ,]/g, m => '\\'+m)} to service_role`, 'i'));
}
assert.match(migration, /WOMPI_TRANSACTION_LINK_SERVICE_ROLE_REQUIRED/);
assert.match(link, /pg_advisory_xact_lock/);
assert.match(link, /WOMPI_TRANSACTION_LINK_CONFLICT/);
assert.match(recovery, /WOMPI_RECOVERY_SERVICE_ROLE_REQUIRED/);
assert.match(recovery, /already_processed/);
assert.match(admin, /recover_storefront_wompi_approved_payment_once/);
assert.match(admin, /const userToken = authorization\.match/);
assert.match(admin, /const key = serviceKey\(\)/);
assert.match(admin, /is_store_admin/);
console.log('PASS: permission revocation, service_role grants, internal guard, conflict/idempotency guards, and server-only caller contract');
