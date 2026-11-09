import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(here, '..', 'admin.html'), 'utf8');

// Static HTML must not promise free shipping before the runtime settings RPC is verified.
assert.doesNotMatch(html, /<span>♥ Envío gratis en Cali<\/span>/);
assert.doesNotMatch(html, /<small>\$0 de envío<\/small>/);
assert.match(html, /<small>Tarifa pendiente de verificación<\/small>/);
assert.match(html, /id="cartShippingMessage" class="cartShippingMessage">Consultando la tarifa vigente de envío/);
assert.match(html, /class="cartShippingTrack" style="display:none" hidden aria-hidden="true"/);
assert.match(html, /id="cartShippingPercent">—<\/span>/);
assert.match(html, /class="cartShippingLocalNote" hidden/);
assert.doesNotMatch(html, /Descubre la temporada y aprovecha el envío gratis a Cali\./);
assert.doesNotMatch(html, /Descubre tus favoritos y aprovecha el envío gratis a Cali\./);
const promoDefault = adminHtml.match(/<textarea id="seasonalPromoMessageInput"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? '';
const promoPresets = adminHtml.match(/const SIREVYA_PROMO_PRESETS=\{([\s\S]*?)\n\};/)?.[1] ?? '';
assert.ok(promoDefault && promoPresets, 'El admin contiene mensaje por defecto y presets promocionales');
assert.doesNotMatch(promoDefault + promoPresets, /env[ií]o gratis a Cali/i, 'Los textos promocionales no prometen Cali gratis si existe una tarifa propia');
assert.match(promoDefault, /tarifa de env[ií]o seg[uú]n tu ciudad/i, 'El mensaje inicial remite al costo real según ciudad');

assert.match(html, /id="checkoutTotal">Por verificar<\/span>/);
assert.match(html, /id="shippingNote" class="shippingSmall">La tarifa se confirma al verificar la configuración vigente\./);

function extractFunction(name) {
  const marker = `function ${name}(`;
  let start = html.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  if (html.slice(start - 6, start) === 'async ') start -= 6;
  const open = html.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${name}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

function element(id, extra = {}) {
  return {
    id,
    textContent: '',
    innerHTML: '',
    hidden: false,
    style: {},
    attributes: {},
    setAttribute(key, value) { this.attributes[key] = String(value); },
    removeAttribute(key) { delete this.attributes[key]; },
    ...extra,
  };
}

function makeContext() {
  const ticker = element('ticker');
  const tickerCopy = element('tickerCopy');
  const caliBenefit = element('caliBenefit');
  const otherBenefit = element('otherBenefit');
  const cartFoot = element('cartFoot');
  const rule = () => {
    const heading = element('heading');
    const copy = element('copy');
    return { querySelector(selector) { return selector === 'b' ? heading : copy; }, heading, copy };
  };
  const caliRule = rule();
  const otherRule = rule();
  const track = element('track', { hidden: true, style: { display: 'none' } });
  const fill = element('cartShippingFill', { parentElement: track });
  const localNote = element('localNote', { hidden: true });
  const nodes = new Map([
    ['cartShippingMessage', element('cartShippingMessage')],
    ['cartShippingFill', fill],
    ['cartShippingTruck', element('cartShippingTruck')],
    ['cartShippingPercent', element('cartShippingPercent')],
    ['shippingValue', element('shippingValue')],
    ['shippingNote', element('shippingNote')],
    ['checkoutTotal', element('checkoutTotal')],
    ['customerCity', element('customerCity', { value: '' })],
    ['customerCityOther', element('customerCityOther', { value: '' })],
    ['checkoutPaymentNote', element('checkoutPaymentNote')],
  ]);
  const selectors = new Map([
    ['.jmTickerTrack [data-shipping-policy]', ticker],
    ['.benefits .benefit:nth-child(1) small', caliBenefit],
    ['.benefits .benefit:nth-child(2) small', otherBenefit],
    ['.cartShippingFoot span:first-child', cartFoot],
    ['.cartShippingTrack', track],
    ['.cartShippingLocalNote', localNote],
  ]);
  let rpcResult = {
    data: [{ success: true, national_shipping_cost: 15000, free_shipping_threshold: 130000, free_shipping_in_cali: true }],
    error: null,
  };
  const context = {
    DEFAULT_STOREFRONT_SHIPPING_SETTINGS: { national_shipping_cost: 15000, free_shipping_threshold: 130000, free_shipping_in_cali: true },
    storefrontShippingSettings: { national_shipping_cost: 15000, free_shipping_threshold: 130000, free_shipping_in_cali: true },
    storefrontShippingSettingsLoaded: false,
    storefrontShippingSettingsLoadError: false,
    storefrontShippingSettingsPromise: null,
    storefrontShippingSettingsRefreshPending: false,
    checkoutShipping: 0,
    money(value) { return '$' + Number(value).toLocaleString('en-US'); },
    $(id) { return nodes.get(id) ?? null; },
    document: {
      querySelector(selector) { return selectors.get(selector) ?? null; },
      querySelectorAll(selector) {
        if (selector === '.detailShippingBenefits .detailShippingRule') return [caliRule, otherRule];
        if (selector === '.jmTickerTrack [data-shipping-policy-copy]') return [tickerCopy];
        return [];
      },
    },
    sb: { async rpc() { return rpcResult; } },
    console: { warn() {} },
    renderCart() { context.updateCartShippingProgress(100000); },
    updateContraEntregaAvailability() {},
    getCheckoutItems() { return []; },
    calculateStorefrontComboPricing() { return { subtotal: 100000, discountTotal: 0, lines: [], applied: [] }; },
    checkoutCityValue() {
      const selected = nodes.get('customerCity').value || '';
      return selected === 'Otra' ? (nodes.get('customerCityOther').value || '').trim() : selected;
    },
    setRpcResult(value) { rpcResult = value; },
    nodes,
    ticker,
    tickerCopy,
    caliBenefit,
    otherBenefit,
    cartFoot,
    caliRule,
    otherRule,
    track,
    localNote,
  };
  vm.createContext(context);
  const names = [
    'normalizeDeliveryCity',
    'canonicalLocalDeliveryCity',
    'storefrontShippingDestinationKey',
    'resolveStorefrontShippingRule',
    'calculateStorefrontShipping',
    'storefrontShippingPolicyText',
    'updateStorefrontShippingCopy',
    'loadStorefrontShippingSettings',
    'updateCartShippingProgress',
    'storefrontShippingDisplayVerified',
    'updateShipping',
    'updateCheckoutSummary',
  ];
  vm.runInContext(names.map(extractFunction).join('\n'), context, { filename: 'index.html#shipping-functions' });
  return context;
}

const ctx = makeContext();
ctx.updateStorefrontShippingCopy();
ctx.updateCartShippingProgress(100000);
assert.equal(ctx.ticker.textContent, '✦ Consulta la tarifa vigente al seleccionar tu ciudad');
assert.equal(ctx.tickerCopy.textContent, ctx.ticker.textContent, 'El clone aria-hidden refleja el mismo estado neutral.');
assert.equal(ctx.caliBenefit.textContent, 'Tarifa por confirmar');
assert.match(ctx.nodes.get('cartShippingMessage').textContent, /Consultando la tarifa vigente/);
assert.equal(ctx.track.hidden, true);
assert.equal(ctx.track.style.display, 'none');
assert.equal(ctx.track.attributes['aria-hidden'], 'true');
assert.equal(ctx.nodes.get('cartShippingPercent').textContent, '—');
assert.equal(ctx.localNote.hidden, true);

ctx.nodes.get('customerCity').value = 'Cali';
ctx.updateShipping();
assert.equal(ctx.nodes.get('shippingValue').textContent, 'Verificando…');
assert.equal(ctx.nodes.get('checkoutTotal').textContent, 'Por verificar');
assert.equal(ctx.storefrontShippingDisplayVerified('Cali', 'Cali'), false);
assert.equal(ctx.storefrontShippingDisplayVerified('Otra', ''), false);

assert.equal(await ctx.loadStorefrontShippingSettings(), true);
assert.equal(ctx.storefrontShippingSettingsLoaded, true);
assert.equal(ctx.storefrontShippingSettingsLoadError, false);
assert.equal(ctx.tickerCopy.textContent, ctx.ticker.textContent, 'El clone se actualiza con el valor retornado por el RPC sintético.');
assert.equal(ctx.tickerCopy.textContent, '✦ Envío gratis desde $130,000 fuera de Cali');
assert.equal(ctx.caliBenefit.textContent, 'Envío gratis');
assert.equal(ctx.localNote.hidden, false);
ctx.updateCartShippingProgress(130000);
assert.equal(ctx.track.hidden, false);
assert.equal(ctx.track.style.display, '');
assert.equal(ctx.track.attributes['aria-hidden'], undefined);
assert.equal(ctx.caliRule.heading.textContent, 'Envío gratis en Cali');
assert.match(ctx.nodes.get('cartShippingMessage').innerHTML, /pedido ya tiene envío gratis/);
ctx.updateShipping();
assert.equal(ctx.nodes.get('shippingValue').textContent, 'GRATIS');
assert.equal(ctx.nodes.get('checkoutTotal').textContent, '$100,000');
assert.equal(ctx.storefrontShippingDisplayVerified('Cali', 'Cali'), true);

// Cali and its aliases stay free without a city override.
ctx.nodes.get('customerCity').value = 'Santiago de Cali';
ctx.updateShipping();
assert.equal(ctx.nodes.get('shippingValue').textContent, 'GRATIS');

// A verified city rule overrides the legacy free fallback; aliases resolve to the same key.
ctx.setRpcResult({ data: [{
  success: true, national_shipping_cost: 15000, free_shipping_threshold: 130000, free_shipping_in_cali: false,
  destination_rules: [{ id: 'cali-paid', scope: 'city', name: 'Cali', priority: 0, shipping_cost: 12000, free_shipping_threshold: null, destinations: ['Cali'] }],
}], error: null });
assert.equal(await ctx.loadStorefrontShippingSettings(true), true);
ctx.nodes.get('customerCity').value = 'Santiago de Cali';
ctx.updateShipping();
assert.equal(ctx.nodes.get('shippingValue').textContent, '$12,000');
assert.equal(ctx.nodes.get('checkoutTotal').textContent, '$112,000');
assert.equal(ctx.caliBenefit.textContent, 'Tarifa por consultar');
assert.match(ctx.ticker.textContent, /Tarifa de Cali según regla/);
assert.match(ctx.localNote.textContent, /tarifa/i);
assert.equal(ctx.resolveStorefrontShippingRule('Cali Valle del Cauca').fee, 12000);

ctx.nodes.get('customerCity').value = 'Otra';
ctx.nodes.get('customerCityOther').value = '';
ctx.updateShipping();
assert.equal(ctx.nodes.get('shippingValue').textContent, 'Escribe tu ciudad');
assert.equal(ctx.nodes.get('checkoutTotal').textContent, 'Por verificar');
ctx.nodes.get('customerCityOther').value = 'Pasto';
ctx.updateShipping();
assert.equal(ctx.nodes.get('shippingValue').textContent, '$15,000');
assert.equal(ctx.nodes.get('checkoutTotal').textContent, '$115,000');

ctx.setRpcResult({ data: null, error: new Error('simulated settings RPC failure') });
assert.equal(await ctx.loadStorefrontShippingSettings(true), false);
assert.equal(ctx.storefrontShippingSettingsLoadError, true);
ctx.updateShipping();
ctx.updateCartShippingProgress(130000);
assert.equal(ctx.nodes.get('shippingValue').textContent, 'No disponible');
assert.equal(ctx.nodes.get('checkoutTotal').textContent, 'Por verificar');
assert.match(ctx.nodes.get('cartShippingMessage').textContent, /No se pudo verificar/);
assert.equal(ctx.track.hidden, true);
assert.equal(ctx.track.style.display, 'none');
assert.equal(ctx.track.attributes['aria-hidden'], 'true');
assert.equal(ctx.caliRule.heading.textContent, 'Tarifa en Cali');
assert.equal(ctx.tickerCopy.textContent, ctx.ticker.textContent, 'El clone conserva el mensaje de verificación fallida.');
assert.equal(ctx.caliBenefit.textContent, 'Tarifa por confirmar');
assert.equal(ctx.localNote.hidden, true);

console.log('PASS prelaunch shipping copy regression: neutral initial state, verified success, destination gating, checkout total gating, and RPC failure.');
