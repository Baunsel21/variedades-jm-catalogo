import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const patterns = [
  /function normalizeText\(v\)\{[\s\S]*?\n\}/,
  /function catalogSizeFilterKey\(value\)\{[\s\S]*?\n\}/,
  /function parseCatalogPriceRange\(minValue,maxValue\)\{[\s\S]*?\n\}/,
  /function readCatalogPriceRange\(\)\{[^\n]*\}/,
  /function catalogShareVariantValues\(params,key\)\{[\s\S]*?\n\}/,
  /function catalogShareSelectedValues\(selection,names\)\{[\s\S]*?\n\}/,
  /function syncCatalogPublicFilterParams\(url\)\{[\s\S]*?\n\}/,
  /function buildCatalogPriceFilterUrl\(range\)\{[\s\S]*?\n\}/,
  /function catalogShareSortValue\(value\)\{[^\n]*\}/,
  /function restoreCatalogPriceFilterFromUrl\(\)\{[\s\S]*?\n\}/,
  /function syncCatalogPriceFilterUrlState\(range\)\{[\s\S]*?\n\}/,
  /async function copyCatalogPriceFilterLink\(\)\{[\s\S]*?\n\}/,
];
const helpers = patterns.map(pattern => source.match(pattern)?.[0]);
assert.ok(helpers.every(Boolean), 'Helpers de URL de precio, disponibilidad y orden disponibles.');

const nodes = {
  catalogPriceMin: { value: '' },
  catalogPriceMax: { value: '' },
  catalogAvailabilityFilter: { value: 'available' },
  category: { value: '' },
  sort: { value: 'recent' },
};
let currentUrl = new URL('https://sirevya.com.co/?release=preview&email=customer%40example.com&categoria=Ropa&min_price=25000&max_price=60000&availability=sold_out&sort=price_desc&color=Negro&color=Azul%20claro&size=M&size=XL#old');
let replaceCalls = 0;
const location = {
  get origin() { return currentUrl.origin; },
  get pathname() { return currentUrl.pathname; },
  get search() { return currentUrl.search; },
  get hash() { return currentUrl.hash; },
  get href() { return currentUrl.href; },
};
const history = {
  state: { keep: true },
  replaceState(state, _title, url) {
    replaceCalls += 1;
    this.state = state;
    currentUrl = new URL(url, currentUrl.origin);
  },
};
const copied = [];
const toasts = [];
const context = vm.createContext({
  URL,
  URLSearchParams,
  normalizeText: value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
  catalogSizeFilterKey: value => {
    const key = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    return ['unica', 'unico', 'talla unica', 'sin talla', 'unitalla', 'one size'].includes(key) ? '' : key;
  },
  selectedCatalogColors: new Set(),
  selectedCatalogColorNames: new Map(),
  selectedCatalogSizes: new Set(),
  selectedCatalogSizeNames: new Map(),
  window: { location, history },
  navigator: { clipboard: { writeText: async value => { copied.push(value); } } },
  $: id => nodes[id] ?? null,
  showToast: message => toasts.push(String(message)),
});
vm.runInContext(`const CATALOG_SHARE_FILTER_VALUE_LIMIT=12;\nconst CATALOG_SHARE_FILTER_LENGTH_LIMIT=48;\nlet catalogAvailabilityFilter='available';\n${helpers.join('\n')}`, context);

context.restoreCatalogPriceFilterFromUrl();
assert.equal(nodes.catalogPriceMin.value, '25000');
assert.equal(nodes.catalogPriceMax.value, '60000');
assert.equal(vm.runInContext('catalogAvailabilityFilter', context), 'sold_out');
assert.equal(nodes.catalogAvailabilityFilter.value, 'sold_out');
assert.equal(nodes.sort.value, 'price_desc');
assert.deepEqual([...context.selectedCatalogColors].sort(), ['azul claro', 'negro']);
assert.deepEqual([...context.selectedCatalogSizes].sort(), ['m', 'xl']);
assert.equal(context.selectedCatalogColorNames.get('azul claro'), 'Azul claro');
assert.equal(context.selectedCatalogSizeNames.get('xl'), 'XL');

currentUrl = new URL('https://sirevya.com.co/?release=preview&email=customer%40example.com#catalogo');
vm.runInContext("catalogAvailabilityFilter='sold_out'", context);
nodes.category.value = 'Ropa';
nodes.sort.value = 'price_desc';
context.syncCatalogPriceFilterUrlState(context.readCatalogPriceRange());
assert.equal(currentUrl.searchParams.get('release'), 'preview', 'El estado de página conserva parámetros existentes.');
assert.equal(currentUrl.searchParams.get('email'), 'customer@example.com');
assert.equal(currentUrl.searchParams.get('min_price'), '25000');
assert.equal(currentUrl.searchParams.get('max_price'), '60000');
assert.equal(currentUrl.searchParams.get('availability'), 'sold_out');
assert.equal(currentUrl.searchParams.get('sort'), 'price_desc');
assert.equal(currentUrl.searchParams.get('categoria'), 'Ropa');
assert.deepEqual(currentUrl.searchParams.getAll('color'), ['Azul claro', 'Negro']);
assert.deepEqual(currentUrl.searchParams.getAll('size'), ['M', 'XL']);
assert.equal(replaceCalls, 1, 'El estado de filtros se actualiza con replaceState, sin agregar historial.');

const cleanLink = context.buildCatalogPriceFilterUrl(context.readCatalogPriceRange());
const shared = new URL(cleanLink);
assert.equal(shared.origin, 'https://sirevya.com.co');
assert.equal(shared.pathname, '/');
assert.equal(shared.hash, '#catalogo');
assert.deepEqual([...shared.searchParams.entries()], [
  ['min_price', '25000'],
  ['max_price', '60000'],
  ['availability', 'sold_out'],
  ['sort', 'price_desc'],
  ['categoria', 'Ropa'],
  ['color', 'Azul claro'],
  ['color', 'Negro'],
  ['size', 'M'],
  ['size', 'XL'],
]);
assert.doesNotMatch(cleanLink, /email|customer|release|search|favorite|cart/i, 'El enlace excluye PII, búsqueda, favoritos, tracking y carrito.');
await context.copyCatalogPriceFilterLink();
assert.deepEqual(copied, [cleanLink]);
assert.match(toasts.at(-1), /categoría, color, talla, precio, disponibilidad y orden/);

for (const sort of ['recent', 'best_selling', 'name_asc', 'price_asc', 'price_desc', 'stock_desc']) {
  assert.equal(context.catalogShareSortValue(sort), sort, `Orden público permitido: ${sort}.`);
}
assert.equal(context.catalogShareSortValue('javascript:alert(1)'), null, 'Rechaza parámetros de orden desconocidos.');

nodes.catalogPriceMin.value = '65000';
nodes.catalogPriceMax.value = '50000';
const invalid = context.readCatalogPriceRange();
assert.equal(invalid.valid, false);
context.syncCatalogPriceFilterUrlState(invalid);
assert.equal(currentUrl.searchParams.has('min_price'), false, 'No se conserva un rango inválido en el URL.');
assert.equal(currentUrl.searchParams.has('max_price'), false);
assert.equal(currentUrl.searchParams.get('availability'), 'sold_out', 'Un rango inválido no borra un filtro público independiente.');
assert.equal(currentUrl.searchParams.get('sort'), 'price_desc', 'Un rango inválido no borra el orden público.');
assert.deepEqual(currentUrl.searchParams.getAll('color'), ['Azul claro', 'Negro'], 'Un rango inválido conserva filtros de variante independientes.');
assert.equal(currentUrl.searchParams.get('email'), 'customer@example.com', 'La sincronización no transmite ni modifica otros parámetros.');
await context.copyCatalogPriceFilterLink();
assert.equal(copied.length, 1, 'Un rango inválido no se copia.');
assert.match(toasts.at(-1), /no puede superar el máximo/);

nodes.catalogPriceMin.value = '';
nodes.catalogPriceMax.value = '';
currentUrl = new URL('https://sirevya.com.co/?min_price=65000&max_price=50000&sort=unsafe&color=Sin%20color&color='+encodeURIComponent('x'.repeat(65))+'&size=Única&size=XL');
context.restoreCatalogPriceFilterFromUrl();
assert.equal(nodes.catalogPriceMax.value, '', 'Un URL inválido no rellena los controles.');
assert.equal(nodes.sort.value, 'price_desc', 'Un valor de orden inválido no cambia la selección válida.');
assert.equal(context.selectedCatalogColors.size, 0, 'Ignora colores inválidos o excesivamente largos.');
assert.deepEqual([...context.selectedCatalogSizes], ['xl'], 'No comparte talla única ni acepta valores inválidos.');

context.selectedCatalogColors.clear();
context.selectedCatalogColorNames.clear();
for (let index = 0; index < 13; index += 1) {
  const key = `color-${index}`;
  context.selectedCatalogColors.add(key);
  context.selectedCatalogColorNames.set(key, key);
}
assert.throws(() => context.buildCatalogPriceFilterUrl(context.readCatalogPriceRange()), /excede los límites/);
currentUrl = new URL('https://sirevya.com.co/?color=previous');
context.syncCatalogPriceFilterUrlState(context.readCatalogPriceRange());
assert.equal(currentUrl.searchParams.has('color'), false, 'No deja un URL parcial si se excede el límite.');
await context.copyCatalogPriceFilterLink();
assert.equal(copied.length, 1, 'No copia un enlace que perdería colores seleccionados.');
assert.match(toasts.at(-1), /12 colores y 12 tallas como máximo/);

nodes.catalogAvailabilityFilter.value = 'available';
currentUrl = new URL('https://sirevya.com.co/?availability=all&sort=name_asc');
context.restoreCatalogPriceFilterFromUrl();
assert.equal(vm.runInContext('catalogAvailabilityFilter', context), 'all', 'Disponibilidad se restaura sin rango de precio.');
assert.equal(nodes.catalogAvailabilityFilter.value, 'all');
assert.equal(nodes.sort.value, 'name_asc', 'El orden se restaura sin rango ni disponibilidad personalizada.');
assert.equal(nodes.catalogPriceMin.value, '');
assert.equal(nodes.catalogPriceMax.value, '');
currentUrl = new URL('https://sirevya.com.co/?availability=unknown&sort=javascript%3Aalert(1)');
context.restoreCatalogPriceFilterFromUrl();
assert.equal(vm.runInContext('catalogAvailabilityFilter', context), 'all', 'Valores desconocidos no cambian la selección válida.');
assert.equal(nodes.sort.value, 'name_asc', 'Orden desconocido no cambia la selección válida.');

nodes.sort.value = 'recent';
context.syncCatalogPriceFilterUrlState(context.readCatalogPriceRange());
assert.equal(currentUrl.searchParams.has('sort'), false, 'El orden predeterminado no ensucia el URL.');

assert.match(source, /syncCatalogPriceFilterUrlState\(priceRange\)/);
assert.match(source, /restoreCatalogPriceFilterFromUrl\(\);/);
assert.match(source, /aria-label="Copiar enlace de filtros públicos del catálogo"/);
assert.match(source, /function categoryFromUrl\(cats\)/, 'La categoría compartida ya se restaura tras cargar el catálogo.');
const restoreCallIndex = source.indexOf('\nrestoreCatalogPriceFilterFromUrl();');
const initialLoadCallIndex = source.lastIndexOf('\nload();');
assert.ok(restoreCallIndex >= 0 && initialLoadCallIndex > restoreCallIndex, 'El enlace rellena controles antes de cargar y renderizar productos.');
assert.match(source, /min_price/);
assert.match(source, /max_price/);
assert.doesNotMatch(helpers.join('\n'), /\.rpc\(|fetch\(/i, 'Compartir filtros no llama al backend.');
console.log('catalog_price_share_url_regression: OK (categoría/color/talla/precio/disponibilidad/orden, URL limpia, sin PII ni backend)');
