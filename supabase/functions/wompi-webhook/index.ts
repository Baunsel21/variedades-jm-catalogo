const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-event-checksum",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce((value: any, key) => value?.[key], obj as any);
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

async function responseJson(response: Response): Promise<any> {
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

const COUPON_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;

async function confirmCouponRedemption(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  reference: string;
}): Promise<{ success: boolean; reconciliationRequired: boolean; httpStatus: number | null }> {
  try {
    const response = await fetch(`${args.supabaseUrl}/rest/v1/rpc/confirm_storefront_coupon_redemption`, {
      method: "POST",
      headers: supabaseHeaders(args.serviceRoleKey),
      body: JSON.stringify({ p_reference: args.reference }),
    });
    const result = rpcObject(await responseJson(response));
    return {
      success: response.ok && result?.success === true,
      reconciliationRequired: result?.reconciliation_required === true || result?.reconciliationRequired === true || result?.late === true || result?.expired_reservation === true,
      httpStatus: response.status,
    };
  } catch {
    return { success: false, reconciliationRequired: false, httpStatus: null };
  }
}

async function releaseCouponRedemption(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  reference: string;
  attemptReference?: string | null;
}): Promise<{ success: boolean; code?: string; httpStatus: number | null }> {
  try {
    const attemptReference = String(args.attemptReference ?? "");
    const attemptAware = /^SW-[A-F0-9]{32}$/.test(attemptReference);
    const rpcName = attemptAware
      ? "release_storefront_wompi_coupon_redemption_for_attempt"
      : "release_storefront_coupon_redemption";
    const body = attemptAware
      ? { p_order_reference: args.reference, p_attempt_reference: attemptReference }
      : { p_reference: args.reference };
    const response = await fetch(`${args.supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      method: "POST",
      headers: supabaseHeaders(args.serviceRoleKey),
      body: JSON.stringify(body),
    });
    const result = rpcObject(await responseJson(response));
    return {
      success: response.ok && result?.success === true,
      code: typeof result?.code === "string" ? result.code : undefined,
      httpStatus: response.status,
    };
  } catch {
    return { success: false, httpStatus: null };
  }
}

async function setCheckoutLockState(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  reference: string;
  state: "pending" | "terminal_grace" | "completed" | "released";
  transactionId: string;
}): Promise<{ success: boolean; lateApprovalConflict: boolean; otherReference: string | null }> {
  try {
    const response = await fetch(`${args.supabaseUrl}/rest/v1/rpc/set_storefront_wompi_checkout_state`, {
      method: "POST",
      headers: supabaseHeaders(args.serviceRoleKey),
      body: JSON.stringify({
        p_reference: args.reference,
        p_state: args.state,
        p_transaction_id: args.transactionId,
      }),
    });
    const result = rpcObject(await responseJson(response));
    return {
      success: response.ok && result?.success === true,
      lateApprovalConflict: response.ok && result?.late_approval_conflict === true,
      otherReference: typeof result?.other_reference === "string" ? result.other_reference : null,
    };
  } catch {
    return { success: false, lateApprovalConflict: false, otherReference: null };
  }
}

// Link a verified Wompi transaction to its existing order BEFORE performing the
// inventory operation. This does not change payment_status; it prevents checkout
// retries from starting another payment while an APPROVED event awaits reconciliation.
async function ensureOrderTransactionLinked(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  reference: string;
  transactionId: string;
}): Promise<{ linked: boolean; conflict: boolean; httpStatus: number | null }> {
  try {
    const response = await fetch(`${args.supabaseUrl}/rest/v1/rpc/link_storefront_wompi_transaction`, {
      method: "POST",
      headers: supabaseHeaders(args.serviceRoleKey),
      body: JSON.stringify({ p_reference: args.reference, p_transaction_id: args.transactionId }),
    });
    const result = rpcObject(await responseJson(response));
    return {
      linked: response.ok && result?.success === true && result?.linked === true,
      conflict: result?.code === "WOMPI_TRANSACTION_LINK_CONFLICT",
      httpStatus: response.status,
    };
  } catch (error) {
    console.error("No se pudo vincular inmediatamente la transacción verificada al pedido.", {
      reference: args.reference,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { linked: false, conflict: false, httpStatus: null };
  }
}

async function listPendingWompiOrdersForPhone(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  phone: string;
}): Promise<{ success: boolean; orders: Array<{ reference: string; transactionId: string; createdAt: string }> }> {
  try {
    const response = await fetch(`${args.supabaseUrl}/rest/v1/rpc/list_pending_wompi_orders_for_phone`, {
      method: "POST",
      headers: supabaseHeaders(args.serviceRoleKey),
      body: JSON.stringify({ p_customer_phone: args.phone }),
    });
    const result = rpcObject(await responseJson(response));
    if (!response.ok || result?.success !== true || !Array.isArray(result.orders)) {
      return { success: false, orders: [] };
    }
    const orders = result.orders.map((row: any) => {
      if (!row || typeof row.reference !== "string" || typeof row.created_at !== "string" ||
          (row.transaction_id !== null && typeof row.transaction_id !== "string") || !Number.isFinite(Date.parse(row.created_at))) {
        return null;
      }
      return {
        reference: row.reference,
        transactionId: String(row.transaction_id ?? "").trim(),
        createdAt: row.created_at,
      };
    });
    if (orders.some((row: any) => row === null)) return { success: false, orders: [] };
    return { success: true, orders: orders as Array<{ reference: string; transactionId: string; createdAt: string }> };
  } catch {
    return { success: false, orders: [] };
  }
}

// Keep a durable record when Wompi has confirmed the charge but inventory cannot
// be finalized safely. This table is created by the accompanying SQL migration.
async function recordInventoryReconciliation(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  transactionId: string;
  reference: string;
  amountInCents: number;
  reason: string;
  details?: Record<string, unknown>;
  orderAlreadyMarked?: boolean;
}): Promise<boolean> {
  let orderAndLockMarked = args.orderAlreadyMarked === true;
  try {
    if (!orderAndLockMarked) {
      try {
        const markerResponse = await fetch(`${args.supabaseUrl}/rest/v1/rpc/mark_storefront_wompi_reconciliation`, {
          method: "POST",
          headers: supabaseHeaders(args.serviceRoleKey),
          body: JSON.stringify({ p_reference: args.reference, p_transaction_id: args.transactionId }),
        });
        const marker = rpcObject(await responseJson(markerResponse));
        orderAndLockMarked = markerResponse.ok && marker?.success === true && marker?.order_flag_updated === true;
        if (!orderAndLockMarked) {
          console.error("No se pudo persistir el flag de conciliación en el pedido/lock Wompi.", {
            reference: args.reference, httpStatus: markerResponse.status,
          });
        }
      } catch (error) {
        console.error("No se pudo persistir el flag de conciliación en el pedido/lock Wompi.", {
          reference: args.reference, error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    const url = new URL(`${args.supabaseUrl}/rest/v1/sirevya_wompi_inventory_reconciliation`);
    url.searchParams.set("on_conflict", "transaction_id");
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        ...supabaseHeaders(args.serviceRoleKey),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        transaction_id: args.transactionId,
        reference: args.reference,
        amount_in_cents: args.amountInCents,
        currency: "COP",
        verified_wompi_status: "APPROVED",
        reconciliation_status: "NEEDS_REVIEW",
        reason: args.reason.slice(0, 1000),
        details: args.details ?? {},
        last_seen_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      console.error("No se pudo guardar el registro de conciliación de Wompi.", { httpStatus: response.status, reference: args.reference });
      return false;
    }
    return orderAndLockMarked;
  } catch (error) {
    console.error("Error guardando el registro de conciliación de Wompi.", { reference: args.reference, error: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

async function markInventoryReconciliationResolved(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  transactionId: string;
}): Promise<void> {
  try {
    const url = new URL(`${args.supabaseUrl}/rest/v1/sirevya_wompi_inventory_reconciliation`);
    url.searchParams.set("transaction_id", `eq.${args.transactionId}`);
    const response = await fetch(url.toString(), {
      method: "PATCH",
      headers: { ...supabaseHeaders(args.serviceRoleKey), Prefer: "return=minimal" },
      body: JSON.stringify({ reconciliation_status: "RESOLVED", resolved_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }),
    });
    if (!response.ok) {
      console.error("La conciliación de inventario se procesó, pero no se pudo actualizar su marca RESOLVED.", {
        transactionId: args.transactionId, httpStatus: response.status,
      });
    }
  } catch (error) {
    // This is auxiliary bookkeeping. Do not reverse a successful payment/stock result
    // because marking a prior review row failed; the durable row remains reviewable.
    console.error("No se pudo marcar la conciliación como resuelta.", { transactionId: args.transactionId, error: error instanceof Error ? error.message : "unknown" });
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  try {
    let event: any;
    try { event = await req.json(); } catch { return json({ error: "El cuerpo del evento no es JSON válido." }, 400); }
    // Wompi documents a separate event URL and an explicit environment field for
    // each environment. This handler is production-only and never selects credentials
    // or endpoints from the incoming event.
    const expectedEnvironment = "prod" as const;
    const eventEnvironment = String(event?.environment ?? "").trim().toLowerCase();
    if (eventEnvironment !== expectedEnvironment) {
      console.error("Evento Wompi recibido en un endpoint de otro ambiente.", { expectedEnvironment, eventEnvironment });
      return json({ error: "El evento pertenece a un ambiente distinto a este webhook." }, 400);
    }

    const eventSecret = Deno.env.get("WOMPI_EVENT_SECRET");
    const privateKey = Deno.env.get("WOMPI_PRIVATE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = getSupabaseServiceKey();
    if (!eventSecret || !privateKey || !supabaseUrl || !serviceRoleKey) {
      console.error("Missing Wompi/Supabase webhook configuration.");
      return json({ error: "Configuración del webhook incompleta." }, 500);
    }

    const properties = event?.signature?.properties;
    const receivedChecksum = req.headers.get("X-Event-Checksum") ?? event?.signature?.checksum;
    const timestamp = event?.timestamp;
    if (!Array.isArray(properties) || properties.length === 0 || properties.length > 50 || !receivedChecksum || timestamp === undefined || timestamp === null) {
      return json({ error: "Evento sin datos de firma suficientes." }, 400);
    }
    if (event?.event === "transaction.updated") {
      // These key fields must be integrity-signed; reference/currency are additionally
      // validated against the authenticated transaction API response below.
      const requiredSignedProperties = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];
      if (!requiredSignedProperties.every((required) => properties.includes(required))) {
        return json({ error: "La firma no incluye las propiedades críticas de la transacción." }, 401);
      }
    }
    let signaturePayload = "";
    for (const property of properties) {
      if (typeof property !== "string" || !property || property.length > 200) return json({ error: "Propiedad de firma no válida." }, 400);
      const value = getNestedValue(event?.data, property);
      if (value === undefined || value === null) return json({ error: "Falta un dato incluido en la firma." }, 400);
      signaturePayload += String(value);
    }
    signaturePayload += String(timestamp) + eventSecret;
    const calculatedChecksum = await sha256Hex(signaturePayload);
    if (calculatedChecksum.toLowerCase() !== String(receivedChecksum).trim().toLowerCase()) {
      console.error("Se rechazó un evento Wompi con checksum inválido.");
      return json({ error: "Firma de evento inválida." }, 401);
    }

    if (event?.event !== "transaction.updated") {
      // Events for other resources do not alter storefront orders.
      return json({ received: true, ignored: true, reason: "Tipo de evento no procesado." });
    }

    const eventTransaction = event?.data?.transaction;
    const transactionId = String(eventTransaction?.id ?? "").trim();
    const eventReference = String(eventTransaction?.reference ?? "").trim();
    const eventCurrency = String(eventTransaction?.currency ?? "").toUpperCase();
    const eventAmount = Number(eventTransaction?.amount_in_cents ?? eventTransaction?.amountInCents);
    if (!transactionId || transactionId.length > 120 || !eventReference || eventReference.length > 120 || eventCurrency !== "COP" || !Number.isSafeInteger(eventAmount) || eventAmount <= 0) {
      return json({ error: "La transacción no contiene identificador, referencia, monto o moneda válidos." }, 400);
    }

    // The checksum properties supplied by Wompi can vary and may not include reference
    // or currency. Verify the transaction independently with Wompi's authenticated API
    // before trusting these fields or updating the order.
    const wompiBaseUrl = "https://production.wompi.co/v1";
    const wompiResponse = await fetch(`${wompiBaseUrl}/transactions/${encodeURIComponent(transactionId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${privateKey}`, Accept: "application/json" },
    });
    if (!wompiResponse.ok) {
      console.error("No se pudo verificar la transacción con la API autenticada de Wompi.", { httpStatus: wompiResponse.status });
      return json({ error: "No se pudo verificar la transacción con Wompi; se reintentará el evento." }, 502);
    }
    const wompiPayload = await responseJson(wompiResponse);
    const confirmed = wompiPayload?.data;
    const confirmedId = String(confirmed?.id ?? "").trim();
    const confirmedReference = String(confirmed?.reference ?? "").trim();
    const confirmedCurrency = String(confirmed?.currency ?? "").toUpperCase();
    const confirmedAmount = Number(confirmed?.amount_in_cents ?? confirmed?.amountInCents);
    let status = String(confirmed?.status ?? "").toUpperCase();

    if (confirmedId !== transactionId || confirmedReference !== eventReference || confirmedCurrency !== "COP" || confirmedCurrency !== eventCurrency || !Number.isSafeInteger(confirmedAmount) || confirmedAmount <= 0 || confirmedAmount !== eventAmount) {
      console.error("Los datos del evento no coinciden con la consulta autenticada de Wompi.", { transactionId });
      return json({ error: "Los datos de la transacción no coinciden con Wompi." }, 409);
    }
    const supportedStatuses = new Set(["PENDING", "APPROVED", "DECLINED", "VOIDED", "ERROR"]);
    if (!supportedStatuses.has(status)) {
      return json({ received: true, ignored: true, reason: "Estado actual de transacción no soportado." });
    }

    // Resolve a current SW reference by its internal key. Legacy transactions
    // reused the stable order reference, so resolve those by external reference
    // AND the transaction ID independently confirmed with Wompi above.
    let orderReference = confirmedReference;
    let attemptReference: string | null = null;
    const isNewAttemptReference = /^SW-[A-F0-9]{32}$/.test(confirmedReference);
    const attemptUrl = new URL(`${supabaseUrl}/rest/v1/storefront_wompi_payment_attempts`);
    if (isNewAttemptReference) {
      attemptUrl.searchParams.set("attempt_reference", `eq.${confirmedReference}`);
    } else {
      attemptUrl.searchParams.set("wompi_reference", `eq.${confirmedReference}`);
      attemptUrl.searchParams.set("transaction_id", `eq.${confirmedId}`);
      attemptUrl.searchParams.set("is_legacy", "eq.true");
    }
    attemptUrl.searchParams.set("select", "attempt_reference,wompi_reference,is_legacy,order_reference,amount_in_cents,currency,environment,transaction_id");
    attemptUrl.searchParams.set("limit", "2");
    const attemptLookup = await fetch(attemptUrl.toString(), { headers: supabaseHeaders(serviceRoleKey) });
    if (!attemptLookup.ok) return json({ error: "No se pudo verificar el historial del intento Wompi." }, 503);
    const attemptRows = await responseJson(attemptLookup);
    if (!Array.isArray(attemptRows) || attemptRows.length > 1) {
      return json({ error: "El historial no identifica un intento Wompi único." }, 409);
    }
    let attemptRow = attemptRows[0] ?? null;
    if (!attemptRow && isNewAttemptReference) {
      return json({ error: "No existe un intento registrado para la referencia Wompi." }, 409);
    }
    if (!attemptRow && !isNewAttemptReference) {
      // Once a stable order has ledger history, an unknown legacy transaction
      // must never fall through to the old order-reference mutation path.
      const knownUrl = new URL(`${supabaseUrl}/rest/v1/storefront_wompi_payment_attempts`);
      knownUrl.searchParams.set("order_reference", `eq.${confirmedReference}`);
      knownUrl.searchParams.set("select", "attempt_reference");
      knownUrl.searchParams.set("limit", "1");
      const knownResponse = await fetch(knownUrl.toString(), { headers: supabaseHeaders(serviceRoleKey) });
      if (!knownResponse.ok) return json({ error: "No se pudo descartar un intento legacy ambiguo." }, 503);
      const knownRows = await responseJson(knownResponse);
      if (Array.isArray(knownRows) && knownRows.length > 0) {
        return json({ error: "La referencia ya tiene historial y la transacción no coincide con un intento registrado." }, 409);
      }
    }
    if (attemptRow) {
      orderReference = String(attemptRow.order_reference ?? "");
      attemptReference = String(attemptRow.attempt_reference ?? "");
      const isLegacyAttempt = attemptRow.is_legacy === true;
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(orderReference) || !/^SW-[A-F0-9]{32}$/.test(attemptReference) ||
          String(attemptRow.wompi_reference ?? "") !== confirmedReference || isLegacyAttempt === isNewAttemptReference ||
          Number(attemptRow.amount_in_cents) !== confirmedAmount || String(attemptRow.currency ?? "").toUpperCase() !== "COP" ||
          String(attemptRow.environment ?? "").toLowerCase() !== expectedEnvironment ||
          (attemptRow.transaction_id && String(attemptRow.transaction_id) !== confirmedId)) {
        return json({ error: "El intento Wompi no coincide con su orden, monto, moneda, ambiente o transacción." }, 409);
      }

      const transitionResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/transition_storefront_wompi_payment_attempt`, {
        method: "POST",
        headers: supabaseHeaders(serviceRoleKey),
        body: JSON.stringify({ p_attempt_reference: attemptReference, p_transaction_id: confirmedId,
          p_status: status, p_amount_in_cents: confirmedAmount, p_currency: confirmedCurrency,
          p_environment: expectedEnvironment }),
      });
      const transition = rpcObject(await responseJson(transitionResponse));
      if (!transitionResponse.ok || transition?.success !== true || String(transition.order_reference ?? "") !== orderReference) {
        console.error("No se pudo registrar de forma segura la transición del intento Wompi.", { httpStatus: transitionResponse.status, code: transition?.code });
        return json({ error: "No se pudo registrar el estado verificado del intento Wompi; el evento se reintentará." }, 502);
      }
      if (transition.late_approval === true || String(transition.status ?? "") === "APPROVED_LATE") {
        const reason = "Wompi aprobó un intento anterior después de iniciarse uno posterior; requiere conciliación y no debe consumir reservas actuales.";
        const reconciliationStored = await recordInventoryReconciliation({
          supabaseUrl, serviceRoleKey, transactionId: confirmedId, reference: orderReference,
          amountInCents: confirmedAmount, reason,
          details: { late_attempt_approval: true, attempt_reference: attemptReference, legacy_attempt: isLegacyAttempt },
          orderAlreadyMarked: true,
        });
        return json({ received: reconciliationStored, reference: orderReference, attemptReference,
          status: "APPROVED_LATE", reconciliationRequired: true, reconciliationStored,
          reason: "La aprobación quedó aislada para conciliación; no se modificó inventario ni cupón." }, reconciliationStored ? 200 : 502);
      }
      if (transition.is_current !== true) {
        return json({ received: true, reference: orderReference, attemptReference,
          status: String(transition.status ?? status), ignored: true,
          reason: "El intento ya no es el vigente; no se modificaron pedido, inventario ni cupón." }, 200);
      }
      status = String(transition.status ?? status);
      if (!supportedStatuses.has(status)) return json({ error: "El ledger devolvió un estado de intento no procesable." }, 409);
    }

    const orderUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
    orderUrl.searchParams.set("reference", `eq.${orderReference}`);
    orderUrl.searchParams.set("select", "reference,total,items,payment_method,payment_status,transaction_id,phone,coupon_id,coupon_code,coupon_discount_total,coupon_reconciliation_required,wompi_reconciliation_required");
    orderUrl.searchParams.set("limit", "2");
    const orderResponse = await fetch(orderUrl.toString(), { headers: supabaseHeaders(serviceRoleKey) });
    if (!orderResponse.ok) {
      let reconciliationStored = false;
      if (status === "APPROVED") reconciliationStored = await recordInventoryReconciliation({
        supabaseUrl, serviceRoleKey, transactionId: confirmedId, reference: orderReference,
        amountInCents: confirmedAmount,
        reason: "Wompi confirmó el pago, pero no se pudo consultar el pedido para finalizar el inventario.",
        details: { order_lookup_http_status: orderResponse.status },
      });
      return json({ error: "No se pudo consultar el pedido de la transacción.", reconciliationRequired: status === "APPROVED", reconciliationStored }, 502);
    }
    const orders = await responseJson(orderResponse);
    if (!Array.isArray(orders) || orders.length !== 1) {
      const reason = "No existe un único pedido para la referencia recibida desde Wompi.";
      console.error(reason, { reference: orderReference, matches: Array.isArray(orders) ? orders.length : -1 });
      let reconciliationStored = false;
      if (status === "APPROVED") reconciliationStored = await recordInventoryReconciliation({
        supabaseUrl, serviceRoleKey, transactionId: confirmedId, reference: orderReference,
        amountInCents: confirmedAmount, reason,
        details: { order_match_count: Array.isArray(orders) ? orders.length : null },
      });
      return json({ error: reason, reconciliationRequired: status === "APPROVED", reconciliationStored }, status === "APPROVED" ? 500 : 409);
    }

    const order = orders[0];
    if (String(order.payment_method ?? "").toLowerCase() !== "wompi") {
      const reason = "La referencia de la transacción aprobada no pertenece a un pedido Wompi.";
      let reconciliationStored = false;
      if (status === "APPROVED") reconciliationStored = await recordInventoryReconciliation({
        supabaseUrl, serviceRoleKey, transactionId: confirmedId, reference: orderReference,
        amountInCents: confirmedAmount, reason, details: { order_payment_method_mismatch: true },
      });
      return json({ error: reason, reconciliationRequired: status === "APPROVED", reconciliationStored }, status === "APPROVED" ? 500 : 409);
    }
    const expectedCop = copAmount(order.total);
    const expectedCents = expectedCop === null ? Number.NaN : expectedCop * 100;
    const verifiedTerminalNoPayment = ["DECLINED", "VOIDED", "ERROR"].includes(status);
    if ((!Number.isSafeInteger(expectedCents) || expectedCents <= 0 || expectedCents !== confirmedAmount) && !verifiedTerminalNoPayment) {
      const reason = "El monto de Wompi no coincide con el total del pedido almacenado.";
      console.error(reason, { reference: orderReference, expectedCents, receivedCents: confirmedAmount });
      let reconciliationStored = false;
      let transactionLinked = Boolean(String(order.transaction_id ?? "").trim() === confirmedId);
      let linkConflict = false;
      let checkoutLockMarkedPending = false;
      let checkoutLockLateApprovalConflict = false;
      // It is still important to bind this verified approved transaction to a Wompi
      // order, without approving it, so the customer cannot accidentally pay again
      // while the amount discrepancy is reviewed.
      if (!verifiedTerminalNoPayment && String(order.payment_method ?? "").toLowerCase() === "wompi" && !String(order.transaction_id ?? "").trim()) {
        const link = await ensureOrderTransactionLinked({
          supabaseUrl, serviceRoleKey, reference: orderReference, transactionId: confirmedId,
        });
        transactionLinked = link.linked;
        linkConflict = link.conflict;
      }
      if (!verifiedTerminalNoPayment && transactionLinked) {
        const pendingLock = await setCheckoutLockState({
          supabaseUrl, serviceRoleKey, reference: orderReference, state: "pending", transactionId: confirmedId,
        });
        checkoutLockMarkedPending = pendingLock.success;
        checkoutLockLateApprovalConflict = pendingLock.lateApprovalConflict;
      }
      if (!verifiedTerminalNoPayment) reconciliationStored = await recordInventoryReconciliation({
        supabaseUrl, serviceRoleKey, transactionId: confirmedId, reference: orderReference,
        amountInCents: confirmedAmount, reason,
        details: {
          expected_amount_in_cents: Number.isSafeInteger(expectedCents) ? expectedCents : null,
          transaction_linked: transactionLinked,
          link_conflict: linkConflict,
          checkout_lock_pending: checkoutLockMarkedPending,
          checkout_lock_late_approval_conflict: checkoutLockLateApprovalConflict,
        },
      });
      return json({ error: reason, transactionLinked, checkoutLockMarkedPending, reconciliationRequired: !verifiedTerminalNoPayment, reconciliationStored }, status === "APPROVED" ? 500 : 409);
    }

    let storedTransactionId = String(order.transaction_id ?? "").trim();
    const storedStatus = String(order.payment_status ?? "").toUpperCase();
    if (storedStatus === "APPROVED" && status !== "APPROVED") {
      // Never downgrade a payment already confirmed by a previous verified event.
      return json({ received: true, reference: orderReference, status: storedStatus, ignored: true, reason: "No se reduce un pago ya aprobado." });
    }
    if (["DECLINED", "VOIDED", "ERROR"].includes(storedStatus) && status !== "APPROVED") {
      return json({ received: true, reference: orderReference, status: storedStatus, ignored: true, reason: "No se reabre ni cambia un estado terminal no aprobado." });
    }

    // Coupon metadata is read from the server-owned order, never from the
    // webhook payload. A malformed coupon row cannot be approved silently, but
    // terminal states can still release the ledger by reference alone.
    const rawCouponCode = String(order.coupon_code ?? "").trim();
    const couponCode = rawCouponCode.toUpperCase();
    const couponId = String(order.coupon_id ?? "").trim();
    const rawCouponDiscount = order.coupon_discount_total;
    const couponDiscountTotal = copAmount(rawCouponDiscount ?? 0);
    const couponDiscountPresent = rawCouponDiscount !== null && rawCouponDiscount !== undefined &&
      String(rawCouponDiscount).trim() !== "" && Number(rawCouponDiscount) !== 0;
    const hasCoupon = rawCouponCode.length > 0 || couponId.length > 0 || couponDiscountPresent;
    let inventoryProcessed = false;
    let couponReconciliationRequired = false;
    const couponMetadataValid = !hasCoupon || (
      COUPON_CODE_PATTERN.test(couponCode) &&
      COUPON_UUID_PATTERN.test(couponId) &&
      couponDiscountTotal !== null && Number.isSafeInteger(couponDiscountTotal) && couponDiscountTotal > 0
    );

    if (storedTransactionId && storedTransactionId !== confirmedId) {
      const reason = "La referencia del pedido ya está vinculada a otro identificador de transacción.";
      if (status === "APPROVED") {
        const reconciliationStored = await recordInventoryReconciliation({
          supabaseUrl, serviceRoleKey, transactionId: confirmedId,
          reference: orderReference, amountInCents: confirmedAmount, reason,
          details: { conflicting_transaction_id: true, linked_transaction_id_present: true },
        });
        console.error("Wompi confirmó una transacción distinta para una referencia ya vinculada; se requiere conciliación.", { reference: orderReference, reconciliationStored });
        return json({ error: reason, reference: orderReference, transactionId: confirmedId, reconciliationRequired: true, reconciliationStored }, 500);
      }
      console.error("La referencia ya tiene otro identificador de transacción.", { reference: orderReference });
      return json({ error: "La referencia ya está vinculada a otra transacción." }, 409);
    }

    const wompiReconciliationAlreadyRequired = order.wompi_reconciliation_required === true;
    const couponReconciliationAlreadyRequired = order.coupon_reconciliation_required === true;
    if (status === "APPROVED" && !storedTransactionId) {
      const link = await ensureOrderTransactionLinked({
        supabaseUrl, serviceRoleKey, reference: orderReference, transactionId: confirmedId,
      });
      if (!link.linked) {
        const reason = link.conflict
          ? "El pedido quedó vinculado concurrentemente a otra transacción."
          : "No se pudo guardar el identificador de la transacción verificada en el pedido.";
        const reconciliationStored = await recordInventoryReconciliation({
          supabaseUrl, serviceRoleKey, transactionId: confirmedId,
          reference: orderReference, amountInCents: confirmedAmount, reason,
          details: { transaction_linked: false, link_conflict: link.conflict, link_http_status: link.httpStatus },
        });
        return json({ error: reason, reference: orderReference, transactionId: confirmedId,
          reconciliationRequired: true, reconciliationStored }, 500);
      }
      storedTransactionId = confirmedId;
      order.transaction_id = confirmedId;
    }
    // A verified link can clear only the Wompi-linking part of the recovery.
    // Coupon reconciliation remains an independent hard stop, even when the
    // approved transaction ID now matches the order.
    if (couponReconciliationAlreadyRequired) {
      const pendingLock = await setCheckoutLockState({
        supabaseUrl, serviceRoleKey, reference: orderReference,
        state: "pending", transactionId: confirmedId,
      });
      if (!pendingLock.success) {
        return json({ error: "El pedido conserva una conciliación de cupón pendiente y no se pudo asegurar el lock preventivo." }, 502);
      }
      return json({ received: true, reference: orderReference, transactionId: confirmedId,
        status: storedStatus, ignored: true, reconciliationRequired: true,
        couponReconciliationRequired: true,
        wompiReconciliationRequired: wompiReconciliationAlreadyRequired,
        reason: "La conciliación del cupón sigue pendiente; no se repite la operación de inventario." }, 200);
    }
    if (wompiReconciliationAlreadyRequired && !(status === "APPROVED" && storedTransactionId === confirmedId)) {
      const pendingLock = await setCheckoutLockState({
        supabaseUrl, serviceRoleKey, reference: orderReference,
        state: "pending", transactionId: confirmedId,
      });
      if (!pendingLock.success) {
        return json({ error: "El pago requiere conciliación manual y no se pudo conservar el lock preventivo." }, 502);
      }
      return json({ received: true, reference: orderReference, transactionId: confirmedId,
        status: storedStatus, ignored: true, reconciliationRequired: true,
        couponReconciliationRequired: false,
        wompiReconciliationRequired: true,
        reason: "El pedido ya está marcado para conciliación manual; no se repite la operación de inventario." }, 200);
    }

    if (storedStatus === "APPROVED" && status === "APPROVED") {
      if (storedTransactionId === confirmedId) {
        const couponReconciliationStored = order.coupon_reconciliation_required === true;
        const wompiReconciliationStored = order.wompi_reconciliation_required === true;
        const completedLock = await setCheckoutLockState({
          supabaseUrl, serviceRoleKey, reference: orderReference,
          state: couponReconciliationStored || wompiReconciliationStored ? "pending" : "completed", transactionId: confirmedId,
        });
        if (!completedLock.success) {
          return json({ error: "El pedido ya está aprobado, pero no se pudo finalizar el lock. El evento se reintentará." }, 502);
        }
        if (completedLock.lateApprovalConflict) {
          const reason = "La aprobación duplicada encontró una referencia de checkout concurrente y requiere conciliación.";
          const reconciliationStored = await recordInventoryReconciliation({
            supabaseUrl, serviceRoleKey, transactionId: confirmedId,
            reference: orderReference, amountInCents: confirmedAmount, reason,
            details: { duplicate_approved_event: true, late_approval_lock_conflict: true },
          });
          return json({ error: reason, reference: orderReference, transactionId: confirmedId,
            reconciliationRequired: true, reconciliationStored }, 500);
        }
        return json({ received: true, reference: orderReference, transactionId: confirmedId,
          status: "APPROVED", idempotent: true, lockFinalized: !couponReconciliationStored,
          reconciliationRequired: couponReconciliationStored || wompiReconciliationStored,
          couponReconciliationRequired: couponReconciliationStored,
          wompiReconciliationRequired: wompiReconciliationStored,
          reason: couponReconciliationStored || wompiReconciliationStored
            ? "Esta aprobación ya se procesó, pero el pedido sigue en conciliación y el lock permanece pendiente."
            : "Esta aprobación ya se procesó para la misma transacción." });
      }
      const reason = "El pedido ya aparece aprobado, pero no conserva el identificador verificado de esta transacción.";
      const reconciliationStored = await recordInventoryReconciliation({
        supabaseUrl, serviceRoleKey, transactionId: confirmedId,
        reference: orderReference, amountInCents: confirmedAmount, reason,
        details: { approved_order_transaction_id_missing: true },
      });
      return json({ error: reason, reference: orderReference, transactionId: confirmedId,
        reconciliationRequired: true, reconciliationStored }, 409);
    }

    // Persist the verified transaction id before inventory operations, but do NOT
    // set payment_status=APPROVED yet. Checkout rejects another payment when it sees
    // a linked PENDING transaction, avoiding a second charge while stock is reviewed.
    if (!storedTransactionId) {
      const link = await ensureOrderTransactionLinked({
        supabaseUrl, serviceRoleKey, reference: orderReference, transactionId: confirmedId,
      });
      if (!link.linked) {
        const reason = link.conflict
          ? "El pedido quedó vinculado concurrentemente a otra transacción."
          : "No se pudo guardar el identificador de la transacción verificada en el pedido.";
        let reconciliationStored = false;
        if (status === "APPROVED") {
          reconciliationStored = await recordInventoryReconciliation({
            supabaseUrl, serviceRoleKey, transactionId: confirmedId,
            reference: orderReference, amountInCents: confirmedAmount, reason,
            details: { transaction_linked: false, link_conflict: link.conflict, link_http_status: link.httpStatus },
          });
        }
        return json({ error: reason, reference: orderReference, transactionId: confirmedId,
          reconciliationRequired: status === "APPROVED", reconciliationStored }, 500);
      }
    }

    const checkoutLockPending = await setCheckoutLockState({
      supabaseUrl,
      serviceRoleKey,
      reference: orderReference,
      state: ["DECLINED", "VOIDED", "ERROR"].includes(status) ? "terminal_grace" : "pending",
      transactionId: confirmedId,
    });
    if (!checkoutLockPending.success) {
      console.error("No se pudo extender el lock de checkout para la transacción verificada.", { reference: orderReference });
      return json({ error: "La transacción quedó vinculada, pero no se pudo asegurar el lock del checkout. El evento se reintentará." }, 502);
    }

    if (!couponMetadataValid) {
      const reason = "El pedido contiene metadata de cupón parcial o inválida y requiere conciliación.";
      const reconciliationStored = await recordInventoryReconciliation({
        supabaseUrl,
        serviceRoleKey,
        transactionId: confirmedId,
        reference: orderReference,
        amountInCents: confirmedAmount,
        reason,
        details: { coupon_metadata_valid: false },
      });
      console.error("La metadata de cupón del pedido no pudo validarse; se requiere conciliación.", { reference: orderReference, reconciliationStored });
      return json({ error: reason, reference: orderReference, transactionId: confirmedId, reconciliationRequired: true, reconciliationStored }, status === "APPROVED" ? 500 : 409);
    }

    let otherPendingReference: string | null = null;
    if (status === "APPROVED") {
      const pendingOrders = await listPendingWompiOrdersForPhone({
        supabaseUrl,
        serviceRoleKey,
        phone: String(order.phone ?? ""),
      });
      if (!pendingOrders.success) {
        const reason = "No se pudo comprobar si había otra sesión Wompi pendiente del comprador; el pago requiere conciliación antes de despacho.";
        const reconciliationStored = await recordInventoryReconciliation({
          supabaseUrl, serviceRoleKey, transactionId: confirmedId,
          reference: orderReference, amountInCents: confirmedAmount, reason,
          details: { pending_phone_lookup_failed: true },
        });
        return json({ error: reason, reference: orderReference, transactionId: confirmedId,
          reconciliationRequired: true, reconciliationStored }, 502);
      }
      const unlinkedGraceCutoff = Date.now() - 15 * 60 * 1000;
      otherPendingReference = pendingOrders.orders.find((pending) =>
        pending.reference !== orderReference &&
        (Boolean(pending.transactionId) || Date.parse(pending.createdAt) >= unlinkedGraceCutoff)
      )?.reference ?? null;
    }

    if (status === "APPROVED" && (checkoutLockPending.lateApprovalConflict || otherPendingReference)) {
      const reason = checkoutLockPending.lateApprovalConflict
        ? "Wompi aprobó una transacción tardía mientras el mismo teléfono ya tenía otro checkout activo; requiere conciliación antes de despacho."
        : "Wompi aprobó una transacción mientras el mismo teléfono tenía otra orden pendiente; requiere conciliación antes de despacho.";
      if (hasCoupon) {
        const couponConfirmation = await confirmCouponRedemption({
          supabaseUrl,
          serviceRoleKey,
          reference: orderReference,
        });
        if (!couponConfirmation.success) {
          const reconciliationStored = await recordInventoryReconciliation({
            supabaseUrl, serviceRoleKey, transactionId: confirmedId,
            reference: orderReference, amountInCents: confirmedAmount,
            reason: `${reason} El ledger de cupón también requiere revisión.`,
            details: {
              late_approval_lock_conflict: checkoutLockPending.lateApprovalConflict,
              other_pending_reference: otherPendingReference ?? checkoutLockPending.otherReference,
              coupon_confirmation_failed: true,
            },
          });
          return json({ error: reason, reference: orderReference, transactionId: confirmedId,
            reconciliationRequired: true, reconciliationStored }, 500);
        }
      }
      const reconciliationStored = await recordInventoryReconciliation({
        supabaseUrl, serviceRoleKey, transactionId: confirmedId,
        reference: orderReference, amountInCents: confirmedAmount, reason,
        details: {
          late_approval_lock_conflict: checkoutLockPending.lateApprovalConflict,
          other_pending_reference: otherPendingReference ?? checkoutLockPending.otherReference,
        },
      });
      if (!reconciliationStored) {
        return json({ error: reason, reference: orderReference, transactionId: confirmedId,
          reconciliationRequired: true, reconciliationStored: false }, 502);
      }
      console.error("Aprobación Wompi tardía guardada para conciliación por otro checkout activo.", {
        reference: orderReference,
        otherReference: otherPendingReference ?? checkoutLockPending.otherReference,
        reconciliationStored,
      });
      return json({ received: true, reference: orderReference, transactionId: confirmedId,
        status, reconciliationRequired: true, reconciliationStored, lateApprovalConflict: true }, 200);
    }

    // Wompi has independently verified the APPROVED status and the transaction
    // is bound to this order. Honor the coupon now, even if inventory recovery
    // below must remain in manual reconciliation.
    if (status === "APPROVED" && hasCoupon) {
      const couponConfirmation = await confirmCouponRedemption({
        supabaseUrl,
        serviceRoleKey,
        reference: orderReference,
      });
      if (!couponConfirmation.success) {
        const reason = "Wompi confirmó el pago, pero no se pudo confirmar el ledger del cupón.";
        const reconciliationStored = await recordInventoryReconciliation({
          supabaseUrl, serviceRoleKey, transactionId: confirmedId, reference: orderReference,
          amountInCents: confirmedAmount, reason,
          details: { coupon_redemption_confirmed: false },
        });
        console.error(reason, { reference: orderReference, reconciliationStored });
        return json({ error: "Wompi confirmó el pago, pero la redención del cupón necesita conciliación. El pedido no se marca aprobado hasta reintentar.",
          reference: orderReference, transactionId: confirmedId, reconciliationRequired: true, reconciliationStored }, 500);
      }
      couponReconciliationRequired = couponConfirmation.reconciliationRequired;
    }

    // Finalize/release inventory first, then persist the terminal payment status.
    // The transaction id is already linked, while payment_status remains unchanged
    // until its corresponding inventory operation succeeds.
    if (status === "APPROVED") {
      let inventoryResponse: Response | null = null;
      let inventoryResult: any = null;
      try {
        inventoryResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/confirm_inventory_reservation`, {
          method: "POST",
          headers: supabaseHeaders(serviceRoleKey),
          body: JSON.stringify({ p_reference: orderReference }),
        });
        inventoryResult = await responseJson(inventoryResponse);
      } catch (error) {
        inventoryResult = { success: false, message: `No se pudo contactar la función de confirmación de inventario: ${error instanceof Error ? error.message : "error desconocido"}` };
      }
      if (!inventoryResponse?.ok || !inventoryResult || inventoryResult.success !== true) {
        const reason = String(inventoryResult?.message ?? `La RPC de inventario respondió HTTP ${inventoryResponse?.status ?? "sin respuesta"}.`);
        const reconciliationStored = await recordInventoryReconciliation({
          supabaseUrl,
          serviceRoleKey,
          transactionId: confirmedId,
          reference: orderReference,
          amountInCents: confirmedAmount,
          reason,
          details: {
            inventory_http_status: inventoryResponse?.status ?? null,
            order_items_available: Array.isArray(order.items),
            coupon_reconciliation_required: couponReconciliationRequired,
          },
        });
        console.error("Wompi confirmó el cobro, pero el inventario no pudo finalizarse; el pedido no se marca aprobado y queda registrado para conciliación.", { reference: orderReference, httpStatus: inventoryResponse?.status ?? null, reconciliationStored });
        return json({
          error: "Wompi confirmó el pago, pero el inventario necesita revisión. El pedido permanece sin aprobar para despacho y su transacción queda vinculada para evitar otro cobro.",
          reference: orderReference,
          transactionId: confirmedId,
          reconciliationRequired: true,
          reconciliationStored,
        }, 500);
      }
      inventoryProcessed = true;
    } else if (["DECLINED", "VOIDED", "ERROR"].includes(status)) {
      const releaseResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/release_inventory_reservation`, {
        method: "POST",
        headers: supabaseHeaders(serviceRoleKey),
        body: JSON.stringify({ p_reference: orderReference }),
      });
      if (!releaseResponse.ok) {
        console.error("No se pudo liberar la reserva de un pago no aprobado; el pedido conservará su estado previo.", { reference: orderReference, status, httpStatus: releaseResponse.status });
        return json({ error: "No se pudo liberar la reserva de inventario; el pedido conservará su estado previo para permitir el reintento del evento." }, 500);
      }
      if (hasCoupon) {
        const couponRelease = await releaseCouponRedemption({
          supabaseUrl, serviceRoleKey, reference: orderReference, attemptReference,
        });
        if (!couponRelease.success && couponRelease.code === "COUPON_REDEMPTION_NOT_FOUND") {
          console.warn("Evento terminal legacy sin ledger de cupón; no hay una reserva de uso que liberar.", { reference: orderReference });
        } else if (!couponRelease.success) {
          console.error("No se pudo liberar el cupón de un pago no aprobado; el pedido conservará su estado previo.", { reference: orderReference, status, httpStatus: couponRelease.httpStatus });
          return json({ error: "No se pudo liberar la reserva del cupón; el pedido conservará su estado previo para permitir el reintento del evento." }, 500);
        }
      }
      inventoryProcessed = true;
    }

    // Solo se escribe el estado después de completar la acción de inventario que le corresponde.
    const updateUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
    updateUrl.searchParams.set("reference", `eq.${orderReference}`);
    updateUrl.searchParams.set("payment_method", "ilike.wompi");
    updateUrl.searchParams.set("transaction_id", `eq.${confirmedId}`);
    if (status !== "APPROVED") updateUrl.searchParams.set("payment_status", "ilike.PENDING");
    let updateResponse: Response | null = null;
    let updatedRows: any = null;
    try {
      updateResponse = await fetch(updateUrl.toString(), {
        method: "PATCH",
        headers: { ...supabaseHeaders(serviceRoleKey), Prefer: "return=representation" },
        body: JSON.stringify({
          payment_status: status,
          transaction_id: confirmedId,
          coupon_reconciliation_required: status === "APPROVED"
            ? couponReconciliationRequired
            : order.coupon_reconciliation_required === true,
          updated_at: new Date().toISOString(),
        }),
      });
      updatedRows = await responseJson(updateResponse);
    } catch (error) {
      console.error("No se pudo completar la escritura del estado del pedido.", { reference: orderReference, error: error instanceof Error ? error.message : "unknown" });
    }
    if (!updateResponse?.ok || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
      const reason = "Se procesó la acción de inventario, pero no se pudo guardar el estado final del pedido.";
      console.error(reason, { reference: orderReference, status, httpStatus: updateResponse?.status ?? null, inventoryProcessed });
      let reconciliationStored = false;
      if (status === "APPROVED") {
        reconciliationStored = await recordInventoryReconciliation({
          supabaseUrl, serviceRoleKey, transactionId: confirmedId,
          reference: orderReference, amountInCents: confirmedAmount,
          reason,
          details: { inventory_processed: inventoryProcessed, order_status_write_failed: true, order_patch_http_status: updateResponse?.status ?? null, coupon_reconciliation_required: couponReconciliationRequired },
        });
      }
      return json({ error: `${reason} El identificador de transacción ya está vinculado; el evento debe reintentarse/conciliarse.`,
        reference: orderReference, transactionId: confirmedId,
        reconciliationRequired: status === "APPROVED" || couponReconciliationRequired, couponReconciliationRequired, reconciliationStored }, 502);
    }

    const finalLockState: "pending" | "terminal_grace" | "completed" | "released" =
      status === "APPROVED"
        ? (inventoryProcessed && !couponReconciliationRequired ? "completed" : "pending")
        : status === "PENDING" ? "pending" : "terminal_grace";
    const checkoutLockFinalized = await setCheckoutLockState({
      supabaseUrl, serviceRoleKey, reference: orderReference,
      state: finalLockState, transactionId: confirmedId,
    });
    if (!checkoutLockFinalized.success) {
      console.error("No se pudo actualizar el estado final del lock Wompi.", { reference: orderReference, finalLockState });
      return json({ error: "El estado del pedido se guardó, pero su lock necesita reconciliación. El evento se reintentará." }, 502);
    }
    if (status === "APPROVED" && inventoryProcessed && !couponReconciliationRequired) {
      await markInventoryReconciliationResolved({ supabaseUrl, serviceRoleKey, transactionId: confirmedId });
    }
    console.log("Evento Wompi procesado.", { reference: orderReference, transactionId: confirmedId, status, inventoryProcessed, couponReconciliationRequired, environment: expectedEnvironment });
    return json({ received: true, reference: orderReference, transactionId: confirmedId, status, inventoryProcessed, reconciliationRequired: couponReconciliationRequired, couponReconciliationRequired });
  } catch (error) {
    console.error("Error procesando evento Wompi:", error instanceof Error ? error.message : "error desconocido");
    return json({ error: "No se pudo procesar el evento." }, 500);
  }
});
