import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const admin = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
assert.match(admin, /id="telegramTestBox"/);
assert.match(admin, /id="telegramTestBtn"[^>]*disabled/);
assert.match(admin, /id="telegramTestStatus"[^>]*role="status"/);
assert.match(admin, /No incluye pedidos, clientes ni datos personales/);
assert.match(admin, /id="telegramAutomaticBox"/);
assert.match(admin, /id="telegramAutomaticToggle"[^>]*disabled/);
assert.match(admin, /id="telegramAutomaticMetrics"[^>]*aria-live="polite"/);
assert.match(admin, /get_sirevya_telegram_notification_status/);
assert.match(admin, /set_sirevya_telegram_notifications_enabled/);
assert.doesNotMatch(admin, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|SUPABASE_SERVICE_ROLE_KEY/);

function extractFunction(name, async = true) {
  const prefix = async ? 'async function' : 'function';
  const matcher = new RegExp(`^${prefix} ${name}\\([^\\n]*\\)\\s*\\{[\\s\\S]*?^\\}`, 'm');
  const match = admin.match(matcher);
  assert.ok(match, `Could not find ${name}`);
  return match[0];
}

function buildContext({ origin, adminAuthorized = true, confirmResult = true, invokeResult = { data: { ok: true }, error: null } }) {
  const elements = {
    telegramTestBtn: { disabled: true },
    telegramTestStatus: { textContent: '', className: 'status' },
  };
  const invokeCalls = [];
  const authChecks = [];
  const context = {
    location: { origin },
    adminSessionAuthorized: adminAuthorized,
    adminSessionUserId: 'fixture-admin-id',
    adminAuthEpoch: 7,
    $: id => elements[id] ?? null,
    confirm: () => confirmResult,
    setTelegramTestStatus: (message, tone = '') => {
      elements.telegramTestStatus.textContent = message;
      elements.telegramTestStatus.className = `status ${tone}`.trim();
    },
    adminAuthOperationStillCurrent: (userId, epoch) => userId === 'fixture-admin-id' && epoch === 7,
    assertCurrentAdminAuthorization: async (userId, epoch) => { authChecks.push([userId, epoch]); },
    sb: {
      functions: {
        invoke: async (...args) => { invokeCalls.push(args); return invokeResult; },
      },
    },
  };
  return { context, elements, invokeCalls, authChecks };
}

const preview = buildContext({ origin: 'https://4173-preview.example' });
vm.runInNewContext(`globalThis.run = ${extractFunction('sendTelegramTestMessage')};`, preview.context);
await preview.context.run();
assert.equal(preview.invokeCalls.length, 0, 'La preview no puede enviar mensajes reales.');
assert.match(preview.elements.telegramTestStatus.textContent, /solo se puede enviar desde sirevya\.com\.co/);

const canceled = buildContext({ origin: 'https://sirevya.com.co', confirmResult: false });
vm.runInNewContext(`globalThis.run = ${extractFunction('sendTelegramTestMessage')};`, canceled.context);
await canceled.context.run();
assert.equal(canceled.invokeCalls.length, 0, 'Cancelar el diálogo no envía el mensaje.');

const official = buildContext({ origin: 'https://sirevya.com.co' });
vm.runInNewContext(`globalThis.run = ${extractFunction('sendTelegramTestMessage')};`, official.context);
await official.context.run();
assert.equal(official.authChecks.length, 1);
assert.equal(official.invokeCalls.length, 1);
assert.equal(official.invokeCalls[0][0], 'telegram-test');
assert.equal(JSON.stringify(official.invokeCalls[0][1]), JSON.stringify({ body: { action: 'test' } }), 'No se envían pedido, cliente, chat alternativo ni texto libre.');
assert.match(official.elements.telegramTestStatus.textContent, /Telegram aceptó el mensaje de prueba/);
assert.equal(official.elements.telegramTestBtn.disabled, false);

const nonAdmin = buildContext({ origin: 'https://sirevya.com.co', adminAuthorized: false });
vm.runInNewContext(`globalThis.run = ${extractFunction('sendTelegramTestMessage')};`, nonAdmin.context);
await nonAdmin.context.run();
assert.equal(nonAdmin.invokeCalls.length, 0);
assert.match(nonAdmin.elements.telegramTestStatus.textContent, /admin autorizada/);

const refreshFunction = extractFunction('refreshTelegramTestButton', false);
const previewButtonContext = buildContext({ origin: 'https://4173-preview.example' });
vm.runInNewContext(`globalThis.refresh = ${refreshFunction};`, previewButtonContext.context);
previewButtonContext.context.refresh();
assert.equal(previewButtonContext.elements.telegramTestBtn.disabled, true);
const officialButtonContext = buildContext({ origin: 'https://sirevya.com.co' });
vm.runInNewContext(`globalThis.refresh = ${refreshFunction};`, officialButtonContext.context);
officialButtonContext.context.refresh();
assert.equal(officialButtonContext.elements.telegramTestBtn.disabled, false);

function buildAutomaticContext({ origin, adminAuthorized = true, confirmResult = true, statusResult = { data: { enabled: false, scheduler_ready: true, dispatcher_ready: true, pending_count: 4, processing_count: 1, sent_last_24h: 8, dead_count: 0, last_error_code: null, last_error_at: null }, error: null }, setResult = { data: { success: true, enabled: true }, error: null } }) {
  const elements = {
    telegramAutomaticToggle: { checked: false, disabled: true },
    telegramAutomaticStatus: { textContent: '', className: 'status' },
    telegramAutomaticMetrics: { textContent: '' },
    refreshTelegramAutomaticBtn: { disabled: true },
    saveTelegramAutomaticBtn: { disabled: true },
  };
  const rpcCalls = [];
  const authChecks = [];
  const confirmCalls = [];
  const context = {
    location: { origin },
    adminSessionAuthorized: adminAuthorized,
    adminSessionUserId: 'fixture-admin-id',
    adminAuthEpoch: 7,
    telegramAutomaticSettingsLoaded: false,
    telegramAutomaticSettingsOriginal: null,
    telegramAutomaticSchedulerReady: false,
    telegramAutomaticDispatcherReady: false,
    telegramAutomaticSaving: false,
    telegramAutomaticErrorCodes: new Set(['network','timeout','telegram_rate_limited','telegram_server_error','telegram_rejected','telegram_auth','telegram_invalid_payload','worker_internal','db_completion']),
    $: id => elements[id] ?? null,
    confirm: message => { confirmCalls.push(message); return confirmResult; },
    adminAuthOperationStillCurrent: (userId, epoch) => userId === 'fixture-admin-id' && epoch === 7,
    assertCurrentAdminAuthorization: async (userId, epoch) => { authChecks.push([userId, epoch]); },
    sb: { rpc: async (...args) => { rpcCalls.push(args); return args[0] === 'get_sirevya_telegram_notification_status' ? statusResult : setResult; } },
  };
  const uiFunctions = [
    extractFunction('setTelegramAutomaticStatus', false),
    extractFunction('updateTelegramAutomaticControls', false),
    extractFunction('loadTelegramAutomaticStatus'),
    extractFunction('saveTelegramAutomaticSettings'),
  ].join('\n');
  vm.runInNewContext(uiFunctions, context);
  return { context, elements, rpcCalls, authChecks, confirmCalls };
}

const automaticPreview = buildAutomaticContext({ origin: 'https://4173-preview.example' });
await automaticPreview.context.loadTelegramAutomaticStatus(true);
assert.equal(automaticPreview.rpcCalls.length, 0, 'La preview no consulta Supabase real.');
assert.equal(automaticPreview.elements.telegramAutomaticToggle.disabled, true);
assert.match(automaticPreview.elements.telegramAutomaticStatus.textContent, /no consulta Supabase/);

const automaticOfficial = buildAutomaticContext({ origin: 'https://sirevya.com.co' });
assert.equal(await automaticOfficial.context.loadTelegramAutomaticStatus(true), true);
assert.equal(automaticOfficial.authChecks.length, 1);
assert.equal(automaticOfficial.rpcCalls[0][0], 'get_sirevya_telegram_notification_status');
assert.match(automaticOfficial.elements.telegramAutomaticMetrics.textContent, /Pendientes: 4 · En proceso: 1 · Enviadas en 24 h: 8/);
assert.match(automaticOfficial.elements.telegramAutomaticStatus.textContent, /Worker marcado como verificado/);
automaticOfficial.elements.telegramAutomaticToggle.checked = true;
assert.equal(await automaticOfficial.context.saveTelegramAutomaticSettings(), true);
assert.deepEqual(JSON.parse(JSON.stringify(automaticOfficial.rpcCalls[1])), ['set_sirevya_telegram_notifications_enabled', { p_enabled: true }]);
assert.equal(automaticOfficial.confirmCalls.length, 1);
assert.match(automaticOfficial.elements.telegramAutomaticStatus.textContent, /activadas/);

const automaticCanceled = buildAutomaticContext({ origin: 'https://sirevya.com.co', confirmResult: false });
await automaticCanceled.context.loadTelegramAutomaticStatus(false);
automaticCanceled.elements.telegramAutomaticToggle.checked = true;
assert.equal(await automaticCanceled.context.saveTelegramAutomaticSettings(), false);
assert.equal(automaticCanceled.rpcCalls.length, 1, 'Cancelar la confirmación no guarda el toggle.');
assert.equal(automaticCanceled.elements.telegramAutomaticToggle.checked, false);

const automaticNotReady = buildAutomaticContext({
  origin: 'https://sirevya.com.co',
  statusResult: { data: { enabled: false, scheduler_ready: false, dispatcher_ready: false, pending_count: 0, processing_count: 0, sent_last_24h: 0, dead_count: 0 }, error: null },
});
await automaticNotReady.context.loadTelegramAutomaticStatus(false);
automaticNotReady.elements.telegramAutomaticToggle.checked = true;
assert.equal(await automaticNotReady.context.saveTelegramAutomaticSettings(), false);
assert.equal(automaticNotReady.rpcCalls.length, 1, 'No se llama al RPC de escritura si el scheduler no está listo.');
assert.equal(automaticNotReady.elements.telegramAutomaticToggle.checked, false);

const automaticWorkerNotReady = buildAutomaticContext({
  origin: 'https://sirevya.com.co',
  statusResult: { data: { enabled: false, scheduler_ready: true, dispatcher_ready: false, pending_count: 0, processing_count: 0, sent_last_24h: 0, dead_count: 0 }, error: null },
});
await automaticWorkerNotReady.context.loadTelegramAutomaticStatus(false);
automaticWorkerNotReady.elements.telegramAutomaticToggle.checked = true;
assert.equal(await automaticWorkerNotReady.context.saveTelegramAutomaticSettings(), false);
assert.equal(automaticWorkerNotReady.rpcCalls.length, 1, 'No se escribe si el worker no fue marcado como verificado.');
assert.equal(automaticWorkerNotReady.elements.telegramAutomaticToggle.checked, false);

const automaticServerWorkerGate = buildAutomaticContext({
  origin: 'https://sirevya.com.co',
  setResult: { data: { success: false, code: 'DISPATCHER_NOT_READY', enabled: false }, error: null },
});
await automaticServerWorkerGate.context.loadTelegramAutomaticStatus(false);
automaticServerWorkerGate.elements.telegramAutomaticToggle.checked = true;
assert.equal(await automaticServerWorkerGate.context.saveTelegramAutomaticSettings(), false);
assert.equal(automaticServerWorkerGate.rpcCalls.length, 2);
assert.equal(automaticServerWorkerGate.context.telegramAutomaticDispatcherReady, false);
assert.equal(automaticServerWorkerGate.elements.telegramAutomaticToggle.checked, false);

const automaticStale = buildAutomaticContext({ origin: 'https://sirevya.com.co' });
await automaticStale.context.loadTelegramAutomaticStatus(false);
automaticStale.elements.telegramAutomaticToggle.checked = true;
let resolveStaleRpc;
automaticStale.context.sb.rpc = async (...args) => {
  automaticStale.rpcCalls.push(args);
  return new Promise(resolve => { resolveStaleRpc = resolve; });
};
const staleSave = automaticStale.context.saveTelegramAutomaticSettings();
await new Promise(resolve => setImmediate(resolve));
assert.equal(typeof resolveStaleRpc, 'function');
automaticStale.context.adminAuthOperationStillCurrent = () => false;
resolveStaleRpc({ data: { success: true, enabled: true }, error: null });
assert.equal(await staleSave, false);
assert.equal(automaticStale.context.telegramAutomaticSaving, false, 'Una sesión nueva no hereda un guardado bloqueado por la solicitud antigua.');

const automaticNonAdmin = buildAutomaticContext({ origin: 'https://sirevya.com.co', adminAuthorized: false });
await automaticNonAdmin.context.loadTelegramAutomaticStatus(true);
assert.equal(automaticNonAdmin.rpcCalls.length, 0);
assert.match(automaticNonAdmin.elements.telegramAutomaticStatus.textContent, /cuenta admin autorizada/);

console.log('telegram_admin_ui_regression: PASS');
