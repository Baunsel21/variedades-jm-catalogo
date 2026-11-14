import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const storefront = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Existe ${name}.`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i], next = source[i + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth += 1;
    if (c === '}') {
      depth -= 1;
      if (!depth) return source.slice(start, i + 1);
    }
  }
  throw new Error(`No se pudo cerrar ${name}.`);
}

const context = vm.createContext({ URL, IMAGE_WORKER_URL: 'https://images.example.test' });
vm.runInContext([
  extractFunction(storefront, 'normalizeText'),
  extractFunction(storefront, 'normalizeVariantKeyText'),
  extractFunction(storefront, 'parseVariantList'),
  extractFunction(storefront, 'normalizeVariants'),
  extractFunction(storefront, 'variantList'),
  extractFunction(storefront, 'publicImage'),
  extractFunction(storefront, 'variantImageUrl'),
].join('\n'), context);

const product = {
  colors: ['Blanco', 'Café'],
  sizes: ['M', 'L'],
  image_url: 'products/synthetic/main.jpg',
  variants: [
    { color: 'Blanco', size: 'M', stock: 2, image_path: 'products/synthetic/blanco-m.jpg' },
    { color: 'Café', size: 'M', stock: 1, image_path: 'products/synthetic/cafe-m.jpg' },
    { color: 'Café', size: 'L', stock: 1, image_path: 'products/synthetic/cafe-l.jpg' },
  ],
};

assert.match(context.variantImageUrl(product, 'Blanco', 'M'), /blanco-m\.jpg$/);
assert.match(context.variantImageUrl(product, 'Café', 'M'), /cafe-m\.jpg$/);
assert.match(context.variantImageUrl(product, 'CAFE', 'L'), /cafe-l\.jpg$/);
assert.match(context.variantImageUrl(product, 'Café'), /cafe-m\.jpg$/);
assert.equal(context.variantImageUrl(product, 'Negro', 'M'), '');

assert.match(admin, /verifyVariantPhotoReferences\(productId, variants, files/);
assert.match(admin, /await verifyVariantPhotoReferences\((?:originalProductId|savedProductId),updatedVariants,variantFiles,isCurrent\)/);
console.log('variant_color_image_regression: PASS (Blanco/Café, acentos, talla y verificación persistida).');
