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

// Link a verified Wompi transaction to its existing order BEFORE performing the
// inventory operation. This does not change payment_status; it prevents checkout
// retries from starting another payment while an APPROVED event awaits reconciliation.
async function ensureOrderTransactionLinked(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  reference: string;
  transactionId: string;
}): Promise<{ linked: boolean; conflict: boolean; httpStatus: number | null }> {
  const patchUrl = new URL(`${args.supabaseUrl}/rest/v1/orders`);
  patchUrl.searchParams.set("reference", `eq.${args.reference}`);
  patchUrl.searchParams.set("payment_method", "eq.wompi");
  // Historical rows may store an empty string instead of SQL NULL. Treat both as
  // unlinked so a verified transaction can be bound and duplicate checkout blocked.
  patchUrl.searchParams.set("or", "(transaction_id.is.null,transaction_id.eq.)");

  let lastStatus: number | null = null;
  try {
    const patchResponse = await fetch(patchUrl.toString(), {
      method: "PATCH",
      headers: { ...supabaseHeaders(args.serviceRoleKey), Prefer: "return=representation" },
      body: JSON.stringify({ transaction_id: args.transactionId, updated_at: new Date().toISOString() }),
    });
    lastStatus = patchResponse.status;
    const patchedRows = await responseJson(patchResponse);
    if (patchResponse.ok && Array.isArray(patchedRows) && patchedRows.length === 1 &&
        String(patchedRows[0]?.transaction_id ?? "").trim() === args.transactionId) {
      return { linked: true, conflict: false, httpStatus: lastStatus };
    }
  } catch (error) {
    console.error("No se pudo vincular inmediatamente la transacción verificada al pedido.", {
      reference: args.reference,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  // A timeout can happen after PostgreSQL committed the PATCH. Read back the row
  // before deciding whether linking failed or another transaction won the race.
  try {
    const verifyUrl = new URL(`${args.supabaseUrl}/rest/v1/orders`);
    verifyUrl.searchParams.set("reference", `eq.${args.reference}`);
    verifyUrl.searchParams.set("payment_method", "eq.wompi");
    verifyUrl.searchParams.set("select", "reference,transaction_id,payment_status");
    verifyUrl.searchParams.set("limit", "2");
    const verifyResponse = await fetch(verifyUrl.toString(), { headers: supabaseHeaders(args.serviceRoleKey) });
    lastStatus = verifyResponse.status;
    const rows = await responseJson(verifyResponse);
    if (verifyResponse.ok && Array.isArray(rows) && rows.length === 1) {
      const existingId = String(rows[0]?.transaction_id ?? "").trim();
      if (existingId === args.transactionId) return { linked: true, conflict: false, httpStatus: lastStatus };
      if (existingId) return { linked: false, conflict: true, httpStatus: lastStatus };
    }
  } catch (error) {
    console.error("No se pudo verificar el vínculo de la transacción con el pedido.", {
      reference: args.reference,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  return { linked: false, conflict: false, httpStatus: lastStatus };
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
}): Promise<boolean> {
  try {
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
    return true;
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

function reservationItemsFromOrder(items: unknown): Array<{ id: string; qty: number; color: string; size: string }> | null {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) return null;
  const normalized: Array<{ id: string; qty: number; color: string; size: string }> = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const id = String(item.id ?? item.product_id ?? "").trim();
    const qty = Number(item.qty ?? item.quantity ?? 0);
    const color = String(item.color ?? "").trim();
    const size = String(item.size ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !Number.isSafeInteger(qty) || qty < 1 || qty > 1000 || color.length > 100 || size.length > 100) return null;
    normalized.push({ id, qty, color, size });
  }
  return normalized;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  try {
    let event: any;
    try { event = await req.json(); } catch { return json({ error: "El cuerpo del evento no es JSON válido." }, 400); }

    // The environment is set on the server and must match the Wompi event. The event's
    // environment field is not part of the documented checksum, so never use it alone
    // to select production/test secrets.
    const expectedEnvironment = (Deno.env.get("WOMPI_ENVIRONMENT") ?? "prod").trim().toLowerCase();
    if (expectedEnvironment !== "prod" && expectedEnvironment !== "test") {
      console.error("WOMPI_ENVIRONMENT must be prod or test.");
      return json({ error: "El ambiente de Wompi no está configurado correctamente." }, 500);
    }
    const eventEnvironment = String(event?.environment ?? "").trim().toLowerCase();
    if (eventEnvironment !== expectedEnvironment) {
      console.error("Evento Wompi recibido en un endpoint de otro ambiente.", { expectedEnvironment, eventEnvironment });
      return json({ error: "El evento pertenece a un ambiente distinto a este webhook." }, 400);
    }

    const eventSecret = Deno.env.get(expectedEnvironment === "test" ? "WOMPI_EVENT_SECRET_TEST" : "WOMPI_EVENT_SECRET");
    const privateKey = Deno.env.get(expectedEnvironment === "test" ? "WOMPI_PRIVATE_KEY_TEST" : "WOMPI_PRIVATE_KEY");
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
    if (!transactionId || transactionId.length > 255 || !eventReference || eventReference.length > 255 || eventCurrency !== "COP" || !Number.isSafeInteger(eventAmount) || eventAmount <= 0) {
      return json({ error: "La transacción no contiene identificador, referencia, monto o moneda válidos." }, 400);
    }

    // The checksum properties supplied by Wompi can vary and may not include reference
    // or currency. Verify the transaction independently with Wompi's authenticated API
    // before trusting these fields or updating the order.
    const wompiBaseUrl = expectedEnvironment === "test" ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1";
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
    const status = String(confirmed?.status ?? "").toUpperCase();

    if (confirmedId !== transactionId || confirmedReference !== eventReference || confirmedCurrency !== "COP" || confirmedCurrency !== eventCurrency || !Number.isSafeInteger(confirmedAmount) || confirmedAmount <= 0 || confirmedAmount !== eventAmount) {
      console.error("Los datos del evento no coinciden con la consulta autenticada de Wompi.", { transactionId });
      return json({ error: "Los datos de la transacción no coinciden con Wompi." }, 409);
    }
    const supportedStatuses = new Set(["PENDING", "APPROVED", "DECLINED", "VOIDED", "ERROR"]);
    if (!supportedStatuses.has(status)) {
      return json({ received: true, ignored: true, reason: "Estado actual de transacción no soportado." });
    }

    const orderUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
    orderUrl.searchParams.set("reference", `eq.${confirmedReference}`);
    orderUrl.searchParams.set("select", "reference,total,items,payment_method,payment_status,transaction_id");
    orderUrl.searchParams.set("limit", "2");
    const orderResponse = await fetch(orderUrl.toString(), { headers: supabaseHeaders(serviceRoleKey) });
    if (!orderResponse.ok) {
      let reconciliationStored = false;
      if (status === "APPROVED") reconciliationStored = await recordInventoryReconciliation({
        supabaseUrl, serviceRoleKey, transactionId: confirmedId, reference: confirmedReference,
        amountInCents: confirmedAmount,
        reason: "Wompi confirmó el pago, pero no se pudo consultar el pedido para finalizar el inventario.",
        details: { order_lookup_http_status: orderResponse.status },
      });
      return json({ error: "No se pudo consultar el pedido de la transacción.", reconciliationRequired: status === "APPROVED", reconciliationStored }, 502);
    }
    const orders = await responseJson(orderResponse);
    if (!Array.isArray(orders) || orders.length !== 1) {
      const reason = "No existe un único pedido para la referencia recibida desde Wompi.";
      console.error(reason, { reference: confirmedReference, matches: Array.isArray(orders) ? orders.length : -1 });
      let reconciliationStored = false;
      if (status === "APPROVED") reconciliationStored = await recordInventoryReconciliation({
        supabaseUrl, serviceRoleKey, transactionId: confirmedId, reference: confirmedReference,
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
        supabaseUrl, serviceRoleKey, transactionId: confirmedId, reference: confirmedReference,
        amountInCents: confirmedAmount, reason, details: { order_payment_method_mismatch: true },
      });
      return json({ error: reason, reconciliationRequired: status === "APPROVED", reconciliationStored }, status === "APPROVED" ? 500 : 409);
    }
    const expectedCents = Number(order.total) * 100;
    if (!Number.isSafeInteger(expectedCents) || expectedCents <= 0 || expectedCents !== confirmedAmount) {
      const reason = "El monto de Wompi no coincide con el total del pedido almacenado.";
      console.error(reason, { reference: confirmedReference, expectedCents, receivedCents: confirmedAmount });
      let reconciliationStored = false;
      let transactionLinked = Boolean(String(order.transaction_id ?? "").trim() === confirmedId);
      let linkConflict = false;
      // It is still important to bind this verified approved transaction to a Wompi
      // order, without approving it, so the customer cannot accidentally pay again
      // while the amount discrepancy is reviewed.
      if (status === "APPROVED" && String(order.payment_method ?? "").toLowerCase() === "wompi" && !String(order.transaction_id ?? "").trim()) {
        const link = await ensureOrderTransactionLinked({
          supabaseUrl, serviceRoleKey, reference: confirmedReference, transactionId: confirmedId,
        });
        transactionLinked = link.linked;
        linkConflict = link.conflict;
      }
      if (status === "APPROVED") reconciliationStored = await recordInventoryReconciliation({
        supabaseUrl, serviceRoleKey, transactionId: confirmedId, reference: confirmedReference,
        amountInCents: confirmedAmount, reason,
        details: {
          expected_amount_in_cents: Number.isSafeInteger(expectedCents) ? expectedCents : null,
          transaction_linked: transactionLinked,
          link_conflict: linkConflict,
        },
      });
      return json({ error: reason, transactionLinked, reconciliationRequired: status === "APPROVED", reconciliationStored }, status === "APPROVED" ? 500 : 409);
    }

    const storedTransactionId = String(order.transaction_id ?? "").trim();
    const storedStatus = String(order.payment_status ?? "").toUpperCase();
    if (storedStatus === "APPROVED" && status !== "APPROVED") {
      // Never downgrade a payment already confirmed by a previous verified event.
      return json({ received: true, reference: confirmedReference, status: storedStatus, ignored: true, reason: "No se reduce un pago ya aprobado." });
    }

    if (storedTransactionId && storedTransactionId !== confirmedId) {
      const reason = "La referencia del pedido ya está vinculada a otro identificador de transacción.";
      if (status === "APPROVED") {
        const reconciliationStored = await recordInventoryReconciliation({
          supabaseUrl, serviceRoleKey, transactionId: confirmedId,
          reference: confirmedReference, amountInCents: confirmedAmount, reason,
          details: { conflicting_transaction_id: true, linked_transaction_id_present: true },
        });
        console.error("Wompi confirmó una transacción distinta para una referencia ya vinculada; se requiere conciliación.", { reference: confirmedReference, reconciliationStored });
        return json({ error: reason, reference: confirmedReference, transactionId: confirmedId, reconciliationRequired: true, reconciliationStored }, 500);
      }
      console.error("La referencia ya tiene otro identificador de transacción.", { reference: confirmedReference });
      return json({ error: "La referencia ya está vinculada a otra transacción." }, 409);
    }

    // Persist the verified transaction id before inventory operations, but do NOT
    // set payment_status=APPROVED yet. Checkout rejects another payment when it sees
    // a linked PENDING transaction, avoiding a second charge while stock is reviewed.
    if (!storedTransactionId) {
      const link = await ensureOrderTransactionLinked({
        supabaseUrl, serviceRoleKey, reference: confirmedReference, transactionId: confirmedId,
      });
      if (!link.linked) {
        const reason = link.conflict
          ? "El pedido quedó vinculado concurrentemente a otra transacción."
          : "No se pudo guardar el identificador de la transacción verificada en el pedido.";
        let reconciliationStored = false;
        if (status === "APPROVED") {
          reconciliationStored = await recordInventoryReconciliation({
            supabaseUrl, serviceRoleKey, transactionId: confirmedId,
            reference: confirmedReference, amountInCents: confirmedAmount, reason,
            details: { transaction_linked: false, link_conflict: link.conflict, link_http_status: link.httpStatus },
          });
        }
        return json({ error: reason, reference: confirmedReference, transactionId: confirmedId,
          reconciliationRequired: status === "APPROVED", reconciliationStored }, 500);
      }
    }

    // Finalize/release inventory first, then persist the terminal payment status.
    // The transaction id is already linked, while payment_status remains unchanged
    // until its corresponding inventory operation succeeds.
    let inventoryProcessed = false;
    let lateReservationRecovered = false;
    if (status === "APPROVED") {
      let inventoryResponse: Response | null = null;
      let inventoryResult: any = null;
      try {
        inventoryResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/confirm_inventory_reservation`, {
          method: "POST",
          headers: supabaseHeaders(serviceRoleKey),
          body: JSON.stringify({ p_reference: confirmedReference }),
        });
        inventoryResult = await responseJson(inventoryResponse);
      } catch (error) {
        inventoryResult = { success: false, message: `No se pudo contactar la función de confirmación de inventario: ${error instanceof Error ? error.message : "error desconocido"}` };
      }

      // If the RPC explicitly says the hold expired/released, safely try to reserve
      // the exact order lines again. This is NOT a stock override: reserve_order_inventory
      // must validate current availability under PostgreSQL locks. If stock was sold,
      // it returns failure and the payment is sent to durable manual reconciliation.
      const holdUnavailable = inventoryResponse?.ok === true && inventoryResult?.success === false &&
        /no hay una reserva vigente para finalizar/i.test(String(inventoryResult?.message ?? ""));
      if (holdUnavailable) {
        const reservationItems = reservationItemsFromOrder(order.items);
        if (reservationItems) {
          let lateReserveResponse: Response | null = null;
          let lateReserveResult: any = null;
          try {
            lateReserveResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/reserve_order_inventory`, {
              method: "POST",
              headers: supabaseHeaders(serviceRoleKey),
              body: JSON.stringify({ p_reference: confirmedReference, p_items: reservationItems, p_minutes: 10 }),
            });
            lateReserveResult = await responseJson(lateReserveResponse);
          } catch (error) {
            console.error("Error intentando recuperar inventario tras aprobación tardía.", { reference: confirmedReference, error: error instanceof Error ? error.message : "unknown" });
          }

          if (lateReserveResponse?.ok && lateReserveResult?.success === true) {
            try {
              inventoryResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/confirm_inventory_reservation`, {
                method: "POST",
                headers: supabaseHeaders(serviceRoleKey),
                body: JSON.stringify({ p_reference: confirmedReference }),
              });
              inventoryResult = await responseJson(inventoryResponse);
            } catch (error) {
              inventoryResponse = null;
              inventoryResult = { success: false, message: `Se reservó de nuevo el stock, pero no se pudo confirmar la reserva: ${error instanceof Error ? error.message : "error desconocido"}` };
            }
            if (inventoryResponse?.ok && inventoryResult?.success === true) {
              lateReservationRecovered = true;
            }
          } else {
            inventoryResult = {
              success: false,
              message: `La reserva original venció y no fue posible reservar nuevamente el stock: ${String(lateReserveResult?.message ?? `HTTP ${lateReserveResponse?.status ?? "sin respuesta"}`).slice(0, 500)}`,
            };
          }
        } else {
          inventoryResult = { success: false, message: "La reserva venció y no se pudieron reconstruir líneas válidas desde orders.items." };
        }
      }

      if (!inventoryResponse?.ok || !inventoryResult || inventoryResult.success !== true) {
        const reason = String(inventoryResult?.message ?? `La RPC de inventario respondió HTTP ${inventoryResponse?.status ?? "sin respuesta"}.`);
        const reconciliationStored = await recordInventoryReconciliation({
          supabaseUrl,
          serviceRoleKey,
          transactionId: confirmedId,
          reference: confirmedReference,
          amountInCents: confirmedAmount,
          reason,
          details: {
            inventory_http_status: inventoryResponse?.status ?? null,
            late_reservation_recovered_attempted: holdUnavailable,
            order_items_available: Array.isArray(order.items),
          },
        });
        console.error("Wompi confirmó el cobro, pero el inventario no pudo finalizarse; el pedido no se marca aprobado y queda registrado para conciliación.", { reference: confirmedReference, httpStatus: inventoryResponse?.status ?? null, reconciliationStored });
        return json({
          error: "Wompi confirmó el pago, pero el inventario necesita revisión. El pedido permanece sin aprobar para despacho y su transacción queda vinculada para evitar otro cobro.",
          reference: confirmedReference,
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
        body: JSON.stringify({ p_reference: confirmedReference }),
      });
      if (!releaseResponse.ok) {
        console.error("No se pudo liberar la reserva de un pago no aprobado; el pedido conservará su estado previo.", { reference: confirmedReference, status, httpStatus: releaseResponse.status });
        return json({ error: "No se pudo liberar la reserva de inventario; el pedido conservará su estado previo para permitir el reintento del evento." }, 500);
      }
      inventoryProcessed = true;
    }

    // Solo se escribe el estado después de completar la acción de inventario que le corresponde.
    const updateUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
    updateUrl.searchParams.set("reference", `eq.${confirmedReference}`);
    updateUrl.searchParams.set("payment_method", "eq.wompi");
    updateUrl.searchParams.set("transaction_id", `eq.${confirmedId}`);
    let updateResponse: Response | null = null;
    let updatedRows: any = null;
    try {
      updateResponse = await fetch(updateUrl.toString(), {
        method: "PATCH",
        headers: { ...supabaseHeaders(serviceRoleKey), Prefer: "return=representation" },
        body: JSON.stringify({ payment_status: status, transaction_id: confirmedId, updated_at: new Date().toISOString() }),
      });
      updatedRows = await responseJson(updateResponse);
    } catch (error) {
      console.error("No se pudo completar la escritura del estado del pedido.", { reference: confirmedReference, error: error instanceof Error ? error.message : "unknown" });
    }
    if (!updateResponse?.ok || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
      const reason = "Se procesó la acción de inventario, pero no se pudo guardar el estado final del pedido.";
      console.error(reason, { reference: confirmedReference, status, httpStatus: updateResponse?.status ?? null, inventoryProcessed });
      let reconciliationStored = false;
      if (status === "APPROVED") {
        reconciliationStored = await recordInventoryReconciliation({
          supabaseUrl, serviceRoleKey, transactionId: confirmedId,
          reference: confirmedReference, amountInCents: confirmedAmount,
          reason,
          details: { inventory_processed: inventoryProcessed, order_status_write_failed: true, order_patch_http_status: updateResponse?.status ?? null },
        });
      }
      return json({ error: `${reason} El identificador de transacción ya está vinculado; el evento debe reintentarse/conciliarse.`,
        reference: confirmedReference, transactionId: confirmedId,
        reconciliationRequired: status === "APPROVED", reconciliationStored }, 502);
    }

    if (status === "APPROVED" && inventoryProcessed) {
      await markInventoryReconciliationResolved({ supabaseUrl, serviceRoleKey, transactionId: confirmedId });
    }

    console.log("Evento Wompi procesado.", { reference: confirmedReference, transactionId: confirmedId, status, inventoryProcessed, lateReservationRecovered, environment: expectedEnvironment });
    return json({ received: true, reference: confirmedReference, transactionId: confirmedId, status, inventoryProcessed, lateReservationRecovered });
  } catch (error) {
    console.error("Error procesando evento Wompi:", error instanceof Error ? error.message : "error desconocido");
    return json({ error: "No se pudo procesar el evento." }, 500);
  }
});
