import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [admin, migration] = await Promise.all([
  readFile(new URL('../admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20261114010000_web_order_tracking_and_change_log.sql', import.meta.url), 'utf8'),
]);

function extractFunction(name) {
  let start = admin.indexOf(`async function ${name}(`);
  if (start < 0) start = admin.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Falta ${name}`);
  const open = admin.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = open; i < admin.length; i += 1) {
    const character = admin[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return admin.slice(start, i + 1);
  }
  assert.fail(`${name} no tiene cierre`);
}

assert.match(admin, /id="orderTrackingModal"[^>]*aria-hidden="true"/);
assert.match(admin, /role="dialog" aria-modal="true" aria-labelledby="orderTrackingTitle"/);
assert.match(admin, /data-order-action="tracking"[^>]*\$\{webOrderTrackingRpcState==='ready'\?'':'disabled'\}/);
assert.match(admin, /sb\.rpc\('admin_list_web_order_tracking',\{p_order_ids:orderIds\}\)/);
assert.match(admin, /pedidos\.map\(order=>order\?\.id\)/);
assert.match(admin, /MAX_WEB_ORDER_TRACKING_ORDER_IDS=5000/);
assert.match(admin, /orderIds\.length>MAX_WEB_ORDER_TRACKING_ORDER_IDS/);
assert.doesNotMatch(admin, /admin_list_web_order_tracking',\{p_limit:/);
assert.match(admin, /admin_list_web_order_change_history/);
assert.match(admin, /admin_set_web_order_tracking/);
assert.match(admin, /function safeOrderTrackingUrl/);
assert.match(admin, /url\.protocol==='https:'/);
assert.match(admin, /const rawRef=String\(order\.order_number\|\|order\.client_reference\|\|''\);const ref=rawRef&&rawRef\.length<=80\?rawRef:'sin referencia comercial'/);
assert.match(admin, /Guía actualizada · \$\{before\} → \$\{after\}/);
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
assert.match(migration, /tracking_url_changed boolean NOT NULL DEFAULT false/);
assert.doesNotMatch(migration, /before_tracking_url|after_tracking_url/);
assert.match(migration, /DROP FUNCTION IF EXISTS public\.admin_list_web_order_tracking\(integer\)/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_list_web_order_tracking\(p_order_ids uuid\[\]\)/);
assert.match(migration, /JOIN public\.web_orders o ON o\.id = t\.web_order_id/);
assert.match(migration, /ORDER_TRACKING_ORDER_IDS_LIMIT_EXCEEDED/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_list_web_order_tracking\(uuid\[\]\) TO authenticated/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_list_web_order_tracking\(uuid\[\]\) FROM PUBLIC, anon, service_role/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_set_web_order_tracking\(uuid, text, text, text\) TO authenticated/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_set_web_order_tracking\(uuid, text, text, text\) FROM PUBLIC, anon, service_role/);
assert.match(migration, /TRACKING_URL_INVALID/);
assert.match(migration, /IS DISTINCT FROM/);

const trackingFunctions = [
  'isValidWebOrderId',
  'safeOrderTrackingUrl',
  'normalizeOrderTrackingRpcRows',
  'isMissingOrderTrackingRpc',
  'clearOrderTrackingHistory',
  'loadWebOrderTracking',
  'loadOrderTrackingHistory',
  'saveOrderTracking',
].map(extractFunction).join('\n');
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

function makeTrackingContext({ rpc, live = { userId: 'synthetic-admin', epoch: 7 } }) {
  const calls = [];
  const renderedHistory = [];
  const elements = {
    orderTrackingCarrier: { value: 'Servientrega' },
    orderTrackingNumber: { value: 'GUIA-LOCAL-001' },
    orderTrackingUrl: { value: 'https://tracking.example.test/GUIA-LOCAL-001' },
    orderTrackingSave: { disabled: false },
    orderTrackingHistoryList: { textContent: 'historial anterior' },
    orderTrackingHistoryStatus: { textContent: 'historial anterior' },
  };
  const modal = { dataset: { orderId: ORDER_ID }, classList: { contains: value => value === 'show' } };
  const context = vm.createContext({
    URL,
    adminSessionUserId: live.userId,
    adminAuthEpoch: live.epoch,
    adminAuthOperationStillCurrent(userId, epoch) { return userId === live.userId && epoch === live.epoch; },
    assertCurrentAdminAuthorization: async () => {},
    sb: { async rpc(name, args) { calls.push({ name, args }); return rpc(name, args); } },
    pedidos: [{ id: ORDER_ID }],
    webOrderTrackingById: Object.create(null),
    webOrderTrackingRpcState: 'ready',
    webOrderTrackingRequestToken: 0,
    webOrderHistoryRequestToken: 0,
    webOrderTrackingSaveToken: 0,
    MAX_WEB_ORDER_TRACKING_ORDER_IDS: 5000,
    $(id) { return id === 'orderTrackingModal' ? modal : (elements[id] || null); },
    updateOrderTrackingStatus() {},
    renderPedidos() {},
    renderOrderTrackingHistory(rows) {
      renderedHistory.push(...rows);
      elements.orderTrackingHistoryList.textContent = 'historial actualizado';
      elements.orderTrackingHistoryStatus.textContent = `${rows.length} cambio(s) recientes`;
    },
    toast() {},
  });
  vm.runInContext(trackingFunctions, context);
  return { context, calls, elements, modal, renderedHistory, live };
}

const listStarted = deferred();
const listResponse = deferred();
const historyStarted = deferred();
const historyResponse = deferred();
const success = makeTrackingContext({
  rpc(name, args) {
    if (name === 'admin_set_web_order_tracking') return { data: { ok: true, changed: true }, error: null };
    if (name === 'admin_list_web_order_tracking') {
      listStarted.resolve(args);
      return listResponse.promise;
    }
    if (name === 'admin_list_web_order_change_history') {
      historyStarted.resolve(args);
      return historyResponse.promise;
    }
    assert.fail(`RPC inesperado: ${name}`);
  },
});
let saveFinished = false;
const savePromise = success.context.saveOrderTracking().then(result => { saveFinished = true; return result; });
const listArgs = await listStarted.promise;
assert.deepEqual(JSON.parse(JSON.stringify(success.calls.map(call => call.name))), ['admin_set_web_order_tracking', 'admin_list_web_order_tracking']);
assert.deepEqual(JSON.parse(JSON.stringify(listArgs)), { p_order_ids: [ORDER_ID] });
assert.equal(success.elements.orderTrackingHistoryList.textContent, '', 'se limpia el historial previo mientras se actualiza la guía');
assert.equal(success.elements.orderTrackingHistoryStatus.textContent, 'Actualizando seguimiento y recargando historial…');
listResponse.resolve({
  data: [{ web_order_id: ORDER_ID, carrier_name: 'Servientrega', tracking_number: 'GUIA-LOCAL-001', tracking_url: 'https://tracking.example.test/GUIA-LOCAL-001' }],
  error: null,
});
const historyArgs = await historyStarted.promise;
assert.deepEqual(JSON.parse(JSON.stringify(success.calls.map(call => call.name))), ['admin_set_web_order_tracking', 'admin_list_web_order_tracking', 'admin_list_web_order_change_history']);
assert.deepEqual(JSON.parse(JSON.stringify(historyArgs)), { p_order_id: ORDER_ID, p_limit: 50 });
assert.equal(saveFinished, false, 'save sigue pendiente hasta completar el historial');
historyResponse.resolve({ data: [{ event_type: 'tracking_created' }], error: null });
assert.equal(await savePromise, true);
assert.equal(saveFinished, true);
assert.equal(success.context.webOrderTrackingRpcState, 'ready');
assert.equal(success.context.webOrderTrackingById[ORDER_ID].tracking_number, 'GUIA-LOCAL-001');
assert.equal(success.renderedHistory.length, 1);
assert.equal(success.elements.orderTrackingHistoryList.textContent, 'historial actualizado');

let failedHistoryCalls = 0;
const listFailure = makeTrackingContext({
  rpc(name) {
    if (name === 'admin_set_web_order_tracking') return { data: { ok: true, changed: true }, error: null };
    if (name === 'admin_list_web_order_tracking') return { data: null, error: new Error('synthetic offline') };
    if (name === 'admin_list_web_order_change_history') failedHistoryCalls += 1;
    assert.fail(`RPC inesperado: ${name}`);
  },
});
assert.equal(await listFailure.context.saveOrderTracking(), true, 'el guardado confirmado sigue siendo éxito aunque falle el refresco');
assert.equal(failedHistoryCalls, 0, 'no se solicita el historial si el listado falló');
assert.equal(listFailure.context.webOrderTrackingRpcState, 'error');
assert.equal(listFailure.elements.orderTrackingHistoryList.textContent, '', 'un fallo de refresco no conserva historial obsoleto');
assert.match(listFailure.elements.orderTrackingHistoryStatus.textContent, /se ocultó el historial anterior/);

const raceListStarted = deferred();
const raceListResponse = deferred();
const authRace = makeTrackingContext({
  rpc(name, args) {
    if (name === 'admin_set_web_order_tracking') return { data: { ok: true, changed: true }, error: null };
    if (name === 'admin_list_web_order_tracking') {
      raceListStarted.resolve(args);
      return raceListResponse.promise;
    }
    assert.fail(`No debe iniciarse RPC tras cambiar auth epoch: ${name}`);
  },
});
const staleSave = authRace.context.saveOrderTracking();
await raceListStarted.promise;
authRace.live.epoch += 1;
raceListResponse.resolve({ data: [], error: null });
assert.equal(await staleSave, false, 'un save de un auth epoch obsoleto se descarta');
assert.equal(authRace.calls.some(call => call.name === 'admin_list_web_order_change_history'), false, 'el historial no se recarga bajo otra sesión');

console.log('order_tracking_admin_ui_regression: PASS (scope by loaded UUIDs, awaited list→history refresh, stale-history clearing, HTTPS and auth epoch)');
