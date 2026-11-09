import assert from 'node:assert/strict';
import {
  createTelegramTestHandler,
  TELEGRAM_TEST_MESSAGE,
} from '../supabase/functions/telegram-test/core.mjs';

const ORIGIN = 'https://sirevya.com.co';
const SUPABASE_URL = 'https://project-fixture.supabase.co';
const ANON_KEY = 'public-fixture-key';
const ACCESS_TOKEN = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmaXh0dXJlIn0.signature';
const BOT_TOKEN = '999999:unit_test_only_fake_token_abcdefghijklmnopqrstuvwxyz';
const CHAT_ID = '-1001234567890';
const ENV = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: ANON_KEY,
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_CHAT_ID: CHAT_ID,
};

function makeRequest({ origin = ORIGIN, authorization = `Bearer ${ACCESS_TOKEN}`, body = { action: 'test' }, contentType = 'application/json' } = {}) {
  const headers = { 'Content-Type': contentType };
  if (origin) headers.Origin = origin;
  if (authorization) headers.Authorization = authorization;
  if (origin === ORIGIN) headers.apikey = ANON_KEY;
  return new Request('https://functions-fixture.example/telegram-test', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function mockFetch({ isAdmin = true, telegramOk = true, telegramThrows = false, calls = [] } = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${SUPABASE_URL}/auth/v1/user`) {
      return new Response(JSON.stringify({ id: 'fixture-admin-id' }), { status: 200 });
    }
    if (url === `${SUPABASE_URL}/rest/v1/rpc/is_store_admin`) {
      assert.equal(init.method, 'POST');
      assert.equal(init.body, '{}');
      assert.equal(init.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
      return new Response(JSON.stringify(isAdmin), { status: 200 });
    }
    if (url === `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`) {
      if (telegramThrows) throw new Error('unit fixture transport failure');
      return new Response(JSON.stringify(telegramOk
        ? { ok: true, result: { message_id: 123, chat: { id: CHAT_ID } } }
        : { ok: false, description: `secret-like ${BOT_TOKEN} fixture diagnostic` }), { status: telegramOk ? 200 : 400 });
    }
    assert.fail(`Unexpected request URL: ${url}`);
  };
}

const successCalls = [];
let now = 100_000;
const handler = createTelegramTestHandler({ env: ENV, fetcher: mockFetch({ calls: successCalls }), now: () => now });
const successResponse = await handler(makeRequest());
const successPayload = await successResponse.json();
assert.equal(successResponse.status, 200);
assert.equal(successPayload.ok, true);
assert.equal(successPayload.accepted, true);
assert.match(successPayload.message, /verifica su recepción/);
assert.equal(successResponse.headers.get('access-control-allow-origin'), ORIGIN);
assert.equal(successCalls.length, 3, 'La única secuencia externa es verificar usuario, rol admin y enviar el mensaje fijo.');
const telegramCall = successCalls[2];
assert.equal(telegramCall.init.method, 'POST');
assert.deepEqual(JSON.parse(telegramCall.init.body), {
  chat_id: CHAT_ID,
  text: TELEGRAM_TEST_MESSAGE,
  disable_web_page_preview: true,
});
assert.equal(telegramCall.init.headers.Authorization, undefined, 'El token del bot nunca va al cliente ni en el header Authorization.');
assert.equal(successPayload.message.includes(BOT_TOKEN), false);
assert.equal(JSON.stringify(successPayload).includes(CHAT_ID), false);

const duplicateResponse = await handler(makeRequest());
assert.equal(duplicateResponse.status, 429, 'Una misma instancia limita una repetición inmediata de la prueba.');
assert.equal(successCalls.filter(call => call.url.startsWith('https://api.telegram.org/')).length, 1);

const deniedCalls = [];
const deniedOrigin = await createTelegramTestHandler({ env: ENV, fetcher: mockFetch({ calls: deniedCalls }) })(
  makeRequest({ origin: 'https://preview.example' }),
);
assert.equal(deniedOrigin.status, 403);
assert.equal(deniedCalls.length, 0, 'Preview no puede enviar mensajes reales.');

const missingOriginCalls = [];
const missingOrigin = await createTelegramTestHandler({ env: ENV, fetcher: mockFetch({ calls: missingOriginCalls }) })(makeRequest({ origin: '' }));
assert.equal(missingOrigin.status, 403, 'La solicitud debe originarse en el dominio oficial incluso si falta Origin.');
assert.equal(missingOriginCalls.length, 0);

const oversizedCalls = [];
const oversized = await createTelegramTestHandler({ env: ENV, fetcher: mockFetch({ calls: oversizedCalls }) })(makeRequest({ body: 'x'.repeat(1025) }));
assert.equal(oversized.status, 413, 'El límite se aplica en bytes antes de parsear.');
assert.equal(oversizedCalls.length, 0);

const noAuthCalls = [];
const noAuth = await createTelegramTestHandler({ env: ENV, fetcher: mockFetch({ calls: noAuthCalls }) })(
  makeRequest({ authorization: '' }),
);
assert.equal(noAuth.status, 401);
assert.equal(noAuthCalls.length, 0);

const nonAdminCalls = [];
const nonAdmin = await createTelegramTestHandler({ env: ENV, fetcher: mockFetch({ isAdmin: false, calls: nonAdminCalls }) })(makeRequest());
assert.equal(nonAdmin.status, 403);
assert.equal(nonAdminCalls.filter(call => call.url.startsWith('https://api.telegram.org/')).length, 0);

const extraPayloadCalls = [];
const extraPayload = await createTelegramTestHandler({ env: ENV, fetcher: mockFetch({ calls: extraPayloadCalls }) })(
  makeRequest({ body: { action: 'test', chat_id: '@attacker', text: 'arbitrary message' } }),
);
assert.equal(extraPayload.status, 400, 'El cliente no puede elegir destinatario ni texto.');
assert.equal(extraPayloadCalls.length, 0);

const badContentType = await createTelegramTestHandler({ env: ENV, fetcher: mockFetch() })(makeRequest({ contentType: 'text/plain' }));
assert.equal(badContentType.status, 415);

const missingSecretsEnv = { SUPABASE_URL, SUPABASE_ANON_KEY: ANON_KEY };
const missingSecretCalls = [];
const missingSecrets = await createTelegramTestHandler({ env: missingSecretsEnv, fetcher: mockFetch({ calls: missingSecretCalls }) })(makeRequest());
assert.equal(missingSecrets.status, 503);
assert.equal(missingSecretCalls.filter(call => call.url.startsWith('https://api.telegram.org/')).length, 0);

const telegramFailureCalls = [];
const telegramFailureLogs = [];
const telegramFailure = await createTelegramTestHandler({ env: ENV, fetcher: mockFetch({ telegramOk: false, calls: telegramFailureCalls }), logger: (event, details) => telegramFailureLogs.push({ event, details }) })(makeRequest());
const telegramFailureText = await telegramFailure.text();
assert.equal(telegramFailure.status, 502);
assert.equal(telegramFailureText.includes(BOT_TOKEN), false, 'Los errores remotos no revelan el token ni el cuerpo de Telegram.');
assert.equal(telegramFailureLogs[0]?.event, 'telegram_test_rejected');
assert.equal(JSON.stringify(telegramFailureLogs).includes(BOT_TOKEN), false);
assert.equal(JSON.stringify(telegramFailureLogs).includes(CHAT_ID), false);

const transportFailureCalls = [];
const transportFailureLogs = [];
const transportFailure = await createTelegramTestHandler({ env: ENV, fetcher: mockFetch({ telegramThrows: true, calls: transportFailureCalls }), logger: (event, details) => transportFailureLogs.push({ event, details }) })(makeRequest());
assert.equal(transportFailure.status, 502);
assert.equal(transportFailureLogs[0]?.event, 'telegram_test_delivery_unknown');
assert.equal(JSON.stringify(transportFailureLogs).includes(BOT_TOKEN), false);

const preflight = await createTelegramTestHandler({ env: ENV, fetcher: mockFetch() })(new Request('https://functions-fixture.example/telegram-test', {
  method: 'OPTIONS',
  headers: { Origin: ORIGIN },
}));
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);

console.log('telegram_test_edge_regression: PASS');
