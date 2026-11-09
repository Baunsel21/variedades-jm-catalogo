import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const shareSource = source.match(/async function shareCurrentProductLink\(\)\{[\s\S]*?\n\}/)?.[0];
const openSource = source.match(/function openDirectProductFromLocation\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(shareSource, 'La tienda implementa compartir la ficha pública actual.');
assert.ok(openSource, 'La tienda conserva el deep link existente por producto.');
assert.match(source, /id="detailShare"[^>]*onclick="shareCurrentProductLink\(\)"[^>]*aria-label="Copiar enlace de este producto"/);
assert.match(source, /requestAnimationFrame\(\(\)=>openDirectProductFromLocation\(\)\)/, 'La ficha se abre tras cargar el catálogo para enlaces ?producto=.');
assert.doesNotMatch(shareSource, /\bsb\b|\bfetch\s*\(|\.rpc\s*\(|\.from\s*\(|WOMPI|checkout|reservation/i, 'Compartir no consulta backend ni crea checkout/reservas.');

let currentUrl = new URL('https://sirevya.com.co/?email=customer%40example.com&cart=private#old');
const copied = [];
const toasts = [];
const context = vm.createContext({
  URL,
  detailProduct: { id: 'public-product-123' },
  window: { location: { origin: currentUrl.origin } },
  navigator: { clipboard: { writeText: async value => copied.push(value) } },
  showToast: message => toasts.push(String(message)),
});
vm.runInContext(shareSource, context);
assert.equal(await context.shareCurrentProductLink(), true);
assert.equal(copied.length, 1);
const shared = new URL(copied[0]);
assert.equal(shared.origin, 'https://sirevya.com.co');
assert.equal(shared.pathname, '/');
assert.equal(shared.searchParams.get('producto'), 'public-product-123');
assert.equal(shared.hash, '#catalogo');
assert.deepEqual([...shared.searchParams.entries()], [['producto', 'public-product-123']]);
assert.doesNotMatch(copied[0], /email|customer|cart|reservation|wompi/i, 'El enlace limpio no transporta datos personales, carrito o reservas.');
assert.match(toasts.at(-1), /No incluye carrito ni datos del cliente/);

context.detailProduct = { id: 'bad\nproduct' };
assert.equal(await context.shareCurrentProductLink(), false);
assert.equal(copied.length, 1, 'Un ID con controles nunca se comparte.');
assert.match(toasts.at(-1), /No se puede compartir/);

const fallbackToasts = [];
const fallback = vm.createContext({
  URL,
  detailProduct: { id: 'public-product-456' },
  window: { location: { origin: 'https://sirevya.com.co' } },
  navigator: { clipboard: { writeText: async () => { throw new Error('clipboard unavailable'); } } },
  showToast: message => fallbackToasts.push(String(message)),
});
vm.runInContext(shareSource, fallback);
assert.equal(await fallback.shareCurrentProductLink(), false);
assert.match(fallbackToasts.at(-1), /Enlace del producto: https:\/\/sirevya\.com\.co\/\?producto=public-product-456#catalogo/);

let directModalOpen = false;
let openedProductId = '';
const directContext = vm.createContext({
  URLSearchParams,
  window: { location: { search: '?producto=public-product-123&email=private%40example.com' } },
  productos: [{ id: 'public-product-123' }],
  $: () => ({ classList: { contains: () => directModalOpen } }),
  openProductDetail: id => { openedProductId = String(id); directModalOpen = true; },
  console: { debug() {} },
});
vm.runInContext(openSource, directContext);
assert.equal(directContext.openDirectProductFromLocation(), true);
assert.equal(openedProductId, 'public-product-123', 'El enlace abre el producto del catálogo sintético.');

console.log('OK catalog_product_share_link_regression: ID público limpio, deep-link existente, sin carrito ni backend.');
