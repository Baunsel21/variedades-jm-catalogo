import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const [admin, store, migration] = await Promise.all([
  readFile(new URL('admin.html', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('supabase/migrations/20261110010000_storefront_coupon_feature_toggle.sql', root), 'utf8'),
]);

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function ${name}\\(`));
  assert.notEqual(start, -1, `missing function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`unclosed function ${name}`);
}

assert.match(admin, /id="storefrontCouponFeatureEnabled"[^>]*disabled/);
assert.match(admin, /id="saveStorefrontCouponFeatureBtn"[^>]*disabled/);
assert.match(admin, /sb\.rpc\('get_public_storefront_coupon_settings'\)/);
assert.match(admin, /sb\.rpc\('admin_set_storefront_coupons_enabled',\{p_enabled:next\}\)/);
assert.match(admin, /loadStorefrontCouponFeatureSettingsAdmin\(true\)/);
assert.match(admin, /resetStorefrontCouponFeatureSettingsAdmin\(\)/);
const couponListLoader = extractFunction(admin, 'loadStorefrontCouponsAdmin');
assert.match(couponListLoader, /sb\.rpc\('admin_list_storefront_coupons'\)/);
assert.match(couponListLoader, /setStorefrontCouponFormDisabled\(false\)/, 'el CRUD individual se habilita tras su propia lectura admin aunque falte el toggle global');
assert.doesNotMatch(couponListLoader, /storefrontCouponFeatureSettingsLoaded/, 'la gestión individual no depende de la RPC del toggle global');
assert.match(admin, /20261110010000_storefront_coupon_feature_toggle\.sql/);
assert.match(store, /id="checkoutCouponBox"[^>]*hidden/);
assert.match(store, /id="couponCode"[^>]*aria-describedby="couponStatus" disabled/);
assert.doesNotMatch(store, /placeholder="EJ\. BIENVENIDA"/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_storefront_cart_quote_with_coupon\(/);
assert.match(migration, /p_coupon_code text/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS storefront_coupons_enabled boolean NOT NULL DEFAULT true/);
assert.match(migration, /'COUPONS_DISABLED'/);
assert.match(migration, /auth\.uid\(\) IS DISTINCT FROM \(SELECT s\.admin_user_id/);
assert.doesNotMatch(migration, /\b(DELETE FROM|TRUNCATE|DROP TABLE|UPDATE public\.(orders|web_orders|storefront_coupons|storefront_coupon_redemptions))\b/i);

const adminControls = {
  storefrontCouponFeatureEnabled: { checked: false, disabled: true },
  saveStorefrontCouponFeatureBtn: { disabled: true, textContent: '' },
  storefrontCouponFeatureStatus: { className: 'promoAdminStatus', textContent: '' },
};
let currentUser = 'admin-user';
let currentEpoch = 7;
let response = { data: { success: true, coupons_enabled: true }, error: null };
const adminCalls = [];
const notifications = [];
const adminContext = {
  sb: { async rpc(name, args) { adminCalls.push([name, args]); return response; } },
  adminSessionUserId: 'admin-user',
  adminAuthEpoch: 7,
  adminAuthOperationStillCurrent(user, epoch) { return user === currentUser && epoch === currentEpoch; },
  $(id) { return adminControls[id] || null; },
  notifyPublicCatalogChanged(type) { notifications.push(type); },
  toast() {},
};
vm.runInNewContext([
  'let storefrontCouponFeatureSettingsLoaded=false,storefrontCouponFeatureEnabled=false,storefrontCouponFeatureOriginal=null,storefrontCouponFeatureSaving=false,storefrontCouponFeatureRequestToken=0;',
  extractFunction(admin, 'setStorefrontCouponFeatureStatus'),
  extractFunction(admin, 'updateStorefrontCouponFeatureSaveState'),
  extractFunction(admin, 'resetStorefrontCouponFeatureSettingsAdmin'),
  extractFunction(admin, 'loadStorefrontCouponFeatureSettingsAdmin'),
  extractFunction(admin, 'saveStorefrontCouponFeatureSettingsAdmin'),
].join('\n'), adminContext);
assert.equal(await adminContext.loadStorefrontCouponFeatureSettingsAdmin(true), true);
assert.equal(adminControls.storefrontCouponFeatureEnabled.checked, true);
assert.equal(adminControls.storefrontCouponFeatureEnabled.disabled, false);
assert.equal(adminControls.saveStorefrontCouponFeatureBtn.disabled, true);
adminControls.storefrontCouponFeatureEnabled.checked = false;
adminContext.updateStorefrontCouponFeatureSaveState();
assert.equal(adminControls.saveStorefrontCouponFeatureBtn.disabled, false, 'El admin puede guardar un cambio cargado.');
response = { data: { success: true, coupons_enabled: false }, error: null };
assert.equal(await adminContext.saveStorefrontCouponFeatureSettingsAdmin(), true);
assert.equal(adminCalls.at(-1)[0], 'admin_set_storefront_coupons_enabled');
assert.equal(JSON.stringify(adminCalls.at(-1)[1]), JSON.stringify({ p_enabled: false }));
assert.equal(notifications.at(-1), 'coupon-settings-changed');
assert.equal(adminControls.saveStorefrontCouponFeatureBtn.disabled, true, 'El valor guardado no deja el botón dirty.');

response = { data: null, error: { code: 'PGRST202', message: 'schema cache' } };
assert.equal(await adminContext.loadStorefrontCouponFeatureSettingsAdmin(true), false);
assert.equal(adminControls.storefrontCouponFeatureEnabled.disabled, true);
assert.equal(adminControls.storefrontCouponFeatureEnabled.checked, true, 'PGRST202 mantiene el comportamiento legacy activo sin habilitar controles de escritura.');
assert.equal(adminControls.saveStorefrontCouponFeatureBtn.disabled, true, 'Sin RPC el admin no puede guardar ni inventar un estado.');
assert.match(adminControls.storefrontCouponFeatureStatus.textContent, /Guardar permanece bloqueado/);
assert.match(adminControls.storefrontCouponFeatureStatus.textContent, /compatibilidad con los cupones actuales/);
assert.match(adminControls.storefrontCouponFeatureStatus.textContent, /CRUD individual se carga mediante RPC separadas/);

let resolveStale;
response = new Promise(resolve => { resolveStale = resolve; });
adminContext.sb.rpc = () => response;
currentEpoch = 7;
const staleLoad = adminContext.loadStorefrontCouponFeatureSettingsAdmin(true);
currentEpoch = 9;
resolveStale({ data: { success: true, coupons_enabled: true }, error: null });
assert.equal(await staleLoad, false, 'Una respuesta de otra sesión no actualiza el toggle.');
assert.equal(adminControls.storefrontCouponFeatureEnabled.disabled, true);

const storeControls = {
  checkoutCouponBox: { hidden: true },
  couponCode: { value: '', disabled: true },
  couponStatus: { textContent: '', removeAttribute(name) { if (name === 'data-kind') delete this.dataset?.kind; } },
  checkoutModal: { classList: { contains(name) { return name === 'open'; } } },
};
const actions = [{ disabled: true }, { disabled: true }];
let storeResponse = { data: { success: true, coupons_enabled: true }, error: null };
let shippingUpdates = 0;
const storeContext = {
  sb: { async rpc(name) { assert.equal(name, 'get_public_storefront_coupon_settings'); return storeResponse; } },
  $(id) { return storeControls[id] || null; },
  document: { querySelectorAll(selector) { assert.equal(selector, '[data-coupon-action]'); return actions; } },
  updateShipping() { shippingUpdates += 1; },
};
vm.runInNewContext([
  "let checkoutCouponRequestToken=0,checkoutCouponCode='OLD',checkoutCouponQuote={discount_total:1},checkoutCouponQuoteFingerprint='old',checkoutCouponQuoteRequiresConfirmation=false,checkoutCouponReservationReference='ref',checkoutCouponReservationFingerprint='fp',checkoutServerQuote={total:1},checkoutServerQuoteFingerprint='old';",
  'let storefrontCouponSettingsLoaded=false,storefrontCouponsEnabled=false,storefrontCouponToggleSupported=false,storefrontCouponSettingsPromise=null,storefrontCouponSettingsRequestToken=0;',
  extractFunction(store, 'setCheckoutCouponStatus'),
  extractFunction(store, 'clearCheckoutServerQuote'),
  extractFunction(store, 'clearCheckoutCouponState'),
  extractFunction(store, 'syncStorefrontCouponControls'),
  extractFunction(store, 'clearCouponIfUnavailable'),
  extractFunction(store, 'refreshStorefrontCouponSettings'),
].join('\n'), storeContext);
assert.equal(await storeContext.refreshStorefrontCouponSettings(true), true);
assert.equal(storeControls.checkoutCouponBox.hidden, false);
assert.equal(storeControls.couponCode.disabled, false);
assert.ok(actions.every(button => !button.disabled));

storeControls.couponCode.value = 'OLD';
vm.runInNewContext("checkoutCouponCode='OLD'; checkoutCouponQuote={discount_total:1};", storeContext);
storeResponse = { data: { success: true, coupons_enabled: false }, error: null };
assert.equal(await storeContext.refreshStorefrontCouponSettings(true), false);
assert.equal(storeControls.checkoutCouponBox.hidden, true);
assert.equal(storeControls.couponCode.disabled, true);
assert.equal(storeControls.couponCode.value, '');
assert.equal(vm.runInNewContext('checkoutCouponCode', storeContext), '');
assert.ok(actions.every(button => button.disabled));
assert.ok(shippingUpdates > 0, 'Al apagarse, se recalcula el checkout sin descuento.');

storeControls.couponCode.value = 'STALE';
vm.runInNewContext("checkoutCouponCode='STALE';", storeContext);
storeResponse = { data: null, error: { code: 'PGRST202', message: 'schema cache' } };
assert.equal(await storeContext.refreshStorefrontCouponSettings(true), true);
assert.equal(storeControls.checkoutCouponBox.hidden, false, 'Si solo falta la nueva RPC, conserva el flujo de cupones previo.');
assert.equal(storeControls.couponCode.disabled, false);
assert.equal(vm.runInNewContext('storefrontCouponToggleSupported', storeContext), false, 'El modo de compatibilidad no pretende que exista el toggle.');

storeResponse = { data: null, error: { code: '42501', message: 'permission denied' } };
assert.equal(await storeContext.refreshStorefrontCouponSettings(true), false);
assert.equal(storeControls.checkoutCouponBox.hidden, true, 'Un error real de permisos mantiene el campo oculto.');
assert.equal(storeControls.couponCode.value, '', 'El error fail-closed limpia el código local.');
console.log('coupon_feature_toggle_regression: PASS');
