import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const open = html.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${name}`);
  let depth = 0;
  for (let index = open; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  assert.fail(`unclosed function ${name}`);
}

const sources = ['catalogProductSortPrice', 'compareCatalogPrice'].map(extractFunction);
for (const source of sources) {
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|\bsb\.(?:rpc|from)\s*\(/);
}
assert.match(html, /if\(sort==='price_asc'\) arr\.sort\(\(a,b\)=>compareCatalogPrice\(a,b,1\)\)/);
assert.match(html, /if\(sort==='price_desc'\) arr\.sort\(\(a,b\)=>compareCatalogPrice\(a,b,-1\)\)/);
assert.doesNotMatch(html, /Number\(a\.sale_price\)\|\|0/);
assert.doesNotMatch(html, /Number\(b\.sale_price\)\|\|0/);

const context = {};
vm.runInNewContext(sources.join('\n'), context);
for (const [product, expected] of [
  [{ sale_price: 0 }, 0],
  [{ sale_price: '45000' }, 45000],
  [{ sale_price: null }, null],
  [{ sale_price: undefined }, null],
  [{ sale_price: '' }, null],
  [{ sale_price: '   ' }, null],
  [{ sale_price: 'not-a-price' }, null],
  [{ sale_price: -1 }, null],
  [{ sale_price: 'Infinity' }, null],
  [{ sale_price: true }, null],
]) {
  assert.equal(context.catalogProductSortPrice(product), expected);
}

const products = [
  { name: 'Precio 100', sale_price: 100 },
  { name: 'Sin precio', sale_price: null },
  { name: 'Precio 0', sale_price: 0 },
  { name: 'Precio igual B', sale_price: '40' },
  { name: 'Espacio', sale_price: ' ' },
  { name: 'Precio igual A', sale_price: 40 },
  { name: 'Sin campo' },
  { name: 'Precio incorrecto', sale_price: 'bad' },
];
const before = JSON.stringify(products);
const ascending = [...products].sort((a, b) => context.compareCatalogPrice(a, b, 1));
const ascendingPrices = ascending.map(context.catalogProductSortPrice);
assert.deepEqual(ascendingPrices.slice(0, 4), [0, 40, 40, 100]);
assert.ok(ascendingPrices.slice(4).every((price) => price === null), 'Precios no verificados quedan al final en ascendente.');
const equalPriceNames = ascending.filter((product) => context.catalogProductSortPrice(product) === 40).map((product) => product.name);
assert.deepEqual(equalPriceNames, ['Precio igual A', 'Precio igual B']);

const descending = [...products].sort((a, b) => context.compareCatalogPrice(a, b, -1));
const descendingPrices = descending.map(context.catalogProductSortPrice);
assert.deepEqual(descendingPrices.slice(0, 4), [100, 40, 40, 0]);
assert.ok(descendingPrices.slice(4).every((price) => price === null), 'Precios no verificados quedan al final también en descendente.');
assert.equal(JSON.stringify(products), before, 'El comparador no muta precios ni productos.');

console.log('catalog_price_sort_regression: PASS');
