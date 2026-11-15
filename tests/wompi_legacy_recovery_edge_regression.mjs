import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 6)) {
  console.log('SKIP Wompi legacy recovery Edge regression: Node 22.6+ required.');
  process.exit(0);
}
if (process.env.SIREVYA_WOMPI_LEGACY_EDGE_CHILD !== '1') {
  const child = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', fileURLToPath(import.meta.url), '--child'], {
    encoding: 'utf8', env: { ...process.env, SIREVYA_WOMPI_LEGACY_EDGE_CHILD: '1' },
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(child.stderr || child.stdout || `child exited ${child.status}`);
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  process.exit(0);
}

const env = {
  SUPABASE_URL: 'https://supabase.invalid',
  SUPABASE_ANON_KEY: 'synthetic-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
  WOMPI_PRIVATE_KEY: 'synthetic-prod-private-key',
  WOMPI_ENVIRONMENT: 'test', // must be ignored by this production-only recovery.
};
let handler;
let scenario;
const requests = [];
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const now = Date.now();
const ids = ['TX-LEGACY-EDGE-001', 'TX-LEGACY-EDGE-002'];
const reference = 'JMRES-LEGACY-EDGE-SYNTHETIC-001';
const productId = '11111111-1111-4111-8111-111111111111';

function reset({ status = 'ERROR', amount = 1500000, currency = 'COP', transactionReference = reference,
  finalizedOffset = 17 * 60_000, admin = true, couponCode = '' } = {}) {
  scenario = { status, amount, currency, transactionReference, finalizedOffset, admin, couponCode, recoveryCalls: 0, wompiCalls: 0 };
  requests.length = 0;
}

globalThis.Deno = {
  env: { get: (name) => env[name] ?? null },
  serve: (fn) => { handler = fn; },
};
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : null;
  requests.push({ url, method, body, headers: new Headers(init.headers) });
  if (url.origin === 'https://production.wompi.co') {
    scenario.wompiCalls++;
    assert.equal(method, 'GET', 'recovery must only read existing Wompi transactions');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-prod-private-key');
    assert.equal(url.pathname.startsWith('/v1/transactions/'), true);
    const index = url.pathname.endsWith(encodeURIComponent(ids[0])) ? 0 : 1;
    return response({ data: {
      id: ids[index], reference: scenario.transactionReference, amount_in_cents: scenario.amount, currency: scenario.currency, status: scenario.status,
      finalized_at: new Date(now - scenario.finalizedOffset - (1 - index) * 60_000).toISOString(),
      customer_email: scenario.couponCode ? 'buyer@example.test' : null,
    } });
  }
  if (url.origin !== env.SUPABASE_URL) throw new Error(`Blocked unexpected origin ${url.origin}`);
  if (url.pathname === '/auth/v1/user') return response({ id: 'synthetic-admin-uuid' });
  if (url.pathname === '/rest/v1/rpc/is_store_admin') return response(scenario.admin);
  if (url.pathname === '/rest/v1/orders' && method === 'GET') return response([{
    reference, total: 15000, payment_method: 'wompi', payment_status: 'PENDING', transaction_id: null,
    phone: '3001111001', coupon_code: scenario.couponCode, coupon_id: scenario.couponCode ? '22222222-2222-4222-8222-222222222222' : null,
    coupon_discount_total: scenario.couponCode ? 5000 : 0, subtotal: 10000, shipping: 5000,
    items: [{ id: productId, qty: 1, color: 'Negro', size: 'M', price: 10000 }], city: 'Ciudad Scratch',
    wompi_reconciliation_required: false, coupon_reconciliation_required: false,
  }]);
  if (url.pathname === '/rest/v1/rpc/recover_storefront_wompi_legacy_order' && method === 'POST') {
    scenario.recoveryCalls++;
    return response({ success: true, order_reused: true, legacy_attempts_registered: 2,
      reservation_expires_at: new Date(now + 10 * 60_000).toISOString(), payment_started: false, order_created: false });
  }
  throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
};

await import(new URL('../supabase/functions/admin-wompi-legacy-recovery/index.ts', import.meta.url).href);
assert.equal(typeof handler, 'function');
function makeRequest() {
  return new Request('https://edge.invalid/admin-wompi-legacy-recovery', {
    method: 'POST',
    headers: { origin: 'https://sirevya.com.co', authorization: 'Bearer synthetic.access.token.with.sufficient.length', 'content-type': 'application/json' },
    body: JSON.stringify({ reference, transaction_ids: ids }),
  });
}

reset();
let result = await handler(makeRequest());
assert.equal(result.status, 200);
let payload = await result.json();
assert.equal(payload.success, true);
assert.equal(payload.orderReused, true);
assert.equal(payload.paymentStarted, false);
assert.equal(payload.orderCreated, false);
assert.equal(scenario.wompiCalls, 2);
assert.equal(scenario.recoveryCalls, 1);
assert.ok(requests.filter((r) => r.url.origin === 'https://production.wompi.co').every((r) => r.method === 'GET'));
const recoveryCall = requests.find((r) => r.url.pathname === '/rest/v1/rpc/recover_storefront_wompi_legacy_order');
assert.equal(recoveryCall.body.p_verified_attempts.length, 2);
assert.ok(recoveryCall.body.p_verified_attempts.every((a) => a.status === 'ERROR' && a.environment === 'prod' && a.currency === 'COP'));
assert.equal(recoveryCall.body.p_customer_email, '', 'no coupon means no email reaches the recovery RPC');
assert.equal(JSON.stringify(payload).includes('buyer@example.test'), false, 'response must not expose PII');
assert.equal(requests.some((r) => r.url.pathname.includes('/transactions') && r.method !== 'GET'), false);

for (const invalid of [
  { status: 'PENDING' },
  { status: 'APPROVED' },
  { amount: 1499900 },
  { currency: 'USD' },
  { transactionReference: 'JMRES-OTHER-SYNTHETIC-REF' },
  { finalizedOffset: 5 * 60_000 },
]) {
  reset(invalid);
  result = await handler(makeRequest());
  assert.equal(result.status, 409, `invalid Wompi evidence must fail closed: ${JSON.stringify(invalid)}`);
  assert.equal(scenario.recoveryCalls, 0, 'no DB recovery call for invalid transaction evidence');
}
reset();
result = await handler(new Request('https://edge.invalid/admin-wompi-legacy-recovery', {
  method: 'POST', headers: { origin: 'https://sirevya.com.co', authorization: 'Bearer synthetic.access.token.with.sufficient.length', 'content-type': 'application/json' },
  body: JSON.stringify({ reference, transaction_ids: [ids[0], ids[0]] }),
}));
assert.equal(result.status, 400);
assert.equal(scenario.wompiCalls, 0);
assert.equal(scenario.recoveryCalls, 0);
reset({ admin: false });
result = await handler(makeRequest());
assert.equal(result.status, 403);
assert.equal(scenario.wompiCalls, 0, 'non-admin must not query Wompi or reach recovery');
assert.equal(scenario.recoveryCalls, 0);

console.log('PASS Wompi legacy recovery Edge regression: admin-only, production GET-only verification, matching reference/COP amount/status/15-minute grace, one atomic recovery RPC, no payment start, fail-closed pending/approved/mismatch and no PII in response; all external calls mocked.');
