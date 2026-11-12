const MAX_BODY_BYTES = 1024;
const MAX_BATCH_SIZE = 5;
const CLAIM_LEASE_SECONDS = 600;
const RPC_TIMEOUT_MS = 8000;
const TELEGRAM_TIMEOUT_MS = 8000;
const TELEGRAM_DISPATCH_HEADER = "x-sirevya-dispatch-secret";

const EVENT_TITLES = Object.freeze({
  "order.created": "🛍️ Nuevo pedido",
  "order.cancelled": "⛔ Pedido cancelado",
  "order.status_changed": "📦 Estado del pedido actualizado",
  "order.shipped": "🚚 Pedido enviado",
  "order.delivered": "✅ Pedido entregado",
  "order.tracking_created": "🧾 Guía de envío generada",
  "order.tracking_updated": "🔄 Guía de envío actualizada",
  "payment.pending": "🕓 Pago pendiente",
  "payment.approved": "✅ Pago confirmado",
  "payment.rejected": "⚠️ Pago rechazado",
  "payment.error": "⚠️ Error de pago",
  "payment.voided": "↩️ Pago anulado",
  "inventory.stockout": "⚠️ Producto agotado",
  "inventory.restocked": "📦 Producto restablecido",
  "inventory.movement": "📋 Movimiento de inventario",
  "reservation.created": "📦 Reserva de inventario creada",
  "reservation.released": "↩️ Reserva de inventario liberada",
  "reservation.expired": "⌛ Reserva de inventario vencida",
  "reservation.whatsapp_reserved": "📲 Inventario reservado para WhatsApp",
  "reservation.whatsapp_confirmed": "✅ Reserva de WhatsApp confirmada",
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

function safePhone(value) {
  const phone = safeSingleLine(value, 40);
  return phone.replace(/\D/g, "").length >= 7 && /^\+?[0-9()\s.-]+$/.test(phone) ? phone : "";
}

function formatCop(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) return "";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatOrderDateTime(value) {
  const raw = String(value ?? "").trim();
  const date = raw ? new Date(raw) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(date);
}

function safeTrackingUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u0020\u007f]/.test(raw)) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !host) return "";
    if (host === "localhost" || host.endsWith(".localhost") || (host.startsWith("[") && host.endsWith("]"))) return "";
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some(part => part > 255) || octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168)) return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function safeWhatsAppUrl(value) {
  const phone = safeSingleLine(value, 40);
  if (!phone || !/^\+?[0-9()\s.-]+$/.test(phone)) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "";
  const internationalDigits = /^\s*\+/.test(phone) && /^[1-9]\d{7,14}$/.test(digits)
    ? digits
    : digits.startsWith("57") && digits.length === 12
      ? digits
      : /^3\d{9}$/.test(digits)
        ? `57${digits}`
        : "";
  return internationalDigits ? `https://wa.me/${internationalDigits}` : "";
}

export function buildTelegramReplyMarkup(row) {
  const eventType = String(row?.event_type ?? "");
  const payload = row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : {};
  const buttons = [];
  const orderId = String(payload.admin_order_id ?? "");
  if (validUuid(orderId) && (eventType === "order.created" || eventType.startsWith("order."))) {
    buttons.push({
      text: "Abrir pedido",
      url: `https://sirevya.com.co/admin.html?web_order=${encodeURIComponent(orderId)}`,
    });
  }
  const trackingUrl = safeTrackingUrl(payload.tracking_url);
  if (trackingUrl && eventType.startsWith("order.tracking_")) {
    buttons.push({ text: "Rastrear envío", url: trackingUrl });
  }
  const contactUrl = safeWhatsAppUrl(payload.customer_phone);
  if (contactUrl && (eventType === "order.created" || eventType.startsWith("order.tracking_"))) {
    buttons.push({ text: "Contactar cliente", url: contactUrl });
  }
  return buttons.length ? { inline_keyboard: [buttons] } : null;
}

function isCodPaymentMethod(value) {
  const method = safeSingleLine(value, 40).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return ["contra entrega", "contraentrega", "cash on delivery", "cod"].includes(method);
}

function humanPaymentMethod(value) {
  const method = safeSingleLine(value, 40).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (isCodPaymentMethod(method)) return "Contraentrega";
  if (method === "wompi") return "Wompi";
  if (method === "pse") return "PSE";
  if (method === "nequi") return "Nequi";
  if (method === "tarjeta" || method === "card") return "Tarjeta";
  return safeSingleLine(value, 40);
}

function humanStatus(value, fallback = "") {
  const status = safeSingleLine(value, 32).toUpperCase();
  const labels = {
    APPROVED: "Aprobado", CONFIRMED: "Confirmado", PENDING: "Pendiente",
    REJECTED: "Rechazado", DECLINED: "Rechazado", FAILED: "Fallido",
    ERROR: "Con error", VOIDED: "Anulado", CANCELLED: "Cancelado", CANCELED: "Cancelado",
    NEW: "Nuevo", NUEVO: "Nuevo", PROCESSING: "En preparación", PREPARANDO: "En preparación",
    SHIPPED: "Enviado", ENVIADO: "Enviado", IN_TRANSIT: "En tránsito", EN_TRANSITO: "En tránsito",
    DELIVERED: "Entregado", ENTREGADO: "Entregado", ENTREGADA: "Entregado",
  };
  return labels[status] || safeSingleLine(value || fallback, 32);
}

export function formatTelegramNotification(row) {
  const eventType = String(row?.event_type ?? "");
  const defaultTitle = EVENT_TITLES[eventType];
  if (!defaultTitle) return "";
  const payload = row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : {};
  const title = eventType === "order.created" && isCodPaymentMethod(payload.payment_method)
    ? "🧾 Pedido contraentrega recibido"
    : defaultTitle;
  const reference = safeReference(payload.reference);
  const orderReference = safeReference(payload.commercial_reference)
    || safeReference(payload.order_reference)
    || (eventType.startsWith("order.") || eventType.startsWith("payment.") ? reference : "");
  const inventoryReference = safeReference(payload.inventory_reference);
  const reservationReference = eventType.startsWith("reservation.")
    ? inventoryReference || reference
    : "";
  const lines = [title, "──────────────"];
  if (orderReference) lines.push(`Pedido: ${orderReference}`);
  if (eventType.startsWith("order.") || eventType.startsWith("payment.")) {
    const dateTime = formatOrderDateTime(row?.created_at ?? payload.created_at);
    if (dateTime) lines.push(`Fecha y hora: ${dateTime} (Colombia)`);
  }
  if (!orderReference && !reservationReference && reference) {
    lines.push(`Referencia: ${reference}`);
  }

  const customerName = safeSingleLine(payload.customer_name, 120);
  const city = safeSingleLine(payload.city, 80);
  const allProducts = Array.isArray(payload.products) ? payload.products : [];
  const products = allProducts.slice(0, 50);
  const declaredOmittedProducts = Number(payload.omitted_products);
  const omittedProducts = Math.max(
    Number.isSafeInteger(declaredOmittedProducts) && declaredOmittedProducts > 0 ? declaredOmittedProducts : 0,
    allProducts.length - products.length,
  );
  const productLines = [];
  let computedUnits = 0;
  for (const product of products) {
    if (!product || typeof product !== "object" || Array.isArray(product)) continue;
    const name = safeProductName(product.name);
    const variant = safeSingleLine(product.variant, 80);
    const quantity = Number(product.quantity ?? product.qty);
    if (!Number.isSafeInteger(quantity) || quantity < 1) continue;
    computedUnits += quantity;
    const productLabel = name || "Producto";
    const unitPrice = formatCop(product.unit_price_cop);
    productLines.push(`• ${productLabel}${variant ? ` · ${variant}` : ""} · Cantidad: ${quantity}${unitPrice ? ` · ${unitPrice} c/u` : ""}`);
  }

  if (productLines.length === 0 && eventType.startsWith("reservation.")) {
    const code = safeProductCode(payload.product_code);
    const name = safeProductName(payload.product_name);
    const quantity = Number(payload.quantity ?? payload.total_units);
    if ((code || name) && Number.isSafeInteger(quantity) && quantity > 0) {
      computedUnits = quantity;
      productLines.push(`- ${[code, name].filter(Boolean).join(" — ")} · Cantidad: ${quantity}`);
    }
  }

  // Keep room for the event details, totals, and the omission notice below Telegram's limit.
  const displayedProductLines = [];
  let productDetailLength = 0;
  for (const line of productLines) {
    const nextLength = line.length + (displayedProductLines.length > 0 ? 1 : 0);
    if (productDetailLength + nextLength > 2600) break;
    displayedProductLines.push(line);
    productDetailLength += nextLength;
  }
  const messageOmittedProducts = omittedProducts + productLines.length - displayedProductLines.length;

  if (customerName) lines.push(`👤 Cliente: ${customerName}`);
  if (city) lines.push(`📍 Ciudad: ${city}`);
  if (displayedProductLines.length > 0) {
    lines.push("📦 Productos:", ...displayedProductLines);
  }
  if (messageOmittedProducts > 0) {
    const shownVerb = displayedProductLines.length === 1 ? "se muestra" : "se muestran";
    const omittedVerb = messageOmittedProducts === 1 ? "se omitió" : "se omitieron";
    const omittedLabel = messageOmittedProducts === 1 ? "línea adicional" : "líneas adicionales";
    const totalProductLines = displayedProductLines.length + messageOmittedProducts;
    lines.push(`Detalle de productos: ${shownVerb} ${displayedProductLines.length} de ${totalProductLines} líneas; ${omittedVerb} ${messageOmittedProducts} ${omittedLabel}.`);
  }
  const totalUnits = Number(payload.total_units);
  const units = Number.isSafeInteger(totalUnits) && totalUnits > 0 ? totalUnits : computedUnits;
  if (units > 0) lines.push(`Total de unidades: ${units}`);

  if (eventType === "order.created") {
    const phone = safePhone(payload.customer_phone);
    const deliveryAddress = safeSingleLine(payload.delivery_address, 200);
    const method = safeSingleLine(payload.payment_method, 40);
    const payment = safeSingleLine(payload.payment_status, 32);
    const order = safeSingleLine(payload.order_status, 32);
    const deliveryMode = safeSingleLine(payload.delivery_mode, 40);
    if (phone) lines.push(`☎️ Teléfono: ${phone}`);
    if (deliveryAddress) lines.push(`🏠 Dirección: ${deliveryAddress}`);
    if (deliveryMode) lines.push(`🚚 Entrega: ${deliveryMode}`);
    if (method) lines.push(`💳 Pago: ${humanPaymentMethod(method)}`);
    if (payment && !isCodPaymentMethod(method)) lines.push(`Estado de pago: ${humanStatus(payment)}`);
    else if (payment === "PENDING" && isCodPaymentMethod(method)) lines.push("Cobro: contraentrega al recibir");
    if (order) lines.push(`📌 Estado del pedido: ${humanStatus(order)}`);
    lines.push("💰 Resumen");
    const subtotal = formatCop(payload.subtotal_cop);
    const discount = formatCop(payload.discount_cop);
    const couponDiscount = formatCop(payload.coupon_discount_cop);
    const couponCode = safeSingleLine(payload.coupon_code, 64);
    const shipping = formatCop(payload.shipping_cop);
    if (subtotal) lines.push(`Subtotal: ${subtotal}`);
    if (discount) lines.push(`Descuentos: ${discount}`);
    if (couponCode) lines.push(`Cupón: ${couponCode}${couponDiscount ? ` · ${couponDiscount}` : ""}`);
    if (shipping) lines.push(`Envío: ${shipping}`);
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
  } else if (eventType === "order.status_changed" || eventType === "order.shipped" || eventType === "order.delivered" || eventType.startsWith("order.tracking_")) {
    const status = safeSingleLine(payload.order_status, 32);
    const carrier = safeSingleLine(payload.carrier_name, 80);
    const trackingNumber = safeSingleLine(payload.tracking_number, 120);
    const phone = safePhone(payload.customer_phone);
    const deliveryAddress = safeSingleLine(payload.delivery_address, 200);
    const method = safeSingleLine(payload.payment_method, 40);
    const amount = formatCop(payload.total_cop);
    if (status) lines.push(`Estado del pedido: ${status}`);
    if (carrier) lines.push(`Transportadora: ${carrier}`);
    if (trackingNumber) lines.push(`Guía: ${trackingNumber}`);
    if (phone) lines.push(`Teléfono: ${phone}`);
    if (deliveryAddress) lines.push(`Dirección: ${deliveryAddress}`);
    if (method) lines.push(`Medio: ${method}`);
    if (amount) lines.push(`Total: ${amount}`);
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
        const replyMarkup = buildTelegramReplyMarkup(row);
        telegramResponse = await fetcher(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          }),
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
