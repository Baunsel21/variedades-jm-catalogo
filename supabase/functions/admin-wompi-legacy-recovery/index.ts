const allowedOrigin = "https://sirevya.com.co";
const productionWompiApi = "https://production.wompi.co/v1";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

type TransactionEvidence = {
  transaction_id: string;
  reference: string;
  amount_in_cents: number;
  currency: "COP";
  status: "ERROR";
  environment: "prod";
  terminal_at: string;
  customer_email: string;
};

function json(payload: unknown, status = 200, origin?: string | null): Response {
  const headers = origin === allowedOrigin ? corsHeaders : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function envValue(name: string): string {
  return Deno.env.get(name)?.trim() ?? "";
}

function supabaseServiceKey(): string {
  const raw = envValue("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.default === "string" && parsed.default.trim()) return parsed.default.trim();
    } catch {
      // Fail over only to the legacy service-role environment value; never log the contents.
    }
  }
  return envValue("SUPABASE_SERVICE_ROLE_KEY");
}

function supabaseHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function safeReference(value: unknown): string {
  const result = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{1,120}$/.test(result) ? result : "";
}

function safeTransactionId(value: unknown): string {
  const result = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{1,120}$/.test(result) ? result : "";
}

function copAmount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function normalizedEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function canonicalCart(input: unknown): string {
  if (!Array.isArray(input) || input.length === 0 || input.length > 50) return "";
  const items = input.map((raw: any) => ({
    id: String(raw?.id ?? raw?.product_id ?? "").trim().toLowerCase(),
    qty: Math.floor(Number(raw?.qty ?? raw?.quantity ?? 0)),
    color: String(raw?.color ?? "").trim().toLowerCase(),
    size: String(raw?.size ?? "").trim().toLowerCase(),
  }));
  if (items.some((item) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(item.id) ||
      !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 100 || item.color.length > 100 || item.size.length > 100)) return "";
  items.sort((a, b) => a.id.localeCompare(b.id) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size) || a.qty - b.qty);
  return JSON.stringify(items);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  let data: any = null;
  try { data = await response.json(); } catch { /* fail closed below */ }
  return { ok: response.ok, status: response.status, data };
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("origin");
  if (origin !== allowedOrigin) return json({ error: "Origen no autorizado." }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405, origin);

  try {
    const authorization = request.headers.get("authorization") ?? "";
    const userToken = authorization.match(/^Bearer\s+([A-Za-z0-9._~-]{24,4096})$/i)?.[1] ?? "";
    const supabaseUrl = envValue("SUPABASE_URL").replace(/\/+$/, "");
    const publicKey = envValue("SUPABASE_PUBLISHABLE_KEY") || envValue("SUPABASE_ANON_KEY");
    const serviceKey = supabaseServiceKey();
    const wompiPrivateKey = envValue("WOMPI_PRIVATE_KEY");
    if (!userToken || !supabaseUrl || !publicKey || !serviceKey || !wompiPrivateKey) {
      return json({ error: "No se pudo preparar la recuperación segura." }, 503, origin);
    }

    const userHeaders = { apikey: publicKey, Authorization: `Bearer ${userToken}`, Accept: "application/json" };
    const userResult = await fetchJson(`${supabaseUrl}/auth/v1/user`, { method: "GET", headers: userHeaders });
    if (!userResult.ok || typeof userResult.data?.id !== "string") {
      return json({ error: "Se requiere una sesión administrativa válida." }, 401, origin);
    }
    const adminResult = await fetchJson(`${supabaseUrl}/rest/v1/rpc/is_store_admin`, {
      method: "POST", headers: { ...userHeaders, "Content-Type": "application/json" }, body: "{}",
    });
    const isAdmin = adminResult.data === true || (Array.isArray(adminResult.data) && adminResult.data[0] === true);
    if (!adminResult.ok) return json({ error: "No se pudo verificar el permiso administrativo." }, 503, origin);
    if (!isAdmin) return json({ error: "La cuenta no tiene permiso administrativo." }, 403, origin);

    let body: any;
    try { body = await request.json(); } catch { return json({ error: "Solicitud no válida." }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["reference", "transaction_ids"].includes(key))) {
      return json({ error: "La solicitud contiene campos no permitidos." }, 400, origin);
    }
    const reference = safeReference(body.reference);
    const transactionIds = Array.isArray(body.transaction_ids) ? body.transaction_ids.map(safeTransactionId) : [];
    if (!reference || transactionIds.length !== 2 || transactionIds.some((id: string) => !id) ||
        transactionIds[0] === transactionIds[1]) {
      return json({ error: "Se requieren una referencia y exactamente dos identificadores distintos." }, 400, origin);
    }

    const orderUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
    orderUrl.searchParams.set("reference", `eq.${reference}`);
    orderUrl.searchParams.set("select", "reference,total,payment_method,payment_status,transaction_id,phone,coupon_code,coupon_id,coupon_discount_total,items,city,wompi_reconciliation_required,coupon_reconciliation_required");
    orderUrl.searchParams.set("limit", "2");
    const orderResult = await fetchJson(orderUrl.toString(), { method: "GET", headers: supabaseHeaders(serviceKey) });
    if (!orderResult.ok || !Array.isArray(orderResult.data) || orderResult.data.length !== 1) {
      return json({ error: "No se encontró un pedido Wompi único para validar." }, 409, origin);
    }
    const order = orderResult.data[0];
    const total = copAmount(order.total);
    const orderAmountInCents = total === null ? null : total * 100;
    const couponCode = String(order.coupon_code ?? "").trim();
    if (String(order.payment_method ?? "").toLowerCase() !== "wompi" || total === null ||
        !Number.isSafeInteger(orderAmountInCents) ||
        order.wompi_reconciliation_required === true || order.coupon_reconciliation_required === true ||
        !canonicalCart(order.items)) {
      return json({ error: "El pedido no cumple las condiciones de recuperación segura." }, 409, origin);
    }
    const orderStateValid = (String(order.payment_status ?? "").toUpperCase() === "PENDING" && !String(order.transaction_id ?? "").trim()) ||
      (String(order.payment_status ?? "").toUpperCase() === "ERROR" && String(order.transaction_id ?? "").trim());
    if (!orderStateValid) return json({ error: "El estado del pedido no permite esta recuperación." }, 409, origin);

    const evidence: TransactionEvidence[] = [];
    for (const transactionId of transactionIds) {
      const result = await fetchJson(`${productionWompiApi}/transactions/${encodeURIComponent(transactionId)}`, {
        method: "GET", headers: { Authorization: `Bearer ${wompiPrivateKey}`, Accept: "application/json" },
      });
      const transaction = result.data?.data;
      const returnedId = safeTransactionId(transaction?.id);
      const terminalAt = typeof transaction?.finalized_at === "string" ? transaction.finalized_at : "";
      const terminalMs = Date.parse(terminalAt);
      if (!result.ok || returnedId !== transactionId || String(transaction?.reference ?? "") !== reference ||
          copAmount(transaction?.amount_in_cents) !== orderAmountInCents || String(transaction?.currency ?? "").toUpperCase() !== "COP" ||
          String(transaction?.status ?? "").toUpperCase() !== "ERROR" || !Number.isFinite(terminalMs) ||
          terminalMs > Date.now() - 15 * 60 * 1000) {
        return json({ error: "Wompi no confirmó ambos intentos como ERROR terminales con referencia, moneda, importe y antigüedad coincidentes." }, 409, origin);
      }
      evidence.push({
        transaction_id: returnedId,
        reference,
        amount_in_cents: orderAmountInCents,
        currency: "COP",
        status: "ERROR",
        environment: "prod",
        terminal_at: new Date(terminalMs).toISOString(),
        customer_email: normalizedEmail(transaction?.customer_email),
      });
    }
    evidence.sort((a, b) => Date.parse(a.terminal_at) - Date.parse(b.terminal_at));
    if (Date.parse(evidence[0].terminal_at) > Date.parse(evidence[1].terminal_at)) {
      return json({ error: "No se pudo ordenar el historial de transacciones." }, 409, origin);
    }
    let customerEmail = "";
    if (couponCode) {
      customerEmail = evidence[0].customer_email;
      if (!customerEmail || evidence[1].customer_email !== customerEmail) {
        return json({ error: "No se pudo verificar de forma consistente la identidad del cupón en ambos intentos." }, 409, origin);
      }
    }

    const cartHash = await sha256Hex(canonicalCart(order.items));
    const verifiedAttempts = evidence.map(({ customer_email: _email, ...entry }) => entry);
    const recoveryResult = await fetchJson(`${supabaseUrl}/rest/v1/rpc/recover_storefront_wompi_legacy_order`, {
      method: "POST",
      headers: supabaseHeaders(serviceKey),
      body: JSON.stringify({
        p_order_reference: reference,
        p_cart_hash: cartHash,
        p_customer_email: customerEmail,
        p_verified_attempts: verifiedAttempts,
      }),
    });
    const recovery = Array.isArray(recoveryResult.data) ? recoveryResult.data[0] : recoveryResult.data;
    if (!recoveryResult.ok || recovery?.success !== true) {
      return json({ error: "La revalidación del pedido, inventario o cupón no fue satisfactoria; no se inició ningún pago.", code: String(recovery?.code ?? "WOMPI_LEGACY_RECOVERY_FAILED") }, 409, origin);
    }
    return json({
      success: true,
      reference,
      orderReused: recovery.order_reused === true,
      legacyAttemptsRegistered: Number(recovery.legacy_attempts_registered) === 2,
      reservationExpiresAt: recovery.reservation_expires_at ?? null,
      paymentStarted: false,
      orderCreated: false,
      idempotent: recovery.idempotent === true,
    }, 200, origin);
  } catch {
    // Never log or echo the request body, transaction identifiers, email or credentials.
    return json({ error: "La recuperación falló de forma segura; no se inició ningún pago." }, 500, origin);
  }
});
