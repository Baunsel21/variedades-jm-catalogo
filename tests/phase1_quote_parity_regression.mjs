import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const catalog = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const progressSource = catalog.match(/function updateCartShippingProgress\(total\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(progressSource, 'Debe existir el renderizador del estado de envío del carrito');

const nodes = {
  cartShippingMessage: {textContent: '', innerHTML: ''},
  cartShippingFill: {style: {}, parentElement: null},
  cartShippingTruck: {style: {}},
  cartShippingPercent: {textContent: ''}
};
const track = {
  hidden: false,
  style: {},
  attrs: {},
  setAttribute(name, value) { this.attrs[name] = String(value); },
  removeAttribute(name) { delete this.attrs[name]; }
};
nodes.cartShippingFill.parentElement = track;
const caliNote = {hidden: false};
const context = vm.createContext({
  storefrontShippingSettings: {national_shipping_cost: 15000, free_shipping_threshold: 130000, destination_rules: []},
  storefrontShippingSettingsLoaded: false,
  storefrontShippingSettingsLoadError: false,
  $: id => nodes[id] || null,
  document: {querySelector: selector => selector === '.cartShippingLocalNote' ? caliNote : null},
  money: value => `COP ${Number(value)}`
});
new vm.Script(progressSource).runInContext(context);

context.updateCartShippingProgress(129999);
assert.match(nodes.cartShippingMessage.textContent, /Consultando la tarifa vigente/);
assert.equal(track.hidden, true, 'Oculta la barra antes de la confirmación de Supabase');
assert.equal(track.attrs['aria-hidden'], 'true');
assert.equal(nodes.cartShippingPercent.textContent, '—');
assert.equal(caliNote.hidden, true, 'No muestra el beneficio local antes de verificar la política');
assert.ok(!nodes.cartShippingMessage.textContent.includes('15.000') && !nodes.cartShippingMessage.textContent.includes('130.000'));

context.storefrontShippingSettingsLoadError = true;
context.updateCartShippingProgress(129999);
assert.match(nodes.cartShippingMessage.textContent, /No se pudo verificar la tarifa vigente/);
assert.equal(track.hidden, true, 'Un error de lectura no convierte el fallback en precio confirmado');

context.storefrontShippingSettingsLoaded = true;
context.storefrontShippingSettingsLoadError = false;
context.updateCartShippingProgress(129999);
assert.equal(track.hidden, false, 'Muestra la barra tras confirmar una configuración válida');
assert.equal(track.style.display, '');
assert.equal(nodes.cartShippingMessage.innerHTML.includes('COP 1'), true, 'Calcula el progreso con la tarifa verificada');
assert.equal(caliNote.hidden, false, 'Solo entonces vuelve a mostrar el beneficio de Cali');

assert.ok(catalog.includes('storefrontShippingSettingsLoaded&&!storefrontShippingSettingsLoadError'), 'Checkout exige configuración cargada y sin fallo de refresco');
assert.ok(catalog.includes("textContent=shippingConfigurationVerified?money(total):'—'"), 'Oculta el total hasta verificar la tarifa');
assert.ok(catalog.includes("const shippingSettingsVerified=await loadStorefrontShippingSettings(true);\n if(!shippingSettingsVerified){showToast('No pudimos verificar la tarifa de envío vigente."), 'La confirmación vuelve a consultar Supabase y falla cerrada');
assert.ok(catalog.includes('Consultando la tarifa vigente de envío…') && catalog.includes('class="cartShippingLocalNote" hidden') && catalog.includes('class="cartShippingTrack" hidden'), 'El HTML inicial no promete una política ni un progreso sin verificar');

console.log('OK phase1_quote_parity_regression: carga, fallo y tarifa verificada sin mostrar fallbacks como vigentes.');
