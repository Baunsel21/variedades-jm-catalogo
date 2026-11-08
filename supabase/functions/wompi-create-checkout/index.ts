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
  items?: QuoteItem[];
};

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
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
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
    price: Math.round(Number(raw?.price ?? 0)),
    original_subtotal: Math.round(Number(raw?.original_subtotal ?? 0)),
    discount_total: Math.round(Number(raw?.discount_total ?? 0)),
    net_subtotal: Math.round(Number(raw?.net_subtotal ?? 0)),
  }));
  if (items.some((x: any) => !x.id || !Number.isSafeInteger(x.qty) || x.qty < 1 ||
    !Number.isSafeInteger(x.price) || !Number.isSafeInteger(x.original_subtotal) ||
    !Number.isSafeInteger(x.discount_total) || !Number.isSafeInteger(x.net_subtotal))) return "";
  items.sort((a: any, b: any) => a.id.localeCompare(b.id) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size) || a.qty - b.qty || a.price - b.price);
  return JSON.stringify(items);
}

async function releaseReservationIfNoOrder(supabaseUrl: string, serviceRoleKey: string, reference: string): Promise<void> {
  // A network error during INSERT can occur after PostgreSQL committed. Never release
  // inventory until a read confirms there is no order for this reference.
  try {
    const url = new URL(`${supabaseUrl}/rest/v1/orders`);
    url.searchParams.set("reference", `eq.${reference}`);
    url.searchParams.set("select", "reference");
    url.searchParams.set("limit", "1");
    const check = await fetch(url.toString(), { headers: supabaseHeaders(serviceRoleKey) });
    if (!check.ok) return;
    const rows = await check.json();
    if (Array.isArray(rows) && rows.length > 0) return;
    await fetch(`${supabaseUrl}/rest/v1/rpc/release_inventory_reservation`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify({ p_reference: reference }),
    });
  } catch {
    // Fail closed: an uncertain reservation is allowed to expire under its 10-minute TTL.
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  try {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "El cuerpo de la solicitud no es JSON válido." }, 400); }

    const items = normalizeItems(body?.items);
    const city = String(body?.city ?? "").trim();
    const expectedTotalRaw = body?.expected_total;
    const expectedDiscountRaw = body?.expected_discount_total;
    const expectedAmountsAreNumeric = (typeof expectedTotalRaw === "number" || typeof expectedTotalRaw === "string") &&
      (typeof expectedDiscountRaw === "number" || typeof expectedDiscountRaw === "string");
    if (!expectedAmountsAreNumeric || expectedTotalRaw == null || expectedDiscountRaw == null || String(expectedTotalRaw).trim() === "" || String(expectedDiscountRaw).trim() === "") {
      return json({ code: "WOMPI_EXPECTED_TOTAL_REQUIRED", error: "Actualiza el catálogo y confirma nuevamente el total antes de iniciar el pago." }, 400);
    }
    const expectedTotal = Number(expectedTotalRaw);
    const expectedDiscountTotal = Number(expectedDiscountRaw);
    const name = String(body?.name ?? "").trim();
    const phone = String(body?.phone ?? "").trim();
    const address = String(body?.address ?? "").trim();
    const neighborhood = String(body?.neighborhood ?? "").trim();
    if (!items || !city || city.length > 120 || !Number.isSafeInteger(expectedTotal) || expectedTotal < 0 ||
        !Number.isSafeInteger(expectedDiscountTotal) || expectedDiscountTotal < 0 || !name || name.length > 200 || !phone || phone.length > 60 || !address || address.length > 300 || neighborhood.length > 200) {
      return json({ error: "Faltan datos obligatorios o hay productos/cantidades no válidas." }, 400);
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

    // Supabase is the authority for item prices, combo discounts, and shipping.
    const quoteResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/get_storefront_cart_quote`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify({ p_items: items, p_city: city }),
    });
    if (!quoteResponse.ok) return json({ error: "No se pudo calcular el total autorizado del carrito." }, 502);
    const quote = await readJson(quoteResponse) as Quote | null;
    if (!quote || quote.success !== true || !Array.isArray(quote.items) || quote.items.length === 0) {
      return json({ error: String(quote?.message ?? "La cotización del carrito no es válida.") }, 422);
    }
    if (canonicalCart(quote.items) !== canonicalCart(items)) {
      return json({ error: "La cotización no corresponde exactamente a los productos, cantidades o variantes enviados." }, 422);
    }

    const subtotal = Math.round(Number(quote.original_subtotal));
    const discountTotal = Math.round(Number(quote.discount_total ?? 0));
    const discountedSubtotal = Math.round(Number(quote.discounted_subtotal));
    const shipping = Math.round(Number(quote.shipping));
    const totalCop = Math.round(Number(quote.total));
    const amountInCents = totalCop * 100;
    const lineOriginalSubtotal = quote.items.reduce((sum: number, item: QuoteItem) => sum + Math.round(Number(item.original_subtotal)), 0);
    const lineDiscountTotal = quote.items.reduce((sum: number, item: QuoteItem) => sum + Math.round(Number(item.discount_total)), 0);
    const lineDiscountedSubtotal = quote.items.reduce((sum: number, item: QuoteItem) => sum + Math.round(Number(item.net_subtotal)), 0);
    if (
      !Number.isSafeInteger(subtotal) || subtotal <= 0 ||
      !Number.isSafeInteger(discountTotal) || discountTotal < 0 || discountTotal > subtotal ||
      !Number.isSafeInteger(discountedSubtotal) || discountedSubtotal < 0 ||
      discountedSubtotal !== subtotal - discountTotal ||
      !Number.isSafeInteger(shipping) || shipping < 0 ||
      !Number.isSafeInteger(totalCop) || totalCop <= 0 ||
      totalCop !== discountedSubtotal + shipping ||
      !Number.isSafeInteger(amountInCents) ||
      lineOriginalSubtotal !== subtotal ||
      lineDiscountTotal !== discountTotal ||
      lineDiscountedSubtotal !== discountedSubtotal ||
      String(quote.currency ?? "COP").toUpperCase() !== "COP"
    ) {
      return json({ error: "La cotización devolvió importes no válidos o inconsistentes." }, 422);
    }
    // Rechazar una tarifa/promoción cambiada antes de crear la reserva o el pedido PENDING.
    // Así el cliente puede revisar el importe nuevo sin dejar filas ni liberar una reserva previa.
    if (expectedTotal !== totalCop || expectedDiscountTotal !== discountTotal) {
      return json({
        code: "WOMPI_QUOTE_CHANGED",
        canRetryWithNewReference: false,
        shipping,
        total: totalCop,
        discount_total: discountTotal,
        error: "El envío o el descuento cambió antes de iniciar el pago. Revisa el total actualizado y confirma de nuevo; no se creó pedido ni se generó una reserva.",
      }, 409);
    }

    let reference = String(body?.reference ?? "").trim();
    if (!reference) reference = `JM-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(reference)) {
      return json({ error: "La referencia del pedido no tiene un formato válido." }, 400);
    }

    // Check existing reference before touching the reservation. A retry may reuse a
    // pending order only when all economically relevant fields still match the quote.
    const existingUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
    existingUrl.searchParams.set("reference", `eq.${reference}`);
    existingUrl.searchParams.set("select", "reference,total,subtotal,shipping,city,items,payment_method,payment_status,transaction_id,customer_name,phone,address,neighborhood");
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
      const sameOrder = pendingAndUnlinked &&
        Math.round(Number(existing.total)) === totalCop &&
        Math.round(Number(existing.subtotal)) === subtotal &&
        Math.round(Number(existing.shipping)) === shipping &&
        String(existing.city ?? "").trim().toLowerCase() === city.toLowerCase() &&
        String(existing.customer_name ?? "").trim() === name &&
        String(existing.phone ?? "").trim() === phone &&
        String(existing.address ?? "").trim() === address &&
        String(existing.neighborhood ?? "").trim() === neighborhood &&
        canonicalCart(existing.items) === canonicalCart(items) &&
        canonicalQuoteItems(existing.items) === canonicalQuoteItems(quote.items);
      if (!sameOrder) {
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
          // is verified terminal in the stored order and its old hold is released.
          const releaseResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/release_inventory_reservation`, {
            method: "POST",
            headers: supabaseHeaders(serviceRoleKey),
            body: JSON.stringify({ p_reference: reference }),
          });
          if (!releaseResponse.ok) {
            return json({ error: "El intento anterior terminó, pero no se pudo confirmar la liberación de su reserva. Espera o contacta soporte antes de volver a pagar." }, 502);
          }
          return json({
            code: "WOMPI_REFERENCE_TERMINAL",
            canRetryWithNewReference: true,
            error: "El intento anterior terminó sin aprobarse y su reserva se liberó. Se preparará un intento nuevo sin reutilizar esa referencia.",
          }, 409);
        }
        if (pendingAndUnlinked) {
          // A stale browser can send a pending reference whose stored order no
          // longer matches the current checkout after back/reload. Release only
          // this old hold and let the client retry once with a fresh reference;
          // never keep the buyer blocked and never stack two active holds.
          const releaseResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/release_inventory_reservation`, {
            method: "POST",
            headers: supabaseHeaders(serviceRoleKey),
            body: JSON.stringify({ p_reference: reference }),
          });
          if (!releaseResponse.ok) {
            return json({ error: "La referencia anterior no coincide con este carrito y no se pudo liberar de forma segura. Espera a que venza su reserva." }, 502);
          }
          return json({
            code: "WOMPI_REFERENCE_STALE",
            canRetryWithNewReference: true,
            error: "La referencia anterior estaba asociada a otro carrito. Su reserva se liberó y se preparará el mismo pedido con una referencia nueva.",
          }, 409);
        }
        return json({ error: "Esta referencia ya corresponde a otro intento, a una transacción vinculada, a otro comprador o a un total distinto. No se reutilizó el pedido anterior." }, 409);
      }
    }

    // Fail closed when this buyer already has a Wompi transaction linked to an
    // unresolved PENDING order. This is especially important when Wompi already
    // approved a payment but inventory/order reconciliation still needs retry.
    const pendingUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
    pendingUrl.searchParams.set("phone", `eq.${phone}`);
    pendingUrl.searchParams.set("payment_method", "eq.wompi");
    pendingUrl.searchParams.set("payment_status", "eq.PENDING");
    // Include linked and unlinked pending orders. SQL legacy data can contain NULL,
    // an empty string or whitespace in transaction_id, so normalize it client-side.
    pendingUrl.searchParams.set("select", "reference,transaction_id,payment_status,total,subtotal,shipping,city,items,customer_name,phone,address,neighborhood");
    pendingUrl.searchParams.set("limit", "1000");
    const pendingResponse = await fetch(pendingUrl.toString(), { headers: supabaseHeaders(serviceRoleKey) });
    if (!pendingResponse.ok) return json({ error: "No se pudo comprobar si ya tienes un pago Wompi pendiente. No se inició otro pago." }, 503);
    const pendingRows = await readJson(pendingResponse);
    if (!Array.isArray(pendingRows)) return json({ error: "La verificación de pagos pendientes devolvió una respuesta no válida. No se inició otro pago." }, 503);
    const hasLinkedPendingTransaction = pendingRows.some((row: any) => Boolean(String(row?.transaction_id ?? "").trim()));
    if (hasLinkedPendingTransaction) {
      return json({
        code: "WOMPI_TRANSACTION_PENDING",
        canRetryWithNewReference: false,
        error: "Ya existe una transacción Wompi vinculada a un pedido pendiente con este teléfono. No inicies otro pago para evitar un posible cobro duplicado; espera la confirmación o contacta soporte.",
      }, 409);
    }

    // Do not create two active holds when a second tab/browser generates a
    // different client reference for the same buyer and identical cart. The
    // frontend will retry once with the existing reference returned here.
    const samePendingOrder = pendingRows.find((row: any) => {
      const rowReference = String(row?.reference ?? "").trim();
      return rowReference && rowReference !== reference &&
        String(row?.payment_status ?? "").toUpperCase() === "PENDING" &&
        !String(row?.transaction_id ?? "").trim() &&
        Math.round(Number(row?.total)) === totalCop &&
        Math.round(Number(row?.subtotal)) === subtotal &&
        Math.round(Number(row?.shipping)) === shipping &&
        String(row?.city ?? "").trim().toLowerCase() === city.toLowerCase() &&
        String(row?.customer_name ?? "").trim() === name &&
        String(row?.phone ?? "").trim() === phone &&
        String(row?.address ?? "").trim() === address &&
        String(row?.neighborhood ?? "").trim() === neighborhood &&
        canonicalCart(row?.items) === canonicalCart(items) &&
        canonicalQuoteItems(row?.items) === canonicalQuoteItems(quote.items);
    });
    if (samePendingOrder) {
      const existingReservationResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/reserve_order_inventory`, {
        method: "POST",
        headers: supabaseHeaders(serviceRoleKey),
        body: JSON.stringify({ p_reference: String(samePendingOrder.reference), p_items: items, p_minutes: 10 }),
      });
      const existingReservation = await readJson(existingReservationResponse);
      const existingExpiry = new Date(String(existingReservation?.expires_at ?? ""));
      if (existingReservationResponse.ok && existingReservation?.success === true && Number.isFinite(existingExpiry.getTime())) {
        return json({
          code: "WOMPI_ACTIVE_RESERVATION",
          existingReference: String(samePendingOrder.reference),
          expiresAt: existingExpiry.toISOString(),
          error: "Ya existe una reserva activa para este carrito y teléfono. Se reutilizará sin crear una segunda reserva.",
        }, 409);
      }
    }
    // Keep the existing 10-minute server-side inventory reservation system.
    const reservationResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/reserve_order_inventory`, {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey),
      body: JSON.stringify({ p_reference: reference, p_items: items, p_minutes: 10 }),
    });
    if (!reservationResponse.ok) return json({ error: "No se pudo reservar el inventario para este pago." }, 502);
    const reservation = await readJson(reservationResponse);
    if (!reservation?.success) return json({ error: String(reservation?.message ?? "No hay suficientes unidades disponibles.") }, 409);

    // Match the hosted checkout's initiation deadline to the existing 10-minute hold.
    // This prevents starting a new Wompi checkout after its server-side stock hold expires.
    const expiryDate = new Date(String(reservation?.expires_at ?? ""));
    const expiryMs = expiryDate.getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= Date.now() + 5000) {
      await releaseReservationIfNoOrder(supabaseUrl, serviceRoleKey, reference);
      return json({ error: "La reserva de inventario venció o no tiene una fecha válida. Vuelve a iniciar el pago." }, 409);
    }
    const expirationTime = expiryDate.toISOString();

    // Wompi specifies expiration-time as part of the integrity signature when supplied.
    const signature = await sha256Hex(`${reference}${amountInCents}COP${expirationTime}${integritySecret}`);
    if (!existing) {
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
          payment_method: "wompi",
          payment_status: "PENDING",
        }),
      });
      if (!orderResponse.ok) {
        await releaseReservationIfNoOrder(supabaseUrl, serviceRoleKey, reference);
        return json({ error: "No se pudo guardar el pedido pendiente de pago." }, 500);
      }
    }

    return json({ reference, amountInCents, signature, expirationTime, subtotal, discountTotal, shipping, total: totalCop, currency: "COP" });
  } catch (error) {
    console.error("Error preparando el pago Wompi:", error instanceof Error ? error.message : "error desconocido");
    return json({ error: "Error preparando el pago." }, 500);
  }
});
