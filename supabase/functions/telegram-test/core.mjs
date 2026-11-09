const OFFICIAL_ORIGIN = "https://sirevya.com.co";
const MAX_BODY_CHARS = 1024;
const REQUEST_TIMEOUT_MS = 5000;
const TEST_COOLDOWN_MS = 60_000;

export const TELEGRAM_TEST_MESSAGE = "Prueba de conexión de Telegram para Sirevya. El bot puede enviar mensajes.";

function envValue(env, name) {
  try {
    const value = typeof env?.get === "function" ? env.get(name) : env?.[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function safeLog(logger, event, details = {}) {
  try {
    if (typeof logger === "function") logger(event, details);
  } catch {
    // Logging must never change the behavior of the notification endpoint.
  }
}

function makeHeaders(request) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "300",
  });
  const origin = request.headers.get("origin");
  if (origin === OFFICIAL_ORIGIN) headers.set("Access-Control-Allow-Origin", OFFICIAL_ORIGIN);
  return headers;
}

function json(request, status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: makeHeaders(request) });
}

function timeoutSignal() {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }
  return undefined;
}

function validSupabaseBase(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function validChatId(value) {
  return /^-?\d{1,20}$/.test(value) || /^@[A-Za-z0-9_]{5,32}$/.test(value);
}

async function readLimitedBody(request, maxBytes) {
  const contentLength = request.headers.get("content-length") ?? "";
  if (/^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) return { tooLarge: true, text: "" };
  const reader = request.body?.getReader?.();
  if (!reader) {
    const text = await request.text();
    return new TextEncoder().encode(text).byteLength > maxBytes ? { tooLarge: true, text: "" } : { tooLarge: false, text };
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

export function createTelegramTestHandler({
  env = {},
  fetcher = fetch,
  now = Date.now,
  cooldownMs = TEST_COOLDOWN_MS,
  logger = (event, details) => console.warn(`[telegram-test] ${event}`, details),
} = {}) {
  let lastSendAttemptAt = Number.NEGATIVE_INFINITY;

  return async function handleTelegramTestRequest(request) {
    const origin = request.headers.get("origin");
    if (origin !== OFFICIAL_ORIGIN) return json(request, 403, { ok: false, error: "Origen no autorizado." });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: makeHeaders(request) });
    if (request.method !== "POST") return json(request, 405, { ok: false, error: "Método no permitido." });

    const contentType = request.headers.get("content-type") ?? "";
    if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
      return json(request, 415, { ok: false, error: "Se requiere JSON." });
    }

    let rawBody;
    try {
      const bodyResult = await readLimitedBody(request, MAX_BODY_CHARS);
      if (bodyResult.tooLarge) return json(request, 413, { ok: false, error: "Solicitud demasiado grande." });
      rawBody = bodyResult.text;
    } catch {
      return json(request, 400, { ok: false, error: "Solicitud no válida." });
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json(request, 400, { ok: false, error: "JSON no válido." });
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "test" || Object.keys(body).length !== 1) {
      return json(request, 400, { ok: false, error: "Acción no permitida." });
    }

    const authorization = request.headers.get("authorization") ?? "";
    const bearer = authorization.match(/^Bearer\s+([A-Za-z0-9._~-]{24,4096})$/i)?.[1] ?? "";
    const supabaseBase = validSupabaseBase(envValue(env, "SUPABASE_URL"));
    const apiKey = request.headers.get("apikey") || envValue(env, "SUPABASE_PUBLISHABLE_KEY") || envValue(env, "SUPABASE_ANON_KEY");
    if (!bearer || !supabaseBase || !apiKey || apiKey.length > 2048) {
      return json(request, 401, { ok: false, error: "Se requiere una sesión administrativa válida." });
    }

    const supabaseHeaders = {
      apikey: apiKey,
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
    };
    let userResponse;
    try {
      userResponse = await fetcher(`${supabaseBase}/auth/v1/user`, {
        method: "GET",
        headers: supabaseHeaders,
        signal: timeoutSignal(),
      });
    } catch {
      safeLog(logger, "supabase_auth_unavailable", { stage: "user" });
      return json(request, 503, { ok: false, error: "No se pudo verificar la sesión." });
    }
    if (!userResponse.ok) return json(request, 401, { ok: false, error: "Se requiere una sesión administrativa válida." });

    let user;
    try {
      user = await userResponse.json();
    } catch {
      safeLog(logger, "supabase_auth_invalid_response", { stage: "user" });
      return json(request, 401, { ok: false, error: "Se requiere una sesión administrativa válida." });
    }
    if (typeof user?.id !== "string" || !user.id) return json(request, 401, { ok: false, error: "Se requiere una sesión administrativa válida." });

    let adminResponse;
    try {
      adminResponse = await fetcher(`${supabaseBase}/rest/v1/rpc/is_store_admin`, {
        method: "POST",
        headers: { ...supabaseHeaders, "Content-Type": "application/json" },
        body: "{}",
        signal: timeoutSignal(),
      });
    } catch {
      safeLog(logger, "supabase_admin_check_unavailable", { stage: "rpc" });
      return json(request, 503, { ok: false, error: "No se pudo verificar el permiso administrativo." });
    }
    if (!adminResponse.ok) {
      safeLog(logger, "supabase_admin_check_failed", { stage: "rpc", status: adminResponse.status });
      return json(request, 503, { ok: false, error: "No se pudo verificar el permiso administrativo." });
    }

    let isAdmin;
    try {
      isAdmin = await adminResponse.json();
    } catch {
      safeLog(logger, "supabase_admin_check_invalid_response", { stage: "rpc" });
      return json(request, 503, { ok: false, error: "No se pudo verificar el permiso administrativo." });
    }
    if (isAdmin !== true) return json(request, 403, { ok: false, error: "La cuenta no tiene permiso administrativo." });

    const botToken = envValue(env, "TELEGRAM_BOT_TOKEN");
    const chatId = envValue(env, "TELEGRAM_CHAT_ID");
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken) || !validChatId(chatId)) {
      safeLog(logger, "telegram_test_secrets_unavailable");
      return json(request, 503, { ok: false, error: "La configuración segura de Telegram no está disponible." });
    }

    const attemptAt = Number(now());
    if (!Number.isFinite(attemptAt) || attemptAt - lastSendAttemptAt < cooldownMs) {
      return json(request, 429, { ok: false, error: "Espera antes de repetir la prueba de Telegram." });
    }
    // Hold the cooldown even when the network result is uncertain, to avoid an immediate duplicate.
    lastSendAttemptAt = attemptAt;

    let telegramResponse;
    try {
      telegramResponse = await fetcher(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: TELEGRAM_TEST_MESSAGE, disable_web_page_preview: true }),
        signal: timeoutSignal(),
      });
    } catch {
      safeLog(logger, "telegram_test_delivery_unknown");
      return json(request, 502, { ok: false, error: "No se pudo confirmar el envío de prueba." });
    }

    let telegramResult;
    try {
      telegramResult = await telegramResponse.json();
    } catch {
      safeLog(logger, "telegram_test_invalid_response", { status: telegramResponse.status });
      return json(request, 502, { ok: false, error: "No se pudo confirmar el envío de prueba." });
    }
    if (!telegramResponse.ok || telegramResult?.ok !== true) {
      safeLog(logger, "telegram_test_rejected", { status: telegramResponse.status });
      return json(request, 502, { ok: false, error: "Telegram no confirmó el mensaje de prueba." });
    }

    return json(request, 200, {
      ok: true,
      accepted: true,
      message: "Telegram aceptó el mensaje de prueba; verifica su recepción en el chat configurado.",
    });
  };
}
