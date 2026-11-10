import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const admin = fs.readFileSync(path.join(here, '..', 'admin.html'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  let start = admin.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  if (admin.slice(start - 6, start) === 'async ') start -= 6;
  const open = admin.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${name}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = open; i < admin.length; i++) {
    const ch = admin[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return admin.slice(start, i + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

const rules = [
  { id: 'r-bogota', scope: 'city', name: 'Bogotá', destinations: ['Santa Fe de Bogotá'] },
  { id: 'r-eje', scope: 'zone', name: 'Eje Cafetero', destinations: ['Pereira', 'Manizales'] },
  { id: 'r-med', scope: 'city', name: 'Medellín', destinations: ['Medellín', 'Itagüí'] },
];
const filterContext = vm.createContext({ storefrontShippingRulesAdmin: rules });
vm.runInContext([
  extractFunction('normalizeStorefrontShippingDestinationAdmin'),
  extractFunction('filterStorefrontShippingRulesAdmin'),
].join('\n'), filterContext);
assert.deepEqual(Array.from(filterContext.filterStorefrontShippingRulesAdmin('bogota')).map(rule => rule.id), ['r-bogota']);
assert.deepEqual(Array.from(filterContext.filterStorefrontShippingRulesAdmin('ITAGUI')).map(rule => rule.id), ['r-med']);
assert.deepEqual(Array.from(filterContext.filterStorefrontShippingRulesAdmin('zona')).map(rule => rule.id), ['r-eje']);
assert.deepEqual(Array.from(filterContext.filterStorefrontShippingRulesAdmin('no existe')), []);
assert.equal(filterContext.filterStorefrontShippingRulesAdmin('').length, 3);
assert.equal(rules.length, 3, 'La búsqueda no modifica la colección original');

const unavailableContext=vm.createContext({});
vm.runInContext(extractFunction('storefrontShippingRulesAdminUnavailableMessage'),unavailableContext);
const missingShippingRpcMessage=unavailableContext.storefrontShippingRulesAdminUnavailableMessage({code:'PGRST202'});
assert.match(missingShippingRpcMessage,/admin_list_storefront_shipping_rules\(\)/);
assert.match(missingShippingRpcMessage,/No se cargaron reglas y Guardar sigue deshabilitado/);
assert.match(unavailableContext.storefrontShippingRulesAdminUnavailableMessage({code:'42501'}),/permisos de administrador/);
assert.match(unavailableContext.storefrontShippingRulesAdminUnavailableMessage(new Error('synthetic failure')),/no se muestran datos de ejemplo.*Guardar sigue deshabilitado/);

assert.match(admin, /<input id="shippingRulesSearch" type="search" maxlength="80"/);
assert.ok(admin.includes("if(event.target?.id==='shippingRulesSearch'){renderStorefrontShippingRulesAdmin();return;}"));
assert.ok(admin.includes('data-shipping-rule-delete'));
assert.ok(admin.includes("sb.rpc('admin_delete_storefront_shipping_rule'"));
assert.ok(admin.includes('no cambian qué ciudades tienen contraentrega'), 'Las reglas de tarifa no activan COD automáticamente');
assert.match(admin, /function lockAdminPanel\([^)]*\)\{[\s\S]*?resetStorefrontShippingRulesAdminState\(\);/);
assert.match(admin, /Cali conserva el envío gratis si no tiene una regla específica de ciudad activa/);

const caliFormNodes = {
  shippingRuleEditId: { value: '' }, shippingRuleScope: { value: 'city' }, shippingRuleName: { value: 'Tarifa Cali' },
  shippingRuleDestinations: { value: 'Santiago de Cali' }, shippingRulePriority: { value: '0' }, shippingRuleCost: { value: '12000' },
  shippingRuleThresholdEnabled: { checked: false }, shippingRuleThreshold: { value: '' }, shippingRuleEnabled: { checked: true },
  saveStorefrontShippingRuleBtn: { disabled: true, textContent: '' }, resetStorefrontShippingRuleBtn: { disabled: true },
  refreshStorefrontShippingRulesBtn: { disabled: true },
};
const caliFormContext = vm.createContext({
  storefrontShippingRulesAdminLoaded: true, storefrontShippingRuleSaving: false,
  $(id) { return caliFormNodes[id] || null; },
});
vm.runInContext([
  extractFunction('normalizeStorefrontShippingDestinationAdmin'),
  extractFunction('readStorefrontShippingRuleAdminForm'),
  extractFunction('validateStorefrontShippingRuleForm'),
  extractFunction('updateStorefrontShippingRuleAdminForm'),
].join('\n'), caliFormContext);
assert.equal(caliFormContext.normalizeStorefrontShippingDestinationAdmin('Cali Valle del Cauca'), 'cali');
caliFormContext.updateStorefrontShippingRuleAdminForm();
assert.equal(caliFormNodes.saveStorefrontShippingRuleBtn.disabled, false, 'Una regla Ciudad de Cali con tarifa debe poder guardarse');
caliFormContext.validateStorefrontShippingRuleForm(caliFormContext.readStorefrontShippingRuleAdminForm());
caliFormNodes.shippingRuleScope.value = 'zone';
caliFormNodes.shippingRuleDestinations.value = 'Cali\nPalmira';
caliFormContext.updateStorefrontShippingRuleAdminForm();
assert.equal(caliFormNodes.saveStorefrontShippingRuleBtn.disabled, true, 'Cali no debe agregarse a una regla de zona');
assert.throws(() => caliFormContext.validateStorefrontShippingRuleForm(caliFormContext.readStorefrontShippingRuleAdminForm()), /Cali solo admite una regla Ciudad/);
caliFormNodes.shippingRuleScope.value = 'city';
caliFormNodes.shippingRuleDestinations.value = 'Cali\nSantiago de Cali';
caliFormContext.updateStorefrontShippingRuleAdminForm();
assert.equal(caliFormNodes.saveStorefrontShippingRuleBtn.disabled, true, 'Los alias de Cali no deben crear reglas city duplicadas');

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const resetSearch = { value: 'Bogotá' };
const resetRefresh = { disabled: true };
const resetRuleFormNodes = {
  shippingRuleEditId: { value: 'A-rule' }, shippingRuleScope: { value: 'zone' }, shippingRuleName: { value: 'Tarifa A' },
  shippingRuleDestinations: { value: 'Bogotá' }, shippingRulePriority: { value: '7' }, shippingRuleCost: { value: '90000' },
  shippingRuleThresholdEnabled: { checked: true }, shippingRuleThreshold: { value: '80000' }, shippingRuleEnabled: { checked: false },
};
let resetRenderCalls = 0;
let resetFormCalls = 0;
const resetContext = vm.createContext({
  storefrontShippingRulesAdminLoaded: true,
  storefrontShippingRulesAdmin: rules,
  storefrontShippingRuleSaving: true,
  $(id) { return resetRuleFormNodes[id] || (id === 'shippingRulesSearch' ? resetSearch : id === 'refreshStorefrontShippingRulesBtn' ? resetRefresh : null); },
  renderStorefrontShippingRulesAdmin() { resetRenderCalls++; },
  updateStorefrontShippingRuleAdminForm() { resetFormCalls++; },
  setStorefrontShippingRulesAdminStatus() {},
});
vm.runInContext([extractFunction('resetStorefrontShippingRuleForm'), extractFunction('resetStorefrontShippingRulesAdminState')].join('\n'), resetContext);
resetContext.resetStorefrontShippingRulesAdminState();
assert.equal(resetContext.storefrontShippingRulesAdminLoaded, false);
assert.equal(resetContext.storefrontShippingRulesAdmin.length, 0);
assert.equal(resetContext.storefrontShippingRuleSaving, false);
assert.equal(resetSearch.value, '');
assert.equal(resetRefresh.disabled, false);
assert.equal(resetRenderCalls, 1);
assert.equal(resetFormCalls, 2);
assert.equal(resetRuleFormNodes.shippingRuleEditId.value, '');
assert.equal(resetRuleFormNodes.shippingRuleScope.value, 'city');
assert.equal(resetRuleFormNodes.shippingRuleName.value, '');
assert.equal(resetRuleFormNodes.shippingRuleDestinations.value, '');
assert.equal(resetRuleFormNodes.shippingRulePriority.value, '0');
assert.equal(resetRuleFormNodes.shippingRuleCost.value, '15000');
assert.equal(resetRuleFormNodes.shippingRuleThreshold.value, '130000');
assert.equal(resetRuleFormNodes.shippingRuleThresholdEnabled.checked, true);
assert.equal(resetRuleFormNodes.shippingRuleEnabled.checked, true);

const requestA = deferred();
let loaderContext;
let loaderRpcCount = 0;
const loaderRefresh = { disabled: false };
const loaderContextSeed = {
  adminSessionUserId: 'account-A', adminAuthEpoch: 1,
  adminAuthOperationStillCurrent(userId, epoch) { return !!loaderContext && loaderContext.adminSessionUserId === userId && loaderContext.adminAuthEpoch === epoch; },
  sb: { async rpc() {
    loaderRpcCount++;
    if (loaderRpcCount === 1) return requestA.promise;
    if (loaderRpcCount === 2) return { data: [{ id: 'B-rule', scope: 'city', name: 'Pereira B', priority: 1, shipping_cost: 12000, free_shipping_threshold: null, enabled: true, destinations: ['Pereira'] }], error: null };
    return { data: null, error: new Error('synthetic offline') };
  } },
  storefrontShippingRulesAdminLoaded: true,
  storefrontShippingRulesAdmin: [{ id: 'A-old-rule' }],
  storefrontShippingRuleSaving: false,
  resetStorefrontShippingRuleForm() {},
  $(id) { return id === 'refreshStorefrontShippingRulesBtn' ? loaderRefresh : null; },
  renderStorefrontShippingRulesAdmin() {}, updateStorefrontShippingRuleAdminForm() {}, setStorefrontShippingRulesAdminStatus() {},
};
loaderContext = vm.createContext(loaderContextSeed);
vm.runInContext('adminAuthOperationStillCurrent=(userId,epoch)=>adminSessionUserId===userId&&adminAuthEpoch===epoch;', loaderContext);
vm.runInContext([
  extractFunction('resetStorefrontShippingRulesAdminState'),
  extractFunction('storefrontShippingRulesAdminUnavailableMessage'),
  extractFunction('loadStorefrontShippingRulesAdmin'),
].join('\n'), loaderContext);
const loadA = loaderContext.loadStorefrontShippingRulesAdmin(true);
vm.runInContext("adminSessionUserId='account-B';adminAuthEpoch=2;", loaderContext);
loaderContext.resetStorefrontShippingRulesAdminState();
requestA.resolve({ data: [{ id: 'A-rule', scope: 'city', name: 'Cali A', priority: 1, shipping_cost: 10000, free_shipping_threshold: null, enabled: true, destinations: ['Palmira'] }], error: null });
assert.equal(await loadA, false);
assert.equal(loaderContext.storefrontShippingRulesAdminLoaded, false);
assert.equal(loaderContext.storefrontShippingRulesAdmin.length, 0, 'Una respuesta vieja no repuebla reglas de A bajo B');
assert.equal(loaderContext.storefrontShippingRuleSaving, false);
assert.equal(loaderRefresh.disabled, false);
assert.equal(await loaderContext.loadStorefrontShippingRulesAdmin(false), true);
assert.deepEqual(Array.from(loaderContext.storefrontShippingRulesAdmin).map(rule => rule.id), ['B-rule']);
assert.equal(await loaderContext.loadStorefrontShippingRulesAdmin(true), false, 'Una carga fallida falla cerrada');
assert.equal(loaderContext.storefrontShippingRulesAdmin.length, 0, 'Una recarga fallida no deja mostrar un snapshot anterior');

const deleteStatuses = [];
const rpcCalls = [];
const notifications = [];
const editedRule = { id: 'r-bogota', scope: 'city', name: 'Bogotá' };
const editId = { value: '' };
const successContext = vm.createContext({
  adminSessionUserId: 'admin-1',
  adminAuthEpoch: 1,
  adminAuthOperationStillCurrent(userId, epoch) { return userId === 'admin-1' && epoch === 1; },
  storefrontShippingRulesAdminLoaded: true,
  storefrontShippingRuleSaving: false,
  storefrontShippingRulesAdmin: [editedRule],
  confirm: message => { assert.match(message, /pedidos existentes conservarán sus importes/); return true; },
  updateStorefrontShippingRuleAdminForm() {},
  setStorefrontShippingRulesAdminStatus(message, kind) { deleteStatuses.push({ message, kind }); },
  sb: { async rpc(name, args) { rpcCalls.push({ name, args }); return { data: { success: true, message: 'Regla eliminada.' } }; } },
  async loadStorefrontShippingRulesAdmin(force) { assert.equal(force, true); return true; },
  $(id) { return id === 'shippingRuleEditId' ? editId : null; },
  notifyPublicCatalogChanged(type) { notifications.push(type); },
  toast() {},
  resetStorefrontShippingRuleForm() {},
});
vm.runInContext(extractFunction('deleteStorefrontShippingRule'), successContext);
await successContext.deleteStorefrontShippingRule('r-bogota');
assert.equal(rpcCalls.length, 1);
assert.equal(rpcCalls[0].name, 'admin_delete_storefront_shipping_rule');
assert.equal(rpcCalls[0].args.p_rule_id, 'r-bogota');
assert.deepEqual(notifications, ['shipping-rules-changed']);
assert.equal(deleteStatuses.at(-1).kind, 'ok');

let deniedRpcCalls = 0;
const deniedStatuses = [];
const deniedContext = vm.createContext({
  adminSessionUserId: 'admin-1',
  adminAuthEpoch: 1,
  adminAuthOperationStillCurrent(userId, epoch) { return userId === 'admin-1' && epoch === 1; },
  storefrontShippingRulesAdminLoaded: true,
  storefrontShippingRuleSaving: false,
  storefrontShippingRulesAdmin: [editedRule],
  confirm: () => true,
  updateStorefrontShippingRuleAdminForm() {},
  setStorefrontShippingRulesAdminStatus(message, kind) { deniedStatuses.push({ message, kind }); },
  sb: { async rpc() { deniedRpcCalls++; throw new Error('permission denied'); } },
  async loadStorefrontShippingRulesAdmin() { return true; },
  $() { return null; },
  notifyPublicCatalogChanged() { assert.fail('No debe invalidar catálogo si el RPC falla'); },
  toast() {},
  resetStorefrontShippingRuleForm() {},
});
vm.runInContext(extractFunction('deleteStorefrontShippingRule'), deniedContext);
await deniedContext.deleteStorefrontShippingRule('r-bogota');
assert.equal(deniedRpcCalls, 1);
assert.match(deniedStatuses.at(-1).message, /No se eliminó la regla/);

let staleRpcCalls = 0;
const staleContext = vm.createContext({
  adminSessionUserId: 'admin-old',
  adminAuthEpoch: 2,
  adminAuthOperationStillCurrent() { return false; },
  storefrontShippingRulesAdminLoaded: true,
  storefrontShippingRuleSaving: false,
  storefrontShippingRulesAdmin: [editedRule],
  confirm() { assert.fail('No debe pedir confirmación para una sesión obsoleta'); },
  sb: { async rpc() { staleRpcCalls++; return { data: { success: true } }; } },
});
vm.runInContext(extractFunction('deleteStorefrontShippingRule'), staleContext);
await staleContext.deleteStorefrontShippingRule('r-bogota');
assert.equal(staleRpcCalls, 0, 'El handler no envía una mutación desde un evento de otra sesión');

const rpcGate = deferred();
let rpcRaceContext;
let rpcRaceReloads = 0;
const rpcRaceStatuses = [];
let rpcRaceNotifications = 0;
const rpcRace = vm.createContext({
  adminSessionUserId: 'account-A', adminAuthEpoch: 1,
  adminAuthOperationStillCurrent(userId, epoch) { return !!rpcRaceContext && rpcRaceContext.adminSessionUserId === userId && rpcRaceContext.adminAuthEpoch === epoch; },
  storefrontShippingRulesAdminLoaded: true, storefrontShippingRuleSaving: false, storefrontShippingRulesAdmin: [editedRule],
  confirm: () => true, updateStorefrontShippingRuleAdminForm() {},
  setStorefrontShippingRulesAdminStatus(message) { rpcRaceStatuses.push(message); },
  sb: { async rpc() { return rpcGate.promise; } },
  async loadStorefrontShippingRulesAdmin() { rpcRaceReloads++; return true; },
  $() { return null; }, renderStorefrontShippingRulesAdmin() {}, resetStorefrontShippingRuleForm() {},
  notifyPublicCatalogChanged() { rpcRaceNotifications++; }, toast() {},
});
rpcRaceContext = rpcRace;
vm.runInContext('adminAuthOperationStillCurrent=(userId,epoch)=>adminSessionUserId===userId&&adminAuthEpoch===epoch;', rpcRace);
vm.runInContext([extractFunction('resetStorefrontShippingRulesAdminState'), extractFunction('deleteStorefrontShippingRule')].join('\n'), rpcRace);
const deletingDuringRpc = rpcRace.deleteStorefrontShippingRule('r-bogota');
assert.equal(rpcRace.storefrontShippingRuleSaving, true);
vm.runInContext("adminSessionUserId='account-B';adminAuthEpoch=2;", rpcRace);
rpcRace.resetStorefrontShippingRulesAdminState();
rpcGate.resolve({ data: { success: true, message: 'Regla eliminada.' } });
await deletingDuringRpc;
assert.equal(rpcRace.storefrontShippingRulesAdmin.length, 0);
assert.equal(rpcRace.storefrontShippingRulesAdminLoaded, false);
assert.equal(rpcRace.storefrontShippingRuleSaving, false, 'lock limpia el saving aunque el RPC de A termine después');
assert.equal(rpcRaceReloads, 0, 'la respuesta de A no inicia una recarga bajo B');
assert.equal(rpcRaceNotifications, 1, 'un borrado ya confirmado actualiza las otras vistas');
assert.match(rpcRaceStatuses.at(-1), /Inicia sesión/);

const reloadGate = deferred();
const reloadStarted = deferred();
let reloadRaceContext;
let reloadRaceToastCalls = 0;
const reloadRace = vm.createContext({
  adminSessionUserId: 'account-A', adminAuthEpoch: 1,
  adminAuthOperationStillCurrent(userId, epoch) { return !!reloadRaceContext && reloadRaceContext.adminSessionUserId === userId && reloadRaceContext.adminAuthEpoch === epoch; },
  storefrontShippingRulesAdminLoaded: true, storefrontShippingRuleSaving: false, storefrontShippingRulesAdmin: [editedRule],
  confirm: () => true, updateStorefrontShippingRuleAdminForm() {}, setStorefrontShippingRulesAdminStatus() {},
  sb: { async rpc() { return { data: { success: true, message: 'Regla eliminada.' } }; } },
  async loadStorefrontShippingRulesAdmin() { reloadStarted.resolve(); return reloadGate.promise; },
  $() { return null; }, renderStorefrontShippingRulesAdmin() {}, resetStorefrontShippingRuleForm() {},
  notifyPublicCatalogChanged() {}, toast() { reloadRaceToastCalls++; },
});
reloadRaceContext = reloadRace;
vm.runInContext('adminAuthOperationStillCurrent=(userId,epoch)=>adminSessionUserId===userId&&adminAuthEpoch===epoch;', reloadRace);
vm.runInContext([extractFunction('resetStorefrontShippingRulesAdminState'), extractFunction('deleteStorefrontShippingRule')].join('\n'), reloadRace);
const deletingDuringReload = reloadRace.deleteStorefrontShippingRule('r-bogota');
await reloadStarted.promise;
vm.runInContext("adminSessionUserId='account-B';adminAuthEpoch=2;", reloadRace);
reloadRace.resetStorefrontShippingRulesAdminState();
reloadGate.resolve(true);
await deletingDuringReload;
assert.equal(reloadRace.storefrontShippingRulesAdmin.length, 0);
assert.equal(reloadRace.storefrontShippingRuleSaving, false);
assert.equal(reloadRaceToastCalls, 0, 'respuesta tardía de reload no muestra éxito a la cuenta B');

const reloadFailureStatuses = [];
let reloadFailureToastCalls = 0;
const reloadFailure = vm.createContext({
  adminSessionUserId: 'admin-1', adminAuthEpoch: 1,
  adminAuthOperationStillCurrent(userId, epoch) { return userId === 'admin-1' && epoch === 1; },
  storefrontShippingRulesAdminLoaded: true, storefrontShippingRuleSaving: false, storefrontShippingRulesAdmin: [editedRule],
  confirm: () => true, updateStorefrontShippingRuleAdminForm() {},
  setStorefrontShippingRulesAdminStatus(message, kind) { reloadFailureStatuses.push({ message, kind }); },
  sb: { async rpc() { return { data: { success: true, message: 'Regla eliminada.' } }; } },
  async loadStorefrontShippingRulesAdmin() { return false; },
  $() { return null; }, notifyPublicCatalogChanged() {}, toast() { reloadFailureToastCalls++; }, resetStorefrontShippingRuleForm() {},
});
vm.runInContext(extractFunction('deleteStorefrontShippingRule'), reloadFailure);
await reloadFailure.deleteStorefrontShippingRule('r-bogota');
assert.match(reloadFailureStatuses.at(-1).message, /La regla se eliminó\. No se pudo recargar/);
assert.equal(reloadFailureToastCalls, 0, 'No afirma que la lista se refrescó cuando falló el reload');
assert.equal(reloadFailure.storefrontShippingRuleSaving, false);

const persistedRule = { id: 'synthetic-city-rule', scope: 'city', name: 'Tarifa de prueba', priority: 2, shipping_cost: 9000, free_shipping_threshold: 100000, enabled: true, destinations: ['Manizales'] };
const persistedRows = [structuredClone(persistedRule)];
const shippingRpcCalls = [];
const statusNode = { textContent: '', className: '' };
const formNodes = {
  shippingRulesAdminStatus: statusNode,
  shippingRuleEditId: { value: '' }, shippingRuleScope: { value: 'city' }, shippingRuleName: { value: '', focus() {} },
  shippingRuleDestinations: { value: '' }, shippingRulePriority: { value: '0' }, shippingRuleCost: { value: '' },
  shippingRuleThresholdEnabled: { checked: false }, shippingRuleThreshold: { value: '' }, shippingRuleEnabled: { checked: true },
  saveStorefrontShippingRuleBtn: { disabled: true, textContent: '' }, resetStorefrontShippingRuleBtn: { disabled: true },
  refreshStorefrontShippingRulesBtn: { disabled: true },
};
const roundTrip = vm.createContext({
  adminSessionUserId: 'synthetic-admin', adminAuthEpoch: 7,
  adminAuthOperationStillCurrent(userId, epoch) { return userId === 'synthetic-admin' && epoch === 7; },
  storefrontShippingRulesAdminLoaded: false, storefrontShippingRulesAdmin: [], storefrontShippingRuleSaving: false,
  sb: { async rpc(name, args) {
    shippingRpcCalls.push({ name, args });
    if (name === 'admin_list_storefront_shipping_rules') return { data: persistedRows.map(row => structuredClone(row)), error: null };
    if (name === 'admin_save_storefront_shipping_rule') {
      const row = persistedRows.find(value => value.id === args.p_rule_id);
      assert.ok(row, 'La prueba edita solo su fila sintética existente.');
      Object.assign(row, { scope: args.p_scope, name: args.p_name, destinations: args.p_destinations, shipping_cost: args.p_shipping_cost, free_shipping_threshold: args.p_free_shipping_threshold, priority: args.p_priority, enabled: args.p_enabled });
      return { data: { success: true, message: 'Regla sintética guardada.' }, error: null };
    }
    assert.fail(`RPC no prevista: ${name}`);
  } },
  $(id) { return formNodes[id] || null; },
  renderStorefrontShippingRulesAdmin() {}, notifyPublicCatalogChanged() {}, toast() {},
  setStorefrontShippingRulesAdminStatus(message, kind = '') { statusNode.textContent = message; statusNode.className = kind; },
});
vm.runInContext([
  extractFunction('normalizeStorefrontShippingDestinationAdmin'),
  extractFunction('readStorefrontShippingRuleAdminForm'),
  extractFunction('validateStorefrontShippingRuleForm'),
  extractFunction('updateStorefrontShippingRuleAdminForm'),
  extractFunction('resetStorefrontShippingRuleForm'),
  extractFunction('editStorefrontShippingRule'),
  extractFunction('storefrontShippingRulesAdminUnavailableMessage'),
  extractFunction('loadStorefrontShippingRulesAdmin'),
  extractFunction('saveStorefrontShippingRule'),
].join('\n'), roundTrip);
assert.equal(await roundTrip.loadStorefrontShippingRulesAdmin(true), true, 'Carga inicial real de la UI usa la RPC de listado mockeada.');
assert.equal(roundTrip.storefrontShippingRulesAdmin[0].shipping_cost, 9000);
roundTrip.editStorefrontShippingRule('synthetic-city-rule');
assert.equal(formNodes.shippingRuleCost.value, '9000', 'Editar hidrata tarifa que vino de la lectura.');
formNodes.shippingRuleCost.value = '12500';
formNodes.shippingRuleThreshold.value = '150000';
roundTrip.updateStorefrontShippingRuleAdminForm();
assert.equal(formNodes.saveStorefrontShippingRuleBtn.disabled, false, 'Un cambio válido habilita Guardar solo tras cargar el backend.');
assert.equal(await roundTrip.saveStorefrontShippingRule(), true, 'La edición se persiste por la RPC mockeada y recarga la lista.');
assert.equal(persistedRows[0].shipping_cost, 12500);
assert.equal(persistedRows[0].free_shipping_threshold, 150000);
assert.equal(roundTrip.storefrontShippingRulesAdmin[0].shipping_cost, 12500, 'La recarga refleja el valor persistido por el RPC sintético.');
assert.deepEqual(shippingRpcCalls.map(call => call.name), ['admin_list_storefront_shipping_rules', 'admin_save_storefront_shipping_rule', 'admin_list_storefront_shipping_rules']);

console.log('OK admin_city_shipping_ui_regression: búsqueda Unicode, reset de sesión, cargas obsoletas y RPC delete/reload con mocks, sin Supabase real.');
