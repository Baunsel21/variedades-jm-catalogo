import assert from 'node:assert/strict';
import { createTelegramDispatchHandler } from '../supabase/functions/telegram-dispatch/core.mjs';

const ORIGIN = '';
const SUPABASE_URL = 'https://hnlbbtnfmbnbkcgegufa.supabase.co';
const SERVICE_KEY = 'sb_secret_fixture_service_key_12345678901234567890';
const DISPATCH_SECRET = 'a'.repeat(64);
const LOCK_TOKEN = '11111111-1111-4111-8111-111111111111';
const CLAIM_TOKEN = '22222222-2222-4222-8222-222222222222';
const ROW_ID = '33333333-3333-4333-8333-333333333333';
const BOT_TOKEN = '999999:unit_test_only_fake_token_abcdefghijklmnopqrstuvwxyz';
const CHAT_ID = '-1001234567890';

const professionalPayload = {
  order_reference: 'JM-SYNTH-001',
  customer_name: 'Cliente de prueba',
  customer_phone: '300 555 0101',
  city: 'Cali',
  delivery_address: 'Carrera Sintética 10-20',
  payment_method: 'Wompi',
  payment_status: 'APPROVED',
  order_status: 'PREPARANDO',
  subtotal_cop: 120000,
  shipping_cop: 10000,
  total_cop: 130000,
  total_units: 3,
  products: [
    { name: 'Blusa sintética', variant: 'Rojo · M', quantity: 2, unit_price_cop: 50000 },
    { name: 'Pantalón sintético', variant: 'Negro · 8', quantity: 1, unit_price_cop: 20000 },
  ],
};

function makeRequest() {
  return new Request(`${SUPABASE_URL}/functions/v1/telegram-dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sirevya-dispatch-secret': DISPATCH_SECRET },
    body: JSON.stringify({ action: 'dispatch', lock_token: LOCK_TOKEN }),
  });
}

function makeHarness({ telegramOk = true } = {}) {
  let claimed = false;
  const calls = [];
  const logs = [];
  const env = {
    SUPABASE_URL,
    SUPABASE_SECRET_KEY: SERVICE_KEY,
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_CHAT_ID: CHAT_ID,
  };
  const row = {
    id: ROW_ID,
    claim_token: CLAIM_TOKEN,
    dedupe_key: 'order:synthetic-order:created',
    event_type: 'order.created',
    source_table: 'web_orders',
    source_id: 'synthetic-order',
    payload: professionalPayload,
  };
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${SUPABASE_URL}/rest/v1/rpc/get_sirevya_telegram_dispatch_secret`) {
      return new Response(JSON.stringify(DISPATCH_SECRET), { status: 200 });
    }
    if (url === `${SUPABASE_URL}/rest/v1/rpc/get_sirevya_telegram_project_url`) {
      return new Response(JSON.stringify(SUPABASE_URL), { status: 200 });
    }
    if (url === `${SUPABASE_URL}/rest/v1/rpc/claim_sirevya_telegram_notifications`) {
      const result = claimed ? [] : [row];
      claimed = true;
      return new Response(JSON.stringify(result), { status: 200 });
    }
    if (url === `${SUPABASE_URL}/rest/v1/rpc/complete_sirevya_telegram_notification`) {
      return new Response(JSON.stringify(telegramOk), { status: 200 });
    }
    if (url === `${SUPABASE_URL}/rest/v1/rpc/release_sirevya_telegram_dispatch_lock`) {
      return new Response('true', { status: 200 });
    }
    if (url === `${SUPABASE_URL}/rest/v1/rpc/retry_sirevya_telegram_notification`) {
      const args = JSON.parse(init.body);
      calls.push({ retry: args });
      return new Response(JSON.stringify('pending'), { status: 200 });
    }
    if (url === `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`) {
      return new Response(JSON.stringify(telegramOk
        ? { ok: true, result: { message_id: 987654, chat: { id: CHAT_ID } } }
        : { ok: false, description: 'synthetic rejected' }), { status: telegramOk ? 200 : 400 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  return { env, fetcher, calls, logs, row, handler: createTelegramDispatchHandler({ env, fetcher, logger: (event, details) => logs.push({ event, details }) }) };
}

const success = makeHarness();
const first = await success.handler(makeRequest());
assert.equal(first.status, 200);
assert.deepEqual(await first.json(), { ok: true, claimed: 1, sent: 1, retrying: 0, dead: 0, skipped: 0 });
const telegramCall = success.calls.find(call => call.url?.startsWith('https://api.telegram.org/'));
assert.ok(telegramCall, 'El dispatcher debe llamar al Telegram fixture');
const message = JSON.parse(telegramCall.init.body).text;
for (const expected of [
  'Pedido: JM-SYNTH-001',
  'Cliente: Cliente de prueba',
  'Teléfono: 300 555 0101',
  'Ciudad: Cali',
  'Dirección: Carrera Sintética 10-20',
  'Blusa sintética · Rojo · M · Cantidad: 2',
  'Pantalón sintético · Negro · 8 · Cantidad: 1',
  'Subtotal: $ 120.000',
  'Envío: $ 10.000',
  'Total: $ 130.000',
  'Pago: Wompi',
  'Estado del pedido: En preparación',
]) assert.match(message, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.doesNotMatch(message, /33333333-3333-4333-8333-333333333333|SKU-/);

const second = await success.handler(makeRequest());
assert.equal(second.status, 200);
assert.deepEqual(await second.json(), { ok: true, claimed: 0, sent: 0, retrying: 0, dead: 0, skipped: 0 }, 'La segunda ejecución no debe reenviar el mismo dedupe_key');
assert.equal(success.calls.filter(call => call.url?.startsWith('https://api.telegram.org/')).length, 1);

const failure = makeHarness({ telegramOk: false });
const failed = await failure.handler(makeRequest());
assert.equal(failed.status, 200);
assert.deepEqual(await failed.json(), { ok: true, claimed: 1, sent: 0, retrying: 1, dead: 0, skipped: 0 });
const retry = failure.calls.find(call => call.retry);
assert.equal(retry.retry.p_error_code, 'telegram_rejected');
assert.equal(retry.retry.p_retryable, false);
assert.equal(failure.logs.at(-1)?.event, 'telegram_delivery_rejected');

console.log('telegram_dispatch_synthetic_e2e_regression: PASS');
