import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 6)) {
  console.log('SKIP admin Wompi manual recovery: Node 22.6+ is required for built-in TypeScript stripping.');
  process.exit(0);
}
if (process.env.SIREVYA_ADMIN_WOMPI_RECOVERY_CHILD !== '1') {
  const child = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', fileURLToPath(import.meta.url), '--child'], {
    encoding: 'utf8',
    env: { ...process.env, SIREVYA_ADMIN_WOMPI_RECOVERY_CHILD: '1' },
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(child.stderr || child.stdout || `Edge child exited ${child.status}`);
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  process.exit(0);
}

const supabaseUrl = 'https://supabase.invalid';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attemptReference = 'SW-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const orderReference = 'SYNTHETIC-ORDER-NO-ATTEMPT';
const rpcCalls = [];
const fetchCalls = [];
let adminAllowed = true;
let rpcResponse = null;
const env = {
  SUPABASE_URL: supabaseUrl,
  SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
  // WOMPI_PRIVATE_KEY intentionally absent: attestation is an admin assertion, not an API lookup.
};
const handlerBox = {};
globalThis.Deno = { env: { get: name => env[name] ?? null }, serve: handler => { handlerBox.handler = handler; } };
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  let body = null;
  if (typeof init.body === 'string' && init.body) body = JSON.parse(init.body);
  fetchCalls.push({ url, init, body });
  if (url.origin !== supabaseUrl) throw new Error(`Blocked external network request: ${url.origin}`);
  if (url.pathname === '/auth/v1/user') return jsonResponse({ id: userId });
  if (url.pathname === '/rest/v1/rpc/is_store_admin') return jsonResponse(adminAllowed);
  const rpcName = url.pathname.split('/').at(-1);
  if (rpcName === 'verify_storefront_wompi_no_transaction' || rpcName === 'verify_storefront_wompi_no_attempt') {
    rpcCalls.push({ rpcName, body });
    return jsonResponse(rpcResponse ?? { success: true, state: 'no_transaction_verified', retry_after: '2026-11-15T22:00:00.000Z',
      order_preserved: true, reservation_released: false, attempt_issued: false, payment_started: false });
  }
  throw new Error(`Unexpected mocked request: ${init.method || 'GET'} ${url.pathname}`);
};
await import('../supabase/functions/admin-wompi-legacy-recovery/index.ts');
assert.equal(typeof handlerBox.handler, 'function');

function post(body, { origin = 'https://sirevya.com.co', bearer = 'synthetic-admin-token-000000000000000000000000' } = {}) {
  return new Request('https://edge.invalid/admin-wompi-legacy-recovery', {
    method: 'POST', headers: { origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

// Invalid origin and non-admin users are rejected before either recovery RPC.
let response = await handlerBox.handler(post({ action: 'attest_no_transaction', attempt_reference: attemptReference, confirm_no_transaction: true }, { origin: 'https://evil.invalid' }));
assert.equal(response.status, 403);
assert.equal(rpcCalls.length, 0);
adminAllowed = false;
response = await handlerBox.handler(post({ action: 'attest_no_transaction', attempt_reference: attemptReference, confirm_no_transaction: true }));
assert.equal(response.status, 403);
assert.equal(rpcCalls.length, 0);
adminAllowed = true;

// Confirmation and allowlisted body fields are mandatory; no writes occur when missing.
response = await handlerBox.handler(post({ action: 'attest_no_transaction', attempt_reference: attemptReference, confirm_no_transaction: false }));
assert.equal(response.status, 400);
response = await handlerBox.handler(post({ action: 'attest_no_attempt', order_reference: orderReference, confirm_no_transaction: true, admin_user_id: userId }));
assert.equal(response.status, 400, 'the client cannot supply or override the admin identity');
assert.equal(rpcCalls.length, 0);

// Manual attestation is forwarded only through the service-role RPC with the JWT-derived admin id.
rpcResponse = { success: true, state: 'no_transaction_verified', retry_after: '2026-11-15T22:00:00.000Z',
  order_preserved: true, reservation_released: false, attempt_issued: false, payment_started: false };
response = await handlerBox.handler(post({ action: 'attest_no_transaction', attempt_reference: attemptReference, confirm_no_transaction: true }));
assert.equal(response.status, 200);
let data = await response.json();
assert.deepEqual(rpcCalls.at(-1), { rpcName: 'verify_storefront_wompi_no_transaction', body: {
  p_attempt_reference: attemptReference, p_admin_user_id: userId, p_confirmed: true,
} });
assert.equal(data.success, true);
assert.equal(data.orderPreserved, true);
assert.equal(data.reservationReleased, false);
assert.equal(data.paymentStarted, false);
assert.equal(data.retryAfter, '2026-11-15T22:00:00.000Z');

rpcResponse = { success: true, state: 'no_transaction_verified', retry_after: '2026-11-15T22:15:00.000Z',
  order_preserved: true, reservation_released: false, attempt_issued: false, payment_started: false };
response = await handlerBox.handler(post({ action: 'attest_no_attempt', order_reference: orderReference, confirm_no_transaction: true }));
assert.equal(response.status, 200);
data = await response.json();
assert.deepEqual(rpcCalls.at(-1), { rpcName: 'verify_storefront_wompi_no_attempt', body: {
  p_order_reference: orderReference, p_admin_user_id: userId, p_confirmed: true,
} });
assert.equal(data.paymentStarted, false);
assert.equal(data.reservationReleased, false);

// A wait/conflict response fails closed and exposes only a safe error code.
rpcResponse = { success: false, code: 'WOMPI_MANUAL_RECOVERY_WAIT', message: 'synthetic internal detail' };
response = await handlerBox.handler(post({ action: 'attest_no_transaction', attempt_reference: attemptReference, confirm_no_transaction: true }));
assert.equal(response.status, 409);
data = await response.json();
assert.deepEqual(data, { success: false, code: 'WOMPI_MANUAL_RECOVERY_WAIT' });
assert.ok(!JSON.stringify(data).includes('synthetic internal detail'));
assert.ok(fetchCalls.every(call => call.url.origin === supabaseUrl), 'the manual pathway never calls Wompi or any external host');
assert.ok(!fetchCalls.some(call => call.url.hostname.endsWith('wompi.co')));
const adminHtml = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
assert.match(adminHtml, /id="wompiManualRecoveryMode"/);
assert.match(adminHtml, /id="wompiManualRecoveryConfirm"/);
assert.match(adminHtml, /id="wompiManualRecoveryPhrase"/);
assert.match(adminHtml, /no consulta Wompi automáticamente/i);
assert.match(adminHtml, /sb\.functions\.invoke\('admin-wompi-legacy-recovery'/);
assert.match(adminHtml, /adminAuthOperationStillCurrent\(userId,authEpoch\)/);
const manualUiStart = adminHtml.indexOf('async function submitWompiManualAttestation()');
const manualUiEnd = adminHtml.indexOf('\n}\n', manualUiStart);
assert.ok(manualUiStart >= 0 && manualUiEnd > manualUiStart);
assert.doesNotMatch(adminHtml.slice(manualUiStart, manualUiEnd), /localStorage|sessionStorage/,
  'manual recovery must not persist the target reference or attestation in browser storage');
console.log('PASS admin Wompi manual recovery: admin JWT and origin enforced; typed confirmation and server-derived admin id required; both audit RPCs exercised; wait/conflict fail closed; no Wompi lookup, payment, secrets, or customer data.');
