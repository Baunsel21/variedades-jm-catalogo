import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Existe function ${name}.`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `La función ${name} tiene cuerpo.`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`No se pudo cerrar la función ${name}.`);
}

const helperNames = [
  'normalizeText',
  'parseVariantList',
  'normalizeVariants',
  'variantList',
  'productStockTotal',
  'availableColorsForProduct',
  'catalogSizeFilterKey',
  'availableCatalogSizesForProduct',
  'buildCatalogSizeIndex',
  'productMatchesCatalogVariantFilters',
];
const helpers = helperNames.map(extractFunction);
const nodes = {
  category: { value: 'Accesorios' },
  filterCategory: { value: 'Accesorios' },
  sort: { value: 'price_asc' },
  search: { value: 'bolso' },
};
let renderCalls = 0;
let closeSizeCalls = 0;
const context = vm.createContext({
  $: id => nodes[id] ?? null,
  productos: [],
  selectedCatalogColors: new Set(['negro']),
  selectedCatalogColorNames: new Map([['negro', 'Negro']]),
  selectedCatalogSizes: new Set(['m']),
  selectedCatalogSizeNames: new Map([['m', 'M']]),
  setDirectCategoryMode() {},
  updateCategoryButtons() {},
  render() { renderCalls += 1; },
  toggleFilterPanel() {},
  toggleColorFilterOptions() {},
  toggleSizeFilterOptions(open) { if (open === false) closeSizeCalls += 1; },
});
vm.runInContext([...helpers, extractFunction('setCatalogSizeFilter'), extractFunction('clearCatalogFilters')].join('\n'), context);

const crossed = {
  id: 'crossed',
  quantity: 0,
  colors: ['Negro', 'Rojo'],
  sizes: ['S', 'M'],
  variants: [
    { color: 'Negro', size: 'S', stock: 2 },
    { color: 'Rojo', size: 'M', stock: 3 },
    { color: 'Negro', size: 'M', stock: 0 },
  ],
};
const legacy = { id: 'legacy', quantity: 4, colors: ['Negro', 'Rojo'], sizes: ['L', 'XL'] };
const oneSize = {
  id: 'one-size',
  quantity: 0,
  colors: ['Blanco'],
  sizes: ['Única'],
  variants: [{ color: 'Blanco', size: 'Única', stock: 2 }],
};
const unavailable = {
  id: 'unavailable',
  quantity: 0,
  sizes: ['XXL'],
  variants: [{ color: '', size: 'XXL', stock: 0 }],
};

assert.deepEqual(Array.from(context.availableCatalogSizesForProduct(crossed)), ['S', 'M']);
assert.deepEqual(Array.from(context.availableCatalogSizesForProduct(legacy)), ['L', 'XL']);
assert.deepEqual(Array.from(context.availableCatalogSizesForProduct(oneSize)), [], 'No ofrece talla única como filtro de talla.');
assert.deepEqual(Array.from(context.availableCatalogSizesForProduct(unavailable)), [], 'No ofrece tallas sin stock.');

context.productos = [crossed, legacy, oneSize, unavailable];
const sizeIndex = context.buildCatalogSizeIndex();
assert.deepEqual(Array.from(sizeIndex.sizes.keys()).sort(), ['l', 'm', 's', 'xl']);

assert.equal(context.productMatchesCatalogVariantFilters(crossed, [], []), true, 'Filtros vacíos no restringen.');
assert.equal(context.productMatchesCatalogVariantFilters(crossed, [], ['M']), true, 'La talla M existe con stock.');
assert.equal(context.productMatchesCatalogVariantFilters(crossed, ['Negro'], []), true, 'El color Negro existe con stock.');
assert.equal(context.productMatchesCatalogVariantFilters(crossed, ['Negro'], ['S']), true, 'Color y talla de la misma variante pasan.');
assert.equal(context.productMatchesCatalogVariantFilters(crossed, ['Negro'], ['M']), false, 'No combina color de una variante con talla agotada/no coincidente.');
assert.equal(context.productMatchesCatalogVariantFilters(crossed, ['Rojo', 'Negro'], ['M']), true, 'Selecciones múltiples usan OR dentro de cada dimensión.');
assert.equal(context.productMatchesCatalogVariantFilters(legacy, [], ['L']), true, 'Talla declarada sin variantes conserva el fallback existente.');
assert.equal(context.productMatchesCatalogVariantFilters(legacy, ['Negro'], []), true, 'Color declarado sin variantes conserva el fallback existente.');
assert.equal(context.productMatchesCatalogVariantFilters(legacy, ['Negro'], ['L']), false, 'Sin relación SKU variante, el filtro combinado falla cerrado.');
assert.equal(context.productMatchesCatalogVariantFilters(oneSize, [], ['Única']), true, 'El alias talla única no crea un filtro específico.');

context.setCatalogSizeFilter('M', true);
assert.equal(context.selectedCatalogSizes.has('m'), true);
assert.equal(context.selectedCatalogSizeNames.get('m'), 'M');
assert.equal(renderCalls, 1, 'Cambiar talla vuelve a renderizar.');
context.setCatalogSizeFilter('M', false);
assert.equal(context.selectedCatalogSizes.has('m'), false);
assert.equal(renderCalls, 2, 'Quitar talla vuelve a renderizar.');
context.clearCatalogFilters();
assert.equal(context.selectedCatalogSizes.size, 0, 'Limpiar borra tallas seleccionadas.');
assert.equal(context.selectedCatalogSizeNames.size, 0);
assert.equal(closeSizeCalls, 1, 'Limpiar cierra el dropdown y resetea aria-expanded.');
assert.equal(renderCalls, 3);
assert.equal(nodes.search.value, '');

assert.match(source, /id="filterSizeToggle"[^>]*aria-expanded="false"[^>]*aria-controls="filterSizeDropdownPanel"/);
assert.match(source, /id="filterSizeOptions"[^>]*role="group"/);
assert.match(source, /if\(!productMatchesCatalogVariantFilters\(p,chosenColors,chosenSizes\)\)return false/);
assert.match(source, /#filterSizeDropdownPanel\[hidden\]\{display:none!important\}/);
assert.doesNotMatch(helpers.join('\n'), /\.rpc\(|fetch\(/i, 'El filtro de talla no llama a Supabase ni a endpoints externos.');
console.log('catalog_variant_filter_regression: OK (tallas con stock, misma variante, fallback legado, limpiar, sin backend)');
