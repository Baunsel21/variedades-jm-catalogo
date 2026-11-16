import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const storefront = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20261116080000_admin_wompi_orders_readonly.sql', import.meta.url), 'utf8');

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_list_wompi_orders\(/);
assert.match(migration, /SECURITY DEFINER/i);
assert.match(migration, /SET search_path = pg_catalog, public, pg_temp/i);
assert.match(migration, /public\.is_store_admin\(\) IS DISTINCT FROM true/);
assert.match(migration, /WHERE lower\(coalesce\(o\.payment_method, ''\)\) = 'wompi'/);
assert.match(migration, /ORDER BY coalesce\(o\.updated_at, o\.created_at\) DESC/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_list_wompi_orders\(integer, integer\) FROM PUBLIC/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_list_wompi_orders\(integer, integer\) FROM anon/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_list_wompi_orders\(integer, integer\) TO authenticated/);
assert.doesNotMatch(migration, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im, 'la migración no altera filas comerciales');

assert.match(admin, /sb\.rpc\('admin_list_wompi_orders'/);
assert.match(admin, /id="wompiOrdersList"/);
assert.match(admin, /function renderAdminWompiOrders\(\)/);
assert.match(admin, /order\.payment_status/);
assert.match(admin, /order\.transaction_id/);
assert.match(admin, /getImageUrl\(item\.image_url\|\|product\?\.image_url/);
const wompiRenderer = admin.slice(admin.indexOf('function renderAdminWompiOrders()'), admin.indexOf('function updateOrderTrackingStatus()'));
assert.ok(wompiRenderer.length > 0);
assert.doesNotMatch(wompiRenderer, /data-order-action|admin_update_web_order_status|\.from\(['"]orders['"]\)\.update/,
  'los pedidos Wompi se presentan en solo lectura y no usan acciones COD');

assert.match(storefront, /payload\.checkout_request_id=activeWompiCheckoutRequestId/);
assert.match(storefront, /data\?\.code==='WOMPI_REQUEST_ID_REQUIRED'/);
const approvedHandlerStart = storefront.indexOf("if(data?.code==='WOMPI_ALREADY_APPROVED')");
const approvedHandlerEnd = storefront.indexOf("if(data?.code==='WOMPI_NEW_ORDER_CONFIRMATION_REQUIRED')", approvedHandlerStart);
assert.ok(approvedHandlerStart >= 0 && approvedHandlerEnd > approvedHandlerStart, 'debe detectar un pedido ya aprobado antes del manejador de pedidos terminales');
const approvedHandler = storefront.slice(approvedHandlerStart, approvedHandlerEnd);
assert.match(approvedHandler, /forgetReservationRecord\(approvedReference\)/);
assert.match(approvedHandler, /se conserva intacto/i);
assert.doesNotMatch(approvedHandler, /checkoutFetchWithTimeout|form\.submit\(\)/,
  'una aprobación existente nunca inicia automáticamente otro intento');
assert.match(storefront, /WOMPI_QUOTE_CHANGED/);
assert.match(storefront, /authoritativeServerQuote/);

console.log('admin_wompi_orders_visibility_regression: PASS');
