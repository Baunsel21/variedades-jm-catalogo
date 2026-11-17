const allowedOrigin = "https://sirevya.com.co";
const target = {
  orderReference: "JMRES-09940D9B-D81C-4C3D-BAEC-39E0FD7C39A9",
  wompiReference: "SW-A5AE9363E6F14D4E946F1C4ED0F5A9EA",
  transactionId: "1538717-1794948766-44060",
  checkoutRequestId: "15f439d0-a737-4b0d-97db-43c3e20538c1",
  amountInCents: 200000,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function env(name: string): string {
  return Deno.env.get(name)?.trim() ?? "";
}

function serviceKey(): string {
  const raw = env("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.default === "string" && parsed.default.trim()) return parsed.default.trim();
    } catch {
      // Fall through without logging secret material.
    }
  }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}

function serviceHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function readJson(response: Response): Promise<any> {
  try { return await response.json(); } catch { return null; }
}

async function getJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  return { ok: response.ok, status: response.status, data: await readJson(response) };
}

function exactTarget(body: any): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const allowed = ["order_reference", "wompi_reference", "transaction_id", "checkout_request_id", "amount_in_cents"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return false;
  return body.order_reference === target.orderReference &&
    body.wompi_reference === target.wompiReference &&
    body.transaction_id === target.transactionId &&
    body.checkout_request_id === target.checkoutRequestId &&
    body.amount_in_cents === target.amountInCents;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("origin");
  if (origin !== allowedOrigin) return new Response(JSON.stringify({ error: "Origen no autorizado." }), { status: 403 });
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);

  try {
    const supabaseUrl = env("SUPABASE_URL").replace(/\/+$/, "");
    const publicKey = env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY");
    const key = serviceKey();
    const authorization = request.headers.get("authorization") ?? "";
    const userToken = authorization.match(/^Bearer\s+([A-Za-z0-9._~-]{24,4096})$/i)?.[1] ?? "";
    if (!supabaseUrl || !publicKey || !key || !userToken) return json({ error: "Sesión administrativa requerida." }, 401);

    const userHeaders = { apikey: publicKey, Authorization: `Bearer ${userToken}`, Accept: "application/json" };
    const user = await getJson(`${supabaseUrl}/auth/v1/user`, { method: "GET", headers: userHeaders });
    if (!user.ok || typeof user.data?.id !== "string") return json({ error: "Sesión administrativa inválida." }, 401);
    const admin = await getJson(`${supabaseUrl}/rest/v1/rpc/is_store_admin`, {
      method: "POST", headers: { ...userHeaders, "Content-Type": "application/json" }, body: "{}",
    });
    if (!admin.ok || !(admin.data === true || (Array.isArray(admin.data) && admin.data[0] === true))) {
      return json({ error: "La cuenta no tiene permiso administrativo." }, 403);
    }

    let body: any;
    try { body = await request.json(); } catch { return json({ error: "Solicitud JSON inválida." }, 400); }
    if (!exactTarget(body)) return json({ error: "El objetivo no coincide con la operación autorizada." }, 400);

    // Authoritative server-side verification; no client-supplied status is trusted.
    const wompiKey = env("WOMPI_PRIVATE_KEY");
    if (!wompiKey) return json({ error: "Falta la credencial privada de Wompi en el entorno seguro." }, 503);
    const transaction = await getJson(`https://production.wompi.co/v1/transactions/${encodeURIComponent(target.transactionId)}`, {
      method: "GET", headers: { Authorization: `Bearer ${wompiKey}`, Accept: "application/json" },
    });
    const data = transaction.data?.data;
    if (!transaction.ok || String(data?.id ?? "") !== target.transactionId ||
        String(data?.reference ?? "") !== target.wompiReference ||
        String(data?.currency ?? "").toUpperCase() !== "COP" ||
        Number(data?.amount_in_cents) !== target.amountInCents ||
        String(data?.status ?? "").toUpperCase() !== "APPROVED") {
      return json({ error: "Wompi no confirmó la transacción exacta como APPROVED.", wompiHttpStatus: transaction.status }, 409);
    }

    const rpc = await getJson(`${supabaseUrl}/rest/v1/rpc/recover_storefront_wompi_approved_payment_once`, {
      method: "POST",
      headers: serviceHeaders(key),
      body: JSON.stringify({
        p_order_reference: target.orderReference,
        p_wompi_reference: target.wompiReference,
        p_transaction_id: target.transactionId,
        p_checkout_request_id: target.checkoutRequestId,
        p_amount_in_cents: target.amountInCents,
      }),
    });
    const result = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    if (!rpc.ok || result?.success !== true) {
      return json({ success: false, code: String(result?.code ?? "WOMPI_RECOVERY_FAILED") }, 409);
    }

    // Telegram is verified by observing the trigger-created outbox row only.
    // This function never inserts or re-sends Telegram events.
    const orderId = String(result.order_id ?? "");
    const outbox = orderId ? await getJson(
      `${supabaseUrl}/rest/v1/sirevya_telegram_outbox?dedupe_key=eq.${encodeURIComponent(`order:${orderId}:payment:APPROVED`)}&select=id,dedupe_key,status,attempt_count,sent_at&limit=1`,
      { method: "GET", headers: serviceHeaders(key) },
    ) : { ok: false, status: 0, data: null };
    const notification = Array.isArray(outbox.data) ? outbox.data[0] ?? null : null;
    return json({
      success: true,
      alreadyProcessed: result.already_processed === true,
      orderReused: true,
      inventoryProcessed: result.inventory_processed === true,
      reservationConverted: result.reservation_converted === true,
      reconciliationResolved: result.reconciliation_resolved === true,
      telegramTriggerVerified: outbox.ok && Boolean(notification),
      telegramOutbox: notification ? {
        status: notification.status,
        attemptCount: notification.attempt_count,
        sentAt: notification.sent_at,
      } : null,
      paymentStarted: false,
    });
  } catch {
    return json({ error: "La recuperación falló de forma segura; no se inició ningún pago." }, 500);
  }
});
