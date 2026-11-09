import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const wompiCreate = await readFile(new URL('../supabase/functions/wompi-create-checkout/index.ts', import.meta.url), 'utf8');
const wompiWebhook = await readFile(new URL('../supabase/functions/wompi-webhook/index.ts', import.meta.url), 'utf8');

assert.doesNotMatch(index, /\.rpc\(\s*['"](?:attach|release)_inventory_reservation['"]/,
  'the public storefront must not call privileged inventory reservation RPCs');
assert.doesNotMatch(index, /function\s+(?:attach|release)InventoryReservation\s*\(/,
  'the storefront must not retain a helper that can invoke the privileged RPCs');

const mismatchStart = index.indexOf('if(data.reference!==paymentReference){');
assert.notEqual(mismatchStart, -1, 'the Wompi reference contract must be checked');
const mismatchEnd = index.indexOf('\n  }', mismatchStart);
assert.ok(mismatchEnd > mismatchStart, 'the mismatch guard must have a finite block');
const mismatchBlock = index.slice(mismatchStart, mismatchEnd);
assert.match(mismatchBlock, /throw new Error\(/,
  'a changed reference must fail closed before constructing the Wompi form');
assert.doesNotMatch(mismatchBlock, /attach_inventory_reservation|attachInventoryReservation/,
  'the browser must never rebind a reservation');

const extractFunction = (source, name) => {
  const marker = `async function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} has no closing brace`);
};

const payWithWompiSource = extractFunction(index, 'payWithWompi');
const paymentItems = [{ id: '00000000-0000-4000-8000-000000000001', qty: 1, color: '', size: '' }];
async function runWompiAttempt(returnedReference) {
  let edgeCalls = 0;
  let quoteCalls = 0;
  let formCreates = 0;
  let formSubmits = 0;
  let rpcMutationCalls = 0;
  let resetCalls = 0;
  const messages = [];
  const button = { disabled: false, textContent: '' };
  const response = {
    ok: true,
    status: 200,
    async json() {
      return { reference: returnedReference, signature: 'synthetic-signature', amountInCents: 1000000 };
    },
  };
  const context = vm.createContext({
    checkoutShipping: 0,
    onlinePaymentsEnabled: true,
    SUPABASE_KEY: 'public-test-key',
    WOMPI_PUBLIC_KEY: 'pub_test_only',
    WOMPI_SIGNATURE_ENDPOINT: 'https://edge.invalid/wompi-create-checkout',
    location: { protocol: 'https:', hostname: 'sirevya.com.co' },
    window: {
      __sirevyaWompiInProgress: false,
      location: { pathname: '/', origin: 'https://sirevya.com.co' },
    },
    URL,
    getCheckoutItems: () => paymentItems,
    calculateStorefrontComboPricing: () => ({ subtotal: 10000, discountTotal: 0 }),
    getActiveReservationReference: () => '',
    getPendingWompiReference: () => '',
    getActiveReservationItems: () => [],
    getRegion: () => 'Valle del Cauca',
    reservationItemsMatch: () => false,
    findReservationRecordForItems: () => null,
    generateReservationReference: () => 'JMRES-SYNTHETIC-REFERENCE',
    saveReservationDraft() {},
    saveActiveReservationReference() {},
    saveActiveReservationItems() {},
    savePendingWompiReference() {},
    setCurrentReservationRecord() {},
    refreshOnlinePaymentSetting: async () => {},
    syncPaymentOptions() {},
    $: id => id === 'checkoutConfirmBtn' ? button : null,
    sb: {
      auth: { async getSession() { return { data: { session: null } }; } },
      async rpc(name) {
        if (name === 'get_storefront_cart_quote') {
          quoteCalls += 1;
          return {
            error: null,
            data: { success: true, total: 10000, discount_total: 0, shipping: 0 },
          };
        }
        rpcMutationCalls += 1;
        assert.fail(`Unexpected client RPC ${name}`);
      },
    },
    fetch: async () => { edgeCalls += 1; return response; },
    document: {
      createElement(tag) {
        if (tag === 'form') {
          formCreates += 1;
          return {
            style: {},
            appendChild() {},
            submit() { formSubmits += 1; },
          };
        }
        return { name: '', value: '', type: '' };
      },
      body: { appendChild() {} },
    },
    closeCheckout() {},
    showToast(message) { messages.push(String(message)); },
    resetWompiButton() { resetCalls += 1; button.disabled = false; },
    console: { error() {}, warn() {} },
  });

  vm.runInContext(payWithWompiSource, context);
  await context.payWithWompi({
    name: 'Synthetic buyer',
    city: 'Cali',
    phone: '0000000000',
    address: 'Synthetic address',
    neighborhood: 'Synthetic neighborhood',
    email: 'fixture@example.invalid',
    cedula: '',
  });
  return { edgeCalls, quoteCalls, formCreates, formSubmits, rpcMutationCalls, resetCalls, messages, context };
}

const matchingReference = await runWompiAttempt('JMRES-SYNTHETIC-REFERENCE');
assert.equal(matchingReference.quoteCalls, 1);
assert.equal(matchingReference.edgeCalls, 1);
assert.equal(matchingReference.formCreates, 1, 'the normal matching-reference checkout still constructs its form');
assert.equal(matchingReference.formSubmits, 1, `the normal matching-reference checkout still submits to Wompi; messages=${matchingReference.messages.join(' | ')}`);
assert.equal(matchingReference.rpcMutationCalls, 0, 'the browser performs no inventory mutation RPC');
assert.equal(matchingReference.context.window.__sirevyaWompiInProgress, false);

const mismatchedReference = await runWompiAttempt('JMRES-UNEXPECTED-REFERENCE');
assert.equal(mismatchedReference.quoteCalls, 1);
assert.equal(mismatchedReference.edgeCalls, 1);
assert.equal(mismatchedReference.formCreates, 0, 'a mismatched reservation reference never opens checkout');
assert.equal(mismatchedReference.formSubmits, 0, 'a mismatched reservation reference is never submitted to Wompi');
assert.equal(mismatchedReference.rpcMutationCalls, 0, 'mismatch handling never calls privileged inventory RPCs');
assert.equal(mismatchedReference.resetCalls, 1);
assert.equal(mismatchedReference.context.window.__sirevyaWompiInProgress, false);
assert.ok(mismatchedReference.messages.some(message => /referencia distinta/.test(message)));

const wompiStart = index.indexOf('async function payWithWompi(');
const catchStart = index.indexOf('}catch(err){', wompiStart);
const finallyStart = index.indexOf('}finally{', catchStart);
assert.ok(wompiStart >= 0 && catchStart > wompiStart && finallyStart > catchStart,
  'the Wompi error/finally path must remain present');
const wompiCatch = index.slice(catchStart, finallyStart);
assert.doesNotMatch(wompiCatch, /release_inventory_reservation|releaseInventoryReservation/,
  'browser error handling must not release a hold whose order may have committed');
assert.match(wompiCatch, /TTL de 10 minutos/,
  'ambiguous holds must be documented as server-owned and allowed to expire');

const codStart = index.indexOf('if(savedCOD?.reference&&savedCOD.fingerprint!==getCODOrderFingerprint');
assert.notEqual(codStart, -1, 'the stale COD draft branch must remain present');
const codEnd = index.indexOf('\n   }', codStart);
assert.ok(codEnd > codStart, 'the stale COD draft branch must have a finite block');
const codBlock = index.slice(codStart, codEnd);
assert.match(codBlock, /clearCODOrderReference\(savedCOD\.reference\)/,
  'a changed local draft must still clear its obsolete idempotency token');
assert.doesNotMatch(codBlock, /release_inventory_reservation|releaseInventoryReservation/,
  'the browser must not release the server-owned COD inventory reference');

const safeServerRelease = (source, label) => {
  const call = source.indexOf('/rpc/release_inventory_reservation');
  assert.notEqual(call, -1, `${label} must retain its server-side release contract`);
  const requestStart = source.lastIndexOf('fetch(', call);
  const requestEnd = source.indexOf('});', call);
  assert.ok(requestStart >= 0 && requestEnd > call, `${label} release request must be parseable`);
  const request = source.slice(requestStart, requestEnd);
  assert.match(request, /headers:\s*supabaseHeaders\(serviceRoleKey\)/,
    `${label} must call the release RPC with the server-only service role`);
};

safeServerRelease(wompiCreate, 'wompi-create-checkout');
safeServerRelease(wompiWebhook, 'wompi-webhook');

const guardedReleaseStart = wompiCreate.indexOf('async function releaseReservationIfNoOrder(');
const guardedReleaseEnd = wompiCreate.indexOf('\n}\n\nDeno.serve', guardedReleaseStart);
assert.ok(guardedReleaseStart >= 0 && guardedReleaseEnd > guardedReleaseStart,
  'the Edge cleanup helper must remain present');
const guardedRelease = wompiCreate.slice(guardedReleaseStart, guardedReleaseEnd);
assert.ok(guardedRelease.indexOf('/orders') < guardedRelease.indexOf('/rpc/release_inventory_reservation'),
  'Edge cleanup must check for an existing order before releasing its reservation');

console.log('Inventory reservation client boundary regression passed, including Wompi reference match/mismatch flows.');
