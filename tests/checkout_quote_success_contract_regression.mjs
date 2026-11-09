import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = `async function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Falta la función async ${name}`);
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
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Función ${name} sin cierre`);
}

function extractSyncFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Falta la función ${name}`);
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
const normalizeCitySource = extractSyncFunction('normalizeDeliveryCity');
const canonicalCitySource = extractSyncFunction('canonicalLocalDeliveryCity');
const shippingSource = extractSyncFunction('calculateStorefrontShipping');
const destinationKeySource = source.includes('function storefrontShippingDestinationKey(')
  ? extractSyncFunction('storefrontShippingDestinationKey')
  : '';
const shippingRuleSource = source.includes('function resolveStorefrontShippingRule(')
  ? extractSyncFunction('resolveStorefrontShippingRule')
  : '';
const syntheticItems = [{ id: 'synthetic-product', qty: 2, color: 'Azul', size: 'M' }];
const settings = { national_shipping_cost: 15000, free_shipping_threshold: 130000, free_shipping_in_cali: true };

async function runCheckout({ city, payment, subtotal, discount, quote, expectedDispatch, name }) {
  let quoteRpcCalls = 0;
  let updateSummaryCalls = 0;
  let wompiCalls = 0;
  let codCalls = 0;
  let resetCalls = 0;
  let capturedPayload = null;
  let receivedQuote = null;
  const messages = [];
  const shippingContext = vm.createContext({
    DEFAULT_STOREFRONT_SHIPPING_SETTINGS: settings,
    storefrontShippingSettings: settings,
  });
  vm.runInContext([normalizeCitySource, canonicalCitySource, destinationKeySource, shippingRuleSource, shippingSource].filter(Boolean).join('\n'), shippingContext);
  const calculateShipping = shippingContext.calculateStorefrontShipping;
  const initialShipping = calculateShipping(city, subtotal, settings);
  const context = vm.createContext({
    checkoutShipping: initialShipping,
    onlinePaymentsEnabled: true,
    checkoutCouponCode: '',
    normalizeCheckoutCouponCode: value => String(value || '').trim().toUpperCase(),
    currentCheckoutCouponQuote: () => null,
    setCheckoutServerQuote(quote) { receivedQuote = quote; context.checkoutShipping = quote.shipping; },
    checkoutDisplayPricing: () => ({ isCouponQuote: false, subtotal, discountTotal: discount }),
    $: () => null,
    getCheckoutItems: () => syntheticItems,
    getCheckoutValidationErrors: () => [],
    displayCheckoutValidation() { assert.fail('El fixture debe ser válido'); },
    clearCheckoutValidation() {},
    calculateStorefrontComboPricing: () => ({ subtotal, discountTotal: discount }),
    selectedPayment: () => payment,
    refreshOnlinePaymentSetting: async () => {},
    refreshCODPaymentSettings: async () => {},
    loadStorefrontShippingSettings: async () => true,
    updateShipping() {
      context.checkoutShipping = receivedQuote ? receivedQuote.shipping : calculateShipping(city, subtotal, settings);
      if (receivedQuote) context.updateCheckoutSummary();
    },
    syncPaymentOptions() {},
    isLocalCODCity: value => shippingContext.canonicalLocalDeliveryCity(value) === 'Cali',
    checkoutCityValue: () => city,
    loadStorefrontProductCombos: async () => {},
    sb: {
      async rpc(name, args) {
        assert.equal(name, 'get_storefront_cart_quote');
        quoteRpcCalls += 1;
        assert.equal(args.p_city, city);
        assert.deepEqual(JSON.parse(JSON.stringify(args.p_items)), [{ id: 'synthetic-product', qty: 2, color: 'Azul', size: 'M' }]);
        return { data: quote, error: null };
      },
    },
    async requestCheckoutQuote(_code, items) {
      const { data, error } = await context.sb.rpc('get_storefront_cart_quote', {
        p_city: city,
        p_items: items.map(item => ({ id: String(item.id), qty: Math.max(1, Number(item.qty) || 1),
          color: String(item.color || '').trim(), size: String(item.size || '').trim() })),
      });
      if (error) throw error;
      return data;
    },
    updateCheckoutSummary() { updateSummaryCalls += 1; },
    buildOrderPayload: () => ({ name: 'Fixture', city, phone: '0000000000', address: 'Synthetic address' }),
    payWithWompi(payload) { wompiCalls += 1; capturedPayload = { ...payload }; },
    async saveContraEntregaOrder(payload) { codCalls += 1; capturedPayload = { ...payload }; },
    showToast(message) { messages.push(String(message)); },
    resetWompiButton() { resetCalls += 1; },
    console: { error() {}, warn() {} },
  });

  vm.runInContext(confirmCheckoutSource, context);
  await context.confirmCheckout();
  assert.equal(quoteRpcCalls, 1, `${name}: una sola quote autoritativa`);
  assert.equal(syntheticItems.length, 1, `${name}: se conserva el carrito sintético`);
  assert.equal(syntheticItems[0].id, 'synthetic-product');

  if (expectedDispatch) {
    assert.equal(payment === 'Contra entrega' ? codCalls : wompiCalls, 1, `${name}: se despacha el método seleccionado una sola vez`);
    assert.equal(payment === 'Contra entrega' ? wompiCalls : codCalls, 0, `${name}: no se invoca el otro método de pago`);
    assert.equal(capturedPayload.shipping, quote.shipping, `${name}: envío autoritativo en el payload`);
    assert.equal(capturedPayload.expected_total, quote.total, `${name}: total autoritativo en el payload`);
    assert.equal(capturedPayload.expected_discount_total, quote.discount_total, `${name}: descuento autoritativo en el payload`);
    assert.equal(capturedPayload.storefront_pricing_version, 'combo-discounts-v1');
    assert.equal(context.checkoutShipping, quote.shipping);
    assert.equal(updateSummaryCalls, 1, `${name}: el resumen refleja la cotización aceptada`);
    assert.equal(resetCalls, 0);
  } else {
    assert.equal(wompiCalls, 0, `${name}: no abre ni inicia Wompi con discrepancia`);
    assert.equal(codCalls, 0, `${name}: no crea contraentrega con discrepancia`);
    assert.equal(context.checkoutShipping, quote.shipping, `${name}: actualiza la tarifa mostrada para el siguiente intento`);
    assert.equal(updateSummaryCalls, 1, `${name}: presenta el total actualizado sin despachar`);
    assert.ok(messages.some(message => /pulsa confirmar otra vez/.test(message)), `${name}: pide confirmar el nuevo total`);
  }
}

const successfulCases = [
  { name: 'Cali COD gratis', city: 'Cali', payment: 'Contra entrega', subtotal: 129999, discount: 12000, shipping: 0 },
  { name: 'alias Santiago de Cali COD gratis', city: 'Santiago de Cali', payment: 'Contra entrega', subtotal: 129999, discount: 12000, shipping: 0 },
  { name: 'Cali Valle del Cauca COD gratis', city: 'Cali Valle del Cauca', payment: 'Contra entrega', subtotal: 129999, discount: 12000, shipping: 0 },
  { name: 'Bogotá bajo umbral', city: 'Bogotá', payment: 'PSE', subtotal: 129999, discount: 12000, shipping: 15000 },
  { name: 'Bogotá umbral exacto', city: 'Bogotá', payment: 'PSE', subtotal: 130000, discount: 12000, shipping: 0 },
  { name: 'Bogotá sobre umbral', city: 'Bogotá', payment: 'PSE', subtotal: 130001, discount: 12000, shipping: 0 },
];
const makeQuote = (total, discountTotal, shipping) => ({
  success: true,
  total,
  discount_total: discountTotal,
  shipping,
  original_subtotal: total - shipping + discountTotal,
  discounted_subtotal: total - shipping,
  coupon_discount_total: 0,
});
for (const scenario of successfulCases) {
  await runCheckout({
    ...scenario,
    quote: makeQuote(scenario.subtotal + scenario.shipping, scenario.discount, scenario.shipping),
    expectedDispatch: true,
    name: scenario.name,
  });
}

const mismatchCases = [
  {
    name: 'COD descuento distinto', city: 'Santiago de Cali', payment: 'Contra entrega', subtotal: 50000, discount: 12000,
    quote: makeQuote(50000, 11000, 0),
  },
  {
    name: 'PSE tarifa distinta', city: 'Bogotá', payment: 'PSE', subtotal: 100000, discount: 12000,
    quote: makeQuote(100000, 12000, 0),
  },
  {
    name: 'COD total distinto', city: 'Cali Valle del Cauca', payment: 'Contra entrega', subtotal: 50000, discount: 12000,
    quote: makeQuote(50001, 12000, 0),
  },
];
for (const scenario of mismatchCases) await runCheckout({ ...scenario, expectedDispatch: false, name: scenario.name });

console.log('OK checkout_quote_success_contract_regression: PASS; quote completa, Cali y alias, umbral de envío, COP/descuento exactos y mismatch fail-closed; todo sintético.');
