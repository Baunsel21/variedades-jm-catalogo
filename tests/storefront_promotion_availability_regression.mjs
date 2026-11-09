import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const extract = (pattern, message) => {
  const source = html.match(pattern)?.[0];
  assert.ok(source, message);
  return source;
};

const state = extract(/let storefrontProductCombosState='loading';/, 'El estado de disponibilidad de combos debe iniciar en carga.');
const message = extract(/function storefrontComboAvailabilityMessage\(state\)\{[\s\S]*?\n\}/, 'Debe existir un mensaje puro para la indisponibilidad de promociones.');
const setter = extract(/function setStorefrontComboAvailability\(state\)\{[\s\S]*?\n\}/, 'Debe existir un setter de disponibilidad de combos.');
const statusElement = { hidden: true, textContent: '' };
const context = vm.createContext({
  $: id => id === 'storefrontComboCatalogStatus' ? statusElement : null,
});
new vm.Script(`${state}\n${message}\n${setter}`).runInContext(context);

assert.equal(context.storefrontComboAvailabilityMessage('unavailable'), 'Las promociones combinadas no están disponibles en este momento. No se aplicó ningún descuento adicional; puedes comprar los productos por separado.');
assert.equal(context.storefrontComboAvailabilityMessage('ready'), '');

context.setStorefrontComboAvailability('unavailable');
assert.equal(statusElement.hidden, false);
assert.match(statusElement.textContent, /No se aplicó ningún descuento adicional/);
context.setStorefrontComboAvailability('ready');
assert.equal(statusElement.hidden, true);
assert.equal(statusElement.textContent, '');
context.setStorefrontComboAvailability('unexpected');
assert.equal(statusElement.hidden, false, 'Un estado desconocido debe fallar cerrado.');

assert.match(html, /id="storefrontComboCatalogStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
assert.match(html, /catch\(error\)\{[\s\S]*?storefrontProductCombos=\[\];[\s\S]*?setStorefrontComboAvailability\('unavailable'\);[\s\S]*?renderStorefrontComboCatalog\(\);[\s\S]*?renderCart\(\);/);
assert.doesNotMatch(setter, /\b(?:fetch|XMLHttpRequest|sendBeacon|\.rpc\s*\(|\.from\s*\()/, 'El estado de UI no hace llamadas remotas.');

console.log('OK storefront_promotion_availability_regression: estado accesible, fail-closed ante RPC de combos fallida, sin descuento obsoleto ni llamadas remotas en el helper.');
