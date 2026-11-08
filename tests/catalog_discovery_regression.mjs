import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

const repoRoot = new URL('..', import.meta.url).pathname;
const indexPath = join(repoRoot, 'index.html');
const html = await readFile(indexPath, 'utf8');

function assertIncludes(needle, message) {
  assert.ok(html.includes(needle), message || `Falta en index.html: ${needle}`);
}

// The test executes the catalog functions from the real inline source, not a copy of their logic.
const blockStart = html.indexOf('let selectedCatalogColors=new Set();');
const blockEnd = html.indexOf('function toggleFilterPanel(force){', blockStart);
assert.ok(blockStart >= 0 && blockEnd > blockStart, 'No se pudo aislar el bloque de descubrimiento del catálogo.');
const catalogBlock = html.slice(blockStart, blockEnd);
const priceCheckStart = html.indexOf('function catalogProductPriceIsVerified(product){');
const priceCheckEnd = html.indexOf('\n}', priceCheckStart);
assert.ok(priceCheckStart >= 0 && priceCheckEnd > priceCheckStart, 'No se pudo aislar el verificador de precio.');
const priceCheckFunction = html.slice(priceCheckStart, priceCheckEnd + 2);

const fixtureProducts = [
  {
    id: 'p-red',
    code: 'SKU-RED',
    name: 'Bolso Rojo',
    category: 'Bolsos',
    sale_price: 50000,
    quantity: 0,
    colors: ['Rojo', 'Azul'],
    sizes: ['S', 'M'],
    variants: [
      { color: 'Rojo', size: 'S', stock: 3 },
      { color: 'Azul', size: 'M', stock: 0 },
    ],
  },
  {
    id: 'p-blue',
    code: 'SKU-BLUE',
    name: 'Cinturón Azul',
    category: 'Accesorios',
    sale_price: 70000,
    quantity: 4,
    colors: ['Azul'],
    sizes: ['L'],
    variants: [{ color: 'Azul', size: 'L', stock: 4 }],
  },
  {
    id: 'p-out',
    code: 'SKU-OUT',
    name: 'Cartera Agotada',
    category: 'Bolsos',
    sale_price: 30000,
    quantity: 0,
    colors: ['Verde'],
    sizes: ['M'],
    variants: [{ color: 'Verde', size: 'M', stock: 0 }],
  },
];

class LocalStorageFixture {
  #values = new Map();
  getItem(key) { return this.#values.has(String(key)) ? this.#values.get(String(key)) : null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(String(key)); }
  keys() { return [...this.#values.keys()]; }
}

class ElementFixture {
  constructor(value = '') {
    this.value = value;
    this.textContent = '';
    this.hidden = false;
    this.dataset = {};
    this.attributes = new Map();
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const localStorage = new LocalStorageFixture();
const elements = new Map();
const getElement = (id) => {
  if (!elements.has(id)) elements.set(id, new ElementFixture());
  return elements.get(id);
};
getElement('filterAvailability').value = 'available';
getElement('sort').value = 'recent';

const location = {
  href: 'https://sirevya.test/catalogo?utm_source=test&categoria=Bolsos',
  search: '?utm_source=test&categoria=Bolsos',
  hash: '#catalogo',
  origin: 'https://sirevya.test',
};
const windowListeners = new Map();
const windowFixture = {
  location,
  addEventListener(type, listener) { windowListeners.set(type, listener); },
};
const historyFixture = {
  state: null,
  replaceState(state, _title, nextUrl) {
    this.state = state;
    const resolved = new URL(nextUrl, location.origin);
    location.href = resolved.href;
    location.search = resolved.search;
    location.hash = resolved.hash;
  },
};
const documentFixture = {
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
};

const context = vm.createContext({
  URL,
  URLSearchParams,
  Date,
  JSON,
  Map,
  Set,
  Math,
  Number,
  String,
  console,
  localStorage,
  window: windowFixture,
  history: historyFixture,
  document: documentFixture,
  setTimeout,
  clearTimeout,
  showToast() {},
  render() { context.renderCalls = (context.renderCalls || 0) + 1; },
  $: getElement,
  normalizeText(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  },
  productStockTotal(product) {
    if (Array.isArray(product?.variants) && product.variants.length) {
      return product.variants.reduce((sum, variant) => sum + Math.max(0, Number(variant?.stock) || 0), 0);
    }
    return Math.max(0, Number(product?.quantity) || 0);
  },
  variantList(product) { return Array.isArray(product?.variants) ? product.variants : []; },
  parseVariantList(value) { return Array.isArray(value) ? value.map(item => String(item ?? '').trim()).filter(Boolean) : []; },
  money(value) { return `$${Number(value) || 0}`; },
  esc(value) { return String(value ?? ''); },
  normalizeDetailId(value) { return String(value ?? '').trim(); },
  productDetailUrl(id) { return `https://sirevya.test/catalogo?producto=${encodeURIComponent(id)}`; },
  detailProduct: null,
  catalogInitialLoadComplete: true,
  fetchAllRpcRows: async () => ({ data: [], error: null }),
});

vm.runInContext(`
const SIREVYA_CATALOG_FAVORITES_KEY = 'sirevya_catalog_favorites_v1';
let productos = ${JSON.stringify(fixtureProducts)};
let detailProduct = null;
let catalogInitialLoadComplete = true;
${priceCheckFunction}
${catalogBlock}
let favoriteProductIds = loadCatalogFavorites();
`, context, { filename: 'index.html#catalog-discovery' });

const evaluate = (expression) => vm.runInContext(expression, context, { filename: 'catalog_discovery_fixture.mjs' });
const storedKeys = () => evaluate('localStorage.keys()');
const purchaseKeys = [
  'jm_wompi_pending_reference_v5',
  'jm_wompi_pending_time_v5',
  'jm_wompi_cart_v5',
  'jm_wompi_reservation_time_v5',
  'jm_wompi_reservation_reference_v6',
  'jm_wompi_reservation_items_v2',
  'jm_wompi_reservations_v3',
  'jm_cod_order_draft_v1',
];

assertIncludes("const SIREVYA_CATALOG_FAVORITES_KEY='sirevya_catalog_favorites_v1';");
for (const declaration of [
  "const WOMPI_PENDING_REFERENCE_KEY='jm_wompi_pending_reference_v5';",
  "const WOMPI_PENDING_TIME_KEY='jm_wompi_pending_time_v5';",
  "const WOMPI_CART_KEY='jm_wompi_cart_v5';",
  "const WOMPI_RESERVATION_TIME_KEY='jm_wompi_reservation_time_v5';",
  "const WOMPI_RESERVATION_REFERENCE_KEY='jm_wompi_reservation_reference_v6';",
  "const WOMPI_RESERVATION_ITEMS_KEY='jm_wompi_reservation_items_v2';",
  "const WOMPI_RESERVATIONS_KEY='jm_wompi_reservations_v3';",
  'const WOMPI_RESERVATION_TTL=10*60*1000;',
  "const COD_ORDER_DRAFT_KEY='jm_cod_order_draft_v1';",
]) assertIncludes(declaration);
assertIncludes('function updateDetailWhatsAppLink()');
assertIncludes('function setDetailMainImage(src)');
assertIncludes('function syncCatalogFiltersToUrl(categoryOverride)');
assertIncludes('function availableSizesForProduct(p,availability=\'available\')');

// Favorites are ID-only and use a namespace separate from Wompi/COD/cart persistence.
evaluate("toggleProductFavorite('p-red',{preventDefault(){},stopPropagation(){}})");
assert.deepEqual(JSON.parse(localStorage.getItem('sirevya_catalog_favorites_v1')), ['p-red']);
assert.deepEqual(storedKeys(), ['sirevya_catalog_favorites_v1']);
for (const key of purchaseKeys) assert.equal(localStorage.getItem(key), null, `Favoritos escribió una clave de compra: ${key}`);
const serializedFavorite = localStorage.getItem('sirevya_catalog_favorites_v1');
assert.ok(!serializedFavorite.includes('Bolso Rojo') && !serializedFavorite.includes('sale_price'), 'La clave de favoritos no es ID-only.');

// Fixtures exercise stock-aware color/talla facets, availability and price range together.
evaluate("selectedCatalogColors = new Set(['rojo']); selectedCatalogSizes = new Set(['s']); $('filterPriceMin').value = '40000'; $('filterPriceMax').value = '60000'; $('filterAvailability').value = 'available';");
const filteredIds = JSON.parse(evaluate(`JSON.stringify((() => {
  const filters = getCatalogFilterState();
  const colors = buildCatalogColorIndex(filters.availability);
  const sizes = buildCatalogSizeIndex(filters.availability);
  return productos.filter(product => catalogProductMatchesFilters(product, filters, colors, sizes)).map(product => product.id);
})())`));
assert.deepEqual(filteredIds, ['p-red'], 'Los filtros de precio/color/talla/disponibilidad no coinciden con el fixture.');

const crossedProduct = {id:'crossed',name:'Producto cruzado',sale_price:50000,category:'Bolsos',colors:['Rojo','Azul'],sizes:['S','M'],variants:[{color:'Rojo',size:'S',stock:1},{color:'Azul',size:'M',stock:1},{color:'Rojo',size:'M',stock:0}]};
context.crossedProduct=crossedProduct;
evaluate("productos.push(crossedProduct); selectedCatalogColors=new Set(['rojo']); selectedCatalogSizes=new Set(['m']);");
assert.equal(evaluate(`(() => {const f=getCatalogFilterState();return catalogProductMatchesFilters(crossedProduct,f,buildCatalogColorIndex(f.availability),buildCatalogSizeIndex(f.availability));})()`),false,'Rojo y M deben existir juntos con stock, no por separado en distintas variantes');
evaluate("$('filterAvailability').value='all';");
assert.equal(evaluate(`(() => {const f=getCatalogFilterState();return catalogProductMatchesFilters(crossedProduct,f,buildCatalogColorIndex(f.availability),buildCatalogSizeIndex(f.availability));})()`),true,'Todos permite la combinación existente agotada sin habilitar venta');
evaluate("productos.pop(); selectedCatalogColors=new Set(['rojo']); selectedCatalogSizes=new Set(['s']);");

evaluate("$('filterAvailability').value = 'out'; $('filterPriceMin').value = ''; $('filterPriceMax').value = '';");
assert.deepEqual(JSON.parse(evaluate(`JSON.stringify((() => {
  const filters = getCatalogFilterState();
  const colors = buildCatalogColorIndex(filters.availability);
  const sizes = buildCatalogSizeIndex(filters.availability);
  return productos.filter(product => catalogProductMatchesFilters(product, filters, colors, sizes)).map(product => product.id);
})())`)), [], 'Un color/talla disponible no debe hacer coincidir un producto agotado.');
evaluate("selectedCatalogColors.clear(); selectedCatalogSizes.clear();");
assert.deepEqual(JSON.parse(evaluate(`JSON.stringify((() => {
  const filters = getCatalogFilterState();
  const colors = buildCatalogColorIndex(filters.availability);
  const sizes = buildCatalogSizeIndex(filters.availability);
  return productos.filter(product => catalogProductMatchesFilters(product, filters, colors, sizes)).map(product => product.id);
})())`)), ['p-out'], 'El filtro de agotados no devolvió el fixture agotado.');

// URL round-trip: only catalog filter params survive; favorites are deliberately not shareable.
evaluate("$('search').value = 'SKU-RED'; $('category').value = 'Bolsos'; $('filterPriceMin').value = '40000'; $('filterPriceMax').value = '60000'; $('filterAvailability').value = 'all'; $('sort').value = 'price_desc'; selectedCatalogColors = new Set(['rojo','azul']); selectedCatalogColorNames = new Map([['rojo','Rojo'],['azul','Azul']]); selectedCatalogSizes = new Set(['s']); selectedCatalogSizeNames = new Map([['s','S']]); catalogFavoritesOnly = true; syncCatalogFiltersToUrl('Bolsos');");
let roundTripUrl = new URL(location.href);
assert.equal(roundTripUrl.searchParams.get('categoria'), 'Bolsos');
assert.equal(roundTripUrl.searchParams.get('q'), 'SKU-RED');
assert.equal(roundTripUrl.searchParams.get('min'), '40000');
assert.equal(roundTripUrl.searchParams.get('max'), '60000');
assert.deepEqual(roundTripUrl.searchParams.getAll('color').sort(), ['Azul', 'Rojo']);
assert.deepEqual(roundTripUrl.searchParams.getAll('talla'), ['S']);
assert.equal(roundTripUrl.searchParams.get('disp'), 'all');
assert.equal(roundTripUrl.searchParams.get('orden'), 'price_desc');
assert.equal(roundTripUrl.searchParams.get('favoritos'), null, 'Favoritos no deben viajar en el URL.');
assert.equal(roundTripUrl.searchParams.get('utm_source'), null, 'El sincronizador no debe conservar parámetros no permitidos.');

evaluate("$('search').value = ''; $('filterPriceMin').value = ''; $('filterPriceMax').value = ''; $('filterAvailability').value = 'available'; $('sort').value = 'recent'; selectedCatalogColors.clear(); selectedCatalogColorNames.clear(); selectedCatalogSizes.clear(); selectedCatalogSizeNames.clear(); catalogFavoritesOnly = false; restoreCatalogFiltersFromUrl();");
assert.equal(getElement('search').value, 'SKU-RED');
assert.equal(getElement('filterPriceMin').value, '40000');
assert.equal(getElement('filterPriceMax').value, '60000');
assert.equal(getElement('filterAvailability').value, 'all');
assert.equal(getElement('sort').value, 'price_desc');
assert.deepEqual(JSON.parse(evaluate('JSON.stringify([...selectedCatalogColors].sort())')), ['azul', 'rojo']);
assert.deepEqual(JSON.parse(evaluate('JSON.stringify([...selectedCatalogSizes])')), ['s']);

// Compile every executable inline script from the delivered HTML with Node's real parser.
const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const syntaxFiles = [];
let match;
while ((match = scriptPattern.exec(html))) {
  const attributes = match[1];
  if (/\bsrc\s*=/.test(attributes) || /application\/(?:ld\+)?json/i.test(attributes)) continue;
  const filename = join(tmpdir(), `sirevya-inline-${process.pid}-${syntaxFiles.length}.js`);
  await writeFile(filename, match[2], 'utf8');
  syntaxFiles.push(filename);
}
assert.ok(syntaxFiles.length > 0, 'No se encontraron scripts inline ejecutables para parsear.');
try {
  for (const filename of syntaxFiles) {
    const checked = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
    assert.equal(checked.status, 0, `Sintaxis inválida en ${filename}:\n${checked.stderr}`);
  }
} finally {
  await Promise.all(syntaxFiles.map(filename => rm(filename, { force: true })));
}

console.log('catalog_discovery_regression: OK (VM fixtures, localStorage ID-only, URL round-trip, inline JS syntax)');
