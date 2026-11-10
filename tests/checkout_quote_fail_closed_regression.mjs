import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const asyncMarker = `async function ${name}(`;
  const syncMarker = `function ${name}(`;
  const asyncStart = source.indexOf(asyncMarker);
  const marker = asyncStart >= 0 ? asyncMarker : syncMarker;
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(syncMarker);
  assert.notEqual(start, -1, `Falta la función async ${name}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `Falta el cuerpo de ${name}`);
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
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Función ${name} sin cierre`);
}

const confirmCheckoutSource = extractFunction('confirmCheckout');
const payWithWompiSource = extractFunction('payWithWompi');
const quoteHelperSource = [
  'normalizeCheckoutCouponCode',
  'checkoutQuoteItems',
  'normalizeCheckoutQuote',
  'quoteErrorMessage',
  'quoteHasValidTotals',
  'requestCheckoutQuote',
].map(extractFunction).join('\n');
const syntheticItems = [{ id: 'synthetic-product', qty: 1, color: '', size: '' }];
const failedQuotes = [
  { data: null, error: new Error('synthetic quote RPC failure') },
  { data: null, error: null },
  { data: { success: true, total: 10000, discount_total: 0 }, error: null },
];

for (const mode of ['PSE', 'Contra entrega']) {
  for (const quoteResponse of failedQuotes) {
    let quoteRpcCalls = 0;
    let wompiCalls = 0;
    let codCalls = 0;
    let resetCalls = 0;
    const messages = [];
    const context = vm.createContext({
      $: () => null,
      checkoutShipping: 0,
      checkoutCouponCode: '',
      storefrontCouponSettingsLoaded: true,
      storefrontCouponsEnabled: true,
      onlinePaymentsEnabled: mode !== 'Contra entrega',
      getCheckoutItems: () => syntheticItems,
      getCheckoutValidationErrors: () => [],
      displayCheckoutValidation() { assert.fail('El fixture de formulario es válido'); },
      clearCheckoutValidation() {},
      calculateStorefrontComboPricing: () => ({ subtotal: 10000, discountTotal: 0 }),
      checkoutDisplayPricing: () => ({ isCouponQuote: false, subtotal: 10000, discountTotal: 0, total: 10000 }),
      currentCheckoutCouponQuote: () => null,
      refreshStorefrontCouponSettings: async () => true,
      setCheckoutServerQuote() {},
      clearCheckoutServerQuote() {},
      setCheckoutCouponStatus() {},
      selectedPayment: () => mode,
      refreshOnlinePaymentSetting: async () => {},
      refreshCODPaymentSettings: async () => {},
      loadStorefrontShippingSettings: async () => true,
      updateShipping() {},
      syncPaymentOptions() {},
      isLocalCODCity: () => true,
      checkoutCityValue: () => 'Cali',
      loadStorefrontProductCombos: async () => {},
      sb: {
        async rpc(name) {
          assert.equal(name, 'get_storefront_cart_quote');
          quoteRpcCalls += 1;
          return quoteResponse;
        },
      },
      updateCheckoutSummary() { assert.fail('Una quote fallida no actualiza un total con datos incompletos'); },
      buildOrderPayload() { assert.fail('No se genera payload después de fallo de cotización'); },
      payWithWompi() { wompiCalls += 1; },
      saveContraEntregaOrder() { codCalls += 1; },
      showToast(message) { messages.push(String(message)); },
      resetWompiButton() { resetCalls += 1; },
      console: { error() {} },
    });

    vm.runInContext(`${quoteHelperSource}\n${confirmCheckoutSource}`, context);
    await context.confirmCheckout();
    assert.equal(quoteRpcCalls, 1);
    assert.equal(wompiCalls, 0, `${mode}: la cotización fallida no inicia Wompi`);
    assert.equal(codCalls, 0, `${mode}: la cotización fallida no crea un pedido COD`);
    assert.equal(resetCalls, 1, `${mode}: se restablece el control de confirmar`);
    assert.ok(messages.some(message => /No pudimos verificar el descuento/.test(message)));
  }
}

for (const quoteResponse of failedQuotes) {
  let fetchCalls = 0;
  let releaseCalls = 0;
  let resetCalls = 0;
  const button = { disabled: false, textContent: '' };
  const messages = [];
  const context = vm.createContext({
    onlinePaymentsEnabled: true,
    checkoutCouponCode: '',
    storefrontCouponSettingsLoaded: true,
    storefrontCouponsEnabled: true,
    checkoutShipping: 0,
    checkoutCityValue: () => 'Cali',
    location: { protocol: 'https:', hostname: 'sirevya.com.co' },
    window: { __sirevyaWompiInProgress: false },
    getCheckoutItems: () => syntheticItems,
    currentCheckoutCouponQuote: () => null,
    checkoutDisplayPricing: () => ({ isCouponQuote: false, subtotal: 10000, discountTotal: 0, total: 10000 }),
    setCheckoutCouponQuote() {},
    setCheckoutCouponStatus() {},
    setCheckoutServerQuote() {},
    clearCheckoutServerQuote() {},
    updateShipping() {},
    refreshOnlinePaymentSetting: async () => {},
    syncPaymentOptions() {},
    $: id => id === 'checkoutConfirmBtn' ? button : null,
    sb: {
      async rpc(name) {
        assert.equal(name, 'get_storefront_cart_quote');
        return quoteResponse;
      },
    },
    fetch: async () => { fetchCalls += 1; throw new Error('No debe llegar a la Edge function'); },
    releaseInventoryReservation: async () => { releaseCalls += 1; },
    showToast(message) { messages.push(String(message)); },
    resetWompiButton() { resetCalls += 1; button.disabled = false; },
    console: { error() {}, warn() {} },
  });

  vm.runInContext(`${quoteHelperSource}\n${payWithWompiSource}`, context);
  await context.payWithWompi({ name: 'Fixture', city: 'Cali', phone: '0000000000' });
  assert.equal(fetchCalls, 0, 'La cotización fallida no llama a wompi-create-checkout');
  assert.equal(releaseCalls, 0, 'No se libera una reserva ajena o previa: no se creó una en este intento');
  assert.equal(resetCalls, 1);
  assert.equal(context.window.__sirevyaWompiInProgress, false);
  assert.equal(messages.length, 1, 'el error de la cotización informa al operador antes de cualquier cobro');
  assert.ok(messages[0].trim().length > 0);
}

console.log('OK checkout_quote_fail_closed_regression: errores/quotes incompletas no llaman a Wompi ni crean COD; pruebas locales, sin red ni escrituras.');
