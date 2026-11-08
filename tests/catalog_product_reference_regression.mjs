import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helperMatch = source.match(/function catalogProductReferenceMarkup\(product\)\{[\s\S]*?\n\}/);
assert.ok(helperMatch, 'Helper de referencia pública disponible.');
const context = vm.createContext({
  esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
});
vm.runInContext(helperMatch[0], context);

assert.equal(context.catalogProductReferenceMarkup({ code: null }), '');
assert.equal(context.catalogProductReferenceMarkup({ code: '   ' }), '');
assert.equal(context.catalogProductReferenceMarkup({ code: 'JM-0042' }), '<div class="productReference">Ref. JM-0042</div>');
assert.equal(context.catalogProductReferenceMarkup({ code: 'JM\u0000-0042\n' }), '<div class="productReference">Ref. JM-0042</div>');
assert.equal(context.catalogProductReferenceMarkup({ code: 'X'.repeat(65) }), '', 'No renderiza referencias anómalamente largas.');
const hostile = context.catalogProductReferenceMarkup({ code: '<img src=x onerror=alert(1)>' });
assert.match(hostile, /&lt;img/);
assert.doesNotMatch(hostile, /<img/);
assert.match(source, /\$\{catalogProductReferenceMarkup\(p\)\}<div class="price">/);
assert.match(source, /renderStorefrontComboCatalog\(\);\s*renderCart\(\);/);
assert.doesNotMatch(helperMatch[0], /\.rpc\(|fetch\(/i, 'El helper solo formatea el campo existente.');
console.log('catalog_product_reference_regression: OK (Ref pública escapada, sin backend)');
