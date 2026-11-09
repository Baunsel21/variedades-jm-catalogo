import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const patterns = [
  /function normalizeText\(v\)\{[\s\S]*?\n\}/,
  /function catalogSizeFilterKey\(value\)\{[\s\S]*?\n\}/,
  /function catalogShareVariantValues\(params,key\)\{[\s\S]*?\n\}/,
  /function catalogShareSelectedValues\(selection,names\)\{[\s\S]*?\n\}/,
  /function syncCatalogPublicFilterParams\(url\)\{[\s\S]*?\n\}/,
  /function catalogShareSortValue\(value\)\{[^\n]*\}/,
  /function restoreCatalogPublicFiltersFromUrl\(\)\{[\s\S]*?\n\}/,
  /function syncCatalogPublicFilterUrlState\(\)\{[\s\S]*?\n\}/,
];
const helpers = patterns.map(pattern => source.match(pattern)?.[0]);
assert.ok(helpers.every(Boolean), 'Se conservan los helpers URL públicos de categoría/variantes/disponibilidad/orden.');

for (const removed of ['copyCatalogPriceFilterLink', 'buildCatalogPriceFilterUrl', 'catalogPriceMin', 'catalogPriceMax']) {
  assert.equal(source.includes(removed), false, `No queda acción ni estado URL de precio: ${removed}.`);
}
assert.doesNotMatch(helpers[6], /min_price|max_price/, 'Los enlaces antiguos no vuelven a aplicar precio.');
assert.match(helpers[7], /delete\('min_price'\).*delete\('max_price'\)/,
  'Los parámetros heredados de precio se eliminan al sincronizar.');

const nodes = {
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
const context = vm.createContext({
  URL,
  URLSearchParams,
  selectedCatalogColors: new Set(),
  selectedCatalogColorNames: new Map(),
  selectedCatalogSizes: new Set(),
  selectedCatalogSizeNames: new Map(),
  window: { location, history },
  $: id => nodes[id] ?? null,
});
vm.runInContext(`const CATALOG_SHARE_FILTER_VALUE_LIMIT=12;\nconst CATALOG_SHARE_FILTER_LENGTH_LIMIT=48;\nlet catalogAvailabilityFilter='available';\n${helpers.join('\n')}`, context);

context.restoreCatalogPublicFiltersFromUrl();
assert.equal(vm.runInContext('catalogAvailabilityFilter', context), 'sold_out');
assert.equal(nodes.catalogAvailabilityFilter.value, 'sold_out');
assert.equal(nodes.sort.value, 'price_desc');
assert.deepEqual([...context.selectedCatalogColors].sort(), ['azul claro', 'negro']);
assert.deepEqual([...context.selectedCatalogSizes].sort(), ['m', 'xl']);
assert.equal(context.selectedCatalogColorNames.get('azul claro'), 'Azul claro');
assert.equal(context.selectedCatalogSizeNames.get('xl'), 'XL');

nodes.category.value = 'Ropa';
context.syncCatalogPublicFilterUrlState();
assert.equal(currentUrl.searchParams.get('release'), 'preview', 'Conserva los parámetros previos ajenos al catálogo.');
assert.equal(currentUrl.searchParams.get('email'), 'customer@example.com', 'No añade ni reescribe datos personales existentes.');
assert.equal(currentUrl.searchParams.has('min_price'), false, 'El rango antiguo se elimina.');
assert.equal(currentUrl.searchParams.has('max_price'), false, 'El rango antiguo se elimina.');
assert.equal(currentUrl.searchParams.get('availability'), 'sold_out');
assert.equal(currentUrl.searchParams.get('sort'), 'price_desc');
assert.equal(currentUrl.searchParams.get('categoria'), 'Ropa');
assert.deepEqual(currentUrl.searchParams.getAll('color'), ['Azul claro', 'Negro']);
assert.deepEqual(currentUrl.searchParams.getAll('size'), ['M', 'XL']);
assert.equal(replaceCalls, 1, 'La sincronización usa replaceState y no agrega entradas de historial.');

for (const sort of ['recent', 'best_selling', 'name_asc', 'price_asc', 'price_desc', 'stock_desc']) {
  assert.equal(context.catalogShareSortValue(sort), sort, `Orden público permitido: ${sort}.`);
}
assert.equal(context.catalogShareSortValue('javascript:alert(1)'), null, 'Rechaza valores de orden desconocidos.');
assert.equal(context.catalogSizeFilterKey('Única'), '', 'No serializa la talla única.');

const invalidUrl = new URL('https://sirevya.com.co/?color=previous&size=previous');
context.selectedCatalogColors.clear();
context.selectedCatalogColorNames.clear();
for (let index = 0; index < 13; index += 1) {
  const key = `color-${index}`;
  context.selectedCatalogColors.add(key);
  context.selectedCatalogColorNames.set(key, key);
}
assert.equal(context.syncCatalogPublicFilterParams(invalidUrl), false, 'Se conserva el límite de 12 variantes compartibles.');
assert.equal(invalidUrl.searchParams.has('color'), false, 'No genera un URL parcial si excede el límite.');
assert.deepEqual(invalidUrl.searchParams.getAll('size'), ['M', 'XL'], 'No descarta las tallas válidas al rechazar demasiados colores.');

assert.match(source, /function categoryFromUrl\(cats\)/, 'La categoría sigue restaurándose tras cargar el catálogo.');
assert.match(source, /id="detailShare"/, 'La acción Compartir producto sigue presente.');
assert.match(source, /shareCurrentProductLink/, 'La ficha conserva su deep link propio.');
assert.doesNotMatch(source, /aria-label="Copiar enlace de filtros públicos del catálogo"/,
  'Se retiró la acción de compartir asociada al rango de precio.');
assert.match(source, /restoreCatalogPublicFiltersFromUrl\(\);/);
const restoreCallIndex = source.indexOf('\nrestoreCatalogPublicFiltersFromUrl();');
const initialLoadCallIndex = source.lastIndexOf('\nload();');
assert.ok(restoreCallIndex >= 0 && initialLoadCallIndex > restoreCallIndex,
  'Los filtros públicos restantes se restauran antes de cargar productos.');
assert.doesNotMatch(helpers.join('\n'), /\.rpc\(|fetch\(/i, 'La sincronización URL no llama al backend.');

console.log('catalog_price_share_url_regression: OK (categoría/color/talla/disponibilidad/orden; sin filtro de precio ni PII nuevo)');
