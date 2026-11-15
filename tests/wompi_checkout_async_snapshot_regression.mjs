import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name, isAsync = false) {
  const marker = `${isAsync ? 'async ' : ''}function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `No se encontró ${marker}`);
  const parameters = html.indexOf('(', start);
  let parameterDepth = 0;
  let parameterQuote = '';
  let parameterEscaped = false;
  let signatureEnd = -1;
  for (let index = parameters; index < html.length; index += 1) {
    const ch = html[index];
    if (parameterQuote) {
      if (parameterEscaped) parameterEscaped = false;
      else if (ch === '\\') parameterEscaped = true;
      else if (ch === parameterQuote) parameterQuote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { parameterQuote = ch; continue; }
    if (ch === '(') parameterDepth += 1;
    else if (ch === ')' && --parameterDepth === 0) { signatureEnd = index + 1; break; }
  }
  let open = signatureEnd;
  while (/\s/.test(html[open] || '')) open += 1;
  assert.equal(html[open], '{', `No se encontró el inicio del cuerpo de ${name}`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < html.length; index += 1) {
    const ch = html[index];
    const next = html[index + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  assert.fail(`No se encontró el cierre de ${name}`);
}

const helpers = [
  extractFunction('normalizeCheckoutCouponCode'),
  extractFunction('cloneCheckoutSnapshotValue'),
  extractFunction('freezeCheckoutSnapshotValue'),
  extractFunction('normalizeCheckoutSnapshotField'),
  extractFunction('wompiCheckoutFormStateFromPayload'),
  extractFunction('currentWompiCheckoutFormState'),
  extractFunction('wompiCheckoutCartFingerprint'),
  extractFunction('checkoutSnapshotMatchesCurrent'),
  extractFunction('createImmutableWompiCheckoutSnapshot'),
  extractFunction('trackActiveWompiSnapshotInput'),
  extractFunction('trackActiveWompiSnapshotCart'),
  extractFunction('hasActiveWompiSnapshotChanges'),
  extractFunction('readWompiCheckoutRequestRecords'),
  extractFunction('writeWompiCheckoutRequestRecords'),
  extractFunction('findWompiCheckoutRequestRecord'),
  extractFunction('storeWompiCheckoutRequestRecord'),
  extractFunction('updateWompiCheckoutRequestStatus'),
  extractFunction('newWompiCheckoutRequestId'),
  extractFunction('selectWompiCheckoutRequest'),
  extractFunction('invalidateActiveWompiCheckoutRequest'),
  extractFunction('cancelActiveWompiCheckoutRequest', true),
].join('\n');
const payWithWompiSource = extractFunction('payWithWompi', true);

const baseItems = [{ id: 'COR-038-SYNTHETIC', name: 'Artículo sintético', code: 'TEST-038', qty: 1, price: 2000, max: 1, color: '', size: '' }];
const basePayload = {
  name: 'Comprador de prueba', cedula_type: 'CC', cedula: '00000000', phone: '3001234567', email: 'checkout-test@example.invalid',
  city: 'Cali', address: 'Dirección sintética 1', neighborhood: 'Barrio de prueba', payment: 'PSE', environment: 'prod',
  shipping: 0, coupon_code: '', expected_total: 2000, expected_discount_total: 0, expected_coupon_discount_total: 0,
  storefront_pricing_version: 'combo-discounts-v1', items: [{ id: baseItems[0].id, name: baseItems[0].name, code: baseItems[0].code, qty: 1, price: 2000, color: '', size: '' }],
};
const baseQuote = {
  success: true, currency: 'COP', original_subtotal: 2000, discounted_subtotal: 2000,
  discount_total: 0, coupon_discount_total: 0, shipping: 0, total: 2000, items: [], _lineItems: [],
};
const reservationReference = 'JMRES-SNAPSHOT-SYNTHETIC-001';

function createHarness({ refreshMutation = null, edgeResponse = null, settingsGate = null, edgeMutation = null, couponCode = '', cancelState = 'cancelled' } = {}) {
  const confirmedPayload = { ...basePayload, coupon_code: couponCode };
  const elements = {
    checkoutConfirmBtn: { disabled: false, textContent: 'Confirmar' },
    customerName: { id: 'customerName', value: basePayload.name },
    customerCedulaType: { id: 'customerCedulaType', value: basePayload.cedula_type },
    customerCedula: { id: 'customerCedula', value: basePayload.cedula },
    customerPhone: { id: 'customerPhone', value: basePayload.phone },
    customerEmail: { id: 'customerEmail', value: basePayload.email },
    customerCity: { id: 'customerCity', value: basePayload.city },
    customerCityOther: { id: 'customerCityOther', value: '' },
    customerAddress: { id: 'customerAddress', value: basePayload.address },
    customerNeighborhood: { id: 'customerNeighborhood', value: basePayload.neighborhood },
    couponCode: { id: 'couponCode', value: couponCode },
  };
  let cartItems = structuredClone(baseItems);
  let edgeCalls = 0;
  let formSubmits = 0;
  let localReservationWrites = 0;
  let reservationDraftWrites = 0;
  let sessionLookups = 0;
  let edgeRequestBody = null;
  let cancelCalls = 0;
  let submittedFields = {};
  const messages = [];
  const storedValues = new Map();
  const responseQuote = edgeResponse?.data?.quote ?? baseQuote;
  const data = edgeResponse?.data ?? {
    environment: 'prod', reference: reservationReference, attemptReference: `SW-${'A'.repeat(32)}`,
    signature: 'firma-sintética-no-utilizable', expirationTime: new Date(Date.now() + 10 * 60_000).toISOString(), amountInCents: 200000,
  };
  const fakeForm = {
    style: {}, fields: [], appendChild(node) { this.fields.push(node); },
    submit() {
      formSubmits += 1;
      submittedFields = Object.fromEntries(this.fields.map(field => [field.name, field.value]));
    },
  };
  const document = {
    body: { appendChild(node) { assert.equal(node, fakeForm); } },
    createElement(tag) {
      if (tag === 'form') return fakeForm;
      if (tag === 'input') return { type: '', name: '', value: '' };
      throw new Error(`Elemento no permitido en el harness: ${tag}`);
    },
  };
  const window = { __sirevyaWompiInProgress: false, location: { pathname: '/', origin: 'https://sirevya.com.co' } };
  const context = vm.createContext({
    window, document, location: { protocol: 'https:', hostname: 'sirevya.com.co' }, URL, Date, structuredClone,
    crypto: { randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', getRandomValues(bytes) { bytes.fill(1); return bytes; } },
    localStorage: { getItem(key) { return storedValues.get(key) ?? null; }, setItem(key, value) { storedValues.set(key, String(value)); }, removeItem(key) { storedValues.delete(key); } },
    fetch: async (url, options) => { cancelCalls += 1; assert.equal(url, 'https://project.invalid/functions/v1/wompi-create-checkout'); const body = JSON.parse(options.body); assert.equal(body.action, 'cancel_request'); assert.match(body.checkout_request_id, /^[0-9a-f-]{36}$/i); return { ok: true, async json() { return { success: true, state: cancelState, released: cancelState === 'cancelled', manual_recovery_required: cancelState === 'manual_recovery_required' || cancelState === 'published' }; } }; },
    WOMPI_CHECKOUT_REQUESTS_KEY: 'jm_wompi_checkout_requests_v1',
    activeWompiCheckoutRequestId: '', activeWompiCheckoutRequestReference: '', activeWompiCheckoutRequestSent: false,
    activeWompiCheckoutRequestCancelPromise: null, activeWompiCheckoutRequestCancelResult: null, activeWompiCheckoutRequestHeaders: null, activeWompiCheckoutRequestRecord: null,
    activeWompiCheckoutRequestInvalidated: false, activeWompiCheckoutRedirectStarted: false,
    activeWompiCheckoutSnapshot: null, activeWompiCheckoutChangedFields: new Set(),
    checkoutCouponCode: couponCode, onlinePaymentsEnabled: true, wompiNewOrderConfirmationFingerprint: '', wompiNewOrderConfirmationReference: '',
    WOMPI_PUBLIC_ENVIRONMENT: 'prod', WOMPI_PUBLIC_KEY: 'pub_prod_synthetic', WOMPI_SIGNATURE_ENDPOINT: 'https://project.invalid/functions/v1/wompi-create-checkout',
    SUPABASE_KEY: 'publishable-test-only', WOMPI_RESERVATION_TTL: 600000,
    normalizeDeliveryCity(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); },
    canonicalLocalDeliveryCity(value) {
      const city = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      return ['cali', 'santiago de cali', 'cali valle del cauca'].includes(city) ? 'Cali' : '';
    },
    normalizeCheckoutQuote: value => value,
    quoteHasValidTotals: quote => !!quote && quote.success === true && Number.isSafeInteger(Number(quote.total)) && Number.isSafeInteger(Number(quote.shipping)),
    getCheckoutItems: () => cartItems,
    checkoutCityValue: () => elements.customerCity.value === 'Otra' ? elements.customerCityOther.value : elements.customerCity.value,
    selectedPayment: () => 'PSE',
    $: id => elements[id] ?? null,
    getWompiOrderSnapshotFingerprint: () => 'snapshot-order-fingerprint-synthetic',
    reservationItemsMatch: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    saveActiveReservationReference() { localReservationWrites += 1; },
    saveActiveReservationItems() { localReservationWrites += 1; },
    savePendingWompiReference() { localReservationWrites += 1; },
    setCurrentReservationRecord() { localReservationWrites += 1; },
    saveReservationDraft() { localReservationWrites += 1; reservationDraftWrites += 1; },
    saveReservationRecord() { localReservationWrites += 1; },
    forgetReservationRecord() { localReservationWrites += 1; },
    updateReservationReference() { localReservationWrites += 1; },
    generateReservationReference: () => 'JMRES-GENERATED-SYNTHETIC-002',
    setCheckoutServerQuote() {}, setCheckoutCouponQuote() {}, setCheckoutCouponStatus() {},
    updateShipping() {}, updateCheckoutSummary() {}, closeCheckout() {}, resetWompiButton() { elements.checkoutConfirmBtn.disabled = false; },
    showToast(message) { messages.push(String(message)); }, money: amount => String(amount), getRegion: () => 'Valle del Cauca',
    console: { error() {}, warn() {}, log() {} },
    sb: { auth: { async getSession() { sessionLookups += 1; return { data: { session: null } }; } } },
    async refreshOnlinePaymentSetting() {
      if (settingsGate) await settingsGate;
      else await Promise.resolve();
      if (refreshMutation) refreshMutation(context, elements, {
        setField(id, value) { elements[id].value = value; context.trackActiveWompiSnapshotInput({ target: elements[id] }); if (id === 'couponCode') context.checkoutCouponCode = String(value).trim().toUpperCase(); },
        refreshCart(next) { cartItems = next; context.trackActiveWompiSnapshotCart(); },
      });
    },
    syncPaymentOptions() {},
    async checkoutFetchWithTimeout(url, options) {
      edgeCalls += 1;
      assert.equal(url, 'https://project.invalid/functions/v1/wompi-create-checkout');
      edgeRequestBody = JSON.parse(options.body);
      if (edgeMutation) edgeMutation(context, elements, {
        setField(id, value) { elements[id].value = value; context.trackActiveWompiSnapshotInput({ target: elements[id] }); if (id === 'couponCode') context.checkoutCouponCode = String(value).trim().toUpperCase(); },
        refreshCart(next) { cartItems = next; context.trackActiveWompiSnapshotCart(); },
      });
      return {
        ok: edgeResponse?.ok ?? true,
        status: edgeResponse?.status ?? 200,
        async json() { return structuredClone(data); },
      };
    },
    async requestCheckoutQuote(code, items, city) {
      assert.equal(city, basePayload.city, 'el fallback read-only debe usar la ciudad confirmada');
      assert.deepEqual(JSON.parse(JSON.stringify(items)).map(row => row.id), [baseItems[0].id]);
      return structuredClone(responseQuote);
    },
  });
  vm.runInContext(`${helpers}\n${payWithWompiSource}`, context);
  const inputFingerprint = JSON.stringify({ city: 'cali', coupon: couponCode, items: [baseItems[0].id] });
  const snapshot = context.createImmutableWompiCheckoutSnapshot({
    payload: structuredClone(confirmedPayload), quote: structuredClone(baseQuote), items: structuredClone(baseItems), couponCode, inputFingerprint,
    formState: context.wompiCheckoutFormStateFromPayload(confirmedPayload),
    cartFingerprint: context.wompiCheckoutCartFingerprint(baseItems),
    reservationState: {
      activeReference: reservationReference, pendingReference: '', activeItems: structuredClone(baseItems),
      matchingRecord: { reference: reservationReference, startedAt: Date.now(), items: structuredClone(baseItems) },
      couponReference: '', couponFingerprint: '',
    },
  });
  return {
    context, elements, snapshot, messages,
    get metrics() { return { edgeCalls, formSubmits, localReservationWrites, reservationDraftWrites, sessionLookups, edgeRequestBody, submittedFields, cancelCalls, storedRequestRecords: storedValues.get('jm_wompi_checkout_requests_v1') || '' }; },
  };
}

async function runApprovedSnapshot(refreshMutation = null) {
  const harness = createHarness({ refreshMutation });
  await harness.context.payWithWompi(harness.snapshot);
  return harness;
}

// Reproducción de la carrera: el refresco asíncrono re-renderiza opciones y normaliza
// representaciones equivalentes de Cali/teléfono. El payload enviado debe seguir siendo
// exactamente el confirmado, no reconstruirse a partir de esos controles mutables.
const normalizedRefresh = await runApprovedSnapshot((_context, elements, { setField }) => {
  elements.customerCity.optionsRevision = 'updated';
  setField('customerCity', 'Santiago de Cali');
  setField('customerPhone', '300 123 4567');
});
assert.equal(normalizedRefresh.metrics.edgeCalls, 1, 'la deriva de presentación semánticamente equivalente no bloquea la solicitud');
assert.equal(normalizedRefresh.metrics.formSubmits, 1, 'la respuesta sintética válida llega al formulario Wompi simulado');
assert.equal(normalizedRefresh.metrics.edgeRequestBody.city, 'Cali', 'la solicitud conserva la ciudad confirmada');
assert.equal(normalizedRefresh.metrics.edgeRequestBody.phone, '3001234567', 'la solicitud conserva el teléfono confirmado, no el control normalizado después');
assert.equal(normalizedRefresh.metrics.edgeRequestBody.expected_total, 2000);
assert.equal(normalizedRefresh.metrics.edgeRequestBody.reference, reservationReference, 'la solicitud reutiliza la referencia de la reserva existente');
assert.match(normalizedRefresh.metrics.edgeRequestBody.checkout_request_id, /^[0-9a-f-]{36}$/i, 'la solicitud usa un request ID idempotente');
assert.match(normalizedRefresh.metrics.storedRequestRecords, /published/, 'el request persistido refleja que la firma fue publicada');
assert.doesNotMatch(normalizedRefresh.metrics.storedRequestRecords, /Comprador|3001234567|checkout-test@example|Dirección sintética/i, 'el ledger local solo persiste ID y referencia opacos, nunca PII');
assert.equal(normalizedRefresh.context.selectWompiCheckoutRequest(reservationReference).requestId, normalizedRefresh.metrics.edgeRequestBody.checkout_request_id, 'tras cerrar/reabrir se recuperan la misma referencia y request ID, no se genera otra reserva');
assert.equal(normalizedRefresh.metrics.reservationDraftWrites, 0, 'el reingreso no genera un nuevo borrador/reserva local');
assert.equal(normalizedRefresh.metrics.submittedFields.currency, 'COP');
assert.equal(normalizedRefresh.metrics.submittedFields['amount-in-cents'], '200000');
assert.equal(normalizedRefresh.metrics.submittedFields['shipping-address:city'], 'Cali');
assert.equal(normalizedRefresh.context.window.__sirevyaWompiInProgress, false, 'el guard se libera después de terminar');

// Una actualización de opciones de pago que no toca datos comerciales deja pasar el mismo snapshot.
const stableRefresh = await runApprovedSnapshot(() => {});
assert.equal(stableRefresh.metrics.edgeCalls, 1);
assert.equal(stableRefresh.metrics.edgeRequestBody.email, basePayload.email);
assert.equal(stableRefresh.metrics.edgeRequestBody.items[0].id, baseItems[0].id);

// Los cambios reales durante la espera invalidan el snapshot y detienen la petición antes de sesión, borrador o Edge.
for (const scenario of [
  { name: 'correo', mutate: (_ctx, _elements, api) => api.setField('customerEmail', 'otro@example.invalid') },
  { name: 'teléfono', mutate: (_ctx, _elements, api) => api.setField('customerPhone', '3007654321') },
  { name: 'ciudad', mutate: (_ctx, _elements, api) => api.setField('customerCity', 'Bogotá') },
  { name: 'dirección', mutate: (_ctx, _elements, api) => api.setField('customerAddress', 'Calle diferente 99') },
  { name: 'cupón', mutate: (_ctx, elements, api) => { elements.couponCode.value = 'NUEVO10'; api.setField('couponCode', 'NUEVO10'); } },
  { name: 'carrito', mutate: (_ctx, _elements, api) => api.refreshCart([{ ...baseItems[0], qty: 2 }]) },
]) {
  const harness = createHarness({ refreshMutation: scenario.mutate });
  await harness.context.payWithWompi(harness.snapshot);
  assert.equal(harness.metrics.edgeCalls, 0, `${scenario.name}: no se invoca el servidor con un snapshot obsoleto`);
  assert.equal(harness.metrics.formSubmits, 0, `${scenario.name}: no se abre Wompi`);
  assert.equal(harness.metrics.localReservationWrites, 0, `${scenario.name}: no se registra una referencia/reserva local nueva antes del rechazo`);
  assert.ok(harness.messages.some(message => /cambió un dato del pedido/i.test(message)), `${scenario.name}: se informa que debe revisar y confirmar de nuevo`);
}

// Eliminar un cupón confirmado también se detecta con el campo vacío, aunque el estado
// checkoutCouponCode todavía conserve el valor anterior al inicio del listener.
const clearedCoupon = createHarness({ couponCode: 'SAVE10', refreshMutation: (_ctx, _elements, api) => api.setField('couponCode', '') });
await clearedCoupon.context.payWithWompi(clearedCoupon.snapshot);
assert.equal(clearedCoupon.metrics.edgeCalls, 0, 'vaciar el campo del cupón cancela antes del POST');
assert.equal(clearedCoupon.metrics.formSubmits, 0, 'no se cobra la cotización previa con el cupón eliminado');

// Si el comprador cambia algo cuando el POST ya está en curso, se preserva el estado
// server-side pero nunca se construye ni envía el formulario de pago con datos cruzados.
const changedDuringEdge = createHarness({ edgeMutation: (_context, _elements, api) => api.setField('customerAddress', 'Otra dirección sintética') });
await changedDuringEdge.context.payWithWompi(changedDuringEdge.snapshot);
assert.equal(changedDuringEdge.metrics.edgeCalls, 1, 'la solicitud que ya estaba en curso termina una vez');
assert.equal(changedDuringEdge.metrics.formSubmits, 0, 'un cambio durante la validación final cancela la redirección');
assert.equal(changedDuringEdge.metrics.cancelCalls, 1, 'la solicitud tardía se cancela idempotentemente una sola vez');
assert.ok(changedDuringEdge.messages.some(message => /cambiaron mientras el servidor validaba/i.test(message)));

// Si el servidor alcanzó a crear el pedido antes de recibir cancel, su respuesta manual
// preserva pedido/reserva y el navegador no puede continuar hacia Wompi.
const lateCreatedOrder = createHarness({ edgeMutation: (_context, _elements, api) => api.setField('customerAddress', 'Otra dirección sintética'), cancelState: 'manual_recovery_required' });
await lateCreatedOrder.context.payWithWompi(lateCreatedOrder.snapshot);
assert.equal(lateCreatedOrder.metrics.formSubmits, 0, 'un pedido creado antes de cancelación nunca redirige con el snapshot cambiado');
assert.match(lateCreatedOrder.metrics.storedRequestRecords, /manual/, 'el request queda marcado para recuperación manual, sin liberar la reserva');
assert.equal(lateCreatedOrder.metrics.reservationDraftWrites, 0, 'la respuesta tardía no crea otro draft/reserva local');

// Doble toque concurrente: el guard se establece antes del primer await y solo hay un POST.
let releaseSettings;
const settingsGate = new Promise(resolve => { releaseSettings = resolve; });
const simultaneous = createHarness({ settingsGate });
const firstCall = simultaneous.context.payWithWompi(simultaneous.snapshot);
const secondCall = simultaneous.context.payWithWompi(simultaneous.snapshot);
await secondCall;
assert.equal(simultaneous.context.window.__sirevyaWompiInProgress, true, 'la primera solicitud conserva el guard durante la espera');
releaseSettings();
await firstCall;
assert.equal(simultaneous.metrics.edgeCalls, 1, 'dos invocaciones simultáneas producen un solo POST');
assert.equal(simultaneous.metrics.formSubmits, 1, 'solo una respuesta puede preparar el formulario');

// La Edge simulada rechaza una cotización alterada; el navegador muestra el quote nuevo, no redirige.
const changedQuote = { ...baseQuote, original_subtotal: 3000, discounted_subtotal: 3000, total: 3000 };
const rejectedQuote = createHarness({ edgeResponse: {
  ok: false, status: 409,
  data: { code: 'WOMPI_QUOTE_CHANGED', error: 'Cotización modificada', quote: changedQuote },
} });
await rejectedQuote.context.payWithWompi(rejectedQuote.snapshot);
assert.equal(rejectedQuote.metrics.edgeCalls, 1, 'el checkout envía una sola validación al servidor');
assert.equal(rejectedQuote.metrics.formSubmits, 0, 'una cotización no coincidente nunca abre el formulario Wompi');
assert.equal(rejectedQuote.metrics.cancelCalls, 1, 'una respuesta comercialmente rechazada cancela su request sin duplicar la llamada');
assert.ok(rejectedQuote.messages.some(message => /Desglose vigente: subtotal/.test(message)), 'el comprador recibe el desglose vigente para reconfirmar');

console.log('PASS wompi_checkout_async_snapshot_regression: payWithWompi real con DOM/Edge simulados; request ID y referencia persistidos sin PII; reingreso recupera el mismo ID; cancelación single-flight; cambios reales bloqueados; respuesta tardía no redirige y preserva recuperación manual; doble toque deduplicado; quote 409 sin pago. Sin llamadas externas ni datos comerciales.');
