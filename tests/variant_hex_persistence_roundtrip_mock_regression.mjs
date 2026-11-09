import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  let start = source.indexOf(marker);
  assert.notEqual(start, -1, `Existe function ${name}.`);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
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

const functionNames = [
  'variantKey',
  'normalizeVariantText',
  'normalizeVariantHex',
  'parseVariants',
  'normalizeAdminColorName',
  'adminVariantKeyCollisions',
  'adminVariantCollisionMessage',
  'collectVariantDraft',
  'totalVariantStock',
  'guardarProducto',
  'editarProducto',
];
const functions = functionNames.map(name => extractFunction(admin, name));

const productId = 'synthetic-product-hex-roundtrip';
const adminId = 'synthetic-admin-hex-roundtrip';
const initialProduct = {
  id: productId,
  code: 'SYN-HEX-001',
  name: 'Producto sintético color personalizado',
  category: 'Accesorios',
  colors: ['Azul petróleo'],
  sizes: ['M'],
  variants: [{ color: 'Azul petróleo', size: 'M', stock: 4, image_path: '', color_hex: '#2468AC' }],
  quantity: 4,
  cost_price: 10000,
  sale_price: 30000,
  location: '',
  description: '',
  size_guide: '',
  size_guide_image: '',
  image_url: '',
};
const productStore = new Map([[productId, structuredClone(initialProduct)]]);
let capturedUpdate = null;
let tableTouched = '';
const stockRows = [{ dataset: { varColor: 'Azul petróleo', varSize: 'M' }, value: '6' }];
const hexField = {
  value: '#2468AC',
  setCustomValidity() {},
  reportValidity() {},
};
const fields = {
  pNombre: { value: initialProduct.name },
  pCategoria: { value: initialProduct.category },
  pColores: { value: 'Azul petróleo' },
  pTallas: { value: 'M' },
  pCantidad: { value: '6' },
  pCompra: { value: '10000' },
  pVenta: { value: '30000' },
  pUbicacion: { value: '' },
  pDescripcion: { value: '' },
  pGuiaTallas: { value: '' },
  pFoto: { value: '', files: [] },
  pGuiaTallasFoto: { value: '', files: [] },
  formTitle: { textContent: '' },
};

const context = vm.createContext({
  document: {
    querySelectorAll(selector) {
      if (selector === '#adminColorManager .adminColorHexText') return [hexField];
      if (selector === '#variantEditorRows .variantAdminStock') return stockRows;
      return [];
    },
    querySelector(selector) {
      if (selector === '#variantEditorRows .variantAdminStock') return stockRows[0] || null;
      if (selector === '[data-view=producto]') return {};
      return null;
    },
  },
  alert(message) { throw new Error(`Unexpected alert during synthetic round-trip: ${message}`); },
  confirm(message) { throw new Error(`Unexpected confirmation during synthetic round-trip: ${message}`); },
  adminSessionUserId: adminId,
  adminAuthEpoch: 1,
  adminAuthOperationStillCurrent(userId, epoch) { return userId === adminId && epoch === 1; },
  editingProductImageLoadToken: 1,
  editingId: productId,
  editingSizeGuideImagePath: '',
  sizeGuideImageRemoveRequested: false,
  variantEditorCollisionError: '',
  variantDraft: structuredClone(initialProduct.variants),
  variantMemory: structuredClone(initialProduct.variants),
  productos: [structuredClone(initialProduct)],
  sb: {
    auth: { async getUser() { return { data: { user: { id: adminId } }, error: null }; } },
    from(table) {
      tableTouched = table;
      return {
        update(payload) {
          capturedUpdate = structuredClone(payload);
          return {
            async eq(column, value) {
              assert.equal(column, 'id');
              assert.equal(value, productId);
              productStore.set(value, { ...productStore.get(value), ...structuredClone(payload) });
              return { error: null };
            },
          };
        },
      };
    },
  },
  hiddenAdminVariantsWithData() { return []; },
  selectedVariantFiles() { return {}; },
  resetAdminNewColorForm() {},
  renderPhotoPreview() {},
  renderSizeGuidePhotoPreview() {},
  renderAdminColorPalette() {},
  renderVariantEditor() {},
  loadExistingProductImages: async () => {},
  notifyPublicCatalogChanged() {},
  limpiarProducto() {},
  cargarTodo: async () => {},
  toast() {},
  show() {},
  $: id => fields[id],
});

vm.runInContext(functions.join('\n'), context, { filename: 'admin-product-hex-roundtrip.js' });
await context.guardarProducto(false);

assert.equal(tableTouched, 'products', 'El guardado debe usar la tabla de productos.');
assert.ok(capturedUpdate, 'El adaptador local debe recibir el payload de actualización.');
assert.deepEqual(JSON.parse(JSON.stringify(capturedUpdate.variants)), [
  { color: 'Azul petróleo', size: 'M', stock: 6, image_path: '', color_hex: '#2468ac' },
]);
assert.equal(capturedUpdate.quantity, 6);

const persistedSyntheticProduct = productStore.get(productId);
assert.deepEqual(persistedSyntheticProduct.variants, capturedUpdate.variants, 'El adaptador guarda el JSONB sintético recibido.');
context.productos = [structuredClone(persistedSyntheticProduct)];
await context.editarProducto(productId);

assert.deepEqual(JSON.parse(JSON.stringify(context.variantDraft)), persistedSyntheticProduct.variants);
assert.deepEqual(JSON.parse(JSON.stringify(context.variantMemory)), persistedSyntheticProduct.variants);
assert.equal(context.variantDraft[0].color_hex, '#2468ac');
assert.equal(context.variantMemory[0].color_hex, '#2468ac');
console.log('variant_hex_persistence_roundtrip_mock_regression: PASS (real admin save/edit functions; synthetic in-memory Supabase adapter; no network or production writes)');
