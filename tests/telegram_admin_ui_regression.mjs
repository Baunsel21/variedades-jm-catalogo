import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const admin = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
assert.match(admin, /id="telegramTestBox"/);
assert.match(admin, /id="telegramTestBtn"[^>]*disabled/);
assert.match(admin, /id="telegramTestStatus"[^>]*role="status"/);
assert.match(admin, /No incluye pedidos, clientes ni datos personales/);
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

console.log('telegram_admin_ui_regression: PASS');
