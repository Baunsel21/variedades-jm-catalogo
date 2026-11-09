import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Falta ${name}`);
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

assert.match(source, /id="shippingCityHint" class="shippingSmall" role="status" aria-live="polite"/);
assert.match(source, /aria-describedby="checkoutErrorCustomerCity shippingCityHint"/);

const hintSource = extractFunction('updateShippingCityHint');
assert.doesNotMatch(hintSource, /\b(?:sb|fetch|localStorage|sessionStorage|rpc)\b/i, 'La ayuda no debe consultar ni simular persistencia');

const nodes = {
  shippingCityHint: { textContent: '' },
  customerCity: { value: '' },
  customerCityOther: { value: '' },
};
const context = vm.createContext({
  $(id) {
    return nodes[id] || null;
  },
});
vm.runInContext([
  extractFunction('normalizeDeliveryCity'),
  extractFunction('canonicalLocalDeliveryCity'),
  hintSource,
].join('\n'), context);

context.updateShippingCityHint();
assert.match(nodes.shippingCityHint.textContent, /Santiago de Cali/);

nodes.customerCity.value = 'Cali';
context.updateShippingCityHint();
assert.match(nodes.shippingCityHint.textContent, /comparten la referencia/);
assert.match(nodes.shippingCityHint.textContent, /servidor confirmará/);

nodes.customerCity.value = 'Otra';
nodes.customerCityOther.value = '';
context.updateShippingCityHint();
assert.equal(nodes.shippingCityHint.textContent, 'Escribe tu ciudad para consultar el valor de envío vigente.');

nodes.customerCityOther.value = '  Santiago de Cali  ';
context.updateShippingCityHint();
assert.match(nodes.shippingCityHint.textContent, /Cali, Santiago de Cali y Cali Valle del Cauca/);

nodes.customerCityOther.value = 'Bogotá';
context.updateShippingCityHint();
assert.equal(nodes.shippingCityHint.textContent, 'La tarifa de Bogotá se confirma al verificar la configuración vigente antes de finalizar.');

console.log('OK storefront_shipping_city_hint_ui_regression: estados de ciudad, aliases de Cali y fallback informativo; sin red ni persistencia.');
