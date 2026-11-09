import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const helperStart = html.indexOf("const SIREVYA_CATALOG_FAVORITES_KEY='sirevya_catalog_favorites_v1';");
const helperEnd = html.indexOf('\nlet cart=[];', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'El bloque de favoritos locales debe existir antes del carrito.');
const helpers = html.slice(helperStart, helperEnd);
const renderStart = html.indexOf('function render(){');
const renderEnd = html.indexOf('\nconst SIREVYA_CATALOG_FAVORITES_KEY=', renderStart);
const render = html.slice(renderStart, renderEnd);

assert.match(html, /id="favoritesOnlyToggle"[^>]+onclick="toggleFavoriteFilter\(\)"/);
assert.match(html, /class="productFavoriteButton"[^>]+onclick="toggleCatalogFavorite\(event,this\)"/);
assert.match(render, /catalogFavoritesOnly&&!favoriteProductIds\.has\(String\(p\.id\)\)/);
assert.match(render, /catalogProductMatchesAvailability\(p,catalogAvailabilityFilter\)/);
assert.match(render, /money\(p\.sale_price\)/);
assert.match(render, /renderVariantOptions\(p\)/);
assert.match(render, /renderStorefrontComboCatalog\(\)/);
assert.match(render, /renderCart\(\)/);
assert.doesNotMatch(helpers, /\.rpc\(|fetch\(/i, 'Los favoritos no consultan ni escriben en Supabase.');
assert.doesNotMatch(helpers, /wompi|checkout|reservation|inventory/i);

const values = new Map();
const key = 'sirevya_catalog_favorites_v1';
values.set(key, '["saved-product"]');
const storageListeners = new Map();
const attributes = {};
const filterButton = {
  innerHTML: '',
  setAttribute(name, value) { attributes[name] = value; },
};
let renders = 0;
const toasts = [];
const context = {
  localStorage: {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  },
  window: { addEventListener(name, callback) { storageListeners.set(name, callback); } },
  catalogInitialLoadComplete: true,
  $(id) { return id === 'favoritesOnlyToggle' ? filterButton : null; },
  render() { renders += 1; },
  showToast(message) { toasts.push(message); },
};
vm.createContext(context);
vm.runInContext(helpers, context);

assert.equal(vm.runInContext('favoriteProductIds.size', context), 1);
assert.match(filterButton.innerHTML, /Favoritos <span id="favoriteProductCount">1<\/span>/, 'El contador inicial refleja favoritos guardados.');
assert.equal(attributes['aria-pressed'], 'false', 'El filtro no se activa hasta que el usuario lo solicita.');
assert.equal(vm.runInContext("isCatalogFavorite('saved-product')", context), true);
const eventFlags = { prevented: false, stopped: false };
const button = { dataset: { favoriteId: 'product-1' } };
context.toggleCatalogFavorite({
  preventDefault() { eventFlags.prevented = true; },
  stopPropagation() { eventFlags.stopped = true; },
}, button);
assert.equal(eventFlags.prevented, true);
assert.equal(eventFlags.stopped, true);
assert.equal(vm.runInContext("isCatalogFavorite('product-1')", context), true);
assert.deepEqual(JSON.parse(values.get(key)), ['saved-product', 'product-1']);
assert.equal(renders, 1);

context.toggleFavoriteFilter();
assert.equal(attributes['aria-pressed'], 'true');
assert.match(filterButton.innerHTML, /Favoritos <span id="favoriteProductCount">2<\/span>/);
assert.equal(renders, 2);

const storageListener = storageListeners.get('storage');
assert.equal(typeof storageListener, 'function');
storageListener({ key, newValue: '["product-2"]' });
assert.equal(vm.runInContext("isCatalogFavorite('product-1')", context), false);
assert.equal(vm.runInContext("isCatalogFavorite('product-2')", context), true);
assert.equal(renders, 3);

storageListener({ key: null, newValue: null });
assert.equal(vm.runInContext('favoriteProductIds.size', context), 0, 'Limpiar el almacenamiento sincroniza favoritos entre pestañas.');
assert.equal(renders, 4);
assert.equal(vm.runInContext("parseCatalogFavorites('{broken').size", context), 0);
assert.equal(vm.runInContext("parseCatalogFavorites(JSON.stringify(Array.from({length:510},(_,i)=>'p'+i))).size", context), 500);

for (const [name, line] of [['checkout', 'function getCheckoutItems()'], ['cart', 'function addToCart(p,event)'], ['shipping', 'function updateShipping('], ['Wompi', 'function sendCart(']]) {
  assert.ok(html.includes(line), `Se conserva el punto de entrada de ${name}.`);
}
assert.deepEqual(toasts, []);
console.log('catalog_favorites_regression: OK (solo localStorage; catálogo, carrito y stock intactos)');
