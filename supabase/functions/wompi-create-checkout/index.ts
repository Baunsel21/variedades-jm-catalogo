const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CartItem = { id: string; qty: number; color: string; size: string };
type QuoteItem = {
  id: string;
  qty: number;
  color?: string;
  size?: string;
  price?: number | string;
  original_subtotal?: number | string;
  discount_total?: number | string;
  net_subtotal?: number | string;
  coupon_discount_total?: number | string;
};

type Quote = {
  success?: boolean;
  message?: string;
  currency?: string;
  original_subtotal?: number | string;
  discount_total?: number | string;
  discounted_subtotal?: number | string;
  shipping?: number | string;
  total?: number | string;
  coupon_id?: string | null;
  coupon_code?: string | null;
  coupon_discount_total?: number | string | null;
  items?: QuoteItem[];
};

type CleanupResult = {
  safe: boolean;
  orderExists: boolean;
  released: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUPON_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UNLINKED_ORDER_SAFE_REUSE_GRACE_MS = 15 * 60 * 1000;

function unlinkedWompiOrderExpired(row: any, now = Date.now()): boolean {
  const createdAt = Date.parse(String(row?.created_at ?? ""));
  return Number.isFinite(createdAt) && createdAt + UNLINKED_ORDER_SAFE_REUSE_GRACE_MS <= now;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getSupabaseServiceKey(): string | null {
  // New Supabase secret keys are provided as a JSON dictionary. Prefer the
  // default secret key, but keep the legacy service_role fallback for projects
  // that have not migrated yet.
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysRaw) {
    try {
      const secretKeys = JSON.parse(secretKeysRaw);
      const defaultKey = secretKeys?.default;
      if (typeof defaultKey === "string" && defaultKey.trim()) return defaultKey.trim();
    } catch {
      console.error("No se pudieron interpretar las claves secretas nuevas de Supabase.");
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || null;
}

function supabaseHeaders(serviceRoleKey: string) {
  const isNewSecretKey = serviceRoleKey.startsWith("sb_secret_");
  return {
    apikey: serviceRoleKey,
    // Supabase's new sb_secret_* keys must be sent via apikey only; the legacy
    // JWT service_role key still needs Authorization: Bearer.
    ...(isNewSecretKey ? {} : { Authorization: `Bearer ${serviceRoleKey}` }),
    "Content-Type": "application/json",
  };
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function rpcObject(payload: any): any {
  return Array.isArray(payload) ? payload[0] : payload;
}

function copAmount(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const amount = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(amount) ? amount : null;
}

function normalizeCouponCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizeStoredCouponCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeCouponId(value: unknown): string {
  const id = String(value ?? "").trim().toLowerCase();
  return UUID_PATTERN.test(id) ? id : "";
}

function normalizeItems(input: unknown): CartItem[] | null {
  // Match live reserve_inventory() limits so checkout validation and SQL agree.
  if (!Array.isArray(input) || input.length === 0 || input.length > 50) return null;
  const normalized: CartItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const id = String(item.id ?? "").trim();
    const qtyNumber = Number(item.qty ?? item.quantity ?? 0);
    const qty = Math.floor(qtyNumber);
    if (
      !UUID_PATTERN.test(id) ||
      !Number.isSafeInteger(qtyNumber) || qty < 1 || qty > 100
    ) return null;
    const color = String(item.color ?? "").trim();
    const size = String(item.size ?? "").trim();
    if (color.length > 100 || size.length > 100) return null;
    normalized.push({ id, qty, color, size });
  }
  return normalized;
}

function canonicalCart(input: unknown): string {
  if (!Array.isArray(input)) return "";
  const items = input.map((raw: any) => ({
    id: String(raw?.id ?? raw?.product_id ?? "").trim().toLowerCase(),
    qty: Math.floor(Number(raw?.qty ?? raw?.quantity ?? 0)),
    color: String(raw?.color ?? "").trim().toLowerCase(),
    size: String(raw?.size ?? "").trim().toLowerCase(),
  }));
  if (items.some((x: any) => !x.id || !Number.isSafeInteger(x.qty) || x.qty < 1)) return "";
  items.sort((a: any, b: any) => a.id.localeCompare(b.id) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size) || a.qty - b.qty);
  return JSON.stringify(items);
}

function canonicalQuoteItems(input: unknown): string {
  if (!Array.isArray(input)) return "";
  const items = input.map((raw: any) => ({
    id: String(raw?.id ?? raw?.product_id ?? "").trim().toLowerCase(),
    qty: Math.floor(Number(raw?.qty ?? raw?.quantity ?? 0)),
    color: String(raw?.color ?? "").trim().toLowerCase(),
    size: String(raw?.size ?? "").trim().toLowerCase(),
    price: copAmount(raw?.price),
    original_subtotal: copAmount(raw?.original_subtotal),
    discount_total: copAmount(raw?.discount_total),
    net_subtotal: copAmount(raw?.net_subtotal),
    coupon_discount_total: raw?.coupon_discount_total == null ? 0 : copAmount(raw?.coupon_discount_total),
  }));
  if (items.some((x: any) => !x.id || !Number.isSafeInteger(x.qty) || x.qty < 1 ||
    x.price === null || x.original_subtotal === null || x.discount_total === null ||
    x.net_subtotal === null || x.coupon_discount_total === null)) return "";
  items.sort((a: any, b: any) =>
    a.id.localeCompare(b.id) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size) ||
    a.qty - b.qty || a.price - b.price || a.original_subtotal - b.original_subtotal ||
    a.discount_total - b.discount_total || a.net_subtotal - b.net_subtotal ||
    a.coupon_discount_total - b.coupon_discount_total);
  return JSON.stringify(items);
}

function couponMetadataMatches(
  row: any,
  couponCode: string,
  couponId: string,
  couponDiscountTotal: number,
): boolean {
  const storedCode = normalizeStoredCouponCode(row?.coupon_code);
  const storedId = normalizeCouponId(row?.coupon_id);
  const storedDiscount = copAmount(row?.coupon_discount_total ?? 0);
  return storedCode === couponCode &&
    (couponCode ? storedId === couponId : !storedId) &&
    storedDiscount === couponDiscountTotal;
}

async function releaseInventoryReservation(supabaseUrl: string, serviceRoleKey: string, reference: string): Promise<boolean> {
  try {
    // The installed RPC returns void; a 2xx response is its success signal.
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/release_inventory_reservation`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify({ p_reference: reference }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function releaseCouponReservation(supabaseUrl: string, serviceRoleKey: string, reference: string): Promise<boolean> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/release_storefront_coupon_redemption`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify({ p_reference: reference }),
    });
    const result = rpcObject(await readJson(response));
    return response.ok && (result?.success === true || result?.code === "COUPON_REDEMPTION_NOT_FOUND");
  } catch {
    return false;
  }
}

async function expireCouponReservation(supabaseUrl: string, serviceRoleKey: string, reference: string): Promise<boolean> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/expire_storefront_coupon_redemption`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify({ p_reference: reference }),
    });
    const result = rpcObject(await readJson(response));
    return response.ok && result?.success === true;
  } catch {
    return false;
  }
}

async function setWompiCheckoutState(
  supabaseUrl: string,
  serviceRoleKey: string,
  reference: string,
  state: "pending" | "terminal_grace" | "completed" | "released",
  transactionId?: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/set_storefront_wompi_checkout_state`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify({ p_reference: reference, p_state: state, p_transaction_id: transactionId ?? null }),
    });
    const result = rpcObject(await readJson(response));
    return response.ok && result?.success === true;
  } catch {
    return false;
  }
}

async function releaseAttemptReservations(
  supabaseUrl: string,
  serviceRoleKey: string,
  reference: string,
  hasCoupon: boolean,
  transactionId?: string,
  finalLockState: "released" | "terminal_grace" = "released",
): Promise<boolean> {
  // Release the ledger first. If it fails, do not pretend the attempt is clean;
  // the inventory RPC is still attempted so a transient ledger error cannot
  // strand stock unnecessarily.
  const couponReleased = !hasCoupon || await releaseCouponReservation(supabaseUrl, serviceRoleKey, reference);
  const inventoryReleased = await releaseInventoryReservation(supabaseUrl, serviceRoleKey, reference);
  const lockReleased = couponReleased && inventoryReleased
    ? await setWompiCheckoutState(supabaseUrl, serviceRoleKey, reference, finalLockState, transactionId)
    : false;
  return couponReleased && inventoryReleased && lockReleased;
}

async function releaseSideEffectsIfNoOrder(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  reference: string;
  hasCoupon: boolean;
}): Promise<CleanupResult> {
  // A network error during INSERT can occur after PostgreSQL committed. Never
  // release either side effect until a read confirms there is no order for this
  // reference. If the order exists, its server-side state owns the holds.
  try {
    const url = new URL(`${args.supabaseUrl}/rest/v1/orders`);
    url.searchParams.set("reference", `eq.${args.reference}`);
    url.searchParams.set("select", "reference");
    url.searchParams.set("limit", "1");
    const check = await fetch(url.toString(), { headers: supabaseHeaders(args.serviceRoleKey) });
    if (!check.ok) return { safe: false, orderExists: false, released: false };
    const rows = await readJson(check);
    if (!Array.isArray(rows)) return { safe: false, orderExists: false, released: false };
    if (rows.length > 0) return { safe: true, orderExists: true, released: false };
    const couponExpired = !args.hasCoupon || await expireCouponReservation(args.supabaseUrl, args.serviceRoleKey, args.reference);
    const inventoryReleased = await releaseInventoryReservation(args.supabaseUrl, args.serviceRoleKey, args.reference);
    const lockReleased = couponExpired && inventoryReleased
      ? await setWompiCheckoutState(args.supabaseUrl, args.serviceRoleKey, args.reference, "released")
      : false;
    return { safe: true, orderExists: false, released: couponExpired && inventoryReleased && lockReleased };
  } catch {
    // Fail closed: an uncertain reservation is allowed to expire under its
    // 10-minute TTL rather than releasing a reservation owned by an order.
    return { safe: false, orderExists: false, released: false };
  }
}

async function reserveWompiCheckoutLock(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  reference: string;
  customerPhone: string;
  cartHash: string;
}): Promise<{ responseOk: boolean; success: boolean; code?: string; existingReference?: string; expiresAt?: string; message?: string }> {
  try {
    const response = await fetch(`${args.supabaseUrl}/rest/v1/rpc/reserve_storefront_wompi_checkout_lock`, {
      method: "POST",
      headers: supabaseHeaders(args.serviceRoleKey),
      body: JSON.stringify({
        p_reference: args.reference,
        p_customer_phone: args.customerPhone,
        p_cart_hash: args.cartHash,
        p_minutes: 10,
      }),
    });
    const result = rpcObject(await readJson(response));
    return {
      responseOk: response.ok,
      success: response.ok && result?.success === true,
      code: typeof result?.code === "string" ? result.code : undefined,
      existingReference: typeof result?.existing_reference === "string" ? result.existing_reference : undefined,
      expiresAt: typeof result?.expires_at === "string" ? result.expires_at : undefined,
      message: typeof result?.message === "string" ? result.message : undefined,
    };
  } catch {
    return { responseOk: false, success: false };
  }
}

async function claimWompiCheckout(supabaseUrl: string, serviceRoleKey: string, reference: string): Promise<{ responseOk: boolean; success: boolean; code?: string }> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_storefront_wompi_checkout`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify({ p_reference: reference }),
    });
    const result = rpcObject(await readJson(response));
    return {
      responseOk: response.ok,
      success: response.ok && result?.success === true,
      code: typeof result?.code === "string" ? result.code : undefined,
    };
  } catch {
    return { responseOk: false, success: false };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  let cleanupSupabaseUrl: string | null = null;
  let cleanupServiceRoleKey: string | null = null;
  let cleanupReference = "";
  let cleanupHasCoupon = false;
  let cleanupStarted = false;
  let orderInsertAttempted = false;
  try {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "El cuerpo de la solicitud no es JSON válido." }, 400); }

    const items = normalizeItems(body?.items);
    const city = String(body?.city ?? "").trim();
    const expectedTotalRaw = body?.expected_total;
    const expectedDiscountRaw = body?.expected_discount_total;
    const expectedAmountsAreNumeric = (typeof expectedTotalRaw === "number" || typeof expectedTotalRaw === "string") &&
      (typeof expectedDiscountRaw === "number" || typeof expectedDiscountRaw === "string");
    if (!expectedAmountsAreNumeric || expectedTotalRaw == null || expectedDiscountRaw == null ||
        String(expectedTotalRaw).trim() === "" || String(expectedDiscountRaw).trim() === "") {
      return json({ code: "WOMPI_EXPECTED_TOTAL_REQUIRED", error: "Actualiza el catálogo y confirma nuevamente el total antes de iniciar el pago." }, 400);
    }
    const expectedTotal = copAmount(expectedTotalRaw);
    const expectedDiscountTotal = copAmount(expectedDiscountRaw);
    const name = String(body?.name ?? "").trim();
    const phone = String(body?.phone ?? "").trim();
    const address = String(body?.address ?? "").trim();
    const neighborhood = String(body?.neighborhood ?? "").trim();

    const rawCouponCode = body?.coupon_code;
    if (rawCouponCode !== undefined && rawCouponCode !== null && typeof rawCouponCode !== "string") {
      return json({ error: "El código de cupón no tiene un formato válido." }, 400);
    }
    const couponCode = normalizeCouponCode(rawCouponCode);
    if (couponCode && (!COUPON_PATTERN.test(couponCode) || couponCode.length > 64)) {
      return json({ error: "El código de cupón no tiene un formato válido." }, 400);
    }
    cleanupHasCoupon = Boolean(couponCode);

    const rawEmail = body?.email ?? body?.customer_email;
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return json({ error: "El correo electrónico del cliente no tiene un formato válido." }, 400);
    }

    const rawExpectedCouponDiscount = body?.expected_coupon_discount_total;
    const expectedCouponDiscountTotal = rawExpectedCouponDiscount == null && !couponCode
      ? 0
      : copAmount(rawExpectedCouponDiscount);
    if (expectedTotal === null || expectedDiscountTotal === null || expectedCouponDiscountTotal === null ||
        expectedTotal < 0 || expectedDiscountTotal < 0 || expectedCouponDiscountTotal < 0 ||
        !items || !city || city.length > 120 || !name || name.length > 200 ||
        !phone || phone.length > 60 || !address || address.length > 300 || neighborhood.length > 200) {
      return json({ error: "Faltan datos obligatorios o hay productos/cantidades/importes no válidos." }, 400);
    }
    if (!couponCode && expectedCouponDiscountTotal !== 0) {
      return json({ error: "El descuento esperado del cupón debe ser cero cuando no se envía un cupón." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = getSupabaseServiceKey();
    // This is server configuration, never a client-supplied field. Set to "prod"
    // for the live store; use a separate test project/deployment for Sandbox.
    const wompiEnvironment = (Deno.env.get("WOMPI_ENVIRONMENT") ?? "prod").trim().toLowerCase();
    if (wompiEnvironment !== "prod" && wompiEnvironment !== "test") {
      return json({ error: "El ambiente de Wompi no está configurado correctamente." }, 500);
    }
    const integritySecret = Deno.env.get(wompiEnvironment === "test" ? "WOMPI_INTEGRITY_SECRET_TEST" : "WOMPI_INTEGRITY_SECRET");
    if (!supabaseUrl || !serviceRoleKey || !integritySecret) {
      return json({ error: "Falta configurar una variable necesaria en Supabase." }, 500);
    }
    cleanupSupabaseUrl = supabaseUrl;
    cleanupServiceRoleKey = serviceRoleKey;

    // Enforce the switch on the server before quote side effects, reservations or orders.
    const statusResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/get_online_payment_status`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: "{}",
    });
    if (!statusResponse.ok) return json({ error: "No se pudo verificar si los pagos en línea están habilitados." }, 503);
    const statusPayload = await readJson(statusResponse);
    const statusRow = Array.isArray(statusPayload) ? statusPayload[0] : statusPayload;
    if (typeof statusRow?.online_payments_enabled !== "boolean") {
      return json({ error: "La configuración de pagos devolvió una respuesta no válida." }, 503);
    }
    if (!statusRow.online_payments_enabled) {
      return json({ error: "Los pagos en línea están desactivados. Usa contraentrega en las ciudades habilitadas." }, 403);
    }

    // The v2 quote returns a uniform coupon-aware contract even for an empty code.
    // Its companion prepare RPC re-quotes under locks before any reservation.
    const quoteBody = {
      p_items: items,
      p_city: city,
      p_coupon_code: couponCode,
      p_customer_email: "",
      p_customer_phone: "",
    };
    const quoteResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/get_storefront_cart_quote_with_coupon`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify(quoteBody),
    });
    if (!quoteResponse.ok) {
      return json({ error: couponCode ? "No se pudo validar el cupón y calcular el total autorizado." : "No se pudo calcular el total autorizado del carrito." }, 502);
    }
    const quote = await readJson(quoteResponse) as Quote | null;
    if (!quote || quote.success !== true || !Array.isArray(quote.items) || quote.items.length === 0) {
      return json({ error: couponCode ? "El cupón no es válido para este carrito." : String(quote?.message ?? "La cotización del carrito no es válida.") }, 422);
    }
    if (quote.original_subtotal == null || quote.discount_total == null || quote.discounted_subtotal == null || quote.shipping == null || quote.total == null) {
      return json({ error: "La cotización del carrito está incompleta. No se creó pedido ni reserva." }, 422);
    }
    if (canonicalCart(quote.items) !== canonicalCart(items)) {
      return json({ error: "La cotización no corresponde exactamente a los productos, cantidades o variantes enviados." }, 422);
    }

    const quoteCouponCode = normalizeStoredCouponCode(quote.coupon_code);
    const quoteCouponId = normalizeCouponId(quote.coupon_id);
    const quoteCouponDiscountRaw = quote.coupon_discount_total == null ? 0 : quote.coupon_discount_total;
    const couponDiscountTotal = copAmount(quoteCouponDiscountRaw);
    const couponMetadataValid = couponDiscountTotal !== null && couponDiscountTotal >= 0 &&
      (couponCode
        ? Boolean(quoteCouponCode) && quoteCouponCode === couponCode && Boolean(quoteCouponId)
        : !quoteCouponCode && !quoteCouponId && couponDiscountTotal === 0);
    if (!couponMetadataValid || (couponCode && quote.coupon_discount_total == null)) {
      return json({ error: "La cotización del cupón no devolvió metadata consistente." }, 422);
    }
    if (couponDiscountTotal === null) {
      return json({ error: "La cotización del cupón no devolvió un descuento válido." }, 422);
    }

    const subtotal = copAmount(quote.original_subtotal);
    const discountTotal = copAmount(quote.discount_total ?? 0);
    const discountedSubtotal = copAmount(quote.discounted_subtotal);
    const shipping = copAmount(quote.shipping);
    const totalCop = copAmount(quote.total);
    if (subtotal === null || discountTotal === null || discountedSubtotal === null || shipping === null || totalCop === null) {
      return json({ error: "La cotización devolvió importes no válidos o inconsistentes." }, 422);
    }

    let lineOriginalSubtotal = 0;
    let lineDiscountTotal = 0;
    let lineCouponDiscountTotal = 0;
    let lineDiscountedSubtotal = 0;
    for (const item of quote.items) {
      const qty = copAmount(item.qty);
      const price = copAmount(item.price);
      const original = copAmount(item.original_subtotal);
      const lineDiscount = copAmount(item.discount_total);
      const net = copAmount(item.net_subtotal);
      const lineCouponRaw = item.coupon_discount_total == null ? 0 : item.coupon_discount_total;
      const lineCoupon = copAmount(lineCouponRaw);
      if (qty === null || price === null || original === null || lineDiscount === null || net === null || lineCoupon === null ||
          qty < 1 || price < 0 || original < 0 || lineDiscount < 0 || net < 0 || lineCoupon < 0 ||
          !Number.isSafeInteger(price * qty) || original !== price * qty || lineDiscount > original ||
          lineCoupon > lineDiscount || net !== original - lineDiscount ||
          (couponCode && item.coupon_discount_total == null)) {
        return json({ error: "La cotización devolvió importes de línea no válidos o inconsistentes." }, 422);
      }
      lineOriginalSubtotal += original;
      lineDiscountTotal += lineDiscount;
      lineCouponDiscountTotal += lineCoupon;
      lineDiscountedSubtotal += net;
    }

    const amountInCents = totalCop * 100;
    if (
      !Number.isSafeInteger(lineOriginalSubtotal) ||
      !Number.isSafeInteger(lineDiscountTotal) ||
      !Number.isSafeInteger(lineCouponDiscountTotal) ||
      !Number.isSafeInteger(lineDiscountedSubtotal) ||
      subtotal <= 0 ||
      discountTotal < 0 || discountTotal > subtotal ||
      discountedSubtotal < 0 ||
      discountedSubtotal !== subtotal - discountTotal ||
      shipping < 0 ||
      totalCop <= 0 ||
      totalCop !== discountedSubtotal + shipping ||
      !Number.isSafeInteger(amountInCents) ||
      lineOriginalSubtotal !== subtotal ||
      lineDiscountTotal !== discountTotal ||
      lineCouponDiscountTotal !== couponDiscountTotal ||
      lineDiscountedSubtotal !== discountedSubtotal ||
      couponDiscountTotal < 0 || couponDiscountTotal > discountTotal ||
      String(quote.currency ?? "COP").toUpperCase() !== "COP"
    ) {
      return json({ error: "La cotización devolvió importes no válidos o inconsistentes." }, 422);
    }

    // Rechazar una tarifa/promoción/cupón cambiado antes de crear la reserva o
    // el pedido PENDING. Así el cliente puede revisar el importe nuevo sin dejar
    // filas ni liberar una reserva previa.
    if (expectedTotal !== totalCop || expectedDiscountTotal !== discountTotal || expectedCouponDiscountTotal !== couponDiscountTotal) {
      return json({
        code: "WOMPI_QUOTE_CHANGED",
        canRetryWithNewReference: false,
        shipping,
        total: totalCop,
        discount_total: discountTotal,
        coupon_discount_total: couponDiscountTotal,
        error: "El envío o el descuento cambió antes de iniciar el pago. Revisa el total actualizado y confirma de nuevo; no se creó pedido ni se generó una reserva.",
      }, 409);
    }

    let reference = String(body?.reference ?? "").trim();
    if (!reference) reference = `JM-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(reference)) {
      return json({ error: "La referencia del pedido no tiene un formato válido." }, 400);
    }
    cleanupReference = reference;

    // Check existing reference before touching reservations. A persisted pending
    // order is never reused; linked payments, unlinked holds and terminal cooldowns
    // each have an explicit fail-closed path below.
    const existingUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
    existingUrl.searchParams.set("reference", `eq.${reference}`);
    existingUrl.searchParams.set("select", "reference,created_at,total,subtotal,shipping,city,items,payment_method,payment_status,transaction_id,customer_name,phone,address,neighborhood,coupon_id,coupon_code,coupon_discount_total");
    existingUrl.searchParams.set("limit", "2");
    const existingResponse = await fetch(existingUrl.toString(), { headers: supabaseHeaders(serviceRoleKey) });
    if (!existingResponse.ok) return json({ error: "No se pudo verificar si la referencia ya existe." }, 502);
    const existingRows = await readJson(existingResponse);
    if (!Array.isArray(existingRows) || existingRows.length > 1) {
      return json({ error: "La referencia está duplicada o la respuesta de pedidos no es válida." }, 409);
    }
    const existing = existingRows[0];
    if (existing) {
      const pendingAndUnlinked = String(existing.payment_method ?? "").toLowerCase() === "wompi" &&
        String(existing.payment_status ?? "").toUpperCase() === "PENDING" &&
        !String(existing.transaction_id ?? "").trim();
      if (pendingAndUnlinked) {
        if (!unlinkedWompiOrderExpired(existing)) {
          return json({
            code: "WOMPI_UNRESOLVED_RESERVATION",
            canRetryWithNewReference: false,
            existingReference: reference,
            error: "Este pedido Wompi sigue pendiente y sin transacción vinculada. No se reutilizará su referencia durante la ventana de seguridad de 15 minutos; espera antes de intentar otro pago.",
          }, 409);
        }
        const released = await releaseAttemptReservations(
          supabaseUrl,
          serviceRoleKey,
          reference,
          Boolean(normalizeStoredCouponCode(existing.coupon_code)),
        );
        if (!released) {
          return json({ error: "La referencia Wompi anterior ya venció, pero no se pudo verificar la liberación de sus reservas. Espera o contacta soporte." }, 502);
        }
        return json({
          code: "WOMPI_REFERENCE_STALE",
          canRetryWithNewReference: true,
          error: "La referencia Wompi anterior superó la ventana de seguridad. Sus reservas se liberaron; inicia el pago con una referencia nueva.",
        }, 409);
      }
      const existingStatus = String(existing.payment_status ?? "").trim().toUpperCase();
        const existingTransactionId = String(existing.transaction_id ?? "").trim();
        if (existingTransactionId && existingStatus === "PENDING") {
          return json({
            code: "WOMPI_TRANSACTION_PENDING",
            canRetryWithNewReference: false,
            error: "Ya hay una transacción Wompi pendiente vinculada a este pedido. No inicies otro pago para evitar un posible cobro duplicado; espera la confirmación del estado o contacta soporte.",
          }, 409);
        }
        if (existingTransactionId && existingStatus === "APPROVED") {
          return json({
            code: "WOMPI_ALREADY_APPROVED",
            canRetryWithNewReference: false,
            error: "Este pedido ya tiene un pago aprobado. No intentes pagarlo otra vez.",
          }, 409);
        }
        const terminalTransaction = Boolean(existingTransactionId) && ["DECLINED", "VOIDED", "ERROR"].includes(existingStatus);
        if (terminalTransaction) {
          // A new payment attempt is permitted only after the previous transaction
          // is verified terminal and both old holds are released.
          const released = await releaseAttemptReservations(
            supabaseUrl,
            serviceRoleKey,
            reference,
            Boolean(normalizeStoredCouponCode(existing.coupon_code)),
            existingTransactionId,
            "terminal_grace",
          );
          if (!released) {
            return json({ error: "El intento anterior terminó, pero no se pudo confirmar la liberación de sus reservas. Espera o contacta soporte antes de volver a pagar." }, 502);
          }
          return json({
            code: "WOMPI_TERMINAL_GRACE",
            canRetryWithNewReference: false,
            existingReference: reference,
            error: "El intento anterior terminó y sus reservas se liberaron. Por seguridad, espera 15 minutos antes de volver a iniciar el pago; así reducimos el riesgo de una aprobación tardía duplicada.",
          }, 409);
        }
        return json({ error: "Esta referencia ya corresponde a otro intento, a una transacción vinculada, a otro comprador o a un total distinto. No se reutilizó el pedido anterior." }, 409);
    }

    // Fail closed when this buyer already has a Wompi transaction linked to an
    // unresolved PENDING order. This is especially important when Wompi already
    // approved a payment but inventory/order reconciliation still needs retry.
    // The private RPC normalizes historic phone formats (+57/0057) inside SQL,
    // so legacy pending orders cannot bypass the one-checkout-per-phone guard.
    const pendingResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/list_pending_wompi_orders_for_phone`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify({ p_customer_phone: phone }),
    });
    const pendingResult = rpcObject(await readJson(pendingResponse));
    if (!pendingResponse.ok || pendingResult?.success !== true || !Array.isArray(pendingResult.orders)) {
      return json({ error: "No se pudo comprobar si ya tienes un pago Wompi pendiente. No se inició otro pago." }, 503);
    }
    const pendingRows = pendingResult.orders;
    const hasLinkedPendingTransaction = pendingRows.some((row: any) => Boolean(String(row?.transaction_id ?? "").trim()));
    if (hasLinkedPendingTransaction) {
      return json({
        code: "WOMPI_TRANSACTION_PENDING",
        canRetryWithNewReference: false,
        error: "Ya existe una transacción Wompi vinculada a un pedido pendiente con este teléfono. No inicies otro pago para evitar un posible cobro duplicado; espera la confirmación o contacta soporte.",
      }, 409);
    }

    // Never re-use the reference of an existing PENDING/unlinked order, even for
    // an identical cart. A stale unlinked order may be released after 15 minutes,
    // but the next attempt always uses a distinct reference.
    const otherUnlinkedPendingOrders = pendingRows.filter((row: any) => {
      const rowReference = String(row?.reference ?? "").trim();
      return rowReference && rowReference !== reference &&
        String(row?.payment_status ?? "").toUpperCase() === "PENDING" &&
        !String(row?.transaction_id ?? "").trim();
    });
    for (const staleOrder of otherUnlinkedPendingOrders) {
      if (!unlinkedWompiOrderExpired(staleOrder)) {
        return json({
          code: "WOMPI_UNRESOLVED_RESERVATION",
          canRetryWithNewReference: false,
          existingReference: String(staleOrder.reference),
          error: "Hay un checkout Wompi reciente sin transacción vinculada y sus reservas se mantienen hasta que venza la sesión. Espera antes de iniciar otro carrito.",
        }, 409);
      }
      const staleReference = String(staleOrder.reference);
      const released = await releaseAttemptReservations(
        supabaseUrl,
        serviceRoleKey,
        staleReference,
        Boolean(normalizeStoredCouponCode(staleOrder.coupon_code)),
      );
      if (!released) {
        return json({ error: "Un checkout anterior ya venció, pero no se pudieron confirmar sus liberaciones. No se inició otro pago." }, 502);
      }
    }
    const canonicalItems = canonicalCart(items);
    if (!canonicalItems) return json({ error: "No se pudo normalizar el carrito para reservarlo." }, 400);
    cleanupStarted = true;
    const checkoutLock = await reserveWompiCheckoutLock({
      supabaseUrl,
      serviceRoleKey,
      reference,
      customerPhone: phone,
      cartHash: await sha256Hex(canonicalItems),
    });
    if (!checkoutLock.responseOk) {
      await releaseSideEffectsIfNoOrder({ supabaseUrl, serviceRoleKey, reference, hasCoupon: Boolean(couponCode) });
      cleanupStarted = false;
      return json({ error: "No se pudo reservar de forma exclusiva este checkout. No se inició el pago." }, 503);
    }
    if (!checkoutLock.success) {
      cleanupStarted = false;
      if (["WOMPI_ACTIVE_RESERVATION", "WOMPI_ACTIVE_OTHER_CART", "WOMPI_TERMINAL_GRACE"].includes(String(checkoutLock.code ?? ""))) {
        return json({
          code: checkoutLock.code,
          existingReference: checkoutLock.existingReference,
          expiresAt: checkoutLock.expiresAt,
          canRetryWithNewReference: false,
          error: checkoutLock.message ?? "Ya existe un checkout activo para este teléfono. Espera antes de iniciar otro pago.",
        }, 409);
      }
      if (checkoutLock.code === "WOMPI_TRANSACTION_PENDING" || checkoutLock.code === "WOMPI_CHECKOUT_ALREADY_PREPARED") {
        return json({
          code: checkoutLock.code,
          existingReference: checkoutLock.existingReference,
          canRetryWithNewReference: false,
          error: checkoutLock.message ?? "Este checkout ya tiene una sesión Wompi o transacción pendiente. Espera antes de reintentar.",
        }, 409);
      }
      return json({ code: checkoutLock.code ?? "WOMPI_LOCK_FAILED", error: checkoutLock.message ?? "No se pudo reservar el checkout de forma exclusiva." }, 409);
    }

    // Re-quote and reserve pricing-sensitive inventory/coupon state in one SQL transaction.
    // The RPC locks product, combo, shipping and coupon rows, then compares this
    // server-owned quote with the current one before it creates any hold.
    cleanupStarted = true;
    const preparationResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/prepare_storefront_wompi_checkout`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify({
        p_reference: reference,
        p_items: items,
        p_city: city,
        p_coupon_code: couponCode,
        p_customer_email: email,
        p_customer_phone: phone,
        p_expected_quote: quote,
      }),
    });
    const preparation = rpcObject(await readJson(preparationResponse));
    if (!preparationResponse.ok || preparation?.success !== true) {
      await releaseSideEffectsIfNoOrder({ supabaseUrl, serviceRoleKey, reference, hasCoupon: Boolean(couponCode) });
      cleanupStarted = false;
      const preparedQuote = rpcObject(preparation?.quote);
      const code = String(preparation?.code ?? "WOMPI_PREPARE_FAILED");
      const quoteChanged = code === "WOMPI_QUOTE_CHANGED";
      const copOrNull = (value: unknown) => value == null ? null : copAmount(value);
      return json({
        code,
        canRetryWithNewReference: false,
        shipping: copOrNull(preparation?.shipping ?? preparedQuote?.shipping),
        total: copOrNull(preparation?.total ?? preparedQuote?.total),
        discount_total: copOrNull(preparation?.discount_total ?? preparedQuote?.discount_total),
        coupon_discount_total: copOrNull(preparation?.coupon_discount_total ?? preparedQuote?.coupon_discount_total),
        error: String(preparation?.message ?? (quoteChanged
          ? "El precio, descuento, cupón o envío cambió durante la preparación. Revisa el nuevo total y confirma otra vez."
          : "No se pudo confirmar de forma atómica la cotización y sus reservas; no se inició el pago.")),
      }, quoteChanged || preparationResponse.ok ? 409 : 502);
    }
    const expiryDate = new Date(String(preparation.expires_at ?? ""));
    const expiryMs = expiryDate.getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= Date.now() + 5000) {
      await releaseSideEffectsIfNoOrder({ supabaseUrl, serviceRoleKey, reference, hasCoupon: Boolean(couponCode) });
      cleanupStarted = false;
      return json({ error: "La reserva atómica venció o no tiene una fecha válida. Vuelve a iniciar el pago con una referencia nueva." }, 409);
    }
    const expirationTime = expiryDate.toISOString();

    // Only one request can claim the hosted checkout session for this lock.
    // A lost claim response is left to TTL; another request may already own it.
    cleanupStarted = false;
    const checkoutClaim = await claimWompiCheckout(supabaseUrl, serviceRoleKey, reference);
    if (!checkoutClaim.responseOk) {
      return json({ error: "No se pudo confirmar un claim exclusivo del checkout. Espera el vencimiento antes de reintentar." }, 503);
    }
    if (!checkoutClaim.success) {
      return json({
        code: checkoutClaim.code ?? "WOMPI_LOCK_NOT_ACTIVE",
        canRetryWithNewReference: false,
        error: "Este intento ya preparó una sesión Wompi o ya no tiene un lock activo. Espera antes de volver a iniciarlo.",
      }, 409);
    }
    cleanupStarted = true;

    // Wompi specifies expiration-time as part of the integrity signature when supplied.
    const signature = await sha256Hex(`${reference}${amountInCents}COP${expirationTime}${integritySecret}`);
    if (!existing) {
      // Once INSERT starts, a network/5xx result cannot prove that PostgreSQL did
      // not commit. Keep all holds until TTL rather than racing a later commit.
      cleanupStarted = false;
      orderInsertAttempted = true;
      const orderResponse = await fetch(`${supabaseUrl}/rest/v1/orders`, {
        method: "POST",
        headers: { ...supabaseHeaders(serviceRoleKey), Prefer: "return=minimal" },
        body: JSON.stringify({
          reference,
          customer_name: name,
          phone,
          city,
          address,
          neighborhood,
          items: quote.items,
          subtotal,
          shipping,
          total: totalCop,
          coupon_id: couponCode ? quoteCouponId : null,
          coupon_code: couponCode || null,
          coupon_discount_total: couponCode ? couponDiscountTotal : 0,
          payment_method: "wompi",
          payment_status: "PENDING",
        }),
      });
      if (!orderResponse.ok) {
        return json({
          code: "WOMPI_ORDER_INSERT_UNCONFIRMED",
          error: "No se pudo confirmar si el pedido quedó registrado. Esta solicitud no abrió la sesión de pago; espera el vencimiento de la reserva antes de volver a intentarlo.",
        }, 503);
      }
      orderInsertAttempted = false;
    }

    cleanupStarted = false;
    return json({ reference, amountInCents, signature, expirationTime, subtotal, discountTotal, couponDiscountTotal, shipping, total: totalCop, currency: "COP" });
  } catch {
    // Deliberately do not log request data: coupon codes and customer PII must not
    // appear in logs, URLs, or exception payloads.
    console.error("Error preparando el pago Wompi.");
    if (orderInsertAttempted) {
      console.error("El resultado del INSERT Wompi es ambiguo; los locks y reservas vencerán por TTL.");
      return json({
        code: "WOMPI_ORDER_INSERT_UNCONFIRMED",
        error: "No se pudo confirmar si el pedido quedó registrado. Esta solicitud no abrió la sesión de pago; espera el vencimiento de la reserva antes de volver a intentarlo.",
      }, 503);
    }
    if (cleanupStarted && cleanupSupabaseUrl && cleanupServiceRoleKey && cleanupReference) {
      try {
        const cleanup = await releaseSideEffectsIfNoOrder({
          supabaseUrl: cleanupSupabaseUrl,
          serviceRoleKey: cleanupServiceRoleKey,
          reference: cleanupReference,
          hasCoupon: cleanupHasCoupon,
        });
        if (!cleanup.safe) console.error("No se pudo verificar/liberar con seguridad las reservas Wompi; vencerán por TTL.");
      } catch {
        console.error("Falló la limpieza segura de las reservas Wompi; vencerán por TTL.");
      }
    }
    return json({ error: "Error preparando el pago." }, 500);
  }
});
