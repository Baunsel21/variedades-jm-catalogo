import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const parseMatch = source.match(/function parseCatalogPriceRange\(minValue,maxValue\)\{[\s\S]*?\n\}/);
const readMatch = source.match(/function readCatalogPriceRange\(\)\{[^\n]*\}/);
const matchMatch = source.match(/function catalogProductMatchesPriceRange\(product,range\)\{[\s\S]*?\n\}/);
const clearMatch = source.match(/function clearCatalogPriceFilter\(\)\{[\s\S]*?\n\}/);
assert.ok(parseMatch && readMatch && matchMatch && clearMatch, 'Helpers de precio disponibles.');

const nodes = {
  catalogPriceMin: { value: '' },
  catalogPriceMax: { value: '' },
};
let renderCalls = 0;
const context = vm.createContext({
  $: id => nodes[id] ?? null,
  render: () => { renderCalls += 1; },
});
vm.runInContext([parseMatch[0], readMatch[0], matchMatch[0], clearMatch[0]].join('\n'), context);

const empty = context.readCatalogPriceRange();
assert.equal(empty.valid, true);
assert.equal(empty.min, null);
assert.equal(empty.max, null);
assert.equal(context.catalogProductMatchesPriceRange({ sale_price: 999999 }, empty), true, 'Rango vacío no altera catálogo.');

const bounded = context.parseCatalogPriceRange('25000', '30000');
assert.equal(bounded.valid, true);
for (const price of [25000, 27500, 30000]) {
  assert.equal(context.catalogProductMatchesPriceRange({ sale_price: price }, bounded), true, `Incluye límite ${price}.`);
}
assert.equal(context.catalogProductMatchesPriceRange({ sale_price: 24999 }, bounded), false);
assert.equal(context.catalogProductMatchesPriceRange({ sale_price: 30001 }, bounded), false);
assert.equal(context.catalogProductMatchesPriceRange({ sale_price: 'no-price' }, bounded), false, 'No trata un precio desconocido como cero.');

const lowerBound = context.parseCatalogPriceRange('60000', '');
assert.equal(context.catalogProductMatchesPriceRange({ sale_price: 59999 }, lowerBound), false);
assert.equal(context.catalogProductMatchesPriceRange({ sale_price: 60000 }, lowerBound), true);
const upperBound = context.parseCatalogPriceRange('', '30000');
assert.equal(context.catalogProductMatchesPriceRange({ sale_price: 30000 }, upperBound), true);
assert.equal(context.catalogProductMatchesPriceRange({ sale_price: 30001 }, upperBound), false);

for (const [min, max] of [['30001', '30000'], ['-1', '50000'], ['NaN', '50000'], ['', 'Infinity']]) {
  const invalid = context.parseCatalogPriceRange(min, max);
  assert.equal(invalid.valid, false, `Rechaza rango inválido ${min}..${max}.`);
  assert.equal(context.catalogProductMatchesPriceRange({ sale_price: 1 }, invalid), true, 'Un rango inválido no aplica un filtro silencioso.');
  assert.ok(invalid.error, 'El usuario recibe motivo legible.');
}

nodes.catalogPriceMin.value = '50000';
nodes.catalogPriceMax.value = '100000';
context.clearCatalogPriceFilter();
assert.equal(nodes.catalogPriceMin.value, '');
assert.equal(nodes.catalogPriceMax.value, '');
assert.equal(renderCalls, 1, 'Limpiar vuelve a renderizar el catálogo.');

assert.match(source, /id="catalogPriceMin" type="number" min="0" step="1000"/);
assert.match(source, /id="catalogPriceMax" type="number" min="0" step="1000"/);
assert.match(source, /id="catalogPriceFilterStatus"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(source, /if\(!catalogProductMatchesPriceRange\(p,priceRange\)\)return false/);
assert.match(source, /renderStorefrontComboCatalog\(\);\s*renderCart\(\);/);
const helpers = [parseMatch[0], readMatch[0], matchMatch[0], clearMatch[0]].join('\n');
assert.doesNotMatch(helpers, /\.rpc\(|fetch\(/i, 'El filtro no llama a Supabase ni a endpoints externos.');
console.log('catalog_price_filter_regression: OK (límites inclusivos, validación, limpieza, sin backend)');
