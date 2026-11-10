import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const functionStart = html.slice(Math.max(0, start - 6), start) === 'async ' ? start - 6 : start;
  const open = html.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return html.slice(functionStart, index + 1);
  }
  assert.fail(`unclosed function ${name}`);
}

function makeExportContext({ missingGallery = false, authorized = true } = {}) {
  const downloads = [];
  const messages = [];
  let galleryQueries = 0;
  const product = {
    id: 'product-1', code: 'REF-001', name: 'Vestido; Ñandú', category: 'Moda',
    quantity: 7, availableQuantity: 5, cost_price: 12000, sale_price: 25000, location: 'Bodega A',
    colors: ['Negro', 'Rosa'], sizes: ['S', 'M'],
    variants: [{ color: 'Negro', size: 'S', stock: 3, image_path: 'variant.webp' }],
    image_url: 'main.webp', image_paths: ['local-extra.webp'], description: '=1+1', is_published: true,
  };
  const query = {
    select(columns) { assert.equal(columns, 'product_id,image_path,sort_order'); return this; },
    in(column, ids) { assert.equal(column, 'product_id'); assert.equal(JSON.stringify(ids), '["product-1"]'); return this; },
    order(column, options) { assert.equal(column, 'sort_order'); assert.equal(options.ascending, true); return this; },
    async range(from, to) {
      galleryQueries += 1;
      assert.equal(from, 0); assert.equal(to, 499);
      if (missingGallery) return { data: null, error: { code: '42P01', message: 'product_images does not exist' } };
      return { data: [{ product_id: 'product-1', image_path: 'gallery.webp', sort_order: 1 }], error: null };
    },
  };
  const context = vm.createContext({
    productos: [product], sb: { from(table) { assert.equal(table, 'product_images'); return query; } },
    adminSessionUserId: 'admin-1', adminAuthEpoch: 5,
    adminAuthOperationStillCurrent(userId, epoch) { return authorized && userId === 'admin-1' && epoch === 5; },
    async assertCurrentAdminAuthorization(userId, epoch) { assert.equal(userId, 'admin-1'); assert.equal(epoch, 5); if (!authorized) throw new Error('unauthorized'); },
    adminAuthOperationError(message) { return new Error(message); },
    isMissingTableError(error, table) { return error?.code === '42P01' && table === 'product_images'; },
    parseVariants(value) { return value; },
    publicWorkerImage(value) { return value ? (String(value).startsWith('https://') ? String(value) : `https://cdn.example/${value}`) : ''; },
    availableQuantity(value) { return Math.max(0, Number(value?.availableQuantity ?? value?.quantity) || 0); },
    safeCSVCell(value) {
      const numeric = typeof value === 'number' && Number.isFinite(value);
      let text = String(value ?? '');
      if (!numeric && /^[\s\uFEFF]*[=+\-@]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    },
    downloadFile(...args) { downloads.push(args); },
    toast(message) { messages.push(message); },
    console: { error() {} },
  });
  vm.runInContext([
    extractFunction('productPublicationStateForCSV'),
    extractFunction('loadProductGalleryImagesForCSV'),
    extractFunction('exportCSV'),
  ].join('\n'), context);
  return { context, downloads, messages, get galleryQueries() { return galleryQueries; } };
}

const success = makeExportContext();
assert.equal(await success.context.exportCSV(), true);
assert.equal(success.galleryQueries, 1);
assert.equal(success.downloads.length, 1);
const [filename, output, mime] = success.downloads[0];
assert.equal(filename, 'variedades_jm_productos.csv');
assert.equal(mime, 'text/csv;charset=utf-8');
assert.ok(output.startsWith('\uFEFF'), 'Incluye BOM UTF-8 para Excel.');
for (const field of ['Código / referencia (SKU)', 'Cantidad física', 'Disponible para venta', 'Compra (COP)', 'Venta (COP)', 'Tallas', 'Colores', 'Variantes (JSON)', 'Descripción', 'URLs de imágenes', 'Estado de publicación']) assert.ok(output.includes(field), `CSV incluye ${field}`);
assert.ok(output.includes('"REF-001"'));
assert.ok(output.includes('"Vestido; Ñandú"'), 'Conserva acentos y delimitadores dentro de celdas.');
assert.ok(output.includes('"=1+1"') === false && output.includes("'=1+1"), 'Neutraliza fórmulas en descripciones.');
for (const url of ['main.webp', 'local-extra.webp', 'gallery.webp', 'variant.webp']) assert.ok(output.includes(`https://cdn.example/${url}`), `Incluye ${url}`);
assert.ok(output.includes('Publicado'));

const noGallery = makeExportContext({ missingGallery: true });
assert.equal(await noGallery.context.exportCSV(), true, 'La galería opcional ausente no bloquea las fotos ya disponibles.');
assert.ok(noGallery.downloads[0][1].includes('https://cdn.example/main.webp'));
assert.ok(!noGallery.downloads[0][1].includes('https://cdn.example/gallery.webp'));
assert.match(noGallery.messages[0], /galería adicional no está instalada/);

const denied = makeExportContext({ authorized: false });
assert.equal(await denied.context.exportCSV(), false);
assert.equal(denied.galleryQueries, 0, 'No consulta ni exporta sin autorización administrativa vigente.');
assert.equal(denied.downloads.length, 0);
console.log('admin_product_export_csv_regression: PASS');
