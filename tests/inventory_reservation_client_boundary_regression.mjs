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
    normalizeCheckoutCouponCode: value => String(value || '').trim().toUpperCase(),
    async requestCheckoutQuote() {
      quoteCalls += 1;
      return { success: true, total: 10000, discount_total: 0, shipping: 0,
        original_subtotal: 10000, discounted_subtotal: 10000, coupon_discount_total: 0 };
    },
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
    coupon_code: '',
    shipping: 0,
    expected_total: 10000,
    expected_discount_total: 0,
    expected_coupon_discount_total: 0,
  });
  return { edgeCalls, quoteCalls, formCreates, formSubmits, rpcMutationCalls, resetCalls, messages, context };
}

const matchingReference = await runWompiAttempt('JMRES-SYNTHETIC-REFERENCE');
assert.equal(matchingReference.quoteCalls, 1, `quote request reaches its stub; messages=${matchingReference.messages.join(' | ')}`);
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

assert.ok(index.includes('function sanitizeCODOrderDraft()'),
  'the local COD draft must be reduced to its opaque reference');
assert.ok(index.includes('JSON.stringify({reference})'),
  'the browser may persist only the opaque COD reference, not buyer fields');
assert.doesNotMatch(index, /getCODOrderFingerprint|customer:\[payload\.name/,
  'the browser must not persist a fingerprint derived from customer PII');
assert.doesNotMatch(index, /release_inventory_reservation|releaseInventoryReservation/,
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

assert.doesNotMatch(wompiCreate, /releaseReservationIfNoOrder|releaseSideEffectsIfNoOrder/,
  'the Edge must not use separate order reads followed by a reservation release');
assert.match(wompiCreate, /cualquier hold incierto vencerá por TTL/,
  'ambiguous server-side holds must expire by TTL instead of a non-atomic cleanup');

console.log('Inventory reservation client boundary regression passed, including Wompi reference match/mismatch flows.');
