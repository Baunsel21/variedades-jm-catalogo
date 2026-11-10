import assert from "node:assert/strict";
import {
  createTelegramDispatchHandler,
  formatTelegramNotification,
} from "../supabase/functions/telegram-dispatch/core.mjs";

const dispatchSecret = "a".repeat(64);
const serviceKey = `sb_secret_${"s".repeat(48)}`;
const botToken = `123456:${"T".repeat(32)}`;
const chatId = "-1001234567890";
const claimToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const dispatchLockToken = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const env = {
  SUPABASE_URL: "https://hnlbbtnfmbnbkcgegufa.supabase.co",
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: serviceKey }),
  TELEGRAM_BOT_TOKEN: botToken,
  TELEGRAM_CHAT_ID: chatId,
};

function request(body = { action: "dispatch", lock_token: dispatchLockToken }, headers = {}) {
  return new Request("https://function.invalid/telegram-dispatch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sirevya-dispatch-secret": dispatchSecret,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function rpcNameFromUrl(url) {
  return new URL(url).pathname.split("/").at(-1);
}

function rpcFetcher({ rows = [], telegramStatus = 200, telegramJson = { ok: true, result: { message_id: 919191 } }, networkFail = false, projectUrl = env.SUPABASE_URL, claimFailure = false, env: envOverride = env } = {}) {
  const calls = [];
  const loggerEvents = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/rest/v1/rpc/")) {
      const name = rpcNameFromUrl(url);
      const args = options.body ? JSON.parse(options.body) : {};
      if (name === "get_sirevya_telegram_dispatch_secret") return Response.json(dispatchSecret);
      if (name === "get_sirevya_telegram_project_url") return Response.json(projectUrl);
      if (name === "claim_sirevya_telegram_notifications") {
        calls.at(-1).args = args;
        if (claimFailure) return new Response("synthetic claim failure", { status: 503 });
        return Response.json(rows);
      }
      if (name === "complete_sirevya_telegram_notification") {
        calls.at(-1).args = args;
        return Response.json(args.p_claim_token === claimToken);
      }
      if (name === "retry_sirevya_telegram_notification") {
        calls.at(-1).args = args;
        return Response.json(args.p_retryable ? "pending" : "dead");
      }
      if (name === "release_sirevya_telegram_dispatch_lock") {
        calls.at(-1).args = args;
        return Response.json(args.p_lock_token === dispatchLockToken);
      }
      return new Response("unknown rpc", { status: 404 });
    }
    if (String(url).startsWith("https://api.telegram.org/")) {
      if (networkFail) throw new TypeError("synthetic transport failure with secret-bearing details");
      const optionsBody = JSON.parse(options.body);
      calls.at(-1).telegramBody = optionsBody;
      if (telegramStatus >= 400 && !telegramJson.ok) return Response.json(telegramJson, { status: telegramStatus });
      return Response.json(telegramJson, { status: telegramStatus });
    }
    throw new Error("Unexpected network target");
  };
  const handler = createTelegramDispatchHandler({
    env: envOverride,
    fetcher,
    logger: (event, details) => loggerEvents.push({ event, details }),
  });
  return { calls, loggerEvents, handler };
}

const syntheticId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orderRow = {
  id: syntheticId,
  claim_token: claimToken,
  event_type: "order.created",
  payload: {
    reference: "JM-TEST-042",
    payment_method: "wompi",
    payment_status: "PENDING",
    order_status: "NEW",
    total_cop: 130000,
    customer_name: "NOMBRE PRIVADO",
    city: "Cali",
    products: [
      { code: "SKU-1", name: "Camisa sintética", quantity: 2 },
      { code: "SKU-2", name: "Zapatos sintéticos", quantity: 1 },
    ],
    total_units: 3,
    customer_phone: "3001112233",
    customer_email: "private@example.test",
    customer_address: "DIRECCION PRIVADA",
  },
  attempt_count: 1,
};

// Formatter is allowlist-only: it includes only the explicitly approved customer
// name/city fields and ignores all other PII and arbitrary nested fields.
const formatted = formatTelegramNotification(orderRow);
assert.match(formatted, /Nuevo pedido/);
assert.match(formatted, /Pedido: JM-TEST-042/);
assert.match(formatted, /PENDING/);
assert.match(formatted, /Cliente: NOMBRE PRIVADO/);
assert.match(formatted, /Ciudad: Cali/);
assert.match(formatted, /SKU-1/);
assert.match(formatted, /Camisa sintética/);
assert.match(formatted, /Total de unidades: 3/);
for (const privateValue of ["3001112233", "private@example.test", "DIRECCION PRIVADA"]) {
  assert.equal(formatted.includes(privateValue), false);
}
const reservationFormatted = formatTelegramNotification({
  event_type: "reservation.released",
  payload: {
    reference: "RES-TEST-1",
    order_reference: "COD-TEST-002",
    reservation_status: "RELEASED",
    customer_name: "NOMBRE PRIVADO",
    city: "Cali",
    products: [{ code: "SKU-10", name: "Synthetic Shirt", quantity: 4 }],
    total_units: 4,
    customer_phone: "3001112233",
  },
});
assert.match(reservationFormatted, /Reserva de inventario liberada/);
assert.match(reservationFormatted, /Pedido: COD-TEST-002/);
assert.match(reservationFormatted, /Ref\. interna de reserva: RES-TEST-1/);
assert.ok(reservationFormatted.endsWith('Ref. interna de reserva: RES-TEST-1'), 'la referencia de reserva queda al final como dato secundario');
assert.match(reservationFormatted, /SKU-10/);
assert.equal(reservationFormatted.includes("3001112233"), false);
assert.equal(formatTelegramNotification({ event_type: "reservation.created", payload: { reference: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }).includes("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), false);
const legacyFormatted = formatTelegramNotification({
  event_type: "order.created",
  payload: {
    reference: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    payment_method: "Wompi",
    payment_status: "PENDING",
    order_status: "NEW",
    total_cop: 130000,
  },
});
assert.match(legacyFormatted, /Nuevo pedido/);
assert.doesNotMatch(legacyFormatted, /(?:Pedido|Reserva|Referencia):/);
assert.match(legacyFormatted, /Estado de pago: PENDING/);
assert.match(legacyFormatted, /Total: /);
assert.equal(legacyFormatted.includes("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), false);

const commercialReferenceFormatted = formatTelegramNotification({
  event_type: "order.created",
  payload: {
    reference: "JMCOD-PRIVATE-TECH-0001",
    order_reference: "COD-TEST-089",
    customer_name: "CLIENTE DE PRUEBA",
    city: "Cali",
    products: [
      { code: "SKU-TEST-1", name: "Body Chain de prueba", quantity: 2 },
      { code: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Producto con código UUID de prueba", quantity: 1 },
    ],
    total_units: 3,
  },
});
assert.match(commercialReferenceFormatted, /Pedido: COD-TEST-089/);
assert.match(commercialReferenceFormatted, /SKU-TEST-1.*Body Chain de prueba: 2/);
assert.match(commercialReferenceFormatted, /Total de unidades: 3/);
assert.equal(commercialReferenceFormatted.includes("JMCOD-PRIVATE-TECH-0001"), false);
assert.equal(commercialReferenceFormatted.includes("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), false);

const legacyReservationFormatted = formatTelegramNotification({
  event_type: "reservation.created",
  payload: {
    reference: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    product_code: "SKU-LEGACY-1",
    product_name: "Body Chain de prueba",
    quantity: 2,
    customer_name: "CLIENTE DE PRUEBA",
    city: "Cali",
    reservation_status: "ACTIVE",
  },
});
assert.match(legacyReservationFormatted, /SKU-LEGACY-1.*Body Chain de prueba: 2/);
assert.match(legacyReservationFormatted, /Total de unidades: 2/);
assert.equal(legacyReservationFormatted.includes("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), false);
const technicalInventoryFormat = formatTelegramNotification({
  event_type: "inventory.stockout",
  payload: {
    product_code: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    product_name: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    quantity: 0,
  },
});
assert.doesNotMatch(technicalInventoryFormat, /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|Código:|Producto:/);
assert.equal(formatTelegramNotification({ event_type: "unknown.event", payload: {} }), "");

// Invalid origin is rejected before the secret lookup, and cannot produce a send.
{
  const { calls, handler } = rpcFetcher({ rows: [orderRow] });
  const response = await handler(request({ action: "dispatch" }, { origin: "https://evil.example" }));
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
}

// Wrong dispatch secret never claims rows or contacts Telegram and is not echoed.
{
  const { calls, handler } = rpcFetcher({ rows: [orderRow] });
  const response = await handler(request({ action: "dispatch" }, { ["x-sirevya-dispatch-secret"]: "b".repeat(64) }));
  assert.equal(response.status, 401);
  assert.equal(calls.length, 1);
  assert.equal(rpcNameFromUrl(calls[0].url), "get_sirevya_telegram_dispatch_secret");
  assert.equal(calls.some((call) => call.url.startsWith("https://api.telegram.org/")), false);
  assert.equal((await response.text()).includes(dispatchSecret), false);
}

// A dispatcher pointed at another Supabase project fails closed before it can claim or send.
{
  const wrongProjectEnv = { ...env, SUPABASE_URL: "https://another-project.supabase.co" };
  const { calls, loggerEvents, handler } = rpcFetcher({ rows: [orderRow], env: wrongProjectEnv });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.equal(calls.some((call) => call.url.includes("claim_sirevya_telegram_notifications")), false);
  assert.equal(calls.some((call) => call.url.startsWith("https://api.telegram.org/")), false);
  assert.equal(calls.some((call) => rpcNameFromUrl(call.url) === "release_sirevya_telegram_dispatch_lock"), false);
  assert.equal(loggerEvents.some((entry) => entry.event === "dispatcher_project_mismatch"), true);
}

// Only the fixed dispatch action is accepted; payloads over the byte limit are rejected.
{
  const { calls, handler } = rpcFetcher({ rows: [orderRow] });
  const invalid = await handler(request({ action: "dispatch", lock_token: dispatchLockToken, include: "anything" }));
  assert.equal(invalid.status, 400);
  const oversized = new Request("https://function.invalid/telegram-dispatch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sirevya-dispatch-secret": dispatchSecret,
      "Content-Length": "2048",
    },
    body: JSON.stringify({ action: "dispatch", lock_token: dispatchLockToken, padding: "x".repeat(1500) }),
  });
  const tooLarge = await handler(oversized);
  assert.equal(tooLarge.status, 413);
  assert.equal(calls.some((call) => call.url.includes("claim_sirevya_telegram_notifications")), false);
}

// Any post-authentication stop releases the scheduler lock without contacting Telegram.
{
  const invalidCredentialEnv = { ...env, TELEGRAM_BOT_TOKEN: "" };
  const invalidCredentials = rpcFetcher({ rows: [orderRow], env: invalidCredentialEnv });
  const response = await invalidCredentials.handler(request());
  assert.equal(response.status, 503);
  assert.equal(invalidCredentials.calls.some((call) => rpcNameFromUrl(call.url) === "claim_sirevya_telegram_notifications"), false);
  assert.equal(invalidCredentials.calls.filter((call) => rpcNameFromUrl(call.url) === "release_sirevya_telegram_dispatch_lock").length, 1);
  assert.equal(invalidCredentials.calls.some((call) => call.url.startsWith("https://api.telegram.org/")), false);
}

// A claim RPC failure also releases the scheduler lock and never sends a partial batch.
{
  const failedClaim = rpcFetcher({ rows: [orderRow], claimFailure: true });
  const response = await failedClaim.handler(request());
  assert.equal(response.status, 503);
  assert.equal(failedClaim.calls.some((call) => rpcNameFromUrl(call.url) === "claim_sirevya_telegram_notifications"), true);
  assert.equal(failedClaim.calls.filter((call) => rpcNameFromUrl(call.url) === "release_sirevya_telegram_dispatch_lock").length, 1);
  assert.equal(failedClaim.calls.some((call) => call.url.startsWith("https://api.telegram.org/")), false);
}

// Successful dispatch uses only the two approved secrets, sends allowlisted text, and marks the outbox row.
{
  const { calls, loggerEvents, handler } = rpcFetcher({ rows: [orderRow] });
  const response = await handler(request());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, { ok: true, claimed: 1, sent: 1, retrying: 0, dead: 0, skipped: 0 });
  const telegramCall = calls.find((call) => call.url.startsWith("https://api.telegram.org/"));
  const rpcCall = calls.find((call) => call.url.includes("/rest/v1/rpc/"));
  const claimCall = calls.find((call) => rpcNameFromUrl(call.url) === "claim_sirevya_telegram_notifications");
  const completeCall = calls.find((call) => rpcNameFromUrl(call.url) === "complete_sirevya_telegram_notification");
  const releaseCall = calls.find((call) => rpcNameFromUrl(call.url) === "release_sirevya_telegram_dispatch_lock");
  assert.ok(telegramCall);
  assert.ok(releaseCall);
  assert.deepEqual(claimCall.args, { p_limit: 5, p_lease_seconds: 600 });
  assert.equal(completeCall.args.p_claim_token, claimToken);
  assert.equal(releaseCall.args.p_lock_token, dispatchLockToken);
  assert.equal(rpcCall.options.headers.apikey, serviceKey);
  assert.equal(rpcCall.options.headers.Authorization, undefined);
  assert.equal(telegramCall.url.endsWith(botToken + "/sendMessage"), true);
  assert.equal(telegramCall.telegramBody.chat_id, chatId);
  assert.equal(telegramCall.telegramBody.disable_web_page_preview, true);
  assert.equal(telegramCall.telegramBody.text.includes("Cliente: NOMBRE PRIVADO"), true);
  assert.equal(telegramCall.telegramBody.text.includes("Ciudad: Cali"), true);
  assert.equal(telegramCall.telegramBody.text.includes("SKU-1"), true);
  for (const privateValue of ["3001112233", "private@example.test", "DIRECCION PRIVADA"]) {
    assert.equal(telegramCall.telegramBody.text.includes(privateValue), false);
  }
  assert.equal(calls.some((call) => rpcNameFromUrl(call.url) === "complete_sirevya_telegram_notification"), true);
  const allDiagnostics = JSON.stringify({ loggerEvents, response: result });
  assert.equal(allDiagnostics.includes(botToken), false);
  assert.equal(allDiagnostics.includes(serviceKey), false);
  assert.equal(allDiagnostics.includes(dispatchSecret), false);
  assert.equal(allDiagnostics.includes(dispatchLockToken), false);
}

// The legacy service_role JWT continues to use both apikey and Authorization headers.
{
  const legacyKey = `eyJhbGciOiJIUzI1NiJ9.${"l".repeat(32)}.${"s".repeat(32)}`;
  const legacyEnv = { ...env, SUPABASE_SECRET_KEYS: "", SUPABASE_SERVICE_ROLE_KEY: legacyKey };
  const { calls, handler } = rpcFetcher({ rows: [orderRow], env: legacyEnv });
  await handler(request());
  const rpcCall = calls.find((call) => call.url.includes("/rest/v1/rpc/"));
  assert.equal(rpcCall.options.headers.apikey, legacyKey);
  assert.equal(rpcCall.options.headers.Authorization, `Bearer ${legacyKey}`);
}

// Telegram 429 is scheduled for bounded automatic retry; the body and description are never logged.
{
  const { calls, loggerEvents, handler } = rpcFetcher({
    rows: [{ ...orderRow, event_type: "payment.approved" }],
    telegramStatus: 429,
    telegramJson: { ok: false, error_code: 429, description: "sensitive response must not be logged", parameters: { retry_after: 30 } },
  });
  const response = await handler(request());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.retrying, 1);
  const retryCall = calls.find((call) => rpcNameFromUrl(call.url) === "retry_sirevya_telegram_notification");
  assert.equal(retryCall.args.p_claim_token, claimToken);
  assert.equal(retryCall.args.p_error_code, "telegram_rate_limited");
  assert.equal(retryCall.args.p_retryable, true);
  assert.equal(retryCall.args.p_retry_after_seconds, 30);
  assert.equal(JSON.stringify(loggerEvents).includes("sensitive response must not be logged"), false);
}

// Telegram 5xx retries; permanent 401 is placed in the dead-letter state.
{
  const transient = rpcFetcher({ rows: [{ ...orderRow, event_type: "payment.rejected" }], telegramStatus: 503, telegramJson: { ok: false } });
  const transientResult = await (await transient.handler(request())).json();
  assert.equal(transientResult.retrying, 1);
  const transientRetry = transient.calls.find((call) => rpcNameFromUrl(call.url) === "retry_sirevya_telegram_notification");
  assert.equal(transientRetry.args.p_error_code, "telegram_server_error");
  assert.equal(transientRetry.args.p_retryable, true);

  const permanent = rpcFetcher({ rows: [{ ...orderRow, event_type: "payment.error" }], telegramStatus: 401, telegramJson: { ok: false, description: "never log this" } });
  const permanentResult = await (await permanent.handler(request())).json();
  assert.equal(permanentResult.dead, 1);
  const permanentRetry = permanent.calls.find((call) => rpcNameFromUrl(call.url) === "retry_sirevya_telegram_notification");
  assert.equal(permanentRetry.args.p_error_code, "telegram_auth");
  assert.equal(permanentRetry.args.p_retryable, false);
  assert.equal(JSON.stringify(permanent.loggerEvents).includes("never log this"), false);
}

// Transport failures are recorded as retryable without logging provider details.
{
  const { calls, loggerEvents, handler } = rpcFetcher({ rows: [{ ...orderRow, event_type: "inventory.stockout" }], networkFail: true });
  const result = await (await handler(request())).json();
  assert.equal(result.retrying, 1);
  const retry = calls.find((call) => rpcNameFromUrl(call.url) === "retry_sirevya_telegram_notification");
  assert.equal(retry.args.p_error_code, "network");
  assert.equal(retry.args.p_retryable, true);
  assert.equal(JSON.stringify(loggerEvents).includes("synthetic transport failure"), false);
}

// A claim without a valid ownership token is never sent or mutated by the worker.
{
  const { calls, handler } = rpcFetcher({ rows: [{ ...orderRow, claim_token: undefined }] });
  const result = await (await handler(request())).json();
  assert.equal(result.skipped, 1);
  assert.equal(calls.some((call) => call.url.startsWith("https://api.telegram.org/")), false);
  assert.equal(calls.some((call) => rpcNameFromUrl(call.url) === "complete_sirevya_telegram_notification"), false);
  assert.equal(calls.some((call) => rpcNameFromUrl(call.url) === "retry_sirevya_telegram_notification"), false);
}

console.log("telegram_dispatch_worker_regression: PASS");
