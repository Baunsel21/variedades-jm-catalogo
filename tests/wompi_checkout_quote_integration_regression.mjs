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
let mockCalls = [];
const capturedOrderInserts = [];
const expirationTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const attemptReferences = [
  'SW-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'SW-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
];
let attemptNumber = 0;
let orderState = null;
let terminalOrderAvailableForRetry = false;
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
  if (url.pathname === '/rest/v1/rpc/list_pending_wompi_orders_for_phone') {
    return jsonResponse({ success: true, orders: [] });
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
    };
    return jsonResponse({ success: true, order_id: '33333333-3333-4333-8333-333333333333', reference: body.p_reference });
  }
  if (url.pathname === '/rest/v1/rpc/begin_storefront_wompi_payment_attempt' && method === 'POST') {
    beginAttemptCalls.push(body);
    const currentAttemptReference = attemptReferences[attemptNumber++];
    if (orderState) { orderState.payment_status = 'PENDING'; orderState.transaction_id = null; }
    return jsonResponse({ success: true, order_reference: body.p_order_reference,
      attempt_reference: currentAttemptReference, amount_in_cents: 6900000,
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
assert.equal(mockCalls.length, 2, 'only payment status and authoritative server quote may be read before rejecting a changed quote');
assert.deepEqual(mockCalls.map(call => call.path), [
  '/rest/v1/rpc/get_online_payment_status',
  '/rest/v1/rpc/get_storefront_cart_quote_with_coupon',
]);
assert.equal(capturedOrderInserts.length, 0);

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
orderState.payment_status = 'ERROR';
orderState.transaction_id = 'TX-SYNTHETIC-OLD';
terminalOrderAvailableForRetry = true;
mockCalls = [];
const discovery = await handlers.checkout(request({ ...baseBody, reference: 'JMRES-SYNTHETIC-NEW-BROWSER-REF' }));
assert.equal(discovery.status, 409);
const discoveryBody = await discovery.json();
assert.equal(discoveryBody.code, 'WOMPI_REUSE_EXISTING_ORDER');
assert.equal(discoveryBody.existingReference, baseBody.reference);
assert.equal(beginAttemptCalls.length, 1, 'discovery must not create an attempt until the stable order reference is reused');
assert.equal(capturedOrderInserts.length, 1, 'discovery must not create a duplicate order');

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
console.log('PASS Wompi quote integration mock: cross-environment requests fail before RPC/order creation; production handler ignores the global TEST environment and signs with the production key; no external network or real payment.');
