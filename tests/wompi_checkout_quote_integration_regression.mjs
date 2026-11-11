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
  WOMPI_ENVIRONMENT: 'test',
  WOMPI_INTEGRITY_SECRET_TEST: 'synthetic-integrity-secret',
};
const handlers = {};
let activeHandler = '';
let quoteFixture;
let mockCalls = [];
const capturedOrderInserts = [];
const expirationTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

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
  if (url.pathname === '/rest/v1/orders' && method === 'GET') return jsonResponse([]);
  if (url.pathname === '/rest/v1/rpc/list_pending_wompi_orders_for_phone') {
    return jsonResponse({ success: true, orders: [] });
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
  if (url.pathname === '/rest/v1/orders' && method === 'POST') {
    capturedOrderInserts.push(body);
    return new Response(null, { status: 201 });
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
assert.equal(paymentIntent.reference, baseBody.reference);
assert.equal(paymentIntent.currency, 'COP');
assert.equal(paymentIntent.subtotal, 60000);
assert.equal(paymentIntent.discountTotal, 6000);
assert.equal(paymentIntent.couponDiscountTotal, 6000);
assert.equal(paymentIntent.shipping, 15000);
assert.equal(paymentIntent.total, 69000);
assert.equal(paymentIntent.amountInCents, 6900000);
const expectedSignature = createHash('sha256')
  .update(`${baseBody.reference}6900000COP${paymentIntent.expirationTime}${env.WOMPI_INTEGRITY_SECRET_TEST}`)
  .digest('hex');
assert.equal(paymentIntent.signature, expectedSignature);
assert.equal(capturedOrderInserts.length, 1);
const inserted = capturedOrderInserts[0];
assert.equal(inserted.payment_method, 'wompi');
assert.equal(inserted.payment_status, 'PENDING');
assert.equal(inserted.subtotal, 60000);
assert.equal(inserted.shipping, 15000);
assert.equal(inserted.total, 69000);
assert.equal(inserted.coupon_id, couponId);
assert.equal(inserted.coupon_code, couponCode);
assert.equal(inserted.coupon_discount_total, 6000);
assert.equal(Object.hasOwn(inserted, 'cedula'), false, 'document must not be copied into the Wompi order payload by this path');
assert.equal(Object.hasOwn(inserted, 'customer_cedula'), false, 'document must not be copied into the Wompi order payload by this path');
assert.equal(JSON.stringify(paymentIntent).includes('TEST-DOCUMENTO-001'), false, 'payment intent response must not return the identity document');
assert.ok(mockCalls.every(call => new URL(call.url).origin === env.SUPABASE_URL));
assert.ok(!mockCalls.some(call => new URL(call.url).hostname.endsWith('wompi.co')), 'the harness must not call Wompi or create a charge');
assert.ok(mockCalls.some(call => call.path === '/rest/v1/rpc/prepare_storefront_wompi_checkout' && call.body.p_coupon_code === couponCode));
assert.ok(mockCalls.some(call => call.path === '/rest/v1/rpc/prepare_storefront_wompi_checkout' && call.body.p_expected_quote.total === 69000));
console.log('PASS Wompi quote integration mock: stale totals fail before locks/orders; accepted synthetic coupon+shipping quote yields matching pending-order amount and signature; no external network or real payment.');
