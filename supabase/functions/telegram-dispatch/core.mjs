const MAX_BODY_BYTES = 1024;
const MAX_BATCH_SIZE = 5;
const CLAIM_LEASE_SECONDS = 600;
const RPC_TIMEOUT_MS = 8000;
const TELEGRAM_TIMEOUT_MS = 8000;
const TELEGRAM_DISPATCH_HEADER = "x-sirevya-dispatch-secret";

const EVENT_TITLES = Object.freeze({
  "order.created": "Nuevo pedido",
  "order.cancelled": "Pedido cancelado",
  "payment.pending": "Pago pendiente",
  "payment.approved": "Pago aprobado",
  "payment.rejected": "Pago rechazado",
  "payment.error": "Error de pago",
  "payment.voided": "Pago anulado",
  "inventory.stockout": "Producto agotado",
  "inventory.restocked": "Producto restablecido",
  "inventory.movement": "Movimiento de inventario",
  "reservation.created": "Reserva de inventario creada",
  "reservation.released": "Reserva de inventario liberada",
  "reservation.expired": "Reserva de inventario vencida",
  "reservation.whatsapp_reserved": "Inventario reservado para WhatsApp",
  "reservation.whatsapp_confirmed": "Reserva de WhatsApp confirmada",
});

function envValue(env, name) {
  try {
    const value = typeof env?.get === "function" ? env.get(name) : env?.[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function serviceKeyFromEnv(env) {
  const keysJson = envValue(env, "SUPABASE_SECRET_KEYS");
  if (keysJson) {
    try {
      const keys = JSON.parse(keysJson);
      const value = typeof keys?.default === "string" ? keys.default.trim() : "";
      if (value) return value;
    } catch {
      // Fall through to single-key environment aliases.
    }
  }
  return envValue(env, "SUPABASE_SECRET_KEY") || envValue(env, "SUPABASE_SERVICE_ROLE_KEY");
}

function validSupabaseBase(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return "";
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.origin;
  } catch {
    // Return empty below.
  }
  return "";
}

function validBotToken(value) {
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(value);
}

function validChatId(value) {
  return /^-?\d{1,20}$/.test(value) || /^@[A-Za-z0-9_]{5,32}$/.test(value);
}

function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function safeLog(logger, event, details = {}) {
  try {
    if (typeof logger === "function") logger(event, details);
  } catch {
    // Logging must never change dispatcher behavior.
  }
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function timeoutSignal(milliseconds) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(milliseconds);
  }
  return undefined;
}

async function readLimitedBody(request, maxBytes) {
  const contentLength = request.headers.get("content-length") ?? "";
  if (/^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) return { tooLarge: true, text: "" };
  const reader = request.body?.getReader?.();
  if (!reader) {
    const text = await request.text();
    return new TextEncoder().encode(text).byteLength > maxBytes
      ? { tooLarge: true, text: "" }
      : { tooLarge: false, text };
  }
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      try { await reader.cancel(); } catch {}
      return { tooLarge: true, text: "" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { tooLarge: false, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

function safeSingleLine(value, maxLength = 100) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeReference(value) {
  const reference = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 80);
  if (!reference || validUuid(reference) || /^JMCOD(?:[-_.].*)?$/i.test(reference)) return "";
  return reference;
}

function safeProductCode(value) {
  const code = safeSingleLine(value, 60);
  return code && !validUuid(code) ? code : "";
}

function safeProductName(value) {
  const name = safeSingleLine(value, 100);
  return name && !validUuid(name) ? name : "";
}

function formatCop(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) return "";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatTelegramNotification(row) {
  const eventType = String(row?.event_type ?? "");
  const title = EVENT_TITLES[eventType];
  if (!title) return "";
  const payload = row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : {};
  const reference = safeReference(payload.reference);
  const orderReference = safeReference(payload.commercial_reference)
    || safeReference(payload.order_reference)
    || (eventType.startsWith("order.") || eventType.startsWith("payment.") ? reference : "");
  const inventoryReference = safeReference(payload.inventory_reference);
  const reservationReference = eventType.startsWith("reservation.")
    ? inventoryReference || reference
    : "";
  const lines = [title];
  if (orderReference) lines.push(`Pedido: ${orderReference}`);
  if (!orderReference && !reservationReference && reference) {
    lines.push(`Referencia: ${reference}`);
  }

  const customerName = safeSingleLine(payload.customer_name, 120);
  const city = safeSingleLine(payload.city, 80);
  const products = Array.isArray(payload.products) ? payload.products : [];
  const productLines = [];
  let computedUnits = 0;
  for (const product of products) {
    if (!product || typeof product !== "object" || Array.isArray(product)) continue;
    const code = safeProductCode(product.code);
    const name = safeProductName(product.name);
    const quantity = Number(product.quantity ?? product.qty);
    if (!Number.isSafeInteger(quantity) || quantity < 1) continue;
    computedUnits += quantity;
    const productLabel = [code, name].filter(Boolean).join(" — ");
    if (productLabel) productLines.push(`- ${productLabel}: ${quantity}`);
  }

  if (productLines.length === 0 && eventType.startsWith("reservation.")) {
    const code = safeProductCode(payload.product_code);
    const name = safeProductName(payload.product_name);
    const quantity = Number(payload.quantity ?? payload.total_units);
    if ((code || name) && Number.isSafeInteger(quantity) && quantity > 0) {
      computedUnits = quantity;
      productLines.push(`- ${[code, name].filter(Boolean).join(" — ")}: ${quantity}`);
    }
  }

  if (customerName) lines.push(`Cliente: ${customerName}`);
  if (city) lines.push(`Ciudad: ${city}`);
  if (productLines.length > 0) {
    lines.push("Productos:", ...productLines);
  }
  const totalUnits = Number(payload.total_units);
  const units = Number.isSafeInteger(totalUnits) && totalUnits > 0 ? totalUnits : computedUnits;
  if (units > 0) lines.push(`Total de unidades: ${units}`);

  if (eventType === "order.created") {
    const method = safeSingleLine(payload.payment_method, 40);
    const payment = safeSingleLine(payload.payment_status, 32);
    const order = safeSingleLine(payload.order_status, 32);
    if (method) lines.push(`Medio: ${method}`);
    if (payment) lines.push(`Estado de pago: ${payment}`);
    if (order) lines.push(`Estado del pedido: ${order}`);
    const amount = formatCop(payload.total_cop);
    if (amount) lines.push(`Total: ${amount}`);
  } else if (eventType.startsWith("payment.")) {
    const method = safeSingleLine(payload.payment_method, 40);
    const payment = safeSingleLine(payload.payment_status, 32);
    if (method) lines.push(`Medio: ${method}`);
    if (payment) lines.push(`Estado: ${payment}`);
    const amount = formatCop(payload.total_cop);
    if (amount) lines.push(`Total: ${amount}`);
  } else if (eventType.startsWith("inventory.")) {
    const code = safeProductCode(payload.product_code);
    const product = safeProductName(payload.product_name);
    const movement = safeSingleLine(payload.movement_type, 32);
    const quantity = Number(payload.quantity);
    if (code) lines.push(`Código: ${code}`);
    if (product) lines.push(`Producto: ${product}`);
    if (movement) lines.push(`Movimiento: ${movement}`);
    if (Number.isSafeInteger(quantity)) lines.push(`Cantidad: ${quantity}`);
  } else if (eventType.startsWith("reservation.")) {
    const status = safeSingleLine(payload.reservation_status, 32);
    const method = safeSingleLine(payload.payment_method, 40);
    const payment = safeSingleLine(payload.payment_status, 32);
    const order = safeSingleLine(payload.order_status, 32);
    const amount = formatCop(payload.total_cop);
    if (method) lines.push(`Medio: ${method}`);
    if (payment) lines.push(`Estado de pago: ${payment}`);
    if (order) lines.push(`Estado del pedido: ${order}`);
    if (amount) lines.push(`Total: ${amount}`);
    if (status) lines.push(`Estado: ${status}`);
    if (reservationReference && reservationReference !== orderReference) {
      lines.push(`Ref. interna de reserva: ${reservationReference}`);
    }
  } else if (eventType === "order.cancelled") {
    const status = safeSingleLine(payload.order_status, 32);
    const method = safeSingleLine(payload.payment_method, 40);
    const amount = formatCop(payload.total_cop);
    if (method) lines.push(`Medio: ${method}`);
    if (status) lines.push(`Estado: ${status}`);
    if (amount) lines.push(`Total: ${amount}`);
  }

  return lines.join("\n").slice(0, 3800);
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function callRpc(fetcher, baseUrl, serviceKey, name, args) {
  const response = await fetcher(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      ...(serviceKey.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${serviceKey}` }),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(args),
    signal: timeoutSignal(RPC_TIMEOUT_MS),
  });
  const result = await parseJsonResponse(response);
  if (!response.ok) throw new Error(`rpc_${name}_${response.status}`);
  return result;
}

function classifyTelegramFailure(response, body) {
  if (response.status === 429) {
    const retryAfter = Number(body?.parameters?.retry_after);
    return {
      code: "telegram_rate_limited",
      retryable: true,
      retryAfterSeconds: Number.isInteger(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3600) : null,
    };
  }
  if (response.status >= 500) return { code: "telegram_server_error", retryable: true, retryAfterSeconds: null };
  if (response.status === 401 || response.status === 403) return { code: "telegram_auth", retryable: false, retryAfterSeconds: null };
  return { code: "telegram_rejected", retryable: false, retryAfterSeconds: null };
}

export function createTelegramDispatchHandler({
  env = {},
  fetcher = fetch,
  logger = (event, details) => console.warn(`[telegram-dispatch] ${event}`, details),
} = {}) {
  return async function handleTelegramDispatchRequest(request) {
    if (request.method !== "POST") return json(405, { ok: false, error: "Método no permitido." });
    if (request.headers.get("origin")) return json(403, { ok: false, error: "Solicitud servidor-a-servidor únicamente." });
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return json(415, { ok: false, error: "Se requiere JSON." });
    }

    const suppliedDispatchSecret = request.headers.get(TELEGRAM_DISPATCH_HEADER) ?? "";
    if (!/^[a-f0-9]{64}$/i.test(suppliedDispatchSecret)) return json(401, { ok: false, error: "Solicitud no autorizada." });

    const baseUrl = validSupabaseBase(envValue(env, "SUPABASE_URL"));
    const serviceKey = serviceKeyFromEnv(env);
    if (!baseUrl || serviceKey.length < 24 || serviceKey.length > 4096) {
      safeLog(logger, "dispatcher_configuration_unavailable", { stage: "supabase" });
      return json(503, { ok: false, error: "El dispatcher no está configurado." });
    }

    let expectedDispatchSecret;
    try {
      expectedDispatchSecret = await callRpc(fetcher, baseUrl, serviceKey, "get_sirevya_telegram_dispatch_secret", {});
    } catch {
      safeLog(logger, "dispatcher_auth_check_unavailable", { stage: "secret" });
      return json(503, { ok: false, error: "No se pudo autenticar el dispatcher." });
    }
    if (typeof expectedDispatchSecret !== "string" || !constantTimeEqual(suppliedDispatchSecret, expectedDispatchSecret)) {
      safeLog(logger, "dispatcher_auth_rejected", { stage: "secret" });
      return json(401, { ok: false, error: "Solicitud no autorizada." });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) return json(415, { ok: false, error: "Se requiere JSON." });
    let rawBody;
    try {
      const result = await readLimitedBody(request, MAX_BODY_BYTES);
      if (result.tooLarge) return json(413, { ok: false, error: "Solicitud demasiado grande." });
      rawBody = result.text;
    } catch {
      return json(400, { ok: false, error: "Solicitud no válida." });
    }
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json(400, { ok: false, error: "JSON no válido." });
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "dispatch" || !validUuid(body.lock_token) || Object.keys(body).length !== 2) {
      return json(400, { ok: false, error: "Acción no permitida." });
    }

    const lockToken = body.lock_token;
    let expectedProjectUrl;
    try {
      expectedProjectUrl = await callRpc(fetcher, baseUrl, serviceKey, "get_sirevya_telegram_project_url", {});
    } catch {
      safeLog(logger, "dispatcher_project_check_unavailable", { stage: "project" });
      return json(503, { ok: false, error: "No se pudo verificar el proyecto del dispatcher." });
    }
    if (typeof expectedProjectUrl !== "string" || validSupabaseBase(expectedProjectUrl) !== baseUrl) {
      safeLog(logger, "dispatcher_project_mismatch", { stage: "project" });
      return json(503, { ok: false, error: "El dispatcher no coincide con el proyecto configurado." });
    }

    const releaseDispatchLock = async () => {
      try {
        const released = await callRpc(fetcher, baseUrl, serviceKey, "release_sirevya_telegram_dispatch_lock", {
          p_lock_token: lockToken,
        });
        if (released !== true) safeLog(logger, "dispatcher_lock_release_not_applied", { stage: "release" });
      } catch {
        safeLog(logger, "dispatcher_lock_release_failed", { stage: "release" });
      }
    };

    const botToken = envValue(env, "TELEGRAM_BOT_TOKEN");
    const chatId = envValue(env, "TELEGRAM_CHAT_ID");
    if (!validBotToken(botToken) || !validChatId(chatId)) {
      safeLog(logger, "telegram_credentials_unavailable", { stage: "telegram" });
      await releaseDispatchLock();
      return json(503, { ok: false, error: "La configuración segura de Telegram no está disponible." });
    }

    let rows;
    try {
      rows = await callRpc(fetcher, baseUrl, serviceKey, "claim_sirevya_telegram_notifications", {
        p_limit: MAX_BATCH_SIZE,
        p_lease_seconds: CLAIM_LEASE_SECONDS,
      });
    } catch {
      safeLog(logger, "dispatcher_claim_failed", { stage: "claim" });
      await releaseDispatchLock();
      return json(503, { ok: false, error: "No se pudo leer la cola de notificaciones." });
    }
    if (!Array.isArray(rows)) {
      safeLog(logger, "dispatcher_claim_invalid_response", { stage: "claim" });
      await releaseDispatchLock();
      return json(503, { ok: false, error: "La cola de notificaciones no respondió correctamente." });
    }

    const counts = { claimed: rows.length, sent: 0, retrying: 0, dead: 0, skipped: 0 };
    for (const row of rows) {
      const text = formatTelegramNotification(row);
      const hasClaimAuthority = validUuid(row?.id) && validUuid(row?.claim_token);
      if (!text || !hasClaimAuthority) {
        counts.skipped += 1;
        if (!hasClaimAuthority) {
          safeLog(logger, "dispatcher_claim_invalid_row", { stage: "claim" });
          continue;
        }
        try {
          const state = await callRpc(fetcher, baseUrl, serviceKey, "retry_sirevya_telegram_notification", {
            p_id: row.id,
            p_claim_token: row.claim_token,
            p_error_code: "telegram_invalid_payload",
            p_retryable: false,
            p_retry_after_seconds: null,
          });
          if (state === "dead") counts.dead += 1;
        } catch {
          safeLog(logger, "dispatcher_failure_record_failed", { stage: "invalid_payload" });
        }
        continue;
      }

      let telegramResponse;
      let telegramBody;
      try {
        telegramResponse = await fetcher(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
          signal: timeoutSignal(TELEGRAM_TIMEOUT_MS),
        });
        telegramBody = await parseJsonResponse(telegramResponse);
      } catch (error) {
        const code = error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "network";
        try {
          const state = await callRpc(fetcher, baseUrl, serviceKey, "retry_sirevya_telegram_notification", {
            p_id: row.id,
            p_claim_token: row.claim_token,
            p_error_code: code,
            p_retryable: true,
            p_retry_after_seconds: null,
          });
          if (state === "pending") counts.retrying += 1;
          else if (state === "dead") counts.dead += 1;
        } catch {
          safeLog(logger, "dispatcher_failure_record_failed", { stage: "network_retry" });
        }
        safeLog(logger, "telegram_delivery_failed", { code });
        continue;
      }

      if (telegramResponse.ok && telegramBody?.ok === true && /^[0-9]{1,30}$/.test(String(telegramBody?.result?.message_id ?? ""))) {
        try {
          const marked = await callRpc(fetcher, baseUrl, serviceKey, "complete_sirevya_telegram_notification", {
            p_id: row.id,
            p_claim_token: row.claim_token,
            p_message_id: String(telegramBody.result.message_id),
          });
          if (marked === true) counts.sent += 1;
          else {
            counts.skipped += 1;
            safeLog(logger, "dispatcher_completion_not_applied", { stage: "complete" });
          }
        } catch {
          // Telegram may already have accepted the message. Keep the lease; at-least-once retry can rarely duplicate it.
          counts.skipped += 1;
          safeLog(logger, "dispatcher_completion_failed", { stage: "complete" });
        }
        continue;
      }

      const failure = classifyTelegramFailure(telegramResponse, telegramBody);
      try {
        const state = await callRpc(fetcher, baseUrl, serviceKey, "retry_sirevya_telegram_notification", {
          p_id: row.id,
          p_claim_token: row.claim_token,
          p_error_code: failure.code,
          p_retryable: failure.retryable,
          p_retry_after_seconds: failure.retryAfterSeconds,
        });
        if (state === "pending") counts.retrying += 1;
        else if (state === "dead") counts.dead += 1;
        else counts.skipped += 1;
      } catch {
        counts.skipped += 1;
        safeLog(logger, "dispatcher_failure_record_failed", { stage: "telegram_response" });
      }
      safeLog(logger, "telegram_delivery_rejected", { code: failure.code, status: telegramResponse.status });
    }

    await releaseDispatchLock();
    return json(200, { ok: true, ...counts });
  };
}
