import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 6)) {
  console.log('SKIP wompi edge handler regression: Node 22.6+ is required for built-in TypeScript stripping.');
  process.exit(0);
}

if (process.env.SIREVYA_WOMPI_EDGE_CHILD !== '1') {
  const child = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', fileURLToPath(import.meta.url), '--child'], {
    encoding: 'utf8',
    env: { ...process.env, SIREVYA_WOMPI_EDGE_CHILD: '1' },
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
  WOMPI_EVENT_SECRET_TEST: 'synthetic-event-secret',
  WOMPI_PRIVATE_KEY_TEST: 'synthetic-private-key',
};
const handlers = {};
let activeHandler = '';
const networkCalls = [];
globalThis.Deno = {
  env: { get: name => env[name] ?? null },
  serve: handler => { handlers[activeHandler] = handler; },
};
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  networkCalls.push({ url, method: init.method || 'GET' });
  if (url.startsWith('https://sandbox.wompi.co/v1/transactions/')) {
    return new Response(JSON.stringify({ error: 'synthetic upstream unavailable' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error(`Unexpected network call blocked by local Wompi test: ${url}`);
};

activeHandler = 'checkout';
await import(new URL('../supabase/functions/wompi-create-checkout/index.ts', import.meta.url).href);
activeHandler = 'webhook';
await import(new URL('../supabase/functions/wompi-webhook/index.ts', import.meta.url).href);
assert.equal(typeof handlers.checkout, 'function');
assert.equal(typeof handlers.webhook, 'function');

function request(method, body, headers = {}) {
  return new Request('https://edge.invalid/test', {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}
async function invoke(name, req, expectedStatus) {
  const response = await handlers[name](req);
  assert.equal(response.status, expectedStatus);
  return response;
}

// Checkout rejects before any RPC, reservation, order insert, or Wompi session.
networkCalls.length = 0;
await invoke('checkout', request('OPTIONS'), 200);
await invoke('checkout', request('GET'), 405);
await invoke('checkout', request('POST', '{invalid-json'), 400);
const missingCedula = await invoke('checkout', request('POST', { items: [] }), 400);
assert.equal((await missingCedula.json()).code, 'CUSTOMER_CEDULA_REQUIRED');
assert.equal(networkCalls.length, 0, 'invalid checkout input must never reach Supabase/Wompi');

// Webhook rejects wrong method, malformed events, cross-environment events, incomplete
// critical signature data, and invalid checksums without a Wompi or Supabase request.
networkCalls.length = 0;
await invoke('webhook', request('OPTIONS'), 200);
await invoke('webhook', request('GET'), 405);
await invoke('webhook', request('POST', '{invalid-json'), 400);
const wrongEnvironment = await invoke('webhook', request('POST', { environment: 'prod' }), 400);
assert.match((await wrongEnvironment.json()).error, /ambiente distinto/);
const unsigned = await invoke('webhook', request('POST', { environment: 'test', event: 'transaction.updated' }), 400);
assert.match((await unsigned.json()).error, /firma suficientes/);
const incompleteSignature = await invoke('webhook', request('POST', {
  environment: 'test', event: 'transaction.updated', timestamp: 10,
  signature: { properties: ['transaction.status'], checksum: '00' },
  data: { transaction: { status: 'APPROVED' } },
}), 401);
assert.match((await incompleteSignature.json()).error, /propiedades críticas/);

const transaction = { id: 'synthetic-txn-001', status: 'APPROVED', amount_in_cents: 1234500, currency: 'COP', reference: 'JM-SYNTHETIC-001' };
const signedProperties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
const timestamp = 1731264000;
const signatureText = `${transaction.id}${transaction.status}${transaction.amount_in_cents}${timestamp}${env.WOMPI_EVENT_SECRET_TEST}`;
const validChecksum = createHash('sha256').update(signatureText).digest('hex');
const invalidChecksum = await invoke('webhook', request('POST', {
  environment: 'test', event: 'transaction.updated', timestamp,
  signature: { properties: signedProperties, checksum: '0'.repeat(64) },
  data: { transaction },
}), 401);
assert.match((await invalidChecksum.json()).error, /Firma de evento inválida/);
assert.equal(networkCalls.length, 0, 'invalid signature must never call Wompi or Supabase');

// A correctly signed synthetic event may call only the mocked sandbox transaction lookup.
// The mocked 503 proves failure is closed: no order lookup/update or inventory mutation follows.
const verifiedButUnavailable = await invoke('webhook', request('POST', {
  environment: 'test', event: 'transaction.updated', timestamp,
  signature: { properties: signedProperties, checksum: validChecksum },
  data: { transaction },
}), 502);
assert.match((await verifiedButUnavailable.json()).error, /reintentará el evento/);
assert.equal(networkCalls.length, 1);
assert.match(networkCalls[0].url, /^https:\/\/sandbox\.wompi\.co\/v1\/transactions\/synthetic-txn-001$/);
assert.equal(networkCalls[0].method, 'GET');
console.log('PASS Wompi Edge fail-closed harness: checkout validation, webhook environment/signature gates and mocked sandbox failure; zero real network, orders or payments.');
