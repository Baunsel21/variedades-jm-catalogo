import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const match = html.match(/function refreshDetailWhatsAppLink\(anchor\)\{[\s\S]*?\n\}/);
assert.ok(match, 'Debe existir un helper que actualice el enlace contextual del modal.');
const helperSource = match[0];

assert.match(html, /<a id="detailPersonalizedLink"[^>]*href="https:\/\/wa\.me\/\d+[^\"]*"[^>]*onclick="refreshDetailWhatsAppLink\(this\)"/);
assert.doesNotMatch(helperSource, /\b(?:fetch|XMLHttpRequest|sendBeacon|window\.open)\s*\(|\bsb\.(?:rpc|from)\s*\(|\b(?:reserve|createOrder|wompi)\b/i);

const selected = {
  color: { dataset: { value: 'Azul petróleo' } },
  size: { dataset: { value: 'M' } },
};
const box = {
  querySelector(selector) {
    if (selector === '.colorDot.active') return selected.color;
    if (selector === '.sizeOption.active') return selected.size;
    return null;
  },
};
const anchor = {
  href: 'https://wa.me/573025469983?text=Hola%2C%20necesito%20asesor%C3%ADa',
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
};
const context = {
  URL,
  detailProduct: { name: 'Artículo <A>\n Azul', code: 'TEST-ONLY', hasVariants: true },
  variantList: product => product.hasVariants ? [{ color: 'Azul petróleo', size: 'M' }] : [],
  document: { querySelector: selector => selector === '#productDetailModal .detailCard' ? box : null },
  anchor,
};
vm.createContext(context);
vm.runInContext(helperSource, context);
assert.equal(vm.runInContext('refreshDetailWhatsAppLink(anchor)', context), true);

let url = new URL(anchor.href);
assert.equal(url.protocol, 'https:');
assert.equal(url.hostname, 'wa.me');
assert.equal(url.pathname, '/573025469983', 'Debe conservar el contacto público existente.');
let message = url.searchParams.get('text');
assert.match(message, /Producto: Artículo <A> Azul/);
assert.match(message, /Código: TEST-ONLY/);
assert.match(message, /Color: Azul petróleo/);
assert.match(message, /Talla: M/);
assert.doesNotMatch(message, /correo|teléfono|cédula|customer/i, 'No debe incluir PII del comprador.');
assert.match(anchor.attributes['aria-label'], /Artículo <A> Azul/);

selected.color.dataset.value = 'Verde';
selected.size.dataset.value = 'L';
vm.runInContext('refreshDetailWhatsAppLink(anchor)', context);
url = new URL(anchor.href);
message = url.searchParams.get('text');
assert.match(message, /Color: Verde/);
assert.match(message, /Talla: L/);
assert.doesNotMatch(message, /Azul petróleo|Talla: M/);

console.log('OK catalog_detail_whatsapp_context_regression: producto, código y variante vigente; sin PII ni llamadas remotas.');
