import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [admin, migration] = await Promise.all([
  readFile(new URL('../admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20261114010000_web_order_tracking_and_change_log.sql', import.meta.url), 'utf8'),
]);

assert.match(admin, /id="orderTrackingModal"[^>]*aria-hidden="true"/);
assert.match(admin, /role="dialog" aria-modal="true" aria-labelledby="orderTrackingTitle"/);
assert.match(admin, /data-order-action="tracking"[^>]*\$\{webOrderTrackingRpcState==='ready'\?'':'disabled'\}/);
assert.match(admin, /admin_list_web_order_tracking/);
assert.match(admin, /admin_list_web_order_change_history/);
assert.match(admin, /admin_set_web_order_tracking/);
assert.match(admin, /function safeOrderTrackingUrl/);
assert.match(admin, /url\.protocol==='https:'/);
assert.match(admin, /\$\{esc\(tracking\.tracking_number\)\}/);
assert.match(admin, /target="_blank" rel="noopener noreferrer"/);
assert.match(admin, /webOrderTrackingRequestToken\+\+;webOrderHistoryRequestToken\+\+;webOrderTrackingSaveToken\+\+/);
assert.match(admin, /adminAuthOperationStillCurrent\(userId,authEpoch\)/);
assert.match(admin, /No se guardó la guía/);
assert.match(admin, /handleOrderTrackingDialogKeydown/);
assert.match(admin, /if\(event\.key==='Escape'\).*closeOrderTracking/s);
assert.match(admin, /focus\(\);\}/);
assert.doesNotMatch(admin.match(/<button type="button" class="softbtn" data-order-action="tracking"[^>]*>/)?.[0] || '', /onclick=/i);

assert.match(migration, /Candidate only/);
assert.match(migration, /no backfill/i);
assert.match(migration, /REFERENCES public\.web_orders\(id\) ON DELETE RESTRICT/);
assert.match(migration, /ALTER TABLE public\.web_order_tracking ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /ALTER TABLE public\.storefront_change_log ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /CREATE POLICY web_order_tracking_admin_read/);
assert.match(migration, /CREATE POLICY storefront_change_log_admin_read/);
assert.match(migration, /CREATE TRIGGER web_orders_change_log_after_write/);
assert.match(migration, /CREATE TRIGGER web_order_tracking_change_log_after_write/);
assert.match(migration, /SECURITY DEFINER/g);
assert.match(migration, /SET search_path = public, pg_temp/g);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_set_web_order_tracking\(uuid, text, text, text\) TO authenticated/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_set_web_order_tracking\(uuid, text, text, text\) FROM PUBLIC, anon, service_role/);
assert.match(migration, /TRACKING_URL_INVALID/);
assert.match(migration, /IS DISTINCT FROM/);

console.log('order_tracking_admin_ui_regression: PASS (admin-only gated controls, escaping, auth-epoch, RLS/trigger contract)');
