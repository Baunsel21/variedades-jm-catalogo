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

const knownCities = source.match(/const COD_KNOWN_CITY_KEYS=\[[^\n]+\];/)?.[0];
assert.ok(knownCities, 'Debe existir el contrato de ciudades conocidas de COD');
const helpers = [
  extractFunction('normalizeDeliveryCity'),
  extractFunction('canonicalLocalDeliveryCity'),
  extractFunction('normalizeCODCityKey'),
  knownCities,
  extractFunction('isLocalCODCity'),
].join('\n');

const context = vm.createContext({ codPaymentEnabled: true, codAllowedCities: ['Cali'] });
vm.runInContext(helpers, context);
for (const alias of ['Cali', 'Santiago de Cali', 'Cali Valle del Cauca']) {
  assert.equal(context.isLocalCODCity(alias), true, `${alias} debe coincidir con Cali en COD`);
}

context.codAllowedCities = ['Santiago de Cali'];
assert.equal(context.isLocalCODCity('Cali'), true, 'La ciudad canónica coincide con un alias guardado');
context.codAllowedCities = ['__other__'];
assert.equal(context.isLocalCODCity('Santiago de Cali'), false, 'Un alias de Cali no se clasifica como ciudad desconocida');
assert.equal(context.isLocalCODCity('Palmira'), true, 'Se conserva la regla existente de ciudades no listadas');
context.codPaymentEnabled = false;
assert.equal(context.isLocalCODCity('Cali'), false, 'COD desactivado continúa fallando cerrado');

const cityOption = value => ({ value, hidden: false, disabled: false });
const citySelect = {
  innerHTML: '<option value="Cali">Cali</option><option value="Otra">Otra</option>',
  value: 'Cali',
  options: [cityOption(''), cityOption('Cali'), cityOption('Otra')],
};
const otherWrap = { hidden: false };
const otherInput = { required: false, value: '' };
const dropdownContext = vm.createContext({
  onlinePaymentsEnabled: false,
  codPaymentEnabled: true,
  codAllowedCities: ['Santiago de Cali'],
  originalCustomerCityOptionsHTML: null,
  $(id) {
    if (id === 'customerCity') return citySelect;
    if (id === 'customerCityOtherWrap') return otherWrap;
    if (id === 'customerCityOther') return otherInput;
    return null;
  },
});
vm.runInContext([
  extractFunction('normalizeDeliveryCity'),
  extractFunction('canonicalLocalDeliveryCity'),
  extractFunction('normalizeCODCityKey'),
  knownCities,
  extractFunction('syncCustomerCityOptionsForPaymentMode'),
].join('\n'), dropdownContext);
dropdownContext.syncCustomerCityOptionsForPaymentMode();
assert.equal(citySelect.options[1].hidden, false, 'Cali permanece visible si el servidor lista su alias');
assert.equal(citySelect.options[1].disabled, false);
assert.equal(citySelect.options[2].hidden, true, 'Otra ciudad no se habilita por una regla exclusiva de Cali');
assert.equal(citySelect.value, 'Cali');

console.log('OK storefront_cod_city_alias_regression: Cali y aliases comparten clave COD; la opción Otra conserva su regla, sin red ni pagos.');
