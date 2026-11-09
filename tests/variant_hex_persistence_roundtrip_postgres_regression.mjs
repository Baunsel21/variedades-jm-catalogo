import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const database = String(process.env.HEX_TEST_DB || '');
const port = String(process.env.HEX_TEST_PORT || '');
assert.match(database, /^sirevya_hex_jsonb_local_[A-Za-z0-9_]+$/, 'El runner debe proporcionar una base temporal local');
assert.match(port, /^\d+$/, 'El runner debe proporcionar el puerto del clúster local');

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

function psql(sql, variables = {}) {
  const args = [
    '-u', 'postgres', 'psql',
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-h', '/var/run/postgresql', '-p', port, '-d', database,
  ];
  for (const [name, value] of Object.entries(variables)) args.push('-v', `${name}=${String(value)}`);
  args.push('-f', '-');
  const result = spawnSync('sudo', args, { input: `${sql}\n`, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`PostgreSQL local scratch falló: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  }
  return result.stdout.trim();
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

const productId = '00000000-0000-4000-8000-000000000001';
const adminId = '00000000-0000-4000-8000-000000000002';
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
let capturedUpdate = null;
let tableTouched = '';
let updateCount = 0;
const stockRows = [{ dataset: { varColor: 'Azul petróleo', varSize: 'M' }, value: '6' }];
const hexField = { value: '#2468AC', setCustomValidity() {}, reportValidity() {} };
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
  alert(message) { throw new Error(`Unexpected alert in synthetic PostgreSQL round-trip: ${message}`); },
  confirm(message) { throw new Error(`Unexpected confirmation in synthetic PostgreSQL round-trip: ${message}`); },
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
              const persistedId = psql(
                "UPDATE public.products SET variants=:'variants'::jsonb, quantity=:'quantity'::integer WHERE id=:'id'::uuid RETURNING id;",
                { variants: JSON.stringify(payload.variants), quantity: payload.quantity, id: value },
              );
              updateCount += 1;
              return { error: persistedId === productId ? null : new Error('El producto sintético no existe en PostgreSQL local.') };
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

vm.runInContext(functions.join('\n'), context, { filename: 'admin-product-hex-postgres-roundtrip.js' });
await context.guardarProducto(false);

assert.equal(tableTouched, 'products');
assert.equal(updateCount, 1, 'guardarProducto debe persistir una vez en el adaptador JSONB PostgreSQL');
assert.ok(capturedUpdate);
assert.deepEqual(JSON.parse(JSON.stringify(capturedUpdate.variants)), [
  { color: 'Azul petróleo', size: 'M', stock: 6, image_path: '', color_hex: '#2468ac' },
]);
assert.equal(capturedUpdate.quantity, 6);

const storedText = psql(
  "SELECT jsonb_build_object('id',id,'variants',variants,'quantity',quantity)::text FROM public.products WHERE id=:'id'::uuid;",
  { id: productId },
);
assert.ok(storedText, 'La fila debe poder releerse del PostgreSQL local después de guardar.');
const persisted = JSON.parse(storedText);
assert.equal(persisted.id, productId);
assert.equal(persisted.quantity, 6);
assert.deepEqual(persisted.variants, capturedUpdate.variants, 'PostgreSQL JSONB conserva el HEX y el stock de la variante.');

context.productos = [{ ...initialProduct, ...persisted }];
await context.editarProducto(productId);
assert.deepEqual(JSON.parse(JSON.stringify(context.variantDraft)), persisted.variants);
assert.deepEqual(JSON.parse(JSON.stringify(context.variantMemory)), persisted.variants);
assert.equal(context.variantDraft[0].color_hex, '#2468ac');
assert.equal(context.variantDraft[0].stock, 6);
console.log('variant_hex_persistence_roundtrip_postgres_regression: PASS (real admin save/edit functions; local PostgreSQL JSONB scratch; not Supabase/PostgREST)');
