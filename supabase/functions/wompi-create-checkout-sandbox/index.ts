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

import { parseCheckoutCedula } from "./cedula.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUPON_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UNLINKED_ORDER_SAFE_REUSE_GRACE_MS = 15 * 60 * 1000;
type WompiEnvironment = "prod" | "test";
const WOMPI_SANDBOX_ENVIRONMENT: WompiEnvironment = "test";
function normalizeWompiEnvironment(value: unknown): WompiEnvironment | null {
  const environment = String(value ?? "").trim().toLowerCase();
  if (environment === "prod" || environment === "production") return "prod";
  if (environment === "test" || environment === "sandbox") return "test";
  return null;
}
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

const TERMINAL_PAYMENT_STATUSES = new Set(["ERROR", "DECLINED", "VOIDED"]);
const VERIFIED_PAYMENT_STATUSES = new Set(["ERROR", "DECLINED", "VOIDED", "APPROVED"]);
const WOMPI_TERMINAL_GRACE_MS = 15 * 60 * 1000;
const WOMPI_ORDER_SELECT = "reference,created_at,total,subtotal,shipping,city,items,payment_method,payment_status,transaction_id,customer_name,phone,address,neighborhood,coupon_id,coupon_code,coupon_discount_total,wompi_reconciliation_required,coupon_reconciliation_required";

function snapshotCityKey(value: unknown): string {
  const normalized = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ");
  return ["cali", "santiago de cali", "cali valle del cauca"].includes(normalized) ? "cali" : normalized;
}

function snapshotTextKey(value: unknown): string {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

function snapshotMismatchFields(existing: any, current: {
  name: string; phone: string; city: string; address: string; neighborhood: string;
  quote: Quote; subtotal: number; shipping: number; total: number; couponCode: string; couponDiscountTotal: number;
}): string[] {
  const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "").slice(-10);
  const mismatches: string[] = [];
  if (snapshotTextKey(existing?.customer_name) !== snapshotTextKey(current.name)) mismatches.push("customer_name");
  if (digits(existing?.phone) !== digits(current.phone)) mismatches.push("phone");
  if (snapshotCityKey(existing?.city) !== snapshotCityKey(current.city)) mismatches.push("city");
  if (snapshotTextKey(existing?.address) !== snapshotTextKey(current.address)) mismatches.push("address");
  if (snapshotTextKey(existing?.neighborhood) !== snapshotTextKey(current.neighborhood)) mismatches.push("neighborhood");
  if (canonicalCart(existing?.items) !== canonicalCart(current.quote?.items)) mismatches.push("cart");
  const previousPricedItems = canonicalQuoteItems(existing?.items);
  const currentPricedItems = canonicalQuoteItems(current.quote?.items);
  if (!previousPricedItems || previousPricedItems !== currentPricedItems) mismatches.push("line_pricing");
  if (copAmount(existing?.total) !== current.total) mismatches.push("total");
  if (copAmount(existing?.subtotal) !== current.subtotal) mismatches.push("subtotal");
  if (copAmount(existing?.shipping) !== current.shipping) mismatches.push("shipping");
  if (normalizeStoredCouponCode(existing?.coupon_code) !== current.couponCode) mismatches.push("coupon_code");
  if (copAmount(existing?.coupon_discount_total ?? 0) !== current.couponDiscountTotal) mismatches.push("coupon_discount");
  if (normalizeCouponId(existing?.coupon_id) !== normalizeCouponId(current.quote?.coupon_id)) mismatches.push("coupon_id");
  return mismatches;
}

async function fetchOrderByReference(supabaseUrl: string, serviceRoleKey: string, reference: string): Promise<{ ok: boolean; duplicate: boolean; order: any | null }> {
  try {
    const url = new URL(`${supabaseUrl}/rest/v1/orders`);
    url.searchParams.set("reference", `eq.${reference}`);
    url.searchParams.set("select", WOMPI_ORDER_SELECT);
    url.searchParams.set("limit", "2");
    const response = await fetch(url.toString(), { headers: supabaseHeaders(serviceRoleKey) });
    if (!response.ok) return { ok: false, duplicate: false, order: null };
    const rows = await readJson(response);
    if (!Array.isArray(rows)) return { ok: false, duplicate: false, order: null };
    return { ok: true, duplicate: rows.length > 1, order: rows[0] ?? null };
  } catch {
    return { ok: false, duplicate: false, order: null };
  }
}

async function verifyWompiSandboxAttempt(privateKey: string, attemptReference: string, transactionId: string, expectedAmountInCents: number, expectedOrderStatus: string): Promise<boolean> {
  try {
    const headers = { Authorization: `Bearer ${privateKey}`, "Content-Type": "application/json" };
    if (transactionId) {
      const response = await fetch(`https://sandbox.wompi.co/v1/transactions/${encodeURIComponent(transactionId)}`, { headers });
      if (!response.ok) return false;
      const payload = await readJson(response);
      const tx = payload?.data;
      const status = String(tx?.status ?? "").trim().toUpperCase();
      return String(tx?.id ?? "").trim() === transactionId &&
        Number(tx?.amount_in_cents) === expectedAmountInCents &&
        String(tx?.currency ?? "").trim().toUpperCase() === "COP" &&
        VERIFIED_PAYMENT_STATUSES.has(status) &&
        status === expectedOrderStatus;
    }
    const url = new URL("https://sandbox.wompi.co/v1/transactions");
    url.searchParams.set("reference", attemptReference);
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) return false;
    const payload = await readJson(response);
    return Array.isArray(payload?.data) && payload.data.length === 0;
  } catch {
    return false;
  }
}

async function verifyTerminalOrderHistory(supabaseUrl: string, serviceRoleKey: string, order: any): Promise<boolean> {
  try {
    const reference = String(order?.reference ?? "").trim();
    const transactionId = String(order?.transaction_id ?? "").trim();
    const wompiPrivateKey = Deno.env.get("WOMPI_PRIVATE_KEY_TEST")?.trim();
    const orderStatus = String(order?.payment_status ?? "").trim().toUpperCase();
    const total = copAmount(order?.total);
    const cart = canonicalCart(order?.items);
    const phone = String(order?.phone ?? "").replace(/\D/g, "").slice(-10);
    if (!reference || !transactionId || !wompiPrivateKey || !VERIFIED_PAYMENT_STATUSES.has(orderStatus) ||
        String(order?.payment_method ?? "").trim().toLowerCase() !== "wompi" ||
        order?.wompi_reconciliation_required !== false || order?.coupon_reconciliation_required !== false ||
        total === null || total <= 0 || !Number.isSafeInteger(total * 100) || !cart || phone.length !== 10) return false;
    if (orderStatus === "APPROVED" && !await verifyApprovedOrderInventoryConverted(supabaseUrl, serviceRoleKey, reference)) return false;

    const expectedPhoneHash = await sha256Hex(phone);
    const expectedCartHash = await sha256Hex(cart);
    const lockUrl = new URL(`${supabaseUrl}/rest/v1/storefront_wompi_checkout_locks`);
    lockUrl.searchParams.set("reference", `eq.${reference}`);
    lockUrl.searchParams.set("select", "reference,status,transaction_id,terminal_at,reconciliation_required,customer_phone_hash,cart_hash");
    lockUrl.searchParams.set("limit", "2");
    const lockResponse = await fetch(lockUrl.toString(), { headers: supabaseHeaders(serviceRoleKey) });
    if (!lockResponse.ok) return false;
    const locks = await readJson(lockResponse);
    if (!Array.isArray(locks) || locks.length !== 1) return false;
    const lock = locks[0];
    const lockTerminalAt = Date.parse(String(lock?.terminal_at ?? ""));
    if (!new Set(["terminal_grace", "released"]).has(String(lock?.status ?? "").toLowerCase()) ||
        String(lock?.transaction_id ?? "").trim() !== transactionId || lock?.reconciliation_required !== false ||
        String(lock?.customer_phone_hash ?? "") !== expectedPhoneHash || String(lock?.cart_hash ?? "").toLowerCase() !== expectedCartHash ||
        !Number.isFinite(lockTerminalAt) || lockTerminalAt + WOMPI_TERMINAL_GRACE_MS > Date.now()) return false;

    const attemptsUrl = new URL(`${supabaseUrl}/rest/v1/storefront_wompi_payment_attempts`);
    attemptsUrl.searchParams.set("order_reference", `eq.${reference}`);
    attemptsUrl.searchParams.set("select", "order_reference,attempt_number,attempt_reference,environment,currency,amount_in_cents,status,transaction_id,terminal_at,manual_disposition,manual_verified_at");
    attemptsUrl.searchParams.set("order", "attempt_number.asc");
    attemptsUrl.searchParams.set("limit", "101");
    const attemptsResponse = await fetch(attemptsUrl.toString(), { headers: supabaseHeaders(serviceRoleKey) });
    if (!attemptsResponse.ok) return false;
    const attempts = await readJson(attemptsResponse);
    if (!Array.isArray(attempts) || attempts.length < 1 || attempts.length > 100) return false;
    const seenAttemptRefs = new Set<string>();
    const seenTransactions = new Set<string>();
    let expectedAttemptNumber = 1;
    for (const attempt of attempts) {
      const status = String(attempt?.status ?? "").trim().toUpperCase();
      const attemptNumber = Number(attempt?.attempt_number);
      const attemptRef = String(attempt?.attempt_reference ?? "").trim();
      const attemptTransaction = String(attempt?.transaction_id ?? "").trim();
      const terminalAt = Date.parse(String(attempt?.terminal_at ?? ""));
      const manualNoTransaction = status === "INITIATED" &&
        String(attempt?.manual_disposition ?? "").trim() === "NO_TRANSACTION_VERIFIED" &&
        !attemptTransaction && Number.isFinite(Date.parse(String(attempt?.manual_verified_at ?? ""))) &&
        Date.parse(String(attempt?.manual_verified_at ?? "")) + WOMPI_TERMINAL_GRACE_MS <= Date.now();
      const expiredBeforeSubmission = status === "EXPIRED_BEFORE_SUBMISSION" && !attemptTransaction &&
        Number.isFinite(terminalAt) && terminalAt + WOMPI_TERMINAL_GRACE_MS <= Date.now();
      const terminalProviderAttempt = VERIFIED_PAYMENT_STATUSES.has(status) && Boolean(attemptTransaction);
      if (String(attempt?.order_reference ?? "") !== reference || !Number.isSafeInteger(attemptNumber) || attemptNumber !== expectedAttemptNumber ||
          (!manualNoTransaction && !expiredBeforeSubmission && !terminalProviderAttempt) ||
          !(await verifyWompiSandboxAttempt(wompiPrivateKey, attemptRef, attemptTransaction, Number(attempt?.amount_in_cents), status === "INITIATED" ? "ERROR" : status)) ||
          String(attempt?.environment ?? "").trim().toLowerCase() !== "test" || String(attempt?.currency ?? "").trim().toUpperCase() !== "COP" ||
          Number(attempt?.amount_in_cents) !== total * 100 || !attemptRef || !attemptTransaction ||
          !Number.isFinite(terminalAt) || terminalAt + WOMPI_TERMINAL_GRACE_MS > Date.now() ||
          seenAttemptRefs.has(attemptRef) || seenTransactions.has(attemptTransaction)) return false;
      expectedAttemptNumber += 1;
      seenAttemptRefs.add(attemptRef);
      seenTransactions.add(attemptTransaction);
    }
    const latestAttempt = attempts[attempts.length - 1];
    return String(latestAttempt?.transaction_id ?? "").trim() === transactionId &&
      String(latestAttempt?.status ?? "").trim().toUpperCase() === orderStatus;
  } catch {
    return false;
  }
}

async function verifyApprovedOrderInventoryConverted(supabaseUrl: string, serviceRoleKey: string, reference: string): Promise<boolean> {
  try {
    const url = new URL(`${supabaseUrl}/rest/v1/inventory_reservations`);
    url.searchParams.set("reference", `eq.${reference}`);
    url.searchParams.set("select", "reference,status");
    url.searchParams.set("limit", "101");
    const response = await fetch(url.toString(), { headers: supabaseHeaders(serviceRoleKey) });
    if (!response.ok) return false;
    const rows = await readJson(response);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) return false;
    return rows.every((row: any) => String(row?.reference ?? "") === reference &&
      String(row?.status ?? "").trim().toLowerCase() === "converted");
  } catch {
    return false;
  }
}

async function verifyNoActiveInventoryReservation(supabaseUrl: string, serviceRoleKey: string, reference: string): Promise<boolean> {
  try {
    const url = new URL(`${supabaseUrl}/rest/v1/inventory_reservations`);
    url.searchParams.set("reference", `eq.${reference}`);
    url.searchParams.set("select", "reference,status,expires_at");
    url.searchParams.set("limit", "101");
    const response = await fetch(url.toString(), { headers: supabaseHeaders(serviceRoleKey) });
    if (!response.ok) return false;
    const rows = await readJson(response);
    if (!Array.isArray(rows) || rows.length > 100) return false;
    const releasedStatuses = new Set(["released", "expired", "cancelled"]);
    const expirableStatuses = new Set(["active", "reserved", "pending"]);
    return rows.every((row: any) => {
      const status = String(row?.status ?? "").trim().toLowerCase();
      if (releasedStatuses.has(status)) return true;
      if (!expirableStatuses.has(status)) return false;
      const expiresAt = Date.parse(String(row?.expires_at ?? ""));
      return Number.isFinite(expiresAt) && expiresAt <= Date.now();
    });
  } catch {
    return false;
  }
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

async function checkoutRequestRpc(
  supabaseUrl: string,
  serviceRoleKey: string,
  functionName: string,
  args: Record<string, unknown>,
): Promise<{ responseOk: boolean; result: any }> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify(args),
    });
    return { responseOk: response.ok, result: rpcObject(await readJson(response)) };
  } catch {
    return { responseOk: false, result: null };
  }
}

async function advanceCheckoutRequest(
  supabaseUrl: string,
  serviceRoleKey: string,
  requestId: string,
  snapshotHash: string,
  step: string,
  args: Record<string, unknown>,
): Promise<{ responseOk: boolean; result: any }> {
  return await checkoutRequestRpc(supabaseUrl, serviceRoleKey, "advance_storefront_wompi_checkout_request", {
    p_request_id: requestId,
    p_snapshot_hash: snapshotHash,
    p_step: step,
    p_args: args,
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  let orderInsertAttempted = false;
  try {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "El cuerpo de la solicitud no es JSON válido." }, 400); }

    if (body?.action === "cancel_request") {
      const origin = String(req.headers.get("origin") ?? "").replace(/\/$/, "");
      if (!new Set(["https://sirevya.com.co", "https://www.sirevya.com.co"]).has(origin)) {
        return json({ code: "WOMPI_REQUEST_CANCEL_ORIGIN_INVALID", error: "No se pudo validar el origen de la cancelación." }, 403);
      }
      const requestId = String(body?.checkout_request_id ?? "").trim();
      if (!UUID_PATTERN.test(requestId)) return json({ code: "WOMPI_REQUEST_ID_INVALID" }, 400);
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = getSupabaseServiceKey();
      if (!supabaseUrl || !serviceRoleKey) return json({ code: "WOMPI_REQUEST_CANCEL_UNAVAILABLE" }, 503);
      const cancelled = await checkoutRequestRpc(supabaseUrl, serviceRoleKey, "cancel_storefront_wompi_checkout_request", {
        p_request_id: requestId,
      });
      if (!cancelled.responseOk || cancelled.result?.success !== true) {
        return json({ code: "WOMPI_REQUEST_CANCEL_UNCONFIRMED", error: "La cancelación no pudo confirmarse; el checkout se conserva protegido para recuperación." }, 503);
      }
      return json({
        success: true,
        state: String(cancelled.result?.state ?? "unknown"),
        released: cancelled.result?.released === true,
        manual_recovery_required: cancelled.result?.manual_recovery_required === true,
        tombstone: cancelled.result?.tombstone === true,
      });
    }
    if (body?.action != null) return json({ code: "WOMPI_REQUEST_ACTION_INVALID" }, 400);

    const requestedWompiEnvironment = normalizeWompiEnvironment(body?.environment);
    const wompiEnvironment = WOMPI_SANDBOX_ENVIRONMENT;
    if (!requestedWompiEnvironment) {
      return json({ code: "WOMPI_ENVIRONMENT_REQUIRED", error: "Actualiza la tienda para validar el ambiente de pago antes de iniciar el checkout." }, 400);
    }
    if (requestedWompiEnvironment !== wompiEnvironment) {
      return json({ code: "WOMPI_ENVIRONMENT_MISMATCH", error: "La tienda y el servidor de pagos usan ambientes distintos. No se creó pedido ni reserva; no se abrió Wompi." }, 409);
    }

    const cedulaValidation = parseCheckoutCedula(body?.cedula ?? body?.customer_cedula);
    const customerCedula = cedulaValidation.value;
    if (cedulaValidation.error === "invalid") {
      return json({ code: "CUSTOMER_CEDULA_INVALID", error: "El número de cédula/documento no es válido o supera 60 caracteres." }, 400);
    }
    if (cedulaValidation.error === "required" && !String(body?.reference ?? "").trim()) {
      return json({ code: "CUSTOMER_CEDULA_REQUIRED", error: "La cédula o documento de identidad es obligatorio para iniciar el pago." }, 400);
    }

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
    const integritySecret = Deno.env.get("WOMPI_INTEGRITY_SECRET_TEST");
    if (!supabaseUrl || !serviceRoleKey || !integritySecret) {
      return json({ error: "Falta configurar una variable necesaria en Supabase." }, 500);
    }

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
    if (!reference) return json({ code: "WOMPI_REFERENCE_REQUIRED", error: "Actualiza el checkout para conservar la misma referencia de reserva durante una recuperación." }, 400);
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(reference)) {
      return json({ error: "La referencia del pedido no tiene un formato válido." }, 400);
    }
    let checkoutRequestId = String(body?.checkout_request_id ?? "").trim();
    const checkoutRequestIdProvided = Boolean(checkoutRequestId);
    if (checkoutRequestIdProvided && !UUID_PATTERN.test(checkoutRequestId)) {
      return json({ code: "WOMPI_REQUEST_ID_INVALID", error: "El identificador de recuperación del checkout no es válido." }, 400);
    }
    const canonicalItems = canonicalCart(items);
    if (!canonicalItems || canonicalCart(quote.items) !== canonicalItems) {
      return json({ code: "WOMPI_REQUEST_CART_INVALID", error: "No se pudo vincular la cesta cotizada con la reserva actual." }, 400);
    }
    const cartHash = await sha256Hex(canonicalItems);
    const normalizedPhone = phone.replace(/\D/g, "").slice(-10);
    if (!/^\d{10}$/.test(normalizedPhone)) return json({ code: "WOMPI_REQUEST_PHONE_INVALID" }, 400);
    const customerPhoneHash = await sha256Hex(normalizedPhone);
    const requestSnapshotHash = await sha256Hex(JSON.stringify({
      reference,
      name: snapshotTextKey(name),
      phone: normalizedPhone,
      email: email.toLowerCase(),
      city: snapshotCityKey(city),
      address: snapshotTextKey(address),
      neighborhood: snapshotTextKey(neighborhood),
      couponCode,
      cart: canonicalItems,
      quoteItems: canonicalQuoteItems(quote.items),
      currency: "COP",
      subtotal,
      discountTotal,
      discountedSubtotal,
      couponDiscountTotal,
      couponId: quoteCouponId,
      quoteCouponCode,
      shipping,
      total: totalCop,
    }));
    if (body?.expired_session_recovery === true && checkoutRequestIdProvided) {
      const expiredRetry = await checkoutRequestRpc(supabaseUrl, serviceRoleKey, "renew_storefront_wompi_expired_session", {
        p_request_id: checkoutRequestId,
        p_snapshot_hash: requestSnapshotHash,
        p_cart_hash: cartHash,
        p_customer_phone_hash: customerPhoneHash,
        p_customer_name: name,
        p_customer_phone: phone,
        p_city: city,
        p_address: address,
        p_neighborhood: neighborhood,
        p_customer_email: email,
        p_items: quote.items,
        p_coupon_code: couponCode,
        p_expected_quote: quote,
      });
      if (!expiredRetry.responseOk || expiredRetry.result?.success !== true) {
        const code = String(expiredRetry.result?.code ?? "WOMPI_EXPIRED_SESSION_RENEWAL_UNCONFIRMED");
        return json({ code, canRetryWithNewReference: false, error: "La sesión Sandbox expiró y no pudo renovarse de forma segura; el pedido y la reserva permanecen protegidos." }, 409);
      }
      const retry = expiredRetry.result;
      const retryReference = String(retry.attempt_reference ?? "");
      const retryAmount = copAmount(retry.amount_in_cents);
      const retryExpiry = String(retry.expires_at ?? "");
      const retryExpiryMs = Date.parse(retryExpiry);
      if (!/^SW-[A-F0-9]{32}$/.test(retryReference) || retryAmount <= 0 || !Number.isFinite(retryExpiryMs) || retryExpiryMs <= Date.now()) {
        return json({ code: "WOMPI_EXPIRED_SESSION_RENEWAL_INVALID", error: "La renovación Sandbox no devolvió una sesión válida." }, 503);
      }
      const retrySignature = await sha256Hex(`${retryReference}${retryAmount}COP${new Date(retryExpiryMs).toISOString()}${integritySecret}`);
      return json({ environment: wompiEnvironment, reference, attemptReference: retryReference, amountInCents: retryAmount, signature: retrySignature, expirationTime: new Date(retryExpiryMs).toISOString(), subtotal, discountTotal, couponDiscountTotal, shipping, total: totalCop, currency: "COP", checkoutRequestId, replayed: false, expiredSessionRenewed: true, newOrderAfterTerminalMismatch: false });
    }
    if (!checkoutRequestIdProvided) {
      const recoveredRequest = await checkoutRequestRpc(supabaseUrl, serviceRoleKey, "recover_storefront_wompi_checkout_request", {
        p_reference: reference,
        p_snapshot_hash: requestSnapshotHash,
        p_cart_hash: cartHash,
        p_customer_phone_hash: customerPhoneHash,
      });
      if (!recoveredRequest.responseOk) {
        return json({ code: "WOMPI_REQUEST_RECOVERY_UNCONFIRMED", canRetryWithNewReference: false,
          error: "No se pudo recuperar el checkout anterior de forma segura. El pedido y la reserva se conservan protegidos." }, 503);
      }
      if (recoveredRequest.result?.success === true) {
        const recoveredId = String(recoveredRequest.result.request_id ?? "");
        if (!UUID_PATTERN.test(recoveredId)) {
          return json({ code: "WOMPI_REQUEST_RECOVERY_INVALID", canRetryWithNewReference: false,
            error: "La recuperación del checkout no devolvió un identificador válido. El pedido permanece protegido." }, 503);
        }
        checkoutRequestId = recoveredId;
      } else if (recoveredRequest.result?.code === "WOMPI_REQUEST_NOT_FOUND") {
        checkoutRequestId = crypto.randomUUID();
      } else {
        const code = String(recoveredRequest.result?.code ?? "WOMPI_REQUEST_RECOVERY_FAILED");
        return json({ code, canRetryWithNewReference: false,
          error: code === "WOMPI_REQUEST_RECOVERY_AMBIGUOUS"
            ? "Hay más de una solicitud compatible con esta referencia. No se abrió otro pago y el pedido requiere conciliación."
            : "No se pudo demostrar qué solicitud anterior corresponde a este pedido. No se inició un pago." }, 409);
      }
    }
    const requestStart = await checkoutRequestRpc(supabaseUrl, serviceRoleKey, "start_storefront_wompi_checkout_request", {
      p_request_id: checkoutRequestId,
      p_reference: reference,
      p_snapshot_hash: requestSnapshotHash,
      p_cart_hash: cartHash,
      p_customer_phone_hash: customerPhoneHash,
    });
    if (!requestStart.responseOk || !requestStart.result) {
      return json({ code: "WOMPI_REQUEST_START_UNCONFIRMED", error: "No se pudo confirmar de forma idempotente el estado del checkout. Conserva la reserva; no se abrió Wompi." }, 503);
    }
    if (requestStart.result.success !== true) {
      const code = String(requestStart.result.code ?? "WOMPI_REQUEST_START_FAILED");
      return json({ code, canRetryWithNewReference: false, error: code === "WOMPI_MANUAL_RECOVERY_REQUIRED"
        ? "Este pedido se conserva protegido y requiere una conciliación administrativa antes de continuar."
        : code === "WOMPI_MANUAL_RETRY_GRACE"
          ? "La verificación administrativa terminó, pero aún debe cumplirse la ventana de seguridad antes del reintento."
        : code === "WOMPI_REQUEST_CANCELLED"
            ? "La solicitud anterior fue cancelada; confirma nuevamente para continuar con una referencia segura."
            : code === "WOMPI_REQUEST_NOT_REPLAYABLE"
              ? "El servidor recuperó la solicitud publicada, pero no puede confirmar su estado porque Wompi exige transaction_id para consultar y no documenta una búsqueda por reference. El pedido y la reserva permanecen protegidos; no se emitirá otra sesión ni se marcará el intento como fallido sin evidencia del proveedor."
              : "No se pudo validar la continuidad de este checkout. No se creó otro pedido ni se inició un pago." }, 409);
    }
    const requestState = String(requestStart.result.request_state ?? "started");
    const requestOrderCreatedByThis = requestStart.result.order_created_by_request === true;
    if (requestStart.result.replay_ready === true) {
      const replayAttemptReference = String(requestStart.result.attempt_reference ?? "");
      const replayAmountInCents = copAmount(requestStart.result.amount_in_cents);
      const replayExpiry = String(requestStart.result.expires_at ?? "");
      const replayExpiryMs = Date.parse(replayExpiry);
      if (!/^SW-[A-F0-9]{32}$/.test(replayAttemptReference) || replayAmountInCents !== amountInCents ||
          !Number.isFinite(replayExpiryMs) || replayExpiryMs <= Date.now() || requestStart.result.reference !== reference) {
        return json({ code: "WOMPI_REQUEST_REPLAY_INVALID", error: "No se pudo reanudar exactamente la sesión Wompi anterior. El pedido permanece protegido." }, 409);
      }
      const replaySignature = await sha256Hex(`${replayAttemptReference}${replayAmountInCents}COP${new Date(replayExpiryMs).toISOString()}${integritySecret}`);
      return json({ environment: wompiEnvironment, reference, attemptReference: replayAttemptReference,
        amountInCents: replayAmountInCents, signature: replaySignature, expirationTime: new Date(replayExpiryMs).toISOString(),
        subtotal, discountTotal, couponDiscountTotal, shipping, total: totalCop, currency: "COP",
        checkoutRequestId, replayed: true, newOrderAfterTerminalMismatch: false });
    }

    // A terminal order may resume only through the verified-attempt ledger below.
    // An unlinked or unknown payment state never gets a fresh order/reference.
    let resumesUnattemptedOrder = requestState === "order_created" && requestOrderCreatedByThis &&
      !String(requestStart.result.attempt_reference ?? "").trim();
    let manualRetryReady = false;
    let manualRetryPreparation: any = null;
    let existingTerminalTransaction = false;
    let forceNewOrderAuthorized = false;
    let approvedReplacementAuthorized = false;
    const userConfirmedSeparateOrder = body?.confirm_new_order_after_terminal_mismatch === true;
    const supersedesReference = String(body?.supersedes_reference ?? "").trim();
    const initialOrderLookup = await fetchOrderByReference(supabaseUrl, serviceRoleKey, reference);
    if (!initialOrderLookup.ok) return json({ error: "No se pudo verificar si la referencia ya existe." }, 502);
    if (initialOrderLookup.duplicate) {
      return json({ error: "La referencia está duplicada o la respuesta de pedidos no es válida." }, 409);
    }
    let existing = initialOrderLookup.order;
    if (!existing && !customerCedula) {
      return json({ code: "CUSTOMER_CEDULA_REQUIRED", error: "La cédula o documento de identidad es obligatorio para iniciar el pago." }, 400);
    }
    if (existing) {
      const pendingAndUnlinked = String(existing.payment_method ?? "").toLowerCase() === "wompi" &&
        String(existing.payment_status ?? "").toUpperCase() === "PENDING" &&
        !String(existing.transaction_id ?? "").trim();
      if (pendingAndUnlinked && !resumesUnattemptedOrder && requestState !== "attempt_issued" &&
          !(requestState === "started" && requestOrderCreatedByThis)) {
        return json({
          code: unlinkedWompiOrderExpired(existing) ? "WOMPI_ATTEMPT_UNVERIFIED" : "WOMPI_UNRESOLVED_RESERVATION",
          canRetryWithNewReference: false,
          existingReference: reference,
          error: unlinkedWompiOrderExpired(existing)
            ? "El pedido anterior sigue sin un estado terminal verificado por Wompi. No se creará otra orden automáticamente; contacta soporte para revisar el intento."
            : "Este pedido Wompi sigue pendiente y sin transacción vinculada. Espera la confirmación; no se abrirá otro intento ni otra orden mientras su estado sea ambiguo.",
        }, 409);
      }
      if (pendingAndUnlinked && requestState === "started" && requestOrderCreatedByThis) {
        const manualPrepare = await checkoutRequestRpc(supabaseUrl, serviceRoleKey, "prepare_storefront_wompi_manual_retry_lock", {
          p_request_id: checkoutRequestId,
          p_snapshot_hash: requestSnapshotHash,
          p_customer_name: name,
          p_customer_phone: phone,
          p_city: city,
          p_address: address,
          p_neighborhood: neighborhood,
          p_customer_email: email,
          p_items: quote.items,
          p_coupon_code: couponCode,
          p_expected_quote: quote,
          p_cart_hash: cartHash,
        });
        if (!manualPrepare.responseOk || manualPrepare.result?.success !== true) {
          const code = String(manualPrepare.result?.code ?? "WOMPI_MANUAL_RECOVERY_UNCONFIRMED");
          return json({ code, canRetryWithNewReference: false,
            error: code === "WOMPI_MANUAL_RETRY_GRACE"
              ? "La verificación individual se registró, pero aún debe cumplirse la ventana de seguridad antes de renovar la misma reserva."
              : "El pedido anterior permanece protegido. No se creó otra reserva ni se abrió Wompi; requiere conciliación administrativa." }, 409);
        }
        manualRetryReady = true;
        manualRetryPreparation = manualPrepare.result;
      }
      const existingStatus = String(existing.payment_status ?? "").trim().toUpperCase();
      const existingTransactionId = String(existing.transaction_id ?? "").trim();
      if (existingTransactionId && existingStatus === "PENDING") {
        return json({
          code: "WOMPI_TRANSACTION_PENDING",
          canRetryWithNewReference: false,
          error: "Ya hay una transacción Wompi pendiente vinculada a este pedido. No inicies otro pago; espera la confirmación o contacta soporte.",
        }, 409);
      }
      if (existingTransactionId && existingStatus === "APPROVED") {
        return json({
          code: "WOMPI_ALREADY_APPROVED",
          canRetryWithNewReference: false,
          error: "Este pedido ya tiene un pago aprobado. No intentes pagarlo otra vez.",
        }, 409);
      }
      if (!customerCedula) {
        return json({ code: "CUSTOMER_CEDULA_REQUIRED", error: "La cédula o documento de identidad es obligatorio para iniciar un nuevo intento de pago." }, 400);
      }
      existingTerminalTransaction = Boolean(existingTransactionId) && ["DECLINED", "VOIDED", "ERROR"].includes(existingStatus);
      if (existingTerminalTransaction) {
        if (!await verifyTerminalOrderHistory(supabaseUrl, serviceRoleKey, existing)) {
          return json({ code: "WOMPI_ATTEMPT_UNVERIFIED", canRetryWithNewReference: false,
            error: "El pedido anterior no tiene todos sus intentos terminales verificados y vencidos. No se inició otro intento." }, 409);
        }
        const mismatches = snapshotMismatchFields(existing, {
          name, phone, city, address, neighborhood, quote, subtotal, shipping, total: totalCop,
          couponCode, couponDiscountTotal,
        });
        if (mismatches.length) {
          console.warn("WOMPI_TERMINAL_ORDER_SNAPSHOT_MISMATCH", mismatches.join(","));
          if (!await verifyNoActiveInventoryReservation(supabaseUrl, serviceRoleKey, String(existing.reference))) {
            return json({ code: "WOMPI_UNRESOLVED_RESERVATION", canRetryWithNewReference: false,
              error: "El pedido anterior aún tiene una retención de inventario activa o no verificable. No se creó otra orden ni reserva." }, 409);
          }
          if (!userConfirmedSeparateOrder) {
            return json({
              code: "WOMPI_NEW_ORDER_CONFIRMATION_REQUIRED",
              canCreateNewOrder: true,
              existingReference: String(existing.reference),
              quote,
              error: "Los datos actuales no coinciden con un pedido anterior cuyos intentos terminaron. El pedido anterior se conservará. Revisa los datos y pulsa Confirmar nuevamente para iniciar una compra separada; todavía no se creó otra orden ni reserva y no se abrió Wompi.",
            }, 409);
          }
          return json({ code: "WOMPI_NEW_REFERENCE_REQUIRED", canRetryWithNewReference: false,
            existingReference: String(existing.reference),
            error: "La confirmación se recibió con la referencia del pedido anterior. No se modificó esa orden; vuelve a confirmar para generar una referencia nueva y segura." }, 409);
        }
      } else if (resumesUnattemptedOrder || manualRetryReady || requestState === "attempt_issued") {
        existingTerminalTransaction = false;
      } else {
        return json({ error: "Esta referencia ya corresponde a otro intento, a una transacción vinculada o a datos distintos. No se reutilizó el pedido anterior." }, 409);
      }
    }

    const confirmationNowMatchesSameOrder = Boolean(existing && existingTerminalTransaction && supersedesReference === reference &&
      snapshotMismatchFields(existing, {
        name, phone, city, address, neighborhood, quote, subtotal, shipping, total: totalCop,
        couponCode, couponDiscountTotal,
      }).length === 0);
    if (userConfirmedSeparateOrder && !confirmationNowMatchesSameOrder) {
      if (!supersedesReference || !/^[A-Za-z0-9_-]{1,120}$/.test(supersedesReference) || supersedesReference === reference) {
        return json({ code: "WOMPI_NEW_REFERENCE_REQUIRED", canRetryWithNewReference: false,
          error: "No se pudo vincular la confirmación a la orden terminal revisada. No se creó otra orden ni reserva." }, 409);
      }
      const supersededLookup = await fetchOrderByReference(supabaseUrl, serviceRoleKey, supersedesReference);
      if (!supersededLookup.ok || supersededLookup.duplicate || !supersededLookup.order ||
          !await verifyTerminalOrderHistory(supabaseUrl, serviceRoleKey, supersededLookup.order)) {
        return json({ code: "WOMPI_ATTEMPT_UNVERIFIED", canRetryWithNewReference: false,
          error: "El pedido anterior cambió o ya no tiene todos sus intentos terminales verificados. No se inició otro pedido ni pago." }, 409);
      }
      const supersededMismatches = snapshotMismatchFields(supersededLookup.order, {
        name, phone, city, address, neighborhood, quote, subtotal, shipping, total: totalCop,
        couponCode, couponDiscountTotal,
      });
      if (!supersededMismatches.length) {
        if (approvedReplacementAuthorized && supersedesReference === supersededLookup.order.reference) {
          forceNewOrderAuthorized = true;
        } else {
        return json({ code: "WOMPI_REUSE_EXISTING_ORDER", existingReference: supersedesReference,
          canRetryWithNewReference: false,
          error: "Los datos coinciden con el pedido anterior; se debe reutilizar esa misma orden y reserva." }, 409);
        }
      }
      if (supersededMismatches.length) console.warn("WOMPI_TERMINAL_ORDER_SNAPSHOT_MISMATCH", supersededMismatches.join(","));
      if (!approvedReplacementAuthorized && !await verifyNoActiveInventoryReservation(supabaseUrl, serviceRoleKey, supersedesReference)) {
        return json({ code: "WOMPI_UNRESOLVED_RESERVATION", canRetryWithNewReference: false,
          error: "El pedido anterior aún tiene una retención de inventario activa o no verificable. No se creó otra orden ni reserva." }, 409);
      }
      forceNewOrderAuthorized = true;
    }

    // Prevent duplicate payments for the same canonical cart, not unrelated
    // historical purchases that happen to share a phone number. Unknown or
    // malformed cart snapshots remain fail-closed because they cannot be ruled out.
    const cartForPendingGuard = canonicalCart(quote.items);
    if (!cartForPendingGuard) return json({ error: "No se pudo normalizar el carrito para verificar pagos pendientes." }, 400);
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
    const sameCartRows = pendingRows.filter((row: any) => {
      const rowReference = String(row?.reference ?? "").trim();
      if (!rowReference || rowReference === reference) return true;
      const rowCart = canonicalCart(row?.items);
      return !rowCart || rowCart === cartForPendingGuard;
    });
    if (sameCartRows.some((row: any) => row?.wompi_reconciliation_required === true || row?.coupon_reconciliation_required === true)) {
      return json({ code: "WOMPI_RECONCILIATION_REQUIRED", canRetryWithNewReference: false,
        error: "Hay un pago de este teléfono que requiere conciliación. No se inició otro cobro." }, 409);
    }
    const sameCartApproved = sameCartRows.find((row: any) => String(row?.payment_status ?? "").toUpperCase() === "APPROVED");
    if (sameCartApproved) {
      const approvedReference = String(sameCartApproved.reference ?? "").trim();
      if (!approvedReference || !await verifyTerminalOrderHistory(supabaseUrl, serviceRoleKey, sameCartApproved)) {
        return json({ code: "WOMPI_ATTEMPT_UNVERIFIED", canRetryWithNewReference: false,
          existingReference: approvedReference,
          error: "El pedido aprobado anterior no está completamente conciliado o su reserva no figura como convertida. No se inició otro cobro." }, 409);
      }
      if (userConfirmedSeparateOrder && supersedesReference === approvedReference && approvedReference !== reference) {
        approvedReplacementAuthorized = true;
        forceNewOrderAuthorized = true;
      } else {
        return json({ code: "WOMPI_ALREADY_APPROVED", canCreateNewOrder: true, canRetryWithNewReference: false,
          existingReference: approvedReference, quote,
          error: "Este carrito ya tiene un pago aprobado y conciliado. Si deseas comprarlo nuevamente, revisa el desglose y pulsa Confirmar otra vez para autorizar una compra separada." }, 409);
      }
    }
    const knownPaymentStatuses = new Set(["PENDING", "APPROVED", "ERROR", "DECLINED", "VOIDED"]);
    const sameCartUnknown = sameCartRows.find((row: any) => !knownPaymentStatuses.has(String(row?.payment_status ?? "").trim().toUpperCase()));
    if (sameCartUnknown) {
      return json({ code: "WOMPI_ATTEMPT_UNVERIFIED", canRetryWithNewReference: false,
        existingReference: String(sameCartUnknown.reference ?? ""),
        error: "El estado del pedido anterior no es verificable. Se conserva protegido y no se inició otro cobro." }, 409);
    }
    for (const terminalOrder of sameCartRows) {
      const terminalReference = String(terminalOrder?.reference ?? "").trim();
      const terminalStatus = String(terminalOrder?.payment_status ?? "").trim().toUpperCase();
      if (!TERMINAL_PAYMENT_STATUSES.has(terminalStatus) || terminalReference === reference) continue;
      if (!terminalReference || !await verifyTerminalOrderHistory(supabaseUrl, serviceRoleKey, terminalOrder)) {
        return json({ code: "WOMPI_ATTEMPT_UNVERIFIED", canRetryWithNewReference: false,
          existingReference: terminalReference,
          error: "El intento anterior de este carrito no tiene un estado terminal verificable. Se conserva protegido y no se inició otro cobro." }, 409);
      }
    }
    const sameCartPendingRows = sameCartRows.filter((row: any) => String(row?.payment_status ?? "").toUpperCase() === "PENDING");
    if (sameCartPendingRows.some((row: any) => !String(row?.reference ?? "").trim())) {
      return json({ code: "WOMPI_ATTEMPT_UNVERIFIED", canRetryWithNewReference: false,
        error: "Hay un intento pendiente del mismo carrito cuya referencia no se pudo verificar. No se abrió otro pago." }, 409);
    }
    const hasLinkedPendingTransaction = sameCartPendingRows.some((row: any) => Boolean(String(row?.transaction_id ?? "").trim()));
    if (hasLinkedPendingTransaction) {
      return json({
        code: "WOMPI_TRANSACTION_PENDING",
        canRetryWithNewReference: false,
        error: "Ya existe una transacción Wompi pendiente para este carrito. No inicies otro pago para evitar un cobro duplicado; espera la confirmación o contacta soporte.",
      }, 409);
    }

    // An unlinked PENDING order for this same cart remains blocked even after
    // its inventory TTL; expiry alone is not proof that Wompi has no transaction.
    const otherUnlinkedPendingOrders = sameCartPendingRows.filter((row: any) => {
      const rowReference = String(row?.reference ?? "").trim();
      return rowReference && rowReference !== reference &&
        !String(row?.transaction_id ?? "").trim();
    });
    if (otherUnlinkedPendingOrders.length) {
      const staleOrder = otherUnlinkedPendingOrders[0];
      return json({
        code: unlinkedWompiOrderExpired(staleOrder) ? "WOMPI_ATTEMPT_UNVERIFIED" : "WOMPI_UNRESOLVED_RESERVATION",
        canRetryWithNewReference: false,
        existingReference: String(staleOrder.reference),
        error: "Hay un pedido Wompi del mismo carrito sin estado terminal verificado. No se abrirá otra sesión para evitar duplicar el pago; contacta soporte para conciliación.",
      }, 409);
    }
    let retryLock: any = { success: false, code: "WOMPI_NO_RETRYABLE_ORDER", reference };
    let retryLockReady = manualRetryReady;
    let resumedOrderPreparation: any = manualRetryPreparation;
    if (resumesUnattemptedOrder) {
      const resumed = await checkoutRequestRpc(supabaseUrl, serviceRoleKey, "resume_storefront_wompi_unattempted_request", {
        p_request_id: checkoutRequestId,
        p_snapshot_hash: requestSnapshotHash,
        p_customer_name: name,
        p_customer_phone: phone,
        p_city: city,
        p_address: address,
        p_neighborhood: neighborhood,
        p_customer_email: email,
        p_items: quote.items,
        p_coupon_code: couponCode,
        p_expected_quote: quote,
        p_cart_hash: cartHash,
      });
      if (!resumed.responseOk || resumed.result?.success !== true) {
        return json({ code: String(resumed.result?.code ?? "WOMPI_REQUEST_RESUME_UNCONFIRMED"),
          error: "No se pudo revalidar atómicamente el mismo pedido y su reserva. El pedido permanece protegido; no se creó otra reserva ni se abrió Wompi." }, 409);
      }
      resumedOrderPreparation = resumed.result;
      retryLockReady = true;
      retryLock = { success: true, reference, expires_at: resumed.result.expires_at };
    } else if (!retryLockReady) {
      const retryLockCall = await advanceCheckoutRequest(supabaseUrl, serviceRoleKey, checkoutRequestId,
        requestSnapshotHash, "retry_lock", { p_customer_phone: phone, p_cart_hash: cartHash, p_minutes: 10 });
      retryLock = retryLockCall.result;
      if (!retryLockCall.responseOk || !retryLock || typeof retryLock.success !== "boolean") {
        return json({ code: "WOMPI_RETRY_LOCK_UNCONFIRMED", error: "No se pudo comprobar si existe un intento terminal reanudable. No se abrió otro pago." }, 503);
      }
      retryLockReady = retryLock.success === true;
    }
    if (!retryLockReady && retryLock.code === "WOMPI_REUSE_EXISTING_ORDER") {
      const priorReference = String(retryLock.existing_reference ?? "").trim();
      if (!priorReference) {
        return json({ code: "WOMPI_ATTEMPT_UNVERIFIED", canRetryWithNewReference: false,
          error: "No se pudo verificar la referencia del pedido terminal. No se creó otra orden ni se abrió Wompi." }, 409);
      }
      const priorLookup = await fetchOrderByReference(supabaseUrl, serviceRoleKey, priorReference);
      if (!priorLookup.ok || priorLookup.duplicate || !priorLookup.order) {
        return json({ code: "WOMPI_ATTEMPT_UNVERIFIED", canRetryWithNewReference: false,
          error: "No se pudo verificar el pedido terminal asociado al carrito. No se creó otra orden ni se abrió Wompi." }, 409);
      }
      const priorOrder = priorLookup.order;
      const priorMismatches = snapshotMismatchFields(priorOrder, {
        name, phone, city, address, neighborhood, quote, subtotal, shipping, total: totalCop,
        couponCode, couponDiscountTotal,
      });
      if (!await verifyTerminalOrderHistory(supabaseUrl, serviceRoleKey, priorOrder)) {
        return json({ code: "WOMPI_ATTEMPT_UNVERIFIED", canRetryWithNewReference: false,
          error: "El historial de pagos del pedido anterior no está completamente conciliado. No se inició otro pago." }, 409);
      }
      if (priorMismatches.length) {
        console.warn("WOMPI_TERMINAL_ORDER_SNAPSHOT_MISMATCH", priorMismatches.join(","));
        if (!await verifyNoActiveInventoryReservation(supabaseUrl, serviceRoleKey, priorReference)) {
          return json({ code: "WOMPI_UNRESOLVED_RESERVATION", canRetryWithNewReference: false,
            error: "El pedido anterior aún tiene una retención de inventario activa o no verificable. No se creó otra orden ni reserva." }, 409);
        }
        if (!userConfirmedSeparateOrder) {
          return json({
            code: "WOMPI_NEW_ORDER_CONFIRMATION_REQUIRED",
            canCreateNewOrder: true,
            existingReference: priorReference,
            quote,
            error: "Hay un pedido anterior del mismo carrito, pero no coincide con los datos actuales. Se conservará intacto. Revisa los datos y pulsa Confirmar nuevamente para crear una orden separada; todavía no se creó otra orden ni reserva y no se abrió Wompi.",
          }, 409);
        }
        if (!forceNewOrderAuthorized || priorReference !== supersedesReference) {
          return json({ code: "WOMPI_NEW_ORDER_CONFIRMATION_REQUIRED", canCreateNewOrder: true,
            existingReference: priorReference, quote,
            error: "Se encontró otra orden terminal relacionada. Revisa los datos y vuelve a confirmar esta compra separada; no se creó una orden ni reserva nueva." }, 409);
        }
        existingTerminalTransaction = false;
        forceNewOrderAuthorized = true;
        retryLockReady = false;
        retryLock.code = "WOMPI_NO_RETRYABLE_ORDER";
      } else {
        return json({
          code: "WOMPI_REUSE_EXISTING_ORDER",
          existingReference: priorReference,
          canRetryWithNewReference: false,
          error: "El pedido terminal coincide con el carrito y los datos actuales; se reutilizará esa misma orden y reserva.",
        }, 409);
      }
    }
    if (!retryLockReady && retryLock.code !== "WOMPI_NO_RETRYABLE_ORDER") {
      return json({
        code: retryLock.code,
        existingReference: retryLock.existing_reference,
        expiresAt: retryLock.expires_at,
        canRetryWithNewReference: false,
        error: retryLock.code === "WOMPI_REUSE_EXISTING_ORDER"
          ? "Existe un pedido terminal reanudable para este carrito. Se usará la misma orden; no se creará otra."
          : retryLock.code === "WOMPI_TERMINAL_GRACE"
            ? "El estado terminal fue verificado, pero debe cumplirse la ventana de seguridad de 15 minutos antes de reintentar."
            : "No se pudo reanudar este intento con seguridad. No se creó otro pedido ni se abrió una sesión de pago.",
      }, 409);
    }
    if (existingTerminalTransaction && !retryLockReady) {
      return json({ code: retryLock.code ?? "WOMPI_ATTEMPT_HISTORY_REQUIRED", canRetryWithNewReference: false,
        error: "El pedido terminó, pero no existe un historial verificado y vencido que permita reabrirlo. No se creó un pedido nuevo." }, 409);
    }
    if (retryLockReady && retryLock.reference != null && String(retryLock.reference) !== reference) {
      return json({ code: "WOMPI_RETRY_REFERENCE_MISMATCH", canRetryWithNewReference: false,
        error: "La referencia de la reanudación no coincide con el pedido actual. No se inició el pago." }, 409);
    }
    let checkoutLock: any = { responseOk: true, success: true };
    if (!retryLockReady) {
      const reserveCall = await advanceCheckoutRequest(supabaseUrl, serviceRoleKey, checkoutRequestId,
        requestSnapshotHash, "reserve_lock", { p_customer_phone: phone, p_cart_hash: cartHash, p_minutes: 10 });
      checkoutLock = { responseOk: reserveCall.responseOk, ...reserveCall.result };
    }
    if (!checkoutLock.responseOk) {
      // The RPC may have committed before its response was lost. Never perform a
      // separate read-then-release; an uncertain hold expires under its TTL.
      return json({ error: "No se pudo confirmar la reserva exclusiva; cualquier hold incierto vencerá por TTL. No se inició el pago." }, 503);
    }
    if (!checkoutLock.success) {
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
    let preparationResponseOk = true;
    let preparation: any = resumedOrderPreparation;
    if (!preparation) {
      const preparationCall = await advanceCheckoutRequest(supabaseUrl, serviceRoleKey, checkoutRequestId,
        requestSnapshotHash, "prepare", {
          p_items: items,
          p_city: city,
          p_coupon_code: couponCode,
          p_customer_email: email,
          p_customer_phone: phone,
          p_expected_quote: quote,
        });
      preparationResponseOk = preparationCall.responseOk;
      preparation = preparationCall.result;
    }
    if (!preparationResponseOk || preparation?.success !== true) {
      // The preparation RPC is transactional, but a lost response is ambiguous.
      // Leave any hold to TTL instead of racing another request with cleanup.
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
      }, quoteChanged || preparationResponseOk ? 409 : 502);
    }
    const expiryDate = new Date(String(preparation.expires_at ?? ""));
    const expiryMs = expiryDate.getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= Date.now() + 5000) {
      return json({ error: "La reserva atómica venció o no tiene una fecha válida. Cualquier hold restante vencerá por TTL; vuelve a iniciar después con una referencia nueva." }, 409);
    }
    const expirationTime = expiryDate.toISOString();

    // Only one request can claim the hosted checkout session for this lock.
    // A lost claim response is left to TTL; another request may already own it.
    const checkoutClaimCall = await advanceCheckoutRequest(supabaseUrl, serviceRoleKey, checkoutRequestId,
      requestSnapshotHash, "claim", {});
    const checkoutClaim = { responseOk: checkoutClaimCall.responseOk, ...checkoutClaimCall.result };
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

    if (!existing) {
      // Insert through a narrow SECURITY DEFINER RPC. This keeps direct table
      // INSERT closed to browser roles and avoids the PostgREST 403 path caused
      // by the Sandbox orders ACL/schema boundary.
      orderInsertAttempted = true;
      const orderCall = await advanceCheckoutRequest(supabaseUrl, serviceRoleKey, checkoutRequestId,
        requestSnapshotHash, "create_order", {
          p_reference: reference,
          p_customer_name: name,
          p_phone: phone,
          p_city: city,
          p_address: address,
          p_neighborhood: neighborhood,
          p_items: quote.items,
          p_subtotal: subtotal,
          p_shipping: shipping,
          p_total: totalCop,
          p_coupon_id: couponCode ? quoteCouponId : null,
          p_coupon_code: couponCode || null,
          p_coupon_discount_total: couponCode ? couponDiscountTotal : 0,
        });
      if (!orderCall.responseOk || orderCall.result?.success !== true) {
        return json({
          code: "WOMPI_ORDER_INSERT_UNCONFIRMED",
          error: "No se pudo confirmar si el pedido quedó registrado. Esta solicitud no abrió la sesión de pago; espera el vencimiento de la reserva antes de volver a intentarlo.",
        }, 503);
      }
      orderInsertAttempted = false;
    } else {
      const linkCall = await advanceCheckoutRequest(supabaseUrl, serviceRoleKey, checkoutRequestId,
        requestSnapshotHash, "mark_existing_order", { p_terminal_retry_verified: existingTerminalTransaction });
      if (!linkCall.responseOk || linkCall.result?.success !== true) {
        return json({ code: String(linkCall.result?.code ?? "WOMPI_ORDER_REUSE_UNCONFIRMED"),
          error: "No se pudo demostrar que el pedido existente pertenece a este reintento seguro. No se creó otro pedido ni se abrió Wompi." }, 409);
      }
    }

    const beginAttemptCall = await advanceCheckoutRequest(supabaseUrl, serviceRoleKey, checkoutRequestId,
      requestSnapshotHash, "begin_attempt", {
        p_order_reference: reference,
        p_customer_name: name,
        p_customer_phone: phone,
        p_city: city,
        p_address: address,
        p_neighborhood: neighborhood,
        p_expected_quote: quote,
        p_cart_hash: cartHash,
        p_is_new_order: !existing || resumesUnattemptedOrder,
        p_expiration_time: expirationTime,
        p_amount_in_cents: amountInCents,
      });
    const beginAttemptResponse = { ok: beginAttemptCall.responseOk };
    const attemptResult = beginAttemptCall.result;
    const attemptReference = String(attemptResult?.attempt_reference ?? "");
    if (!beginAttemptResponse.ok || attemptResult?.success !== true || !/^SW-[A-F0-9]{32}$/.test(attemptReference) ||
        Number(attemptResult?.amount_in_cents) !== amountInCents || String(attemptResult?.currency ?? "").toUpperCase() !== "COP" ||
        String(attemptResult?.environment ?? "").toLowerCase() !== wompiEnvironment) {
      return json({
        code: String(attemptResult?.code ?? "WOMPI_ATTEMPT_CREATE_FAILED"),
        canRetryWithNewReference: false,
        error: "No se pudo registrar de forma segura el intento de pago. No se abrió Wompi ni se presentó un cobro.",
      }, beginAttemptResponse.ok ? 409 : 503);
    }

    // Wompi receives and signs a unique attempt reference; the stable order
    // reference remains the key for inventory, coupons, order, and checkout lock.
    const signature = await sha256Hex(`${attemptReference}${amountInCents}COP${expirationTime}${integritySecret}`);
    const publish = await checkoutRequestRpc(supabaseUrl, serviceRoleKey, "publish_storefront_wompi_checkout_request", {
      p_request_id: checkoutRequestId,
      p_snapshot_hash: requestSnapshotHash,
      p_attempt_reference: attemptReference,
      p_amount_in_cents: amountInCents,
      p_expiration_time: expirationTime,
    });
    if (!publish.responseOk || publish.result?.success !== true) {
      return json({ code: String(publish.result?.code ?? "WOMPI_REQUEST_PUBLISH_UNCONFIRMED"),
        error: "La solicitud de checkout fue cancelada o no pudo confirmarse de forma atómica. No se abrió Wompi; el pedido y la reserva permanecen protegidos." }, 409);
    }
    return json({ environment: wompiEnvironment, reference, checkoutRequestId, attemptReference, amountInCents, signature, expirationTime, subtotal, discountTotal, couponDiscountTotal, shipping, total: totalCop, currency: "COP", newOrderAfterTerminalMismatch: forceNewOrderAuthorized });
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
    // No se hace cleanup separado: una respuesta perdida puede pertenecer a un
    // checkout concurrente. Las reservas dudosas expiran según su TTL server-side.
    return json({ error: "Error preparando el pago." }, 500);
  }
});
