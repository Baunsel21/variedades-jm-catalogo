import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const extract = (pattern, message) => {
  const source = html.match(pattern)?.[0];
  assert.ok(source, message);
  return source;
};
const availabilityState = extract(/let catalogAvailabilityFilter='available';/, 'El filtro conserva Disponibles como opción inicial.');
const stockHelper = extract(/function productStockTotal\(p\)\{[\s\S]*?\n\}/, 'La disponibilidad debe reutilizar el cálculo real de stock.');
const matcher = extract(/function catalogProductMatchesAvailability\(p,filter=catalogAvailabilityFilter\)\{[\s\S]*?\n\}/, 'Debe existir el matcher de disponibilidad.');
const setter = extract(/function setCatalogAvailabilityFilter\(value\)\{[\s\S]*?\n\}/, 'Debe existir el setter client-side del selector.');
const renderSource = extract(/function render\(\)\{[\s\S]*?\n\}/, 'Debe existir el renderer del catálogo.');
const clearSource = extract(/function clearCatalogFilters\(\)\{[\s\S]*?\n\}/, 'Debe existir el reset de filtros.');
const select = { value: 'available' };
let renderCalls = 0;
const context = vm.createContext({
  variantList: product => Array.isArray(product?.variants) ? product.variants : [],
  $: id => id === 'catalogAvailabilityFilter' ? select : null,
  render: () => { renderCalls++; },
});
new vm.Script(`${availabilityState}\n${stockHelper}\n${matcher}\n${setter}`).runInContext(context);

const inStockByVariant = { quantity: 0, variants: [{ stock: 2 }, { stock: 1 }] };
const exhaustedByVariant = { quantity: 99, variants: [{ stock: 0 }, { stock: -2 }] };
const exhaustedLegacy = { quantity: 0, variants: [] };
assert.equal(context.productStockTotal(inStockByVariant), 3);
assert.equal(context.catalogProductMatchesAvailability(inStockByVariant, 'available'), true);
assert.equal(context.catalogProductMatchesAvailability(inStockByVariant, 'sold_out'), false);
assert.equal(context.catalogProductMatchesAvailability(exhaustedByVariant, 'available'), false, 'Las variantes prevalecen sobre quantity de respaldo.');
assert.equal(context.catalogProductMatchesAvailability(exhaustedByVariant, 'sold_out'), true);
assert.equal(context.catalogProductMatchesAvailability(exhaustedByVariant, 'all'), true);
assert.equal(context.catalogProductMatchesAvailability(exhaustedLegacy, 'sold_out'), true);
assert.equal(context.catalogProductMatchesAvailability(exhaustedLegacy, 'invalid'), false, 'Un valor desconocido conserva el filtro seguro de disponibles.');

context.setCatalogAvailabilityFilter('sold_out');
assert.equal(vm.runInContext('catalogAvailabilityFilter', context), 'sold_out');
assert.equal(select.value, 'sold_out');
context.setCatalogAvailabilityFilter('not-a-filter');
assert.equal(vm.runInContext('catalogAvailabilityFilter', context), 'available');
assert.equal(select.value, 'available');
assert.equal(renderCalls, 2, 'Cambiar el selector solo vuelve a renderizar el catálogo.');
assert.doesNotMatch(setter, /\b(?:fetch|XMLHttpRequest|sendBeacon|\.rpc\s*\(|\.from\s*\()/, 'El filtro no hace solicitudes ni consultas remotas.');

assert.match(html, /<select id="catalogAvailabilityFilter"[^>]*aria-label="Filtrar por disponibilidad"/);
assert.match(html, /<option value="available" selected>Disponibles<\/option>/);
assert.match(html, /<option value="sold_out">Agotados<\/option>/);
assert.match(renderSource, /if\(!catalogProductMatchesAvailability\(p,catalogAvailabilityFilter\)\)return false;/, 'El matcher participa en el filtro principal de tarjetas.');
assert.match(clearSource, /catalogAvailabilityFilter='available'/, 'Limpiar filtros vuelve al comportamiento inicial.');
assert.match(clearSource, /\$\('catalogAvailabilityFilter'\)\.value='available'/);

console.log('OK catalog_availability_filter_regression: stock por variante, selector accesible, estados disponibles/todos/agotados, reset y sin llamadas remotas.');
