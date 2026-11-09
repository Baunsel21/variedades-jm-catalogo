import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

for (const removed of [
  'catalogPriceFilters',
  'catalogPriceMin',
  'catalogPriceMax',
  'catalogPriceFilterStatus',
  'parseCatalogPriceRange',
  'readCatalogPriceRange',
  'catalogProductMatchesPriceRange',
  'clearCatalogPriceFilter',
  'copyCatalogPriceFilterLink',
  'buildCatalogPriceFilterUrl',
  'Precio (COP)',
  'aria-label="Copiar enlace de filtros públicos del catálogo"',
]) {
  assert.equal(source.includes(removed), false, `Se retiró únicamente el control de rango de precio: ${removed}.`);
}

assert.match(source, /function catalogProductSortPrice\(product\)/, 'El orden por precio sigue usando el precio de catálogo.');
assert.match(source, /else if\(sort==='price_asc'\) arr\.sort\(\(a,b\)=>compareCatalogPrice\(a,b,1\)\)/);
assert.match(source, /else if\(sort==='price_desc'\) arr\.sort\(\(a,b\)=>compareCatalogPrice\(a,b,-1\)\)/);
assert.match(source, /id="categoryButtons"/, 'La navegación de categorías se conserva.');
assert.match(source, /id="favoritesOnlyToggle"/, 'El filtro de favoritos se conserva.');
assert.match(source, /class="productFavoriteButton"/, 'Los corazones por producto se conservan.');
assert.match(source, /id="detailShare"/, 'El enlace compartible de producto se conserva.');
assert.match(source, /function clearCatalogFilters\(\)/, 'La acción general de limpiar filtros se conserva.');
assert.match(source, /function restoreCatalogPublicFiltersFromUrl\(\)/);
assert.match(source, /function syncCatalogPublicFilterUrlState\(\)/);
assert.match(source, /url\.searchParams\.delete\('min_price'\);url\.searchParams\.delete\('max_price'\)/,
  'Los enlaces antiguos dejan de aplicar el rango retirado.');
assert.doesNotMatch(source, /searchParams\.(?:get|set)\('(min_price|max_price)'/,
  'El navegador no restaura ni genera un filtro de rango oculto.');

console.log('catalog_price_filter_regression: OK (rango retirado, orden por precio/categorías/favoritos/compartir producto conservados)');
