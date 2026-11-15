import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 6)) {
  console.log('SKIP Wompi attempt webhook regression: Node 22.6+ is required for built-in TypeScript stripping.');
  process.exit(0);
}
if (process.env.SIREVYA_WOMPI_ATTEMPT_WEBHOOK_CHILD !== '1') {
  const child = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', fileURLToPath(import.meta.url), '--child'], {
    encoding: 'utf8', env: { ...process.env, SIREVYA_WOMPI_ATTEMPT_WEBHOOK_CHILD: '1' },
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
  WOMPI_EVENT_SECRET: 'synthetic-production-event-secret',
  WOMPI_PRIVATE_KEY: 'synthetic-production-private-key',
};
const handlers = {};
const requests = [];
const sideEffects = { inventoryConfirm: 0, inventoryRelease: 0, couponConfirm: 0, couponRelease: 0, orderReads: 0 };
let scenario;
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'content-type': 'application/json' },
});

globalThis.Deno = {
  env: { get: name => env[name] ?? null },
  serve: handler => { handlers.webhook = handler; },
};
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : null;
  requests.push({ url, method, body });
  if (url.origin === 'https://production.wompi.co') {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-production-private-key');
    return jsonResponse({ data: {
      id: scenario.transactionId,
      reference: scenario.wompiReference,
      amount_in_cents: scenario.amount,
      currency: 'COP',
      status: scenario.status,
    } });
  }
  if (url.origin !== env.SUPABASE_URL) throw new Error(`Blocked unexpected origin ${url.origin}`);

  if (url.pathname === '/rest/v1/storefront_wompi_payment_attempts' && method === 'GET') {
    if (scenario.attemptLookupStatus !== undefined) return jsonResponse({ error: 'synthetic lookup failure' }, scenario.attemptLookupStatus);
    if (url.searchParams.has('order_reference')) return jsonResponse(scenario.knownLedgerRows ?? scenario.attemptRows);
    return jsonResponse(scenario.attemptRows);
  }
  if (url.pathname === '/rest/v1/rpc/transition_storefront_wompi_payment_attempt') {
    return jsonResponse(scenario.transition);
  }
  if (url.pathname === '/rest/v1/rpc/mark_storefront_wompi_reconciliation') {
    return jsonResponse({ success: true, order_flag_updated: true });
  }
  if (url.pathname === '/rest/v1/sirevya_wompi_inventory_reconciliation' && method === 'POST') {
    return new Response(null, { status: 201 });
  }
  if (url.pathname === '/rest/v1/orders' && method === 'GET') {
    sideEffects.orderReads += 1;
    return jsonResponse(scenario.order ? [structuredClone(scenario.order)] : []);
  }
  if (url.pathname === '/rest/v1/orders' && method === 'PATCH') {
    if (body?.transaction_id && !body?.payment_status) scenario.order.transaction_id = body.transaction_id;
    if (body?.payment_status) {
      scenario.order.payment_status = body.payment_status;
      scenario.order.transaction_id = body.transaction_id;
    }
    return jsonResponse([structuredClone(scenario.order)]);
  }
  if (url.pathname === '/rest/v1/rpc/set_storefront_wompi_checkout_state') {
    return jsonResponse({ success: true, late_approval_conflict: false });
  }
  if (url.pathname === '/rest/v1/rpc/list_pending_wompi_orders_for_phone') {
    return jsonResponse({ success: true, orders: [] });
  }
  if (url.pathname === '/rest/v1/rpc/confirm_inventory_reservation') {
    sideEffects.inventoryConfirm += 1;
    return jsonResponse({ success: true, items_finalized: 1 });
  }
  if (url.pathname === '/rest/v1/rpc/release_inventory_reservation') {
    sideEffects.inventoryRelease += 1;
    return jsonResponse({ success: true });
  }
  if (url.pathname === '/rest/v1/rpc/confirm_storefront_coupon_redemption') {
    sideEffects.couponConfirm += 1;
    return jsonResponse({ success: true });
  }
  if (url.pathname === '/rest/v1/rpc/release_storefront_wompi_coupon_redemption_for_attempt' ||
      url.pathname === '/rest/v1/rpc/release_storefront_coupon_redemption') {
    sideEffects.couponRelease += 1;
    return jsonResponse({ success: true });
  }
  if (url.pathname === '/rest/v1/sirevya_wompi_inventory_reconciliation' && method === 'PATCH') {
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
};

await import(new URL('../supabase/functions/wompi-webhook/index.ts', import.meta.url).href);
assert.equal(typeof handlers.webhook, 'function');

function makeScenario({ status, reference, attemptReference, transactionId, transition, orderStatus = 'PENDING', orderTx = null,
  attemptRows, attemptLookupStatus, isLegacy = false } = {}) {
  const stableReference = reference ?? 'JMRES-SYNTHETIC-ORDER-001';
  const attemptRef = attemptReference ?? 'SW-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const txId = transactionId ?? 'TX-SYNTHETIC-001';
  const amount = 1234500;
  const currentStatus = status ?? 'PENDING';
  return {
    status: currentStatus,
    wompiReference: isLegacy ? stableReference : attemptRef,
    transactionId: txId,
    amount,
    attemptLookupStatus,
    attemptRows: attemptRows ?? [{
      attempt_reference: attemptRef,
      wompi_reference: isLegacy ? stableReference : attemptRef,
      is_legacy: isLegacy,
      order_reference: stableReference,
      amount_in_cents: amount,
      currency: 'COP',
      environment: 'prod',
      transaction_id: orderTx,
    }],
    transition: transition ?? {
      success: true,
      order_reference: stableReference,
      attempt_reference: attemptRef,
      transaction_id: txId,
      status: currentStatus,
      is_current: true,
      late_approval: false,
      reconciliation_required: false,
      idempotent: false,
    },
    order: {
      reference: stableReference,
      total: 12345,
      items: [{ id: '00000000-0000-4000-8000-000000000001', qty: 1 }],
      payment_method: 'wompi',
      payment_status: orderStatus,
      transaction_id: orderTx,
      phone: '3000000000',
      coupon_id: null,
      coupon_code: null,
      coupon_discount_total: 0,
      coupon_reconciliation_required: false,
      wompi_reconciliation_required: false,
    },
  };
}

function signedRequest() {
  const timestamp = 1731264000;
  const transaction = {
    id: scenario.transactionId,
    status: scenario.status,
    amount_in_cents: scenario.amount,
    currency: 'COP',
    reference: scenario.wompiReference,
  };
  const properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
  const source = `${transaction.id}${transaction.status}${transaction.amount_in_cents}${timestamp}${env.WOMPI_EVENT_SECRET}`;
  const checksum = createHash('sha256').update(source).digest('hex');
  return new Request('https://edge.invalid/wompi-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-event-checksum': checksum },
    body: JSON.stringify({
      environment: 'prod',
      event: 'transaction.updated',
      timestamp,
      signature: { properties, checksum },
      data: { transaction },
    }),
  });
}

for (const status of ['PENDING', 'ERROR', 'DECLINED', 'VOIDED', 'APPROVED']) {
  scenario = makeScenario({ status, transactionId: `TX-${status}-001`, attemptReference: `SW-${status === 'PENDING' ? 'A' : status === 'ERROR' ? 'B' : status === 'DECLINED' ? 'C' : status === 'VOIDED' ? 'D' : 'E'.repeat(32)}` });
  if (scenario.wompiReference.length !== 35) scenario.wompiReference = `SW-${'A'.repeat(32)}`;
  scenario.attemptRows[0].attempt_reference = scenario.wompiReference;
  scenario.attemptRows[0].wompi_reference = scenario.wompiReference;
  scenario.attemptRows[0].is_legacy = false;
  requests.length = 0;
  Object.keys(sideEffects).forEach(key => { sideEffects[key] = 0; });
  const response = await handlers.webhook(signedRequest());
  assert.equal(response.status, 200, `${status} event should be processed by the synthetic current-attempt flow`);
  const result = await response.json();
  assert.equal(result.status, status);
  assert.equal(scenario.order.reference, 'JMRES-SYNTHETIC-ORDER-001', 'attempt maps to the stable order reference');
  assert.equal(scenario.order.transaction_id, scenario.transactionId);
  if (status === 'PENDING') {
    assert.equal(scenario.order.payment_status, 'PENDING');
    assert.equal(sideEffects.inventoryConfirm, 0);
    assert.equal(sideEffects.inventoryRelease, 0);
  } else if (['ERROR', 'DECLINED', 'VOIDED'].includes(status)) {
    assert.equal(scenario.order.payment_status, status);
    assert.equal(sideEffects.inventoryRelease, 1, `${status} releases only the active reservation once`);
    assert.equal(sideEffects.inventoryConfirm, 0);
  } else {
    assert.equal(scenario.order.payment_status, 'APPROVED');
    assert.equal(sideEffects.inventoryConfirm, 1);
    assert.equal(sideEffects.inventoryRelease, 0);
  }
  assert.ok(requests.some(call => call.url.pathname === '/rest/v1/rpc/transition_storefront_wompi_payment_attempt'));
  assert.ok(requests.some(call => call.url.pathname === '/rest/v1/orders' && call.method === 'GET'));
}

// Wompi's documented event schema has no environment field. A valid signed event
// must pass the production-secret and authenticated production-API checks without it.
scenario = makeScenario({ status: 'PENDING', transactionId: 'TX-NO-ENV-001' });
requests.length = 0;
Object.keys(sideEffects).forEach(key => { sideEffects[key] = 0; });
const documentedRequest = signedRequest();
const documentedPayload = await documentedRequest.json();
delete documentedPayload.environment;
const missingEnvironmentResponse = await handlers.webhook(new Request('https://edge.invalid/wompi-webhook', {
  method: 'POST', headers: documentedRequest.headers, body: JSON.stringify(documentedPayload),
}));
assert.equal(missingEnvironmentResponse.status, 200, 'documented signed event without environment must be accepted');
assert.equal((await missingEnvironmentResponse.json()).status, 'PENDING');
assert.equal(sideEffects.inventoryConfirm, 0);
assert.equal(sideEffects.inventoryRelease, 0);

// An explicit Sandbox label is still rejected before any API or database request.
requests.length = 0;
const sandboxPayload = { ...documentedPayload, environment: 'test' };
const sandboxResponse = await handlers.webhook(new Request('https://edge.invalid/wompi-webhook', {
  method: 'POST', headers: documentedRequest.headers, body: JSON.stringify(sandboxPayload),
}));
assert.equal(sandboxResponse.status, 400, 'explicit Sandbox environment must remain rejected');
assert.equal(requests.length, 0, 'wrong environment must be rejected before network side effects');

// Duplicate APPROVED webhook must not confirm inventory a second time.
scenario = makeScenario({ status: 'APPROVED', transactionId: 'TX-APPROVED-DUP', orderStatus: 'APPROVED', orderTx: 'TX-APPROVED-DUP',
  attemptReference: `SW-${'F'.repeat(32)}`,
  transition: { success: true, order_reference: 'JMRES-SYNTHETIC-ORDER-001', status: 'APPROVED', is_current: true, late_approval: false, idempotent: true } });
requests.length = 0;
Object.keys(sideEffects).forEach(key => { sideEffects[key] = 0; });
const duplicate = await handlers.webhook(signedRequest());
assert.equal(duplicate.status, 200);
assert.equal((await duplicate.json()).idempotent, true);
assert.equal(sideEffects.inventoryConfirm, 0, 'duplicate APPROVED must not finalize inventory again');
assert.equal(sideEffects.inventoryRelease, 0);

// An old attempt approved after a newer attempt exists: durably reconcile it and
// do not read/update the order or touch current inventory/coupon reservations.
scenario = makeScenario({ status: 'APPROVED', transactionId: 'TX-OLD-LATE', orderTx: 'TX-CURRENT',
  attemptReference: `SW-${'9'.repeat(32)}`,
  transition: { success: true, order_reference: 'JMRES-SYNTHETIC-ORDER-001', status: 'APPROVED_LATE',
    is_current: false, late_approval: true, reconciliation_required: true } });
scenario.attemptRows[0].transaction_id = 'TX-OLD-LATE';
requests.length = 0;
Object.keys(sideEffects).forEach(key => { sideEffects[key] = 0; });
const late = await handlers.webhook(signedRequest());
assert.equal(late.status, 200);
const lateResult = await late.json();
assert.equal(lateResult.status, 'APPROVED_LATE');
assert.equal(lateResult.reconciliationRequired, true);
assert.equal(sideEffects.orderReads, 0, 'late approval is handled before order/fulfillment paths');
assert.equal(sideEffects.inventoryConfirm, 0);
assert.equal(sideEffects.inventoryRelease, 0);
assert.equal(sideEffects.couponConfirm, 0);
assert.equal(sideEffects.couponRelease, 0);
assert.equal(requests.some(call => call.url.pathname === '/rest/v1/rpc/mark_storefront_wompi_reconciliation'), false,
  'the ledger transition already marks order and lock atomically for a late approval');
assert.ok(requests.some(call => call.url.pathname === '/rest/v1/sirevya_wompi_inventory_reconciliation' && call.method === 'POST'));

// Legacy provider reference is the stable order reference; exact transaction_id
// resolves each immutable history row and uses the internal SW key for transition.
const legacyReference = 'JMRES-LEGACY-SYNTHETIC-001';
const legacyAttempt = `SW-${'6'.repeat(32)}`;
scenario = makeScenario({ status: 'ERROR', reference: legacyReference, attemptReference: legacyAttempt,
  transactionId: 'TX-LEGACY-ERROR', orderStatus: 'ERROR', orderTx: 'TX-LEGACY-ERROR', isLegacy: true,
  transition: { success: true, order_reference: legacyReference, attempt_reference: legacyAttempt,
    status: 'ERROR', is_current: true, late_approval: false, idempotent: true } });
scenario.wompiReference = legacyReference;
scenario.attemptRows[0].wompi_reference = legacyReference;
scenario.attemptRows[0].transaction_id = 'TX-LEGACY-ERROR';
requests.length = 0;
Object.keys(sideEffects).forEach(key => { sideEffects[key] = 0; });
const legacyError = await handlers.webhook(signedRequest());
assert.equal(legacyError.status, 200);
assert.equal((await legacyError.json()).ignored, true);
const legacyLookup = requests.find(call => call.url.pathname === '/rest/v1/storefront_wompi_payment_attempts' && call.method === 'GET');
assert.equal(legacyLookup.url.searchParams.get('wompi_reference'), `eq.${legacyReference}`);
assert.equal(legacyLookup.url.searchParams.get('transaction_id'), 'eq.TX-LEGACY-ERROR');
assert.equal(legacyLookup.url.searchParams.get('is_legacy'), 'eq.true');
assert.equal(sideEffects.inventoryConfirm, 0);
assert.equal(sideEffects.inventoryRelease, 0);

// A late legacy APPROVED event is reconciled before any order/reservation side effect.
scenario = makeScenario({ status: 'APPROVED', reference: legacyReference, attemptReference: legacyAttempt,
  transactionId: 'TX-LEGACY-OLD-LATE', orderStatus: 'PENDING', orderTx: 'TX-CURRENT', isLegacy: true,
  transition: { success: true, order_reference: legacyReference, attempt_reference: legacyAttempt,
    status: 'APPROVED_LATE', is_current: false, late_approval: true, reconciliation_required: true } });
scenario.wompiReference = legacyReference;
scenario.attemptRows[0].wompi_reference = legacyReference;
scenario.attemptRows[0].transaction_id = 'TX-LEGACY-OLD-LATE';
requests.length = 0;
Object.keys(sideEffects).forEach(key => { sideEffects[key] = 0; });
const legacyLate = await handlers.webhook(signedRequest());
assert.equal(legacyLate.status, 200);
assert.equal((await legacyLate.json()).status, 'APPROVED_LATE');
assert.equal(sideEffects.orderReads, 0);
assert.equal(sideEffects.inventoryConfirm, 0);
assert.equal(sideEffects.inventoryRelease, 0);
assert.ok(requests.some(call => call.url.pathname === '/rest/v1/rpc/transition_storefront_wompi_payment_attempt'));

// Unknown transaction under a stable reference with any ledger row is ambiguous and fail-closed.
scenario = makeScenario({ status: 'APPROVED', reference: legacyReference, attemptReference: legacyAttempt,
  transactionId: 'TX-LEGACY-UNKNOWN', isLegacy: true, attemptRows: [] });
scenario.wompiReference = legacyReference;
scenario.knownLedgerRows = [{ attempt_reference: legacyAttempt }];
requests.length = 0;
Object.keys(sideEffects).forEach(key => { sideEffects[key] = 0; });
const unknownLegacy = await handlers.webhook(signedRequest());
assert.equal(unknownLegacy.status, 409);
assert.equal(sideEffects.orderReads, 0);
assert.equal(sideEffects.inventoryConfirm, 0);
assert.equal(sideEffects.inventoryRelease, 0);

// An unresolved attempt lookup fails closed without legacy order-reference fallback.
scenario = makeScenario({ status: 'APPROVED', attemptReference: `SW-${'8'.repeat(32)}`, attemptRows: [] });
requests.length = 0;
const missingAttempt = await handlers.webhook(signedRequest());
assert.equal(missingAttempt.status, 409);
assert.equal(sideEffects.orderReads, 0);
assert.equal(requests.some(call => call.url.pathname === '/rest/v1/orders'), false);

scenario = makeScenario({ status: 'APPROVED', attemptReference: `SW-${'7'.repeat(32)}`, attemptLookupStatus: 503 });
requests.length = 0;
const unavailableAttempt = await handlers.webhook(signedRequest());
assert.equal(unavailableAttempt.status, 503);
assert.equal(sideEffects.orderReads, 0);
assert.equal(requests.some(call => call.url.pathname === '/rest/v1/orders'), false);

console.log('PASS Wompi attempt webhook regression: current PENDING/ERROR/DECLINED/VOIDED/APPROVED, legacy reference+transaction mapping, unknown legacy fail-closed, duplicate approval idempotency, stale legacy/current approval reconciliation without inventory/coupon effects; all network mocked.');
