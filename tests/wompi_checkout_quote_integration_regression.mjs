import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 6)) {
  console.log('SKIP Wompi checkout integration: Node 22.6+ is required for built-in TypeScript stripping.');
  process.exit(0);
}
if (process.env.SIREVYA_WOMPI_QUOTE_CHILD !== '1') {
  const child = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', fileURLToPath(import.meta.url), '--child'], {
    encoding: 'utf8',
    env: { ...process.env, SIREVYA_WOMPI_QUOTE_CHILD: '1' },
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(child.stderr || child.stdout || `Edge child exited ${child.status}`);
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  process.exit(0);
}

const env = {
  SUPABASE_URL: 'https://supabase.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
  // Decoy project-wide value: the production handler must ignore it.
  WOMPI_ENVIRONMENT: 'test',
  WOMPI_INTEGRITY_SECRET: 'synthetic-production-integrity-secret',
  WOMPI_INTEGRITY_SECRET_TEST: 'synthetic-test-integrity-secret',
};
const handlers = {};
let activeHandler = '';
let quoteFixture;
let preparationFixture = null;
let mockCalls = [];
const capturedOrderInserts = [];
const expirationTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const attemptReferences = [
  'SW-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'SW-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  'SW-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
  'SW-DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
  'SW-EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
];
let attemptNumber = 0;
let orderState = null;
let terminalOrderAvailableForRetry = false;
let terminalAttemptsFixture = [];
let terminalLockFixture = null;
let activeReservationFixture = [];
let pendingRowsFixture = [];
const beginAttemptCalls = [];

globalThis.Deno = {
  env: { get: name => env[name] ?? null },
  serve: handler => { handlers[activeHandler] = handler; },
};
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  let body = null;
  if (typeof init.body === 'string' && init.body) body = JSON.parse(init.body);
  mockCalls.push({ url: url.toString(), path: url.pathname, method, body });

  if (url.origin !== env.SUPABASE_URL) throw new Error(`Blocked non-mock origin: ${url.origin}`);
  if (url.pathname === '/rest/v1/rpc/get_online_payment_status') {
    return jsonResponse([{ online_payments_enabled: true }]);
  }
  if (url.pathname === '/rest/v1/rpc/get_storefront_cart_quote_with_coupon') {
    return jsonResponse(quoteFixture);
  }
  if (url.pathname === '/rest/v1/orders' && method === 'GET') {
    const filter = String(url.searchParams.get('reference') || '');
    const requestedReference = filter.startsWith('eq.') ? filter.slice(3) : '';
    return jsonResponse(orderState && orderState.reference === requestedReference ? [structuredClone(orderState)] : []);
  }
  if (url.pathname === '/rest/v1/storefront_wompi_payment_attempts' && method === 'GET') {
    const filter = String(url.searchParams.get('order_reference') || '');
    const requestedReference = filter.startsWith('eq.') ? filter.slice(3) : '';
    return jsonResponse(terminalAttemptsFixture.filter(row => row.order_reference === requestedReference).map(row => structuredClone(row)));
  }
  if (url.pathname === '/rest/v1/storefront_wompi_checkout_locks' && method === 'GET') {
    const filter = String(url.searchParams.get('reference') || '');
    const requestedReference = filter.startsWith('eq.') ? filter.slice(3) : '';
    return jsonResponse(terminalLockFixture?.reference === requestedReference ? [structuredClone(terminalLockFixture)] : []);
  }
  if (url.pathname === '/rest/v1/inventory_reservations' && method === 'GET') {
    const filter = String(url.searchParams.get('reference') || '');
    const requestedReference = filter.startsWith('eq.') ? filter.slice(3) : '';
    return jsonResponse(activeReservationFixture.filter(row => row.reference === requestedReference).map(row => structuredClone(row)));
  }
  if (url.pathname === '/rest/v1/rpc/list_pending_wompi_orders_for_phone') {
    return jsonResponse({ success: true, orders: structuredClone(pendingRowsFixture) });
  }
  if (url.pathname === '/rest/v1/rpc/prepare_storefront_wompi_retry_lock') {
    if (terminalOrderAvailableForRetry && orderState && ['ERROR', 'DECLINED', 'VOIDED'].includes(orderState.payment_status)) {
      if (body.p_reference === orderState.reference) {
        return jsonResponse({ success: true, reference: orderState.reference, retry_after_terminal: true, expires_at: expirationTime });
      }
      return jsonResponse({ success: false, code: 'WOMPI_REUSE_EXISTING_ORDER', existing_reference: orderState.reference });
    }
    return jsonResponse({ success: false, code: 'WOMPI_NO_RETRYABLE_ORDER' });
  }
  if (url.pathname === '/rest/v1/rpc/reserve_storefront_wompi_checkout_lock') {
    return jsonResponse({ success: true, code: 'WOMPI_LOCK_CREATED', expires_at: expirationTime });
  }
  if (url.pathname === '/rest/v1/rpc/prepare_storefront_wompi_checkout') {
    if (preparationFixture) return jsonResponse(preparationFixture);
    return jsonResponse({ success: true, expires_at: expirationTime, quote: quoteFixture });
  }
  if (url.pathname === '/rest/v1/rpc/claim_storefront_wompi_checkout') {
    return jsonResponse({ success: true });
  }
  if (url.pathname === '/rest/v1/rpc/create_storefront_wompi_pending_order' && method === 'POST') {
    capturedOrderInserts.push(body);
    orderState = {
      reference: body.p_reference,
      created_at: new Date().toISOString(),
      payment_method: 'wompi',
      payment_status: 'PENDING',
      transaction_id: null,
      customer_name: body.p_customer_name,
      phone: body.p_phone,
      city: body.p_city,
      address: body.p_address,
      neighborhood: body.p_neighborhood,
      items: body.p_items,
      subtotal: body.p_subtotal,
      shipping: body.p_shipping,
      total: body.p_total,
      coupon_id: body.p_coupon_id,
      coupon_code: body.p_coupon_code,
      coupon_discount_total: body.p_coupon_discount_total,
      wompi_reconciliation_required: false,
      coupon_reconciliation_required: false,
    };
    return jsonResponse({ success: true, order_id: '33333333-3333-4333-8333-333333333333', reference: body.p_reference });
  }
  if (url.pathname === '/rest/v1/rpc/begin_storefront_wompi_payment_attempt' && method === 'POST') {
    beginAttemptCalls.push(body);
    const currentAttemptReference = attemptReferences[attemptNumber++];
    if (orderState) { orderState.payment_status = 'PENDING'; orderState.transaction_id = null; }
    return jsonResponse({ success: true, order_reference: body.p_order_reference,
      attempt_reference: currentAttemptReference, amount_in_cents: Math.round(Number(quoteFixture.total) * 100),
      currency: 'COP', environment: 'prod', status: 'INITIATED' });
  }
  if (url.pathname === '/rest/v1/orders' && method === 'POST') {
    throw new Error('El checkout no debe hacer INSERT directo en public.orders.');
  }
  throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

activeHandler = 'checkout';
await import(new URL('../supabase/functions/wompi-create-checkout/index.ts', import.meta.url).href);
assert.equal(typeof handlers.checkout, 'function');

const productId = '11111111-1111-4111-8111-111111111111';
const couponId = '22222222-2222-4222-8222-222222222222';
const couponCode = 'PRUEBA10';
quoteFixture = {
  success: true,
  currency: 'COP',
  original_subtotal: 60000,
  discount_total: 6000,
  discounted_subtotal: 54000,
  shipping: 15000,
  total: 69000,
  coupon_id: couponId,
  coupon_code: couponCode,
  coupon_discount_total: 6000,
  items: [{
    id: productId,
    qty: 1,
    color: 'Negro',
    size: 'M',
    price: 60000,
    original_subtotal: 60000,
    discount_total: 6000,
    net_subtotal: 54000,
    coupon_discount_total: 6000,
  }],
};
const baseBody = {
  reference: 'SIREVYA-SYNTHETIC-CHECKOUT-001',
  environment: 'prod',
  items: [{ id: productId, qty: 1, color: 'Negro', size: 'M' }],
  city: 'Ciudad de prueba',
  name: 'Comprador sintético',
  cedula: 'TEST-DOCUMENTO-001',
  cedula_type: 'CC',
  phone: '3000000000',
  email: 'buyer@example.test',
  address: 'Calle de prueba 123',
  neighborhood: 'Barrio sintético',
  coupon_code: 'prueba10',
  expected_total: 69000,
  expected_discount_total: 6000,
  expected_coupon_discount_total: 6000,
};
function canonicalTestCart(items) {
  return JSON.stringify(items.map(item => ({
    id: String(item.id ?? item.product_id ?? '').trim().toLowerCase(),
    qty: Math.floor(Number(item.qty ?? item.quantity ?? 0)),
    color: String(item.color ?? '').trim().toLowerCase(),
    size: String(item.size ?? '').trim().toLowerCase(),
  })).sort((a, b) => a.id.localeCompare(b.id) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size) || a.qty - b.qty));
}
function setVerifiedTerminalFixture(order, { statuses = ['ERROR', 'ERROR'], ageMinutes = 60 } = {}) {
  activeReservationFixture = [];
  const phone = String(order.phone || '').replace(/\D/g, '').slice(-10);
  const cart = canonicalTestCart(order.items);
  const phoneHash = createHash('sha256').update(phone).digest('hex');
  const cartHash = createHash('sha256').update(cart).digest('hex');
  const baseTerminalTime = Date.now() - ageMinutes * 60 * 1000;
  terminalAttemptsFixture = statuses.map((status, index) => ({
    order_reference: order.reference,
    attempt_number: index + 1,
    attempt_reference: `SW-${String.fromCharCode(65 + index).repeat(32)}`,
    environment: 'prod',
    currency: 'COP',
    amount_in_cents: Math.round(Number(order.total) * 100),
    status,
    transaction_id: `TX-SYNTHETIC-TERMINAL-${index + 1}`,
    terminal_at: new Date(baseTerminalTime - (statuses.length - index - 1) * 60_000).toISOString(),
  }));
  const latest = terminalAttemptsFixture.at(-1);
  order.payment_status = String(latest.status).toUpperCase();
  order.transaction_id = latest.transaction_id;
  order.wompi_reconciliation_required = false;
  order.coupon_reconciliation_required = false;
  terminalLockFixture = {
    reference: order.reference,
    status: 'released',
    transaction_id: latest.transaction_id,
    terminal_at: latest.terminal_at,
    reconciliation_required: false,
    customer_phone_hash: phoneHash,
    cart_hash: cartHash,
  };
}
function request(body) {
  return new Request('https://edge.invalid/wompi-create-checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Cross-environment checkout must fail before Supabase, reservations, or orders.
mockCalls = [];
const environmentMismatch = await handlers.checkout(request({ ...baseBody, environment: 'test' }));
assert.equal(environmentMismatch.status, 409);
assert.equal((await environmentMismatch.json()).code, 'WOMPI_ENVIRONMENT_MISMATCH');
assert.equal(mockCalls.length, 0, 'environment mismatch must stop before any Supabase RPC or order query');
assert.equal(capturedOrderInserts.length, 0, 'environment mismatch must not create a pending order');

// A stale client total must stop before lock, reservation, or order creation.
mockCalls = [];
const mismatch = await handlers.checkout(request({ ...baseBody, expected_total: 69001 }));
assert.equal(mismatch.status, 409);
const mismatchBody = await mismatch.json();
assert.equal(mismatchBody.code, 'WOMPI_QUOTE_CHANGED');
assert.equal(mismatchBody.total, 69000);
assert.equal(mismatchBody.shipping, 15000);
assert.equal(mismatchBody.quote, undefined, 'the currently deployed v41 returns only the 409 summary; the storefront must safely refresh the quote');
assert.equal(mockCalls.length, 2, 'only payment status and authoritative server quote may be read before rejecting a changed quote');
assert.deepEqual(mockCalls.map(call => call.path), [
  '/rest/v1/rpc/get_online_payment_status',
  '/rest/v1/rpc/get_storefront_cart_quote_with_coupon',
]);
assert.equal(capturedOrderInserts.length, 0);

// A change between the Edge quote and its atomic preparation must return the
// prepared authoritative quote and stop before order/attempt insertion.
preparationFixture = {
  success: false,
  code: 'WOMPI_QUOTE_CHANGED',
  message: 'Cotización sintética cambió durante la preparación.',
  quote: { ...structuredClone(quoteFixture), shipping: 16000, total: 70000 },
  shipping: 16000,
  total: 70000,
  discount_total: 6000,
  coupon_discount_total: 6000,
};
mockCalls = [];
const atomicMismatch = await handlers.checkout(request({ ...baseBody, reference: 'SIREVYA-SYNTHETIC-ATOMIC-QUOTE-CHANGE' }));
assert.equal(atomicMismatch.status, 409);
const atomicMismatchBody = await atomicMismatch.json();
assert.equal(atomicMismatchBody.code, 'WOMPI_QUOTE_CHANGED');
assert.equal(atomicMismatchBody.total, 70000);
assert.equal(atomicMismatchBody.shipping, 16000);
assert.equal(atomicMismatchBody.quote, undefined, 'atomic 409s from v41 likewise require a read-only client quote refresh');
assert.equal(capturedOrderInserts.length, 0, 'atomic quote changes must not create an order');
assert.equal(beginAttemptCalls.length, 0, 'atomic quote changes must not start a payment attempt');
assert.ok(!mockCalls.some(call => call.path === '/rest/v1/rpc/create_storefront_wompi_pending_order'));
assert.ok(!mockCalls.some(call => call.path === '/rest/v1/rpc/begin_storefront_wompi_payment_attempt'));
preparationFixture = null;

// A synthetic accepted quote may prepare a pending order entirely inside the fetch mock.
// It verifies coupon + shipping + amount/signature consistency, never contacts Wompi or production.
mockCalls = [];
const accepted = await handlers.checkout(request(baseBody));
assert.equal(accepted.status, 200);
const paymentIntent = await accepted.json();
assert.equal(paymentIntent.environment, 'prod');
assert.equal(paymentIntent.reference, baseBody.reference);
assert.equal(paymentIntent.attemptReference, attemptReferences[0]);
assert.equal(paymentIntent.currency, 'COP');
assert.equal(paymentIntent.subtotal, 60000);
assert.equal(paymentIntent.discountTotal, 6000);
assert.equal(paymentIntent.couponDiscountTotal, 6000);
assert.equal(paymentIntent.shipping, 15000);
assert.equal(paymentIntent.total, 69000);
assert.equal(paymentIntent.amountInCents, 6900000);
const expectedSignature = createHash('sha256')
  .update(`${attemptReferences[0]}6900000COP${paymentIntent.expirationTime}${env.WOMPI_INTEGRITY_SECRET}`)
  .digest('hex');
assert.equal(paymentIntent.signature, expectedSignature);
assert.notEqual(paymentIntent.signature, createHash('sha256')
  .update(`${attemptReferences[0]}6900000COP${paymentIntent.expirationTime}${env.WOMPI_INTEGRITY_SECRET_TEST}`)
  .digest('hex'), 'the TEST integrity key must not sign a production checkout');
assert.equal(capturedOrderInserts.length, 1);
const inserted = capturedOrderInserts[0];
assert.equal(inserted.p_reference, baseBody.reference);
assert.equal(inserted.p_subtotal, 60000);
assert.equal(inserted.p_shipping, 15000);
assert.equal(inserted.p_total, 69000);
assert.equal(inserted.p_coupon_id, couponId);
assert.equal(inserted.p_coupon_code, couponCode);
assert.equal(inserted.p_coupon_discount_total, 6000);
assert.equal(Object.hasOwn(inserted, 'cedula'), false, 'document must not be copied into the Wompi order payload by this path');
assert.equal(Object.hasOwn(inserted, 'customer_cedula'), false, 'document must not be copied into the Wompi order payload by this path');
assert.equal(JSON.stringify(paymentIntent).includes('TEST-DOCUMENTO-001'), false, 'payment intent response must not return the identity document');
assert.ok(mockCalls.every(call => new URL(call.url).origin === env.SUPABASE_URL));
assert.ok(!mockCalls.some(call => new URL(call.url).hostname.endsWith('wompi.co')), 'the harness must not call Wompi or create a charge');
assert.ok(mockCalls.some(call => call.path === '/rest/v1/rpc/prepare_storefront_wompi_checkout' && call.body.p_coupon_code === couponCode));
assert.ok(mockCalls.some(call => call.path === '/rest/v1/rpc/prepare_storefront_wompi_checkout' && call.body.p_expected_quote.total === 69000));
assert.ok(mockCalls.some(call => call.path === '/rest/v1/rpc/prepare_storefront_wompi_retry_lock'));
assert.ok(mockCalls.some(call => call.path === '/rest/v1/rpc/begin_storefront_wompi_payment_attempt' &&
  call.body.p_order_reference === baseBody.reference && call.body.p_expected_quote.total === 69000 &&
  call.body.p_customer_phone === baseBody.phone && call.body.p_is_new_order === true));

// A verified terminal order can be found from a newly generated browser reference,
// then resumed with its original stable order/reservation reference after cooldown.
setVerifiedTerminalFixture(orderState);
const terminalOrderSnapshot = structuredClone(orderState);
terminalOrderAvailableForRetry = true;
pendingRowsFixture = Array.from({ length: 6 }, (_, i) => ({
  reference: `JMRES-SYNTHETIC-LEGACY-${i + 1}`,
  payment_status: 'PENDING',
  transaction_id: i === 0 ? 'TX-SYNTHETIC-OTHER-CART-PENDING' : null,
  created_at: '2026-10-19T02:13:04.634455Z',
  items: [{ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, '0')}`, qty: 1, color: 'Azul', size: 'S' }],
}));
mockCalls = [];
const discovery = await handlers.checkout(request({ ...baseBody, reference: 'JMRES-SYNTHETIC-NEW-BROWSER-REF' }));
assert.equal(discovery.status, 409);
const discoveryBody = await discovery.json();
assert.equal(discoveryBody.code, 'WOMPI_REUSE_EXISTING_ORDER');
assert.equal(discoveryBody.existingReference, baseBody.reference);
assert.equal(beginAttemptCalls.length, 1, 'discovery must not create an attempt until the stable order reference is reused');
assert.equal(capturedOrderInserts.length, 1, 'discovery must not create a duplicate order');
assert.ok(mockCalls.some(call => call.path === '/rest/v1/rpc/prepare_storefront_wompi_retry_lock'),
  'unrelated legacy PENDING carts must not stop lookup of the same verified recoverable order');

// Unknown pending attempts for the exact same cart remain blocked, including after the old TTL.
pendingRowsFixture = [{
  reference: 'JMRES-SYNTHETIC-UNKNOWN-SAME-CART',
  payment_status: 'PENDING',
  transaction_id: null,
  created_at: '2026-10-19T02:13:04.634455Z',
  items: [{ id: productId, qty: 1, color: 'Negro', size: 'M' }],
}];
mockCalls = [];
const sameCartUnlinked = await handlers.checkout(request({ ...baseBody, reference: 'JMRES-SYNTHETIC-NEW-BROWSER-REF' }));
assert.equal(sameCartUnlinked.status, 409);
assert.equal((await sameCartUnlinked.json()).code, 'WOMPI_ATTEMPT_UNVERIFIED');
assert.ok(!mockCalls.some(call => call.path === '/rest/v1/rpc/prepare_storefront_wompi_retry_lock'),
  'same-cart unlinked legacy attempts must fail closed until reconciled');

pendingRowsFixture[0].transaction_id = 'TX-SYNTHETIC-SAME-CART-PENDING';
mockCalls = [];
const sameCartLinked = await handlers.checkout(request({ ...baseBody, reference: 'JMRES-SYNTHETIC-NEW-BROWSER-REF' }));
assert.equal(sameCartLinked.status, 409);
assert.equal((await sameCartLinked.json()).code, 'WOMPI_TRANSACTION_PENDING');
assert.ok(!mockCalls.some(call => call.path === '/rest/v1/rpc/prepare_storefront_wompi_retry_lock'),
  'same-cart linked PENDING transactions must not start another payment');

pendingRowsFixture = [];
mockCalls = [];
const retry = await handlers.checkout(request({ ...baseBody, reference: baseBody.reference }));
assert.equal(retry.status, 200);
const retryIntent = await retry.json();
assert.equal(retryIntent.reference, baseBody.reference, 'a retry reuses the stable order and inventory reference');
assert.equal(retryIntent.attemptReference, attemptReferences[1], 'a retry receives a new, unique Wompi reference');
assert.notEqual(retryIntent.attemptReference, paymentIntent.attemptReference);
assert.equal(capturedOrderInserts.length, 1, 'retry must not insert another order');
assert.equal(beginAttemptCalls.length, 2, 'retry inserts exactly one new attempt row');
assert.equal(beginAttemptCalls[1].p_is_new_order, false);
assert.equal(beginAttemptCalls[1].p_order_reference, baseBody.reference);
assert.ok(!mockCalls.some(call => call.path === '/rest/v1/rpc/reserve_storefront_wompi_checkout_lock'),
  'retry reactivates the existing lock instead of creating a second checkout lock');
const retrySignature = createHash('sha256')
  .update(`${attemptReferences[1]}6900000COP${retryIntent.expirationTime}${env.WOMPI_INTEGRITY_SECRET}`)
  .digest('hex');
assert.equal(retryIntent.signature, retrySignature);
assert.equal(orderState.payment_status, 'PENDING');
assert.equal(orderState.transaction_id, null);

mockCalls = [];
const unresolvedRetry = await handlers.checkout(request({ ...baseBody, reference: baseBody.reference }));
assert.equal(unresolvedRetry.status, 409);
assert.equal((await unresolvedRetry.json()).code, 'WOMPI_UNRESOLVED_RESERVATION');
assert.equal(capturedOrderInserts.length, 1, 'an unlinked retry remains blocked rather than creating a second order');
assert.equal(beginAttemptCalls.length, 2, 'an unresolved attempt cannot start another Wompi session');
assert.ok(!mockCalls.some(call => call.path === '/rest/v1/rpc/reserve_storefront_wompi_checkout_lock'),
  'unresolved attempts never acquire a second lock');

// A terminal order with the same cart/price but a different delivery address must
// stop read-only, show the server quote, and require a second explicit confirmation.
orderState = structuredClone(terminalOrderSnapshot);
terminalOrderAvailableForRetry = true;
pendingRowsFixture = [];
const separateAddress = 'Avenida 9 # 8-7, Apto 301';
const mutations = new Set([
  '/rest/v1/rpc/reserve_storefront_wompi_checkout_lock',
  '/rest/v1/rpc/prepare_storefront_wompi_checkout',
  '/rest/v1/rpc/claim_storefront_wompi_checkout',
  '/rest/v1/rpc/create_storefront_wompi_pending_order',
  '/rest/v1/rpc/begin_storefront_wompi_payment_attempt',
]);
mockCalls = [];
const mismatchPrompt = await handlers.checkout(request({ ...baseBody, reference: baseBody.reference, address: separateAddress }));
assert.equal(mismatchPrompt.status, 409);
const mismatchPromptBody = await mismatchPrompt.json();
assert.equal(mismatchPromptBody.code, 'WOMPI_NEW_ORDER_CONFIRMATION_REQUIRED');
assert.equal(mismatchPromptBody.existingReference, baseBody.reference);
assert.equal(mismatchPromptBody.quote.total, 69000);
assert.ok(!mockCalls.some(call => mutations.has(call.path)), 'mismatch prompt must not reserve inventory, insert an order, or start an attempt');
assert.equal(capturedOrderInserts.length, 1);
assert.equal(beginAttemptCalls.length, 2);

setVerifiedTerminalFixture(orderState);
activeReservationFixture = [{
  reference: baseBody.reference,
  status: 'active',
  expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
}];
mockCalls = [];
const activeOldHold = await handlers.checkout(request({
  ...baseBody, reference: baseBody.reference, address: separateAddress,
  confirm_new_order_after_terminal_mismatch: true,
  supersedes_reference: baseBody.reference,
}));
assert.equal(activeOldHold.status, 409);
assert.equal((await activeOldHold.json()).code, 'WOMPI_UNRESOLVED_RESERVATION');
assert.ok(!mockCalls.some(call => mutations.has(call.path)), 'an unexpired old hold must prevent any second reservation or order');

setVerifiedTerminalFixture(orderState);
activeReservationFixture = [{
  reference: baseBody.reference,
  status: 'converted',
  expires_at: new Date(Date.now() - 60_000).toISOString(),
}];
mockCalls = [];
const convertedOldHold = await handlers.checkout(request({ ...baseBody, reference: baseBody.reference, address: separateAddress }));
assert.equal(convertedOldHold.status, 409);
assert.equal((await convertedOldHold.json()).code, 'WOMPI_UNRESOLVED_RESERVATION');
assert.ok(!mockCalls.some(call => mutations.has(call.path)), 'a converted old hold must never permit duplicate inventory deduction');

// Even if the order row says ERROR, any pending/approved historical ledger item or
// an unexpired terminal grace keeps the new-order path fail-closed.
for (const unverifiedStatus of ['PENDING', 'APPROVED']) {
  setVerifiedTerminalFixture(orderState, { statuses: [unverifiedStatus, 'ERROR'] });
  mockCalls = [];
  const blocked = await handlers.checkout(request({ ...baseBody, reference: baseBody.reference, address: separateAddress }));
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, 'WOMPI_ATTEMPT_UNVERIFIED');
  assert.ok(!mockCalls.some(call => mutations.has(call.path)));
}
setVerifiedTerminalFixture(orderState, { ageMinutes: 5 });
mockCalls = [];
const graceBlocked = await handlers.checkout(request({ ...baseBody, reference: baseBody.reference, address: separateAddress }));
assert.equal(graceBlocked.status, 409);
assert.equal((await graceBlocked.json()).code, 'WOMPI_ATTEMPT_UNVERIFIED');
assert.ok(!mockCalls.some(call => mutations.has(call.path)));

// After restoring two old ERROR attempts beyond 15 minutes, the user-confirmed
// separate purchase uses a client-persisted fresh reference; the old order remains untouched.
setVerifiedTerminalFixture(orderState);
const immutableOldOrder = structuredClone(orderState);
const separateReference = 'JMRES-SYNTHETIC-SEPARATE-ORDER';
mockCalls = [];
const separateOrderResponse = await handlers.checkout(request({
  ...baseBody,
  reference: separateReference,
  address: separateAddress,
  confirm_new_order_after_terminal_mismatch: true,
  supersedes_reference: baseBody.reference,
}));
assert.equal(separateOrderResponse.status, 200);
const separateIntent = await separateOrderResponse.json();
assert.equal(separateIntent.reference, separateReference);
assert.equal(separateIntent.newOrderAfterTerminalMismatch, true);
assert.equal(capturedOrderInserts.length, 2, 'a separate confirmed purchase creates exactly one new order');
assert.equal(capturedOrderInserts[1].p_reference, separateReference);
assert.equal(capturedOrderInserts[1].p_address, separateAddress);
assert.equal(beginAttemptCalls.length, 3, 'the separate order starts exactly one attempt');
assert.equal(beginAttemptCalls[2].p_is_new_order, true);
assert.equal(beginAttemptCalls[2].p_order_reference, separateReference);
assert.equal(immutableOldOrder.payment_status, 'ERROR');
assert.equal(immutableOldOrder.transaction_id, terminalOrderSnapshot.transaction_id);
assert.ok(!mockCalls.some(call => call.path === '/rest/v1/orders' && ['POST', 'PATCH', 'DELETE'].includes(call.method)),
  'the previous order is never modified directly');
assert.equal(mockCalls.filter(call => call.path === '/rest/v1/rpc/reserve_storefront_wompi_checkout_lock').length, 1,
  'the confirmed new order takes one lock only');
assert.ok(!mockCalls.some(call => new URL(call.url).hostname.endsWith('wompi.co')),
  'the synthetic regression never opens Wompi or creates a payment');

// COR-038/Cali: production read-only quote was COP 2,000 with free shipping;
// this fully synthetic in-memory RPC fixture verifies the same contract without a real order/hold/payment.
const cor038Id = 'a4ab0f59-493b-4937-a34d-9242fbc6f8c4';
quoteFixture = {
  success: true,
  currency: 'COP',
  original_subtotal: 2000,
  discount_total: 0,
  discounted_subtotal: 2000,
  shipping: 0,
  total: 2000,
  coupon_id: null,
  coupon_code: null,
  coupon_discount_total: 0,
  destination_status: 'cali_free',
  items: [{ id: cor038Id, code: 'COR-038', name: 'Producto sintético COR-038', qty: 1,
    color: '', size: '', price: 2000, original_subtotal: 2000, discount_total: 0,
    net_subtotal: 2000, coupon_discount_total: 0 }],
};
orderState = null;
pendingRowsFixture = [];
terminalOrderAvailableForRetry = false;
terminalAttemptsFixture = [];
terminalLockFixture = null;
mockCalls = [];
const cor038Body = {
  ...baseBody,
  reference: 'SIREVYA-SYNTHETIC-COR-038-CALI',
  items: [{ id: cor038Id, qty: 1, color: '', size: '' }],
  city: 'Cali',
  coupon_code: '',
  expected_total: 2000,
  expected_discount_total: 0,
  expected_coupon_discount_total: 0,
};
const cor038Response = await handlers.checkout(request(cor038Body));
assert.equal(cor038Response.status, 200);
const cor038Intent = await cor038Response.json();
assert.equal(cor038Intent.subtotal, 2000);
assert.equal(cor038Intent.discountTotal, 0);
assert.equal(cor038Intent.couponDiscountTotal, 0);
assert.equal(cor038Intent.shipping, 0);
assert.equal(cor038Intent.total, 2000);
assert.equal(cor038Intent.amountInCents, 200000);
assert.equal(cor038Intent.currency, 'COP');
assert.equal(cor038Intent.attemptReference, attemptReferences[3]);
assert.ok(mockCalls.some(call => call.path === '/rest/v1/rpc/prepare_storefront_wompi_checkout' &&
  call.body.p_city === 'Cali' && call.body.p_expected_quote.total === 2000 && call.body.p_expected_quote.shipping === 0));
assert.ok(!mockCalls.some(call => new URL(call.url).hostname.endsWith('wompi.co')),
  'the COR-038 regression must not open Wompi or create a charge');

// Reproduce the reported old-order mismatch with COR-038/Cali: the product,
// amount, free shipping and city match, while identity/delivery fields differ.
const oldCor038Reference = 'JMRES-SYNTHETIC-COR-038-OLD';
const oldCor038Order = {
  reference: oldCor038Reference,
  created_at: '2026-11-14T00:00:00.000Z',
  payment_method: 'wompi',
  payment_status: 'ERROR',
  transaction_id: 'TX-SYNTHETIC-COR-038-OLD-2',
  customer_name: 'Comprador Anterior',
  phone: '3000000001',
  city: 'Cali',
  address: 'Calle Antigua 1',
  neighborhood: 'Centro anterior',
  items: structuredClone(quoteFixture.items),
  subtotal: 2000,
  shipping: 0,
  total: 2000,
  coupon_id: null,
  coupon_code: null,
  coupon_discount_total: 0,
  wompi_reconciliation_required: false,
  coupon_reconciliation_required: false,
};
setVerifiedTerminalFixture(oldCor038Order);
orderState = oldCor038Order;
terminalOrderAvailableForRetry = true;
pendingRowsFixture = [];
mockCalls = [];
const cor038Mismatch = await handlers.checkout(request({ ...cor038Body, reference: 'JMRES-SYNTHETIC-COR-038-NEW-BROWSER' }));
assert.equal(cor038Mismatch.status, 409);
const cor038MismatchBody = await cor038Mismatch.json();
assert.equal(cor038MismatchBody.code, 'WOMPI_NEW_ORDER_CONFIRMATION_REQUIRED');
assert.equal(cor038MismatchBody.existingReference, oldCor038Reference);
assert.equal(cor038MismatchBody.quote.total, 2000);
assert.equal(cor038MismatchBody.quote.shipping, 0);
assert.ok(!mockCalls.some(call => mutations.has(call.path)), 'COR-038 mismatch must not create a reservation/order/attempt before confirmation');

mockCalls = [];
const cor038Confirmed = await handlers.checkout(request({
  ...cor038Body,
  reference: 'JMRES-SYNTHETIC-COR-038-SEPARATE',
  confirm_new_order_after_terminal_mismatch: true,
  supersedes_reference: oldCor038Reference,
}));
assert.equal(cor038Confirmed.status, 200);
const cor038SeparateIntent = await cor038Confirmed.json();
assert.equal(cor038SeparateIntent.reference, 'JMRES-SYNTHETIC-COR-038-SEPARATE');
assert.equal(cor038SeparateIntent.newOrderAfterTerminalMismatch, true);
assert.equal(cor038SeparateIntent.total, 2000);
assert.equal(cor038SeparateIntent.shipping, 0);
assert.equal(cor038SeparateIntent.amountInCents, 200000);
assert.equal(capturedOrderInserts[3].p_reference, 'JMRES-SYNTHETIC-COR-038-SEPARATE');
assert.equal(beginAttemptCalls[4].p_order_reference, 'JMRES-SYNTHETIC-COR-038-SEPARATE');
assert.equal(oldCor038Order.payment_status, 'ERROR', 'the historical order remains terminal and unchanged');
assert.ok(!mockCalls.some(call => new URL(call.url).hostname.endsWith('wompi.co')),
  'the confirmed COR-038 fixture still never opens Wompi or creates a charge');
console.log('PASS Wompi checkout integration: COR-038/Cali COP 2,000, $0 shipping; exact same-snapshot retry reuses the order; different identity/address requires a second confirmation and a new reference; PENDING/APPROVED history and 15-minute grace block; no external calls or real payments.');
