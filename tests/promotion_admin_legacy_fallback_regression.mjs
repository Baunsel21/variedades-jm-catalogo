import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const extract = (pattern, label) => {
  const found = admin.match(pattern)?.[0];
  assert.ok(found, `${label} debe existir en admin.html`);
  return found;
};
const state = extract(/^let storefrontProductCombosAdmin=[^\n]+;/m, 'Estado de combos');
const status = extract(/function setStorefrontCombosAdminStatus\(message,kind=''\)\{[^\n]*\}/, 'Estado accesible');
const disable = extract(/function setStorefrontComboFormDisabled\(disabled\)\{[^\n]*\}/, 'Gate de campos');
const loader = extract(/function isMissingStorefrontCalendarRpc\(error,name\)\{[^\n]*\}\nasync function loadStorefrontProductCombosAdmin\(force=false\)\{[\s\S]*?(?=\nasync function saveStorefrontProductCombo\()/, 'Carga compatible');
const fields = Object.fromEntries([
  'storefrontComboPriority', 'storefrontComboTimeZone', 'storefrontComboTitle', 'saveStorefrontComboBtn', 'storefrontCombosAdminList',
].map(id => [id, { disabled: true, textContent: '', className: '', innerHTML: '' }]));

function contextFor(respond) {
  const calls = [];
  const ctx = vm.createContext({
    adminSessionUserId: 'admin-fixture',
    adminAuthEpoch: 4,
    adminAuthOperationStillCurrent: (userId, epoch) => userId === 'admin-fixture' && epoch === 4,
    sb: { rpc: async (name, args) => { calls.push({ name, args }); return respond(name, args); } },
    $: id => fields[id] || null,
    renderStorefrontComboProductSelects() {},
    renderStorefrontCombosAdminList() {},
    updateStorefrontComboRuleFields() {},
    console,
  });
  vm.runInContext(`${state}\n${status}\n${disable}\n${loader}`, ctx);
  return { ctx, calls };
}

const legacy = contextFor(name => name === 'admin_list_storefront_product_combos_v2'
  ? { data: null, error: { code: 'PGRST202', message: 'admin_list_storefront_product_combos_v2 not found in schema cache' } }
  : { data: [{ id: 'legacy-combo', enabled: true }], error: null });
assert.equal(await vm.runInContext('loadStorefrontProductCombosAdmin()', legacy.ctx), true);
assert.deepEqual(legacy.calls.map(call => call.name), [
  'admin_list_storefront_product_combos_v2',
  'admin_list_storefront_product_combos',
]);
assert.equal(vm.runInContext('storefrontComboCalendarRpcAvailable', legacy.ctx), false);
assert.equal(fields.storefrontComboPriority.disabled, true, 'No permitir editar prioridad sin el RPC v2.');
assert.equal(fields.storefrontComboTimeZone.disabled, true, 'No permitir editar timezone sin el RPC v2.');
assert.equal(fields.storefrontComboTitle.disabled, false, 'Conservar administración legacy de combos.');
assert.equal(vm.runInContext('storefrontCombosAdminLoaded', legacy.ctx), true);

const current = contextFor(name => ({ data: [{ id: 'v2-combo', enabled: true, priority: 20 }], error: null }));
assert.equal(await vm.runInContext('loadStorefrontProductCombosAdmin()', current.ctx), true);
assert.deepEqual(current.calls.map(call => call.name), ['admin_list_storefront_product_combos_v2']);
assert.equal(vm.runInContext('storefrontComboCalendarRpcAvailable', current.ctx), true);
assert.equal(fields.storefrontComboPriority.disabled, false, 'Habilitar prioridad solo tras respuesta correcta de v2.');

const denied = contextFor(() => ({ data: null, error: { code: '42501', message: 'unauthorized' } }));
assert.equal(await vm.runInContext('loadStorefrontProductCombosAdmin()', denied.ctx), false);
assert.deepEqual(denied.calls.map(call => call.name), ['admin_list_storefront_product_combos_v2'], 'No esconder errores de autorización mediante fallback.');
assert.equal(vm.runInContext('storefrontCombosAdminLoaded', denied.ctx), false);
assert.equal(fields.storefrontComboTitle.disabled, true);

assert.match(admin, /storefrontComboCalendarRpcAvailable\s*\?await sb\.rpc\('admin_save_storefront_product_combo_v2'/);
assert.match(admin, /:await sb\.rpc\('admin_save_storefront_product_combo',legacyPayload\)/, 'El guardado legacy se conserva cuando falta v2.');

console.log('OK promotion_admin_legacy_fallback_regression: compatibilidad legacy, prioridad v2 gated y errores de autorización fail-closed.');
