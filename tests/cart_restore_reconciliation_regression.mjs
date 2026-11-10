import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const extract = name => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`function ${escaped}\\(\\)[\\s\\S]*?\\n\\}`))?.[0] ?? '';
};
const reconcile = extract('reconcileRestoredCartWithCatalog');
const renderNotice = extract('renderCartRestoreNotice');
const renderCart = extract('renderCart');
assert.ok(reconcile, 'La rutina de reconciliación local está declarada.');
assert.ok(renderNotice, 'El aviso accesible del carrito restaurado está declarado.');
assert.ok(renderCart.includes('renderCartRestoreNotice()'), 'El aviso se actualiza al renderizar el carrito.');
assert.doesNotMatch(reconcile, /\bsb\.rpc|\bfetch\s*\(|reserve_order_inventory|attach_inventory_reservation|release_inventory_reservation/, 'La reconciliación no llama backend ni muta reservas.');

function runScenario({ cart, products, activeReference = '' }) {
  const context = {
    __cart: structuredClone(cart),
    __products: structuredClone(products),
    writes: 0,
    getActiveReservationReference: () => activeReference,
    variantList: product => Array.isArray(product?.variants) ? product.variants : [],
    variantStock: (product, color, size) => {
      const variant = (product?.variants || []).find(row => row.color === color && row.size === size);
      return Number(variant?.stock) || 0;
    },
    saveWompiCart: () => { context.writes++; },
    $: () => null,
  };
  const result = vm.runInNewContext(`
    let cart=__cart;
    let productos=__products;
    let cartRecoveryNoticeMessage='';
    ${reconcile}
    const result=reconcileRestoredCartWithCatalog();
    JSON.stringify({result,cart,message:cartRecoveryNoticeMessage,writes});
  `, context);
  return JSON.parse(result);
}

const changed = runScenario({
  cart: [{ id: 'sku-test', name: 'Nombre anterior', code: 'SKU-TEST', price: 10000, qty: 3, max: 5, color: 'Azul', size: 'M' }],
  products: [{ id: 'sku-test', name: 'Nombre vigente', code: 'SKU-TEST', sale_price: 12000, quantity: 40, variants: [{ color: 'Azul', size: 'M', stock: 2 }] }],
});
assert.equal(changed.result.priceChanges, 1);
assert.equal(changed.result.stockChanges, 1);
assert.equal(changed.cart[0].price, 12000);
assert.equal(changed.cart[0].max, 2);
assert.equal(changed.cart[0].qty, 3, 'No se descarta en silencio la cantidad que eligió el comprador.');
assert.equal(changed.cart[0].name, 'Nombre vigente');
assert.equal(changed.writes, 1, 'La instantánea local se actualiza una vez.');
assert.match(changed.message, /cambió de precio/);
assert.match(changed.message, /cambió de disponibilidad/);
assert.match(changed.message, /No se creó ni renovó ninguna reserva/);

const missing = runScenario({
  cart: [{ id: 'gone-test', name: 'Producto anterior', code: 'GONE', price: 8000, qty: 1, max: 2 }],
  products: [],
});
assert.equal(missing.result.missingProducts, 1);
assert.equal(missing.cart[0].max, 0);
assert.equal(missing.cart[0].qty, 1, 'El artículo ausente queda visible para que el comprador pueda quitarlo.');
assert.match(missing.message, /ya no aparece en el catálogo/);

const unchanged = runScenario({
  cart: [{ id: 'stable-test', name: 'Producto', code: 'STABLE', price: 9000, qty: 1, max: 4 }],
  products: [{ id: 'stable-test', name: 'Producto', code: 'STABLE', sale_price: 9000, quantity: 4, variants: [] }],
});
assert.equal(unchanged.result.priceChanges, 0);
assert.equal(unchanged.result.stockChanges, 0);
assert.equal(unchanged.message, '');
assert.equal(unchanged.writes, 0);

const reserved = runScenario({
  cart: [{ id: 'reserved-test', name: 'Precio reservado', code: 'RES', price: 10000, qty: 1, max: 4 }],
  products: [{ id: 'reserved-test', name: 'Precio nuevo', code: 'RES', sale_price: 20000, quantity: 0, variants: [] }],
  activeReference: 'REF-TEST-ACTIVA',
});
assert.equal(reserved.result.skipped, true);
assert.equal(reserved.cart[0].price, 10000);
assert.equal(reserved.cart[0].max, 4);
assert.equal(reserved.writes, 0, 'No se cambia el carrito asociado a una reserva activa.');

let node;
const elements = {
  cartRestoreNotice: null,
  cartItems: { parentNode: { insertBefore(value) { node = value; elements.cartRestoreNotice = value; } } },
};
const domContext = {
  __message: 'Recuperamos tu carrito. El precio actual cambió.',
  elements,
  document: {
    createElement(tag) {
      assert.equal(tag, 'div');
      return { style: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
    },
  },
  $: id => elements[id] ?? null,
};
vm.runInNewContext(`
  let cartRecoveryNoticeMessage=__message;
  ${renderNotice}
  renderCartRestoreNotice();
`, domContext);
assert.equal(node.attributes.role, 'status');
assert.equal(node.attributes['aria-live'], 'polite');
assert.equal(node.hidden, false);
assert.match(node.textContent, /precio actual cambió/);

const loadStart = html.indexOf('productos=(base.data||[]).map');
const loadWindow = html.slice(loadStart, loadStart + 900);
assert.ok(loadStart >= 0 && loadWindow.indexOf('reconcileRestoredCartWithCatalog();') > 0 && loadWindow.indexOf('render();restoreCheckoutFromReservation();') > loadWindow.indexOf('reconcileRestoredCartWithCatalog();'), 'La reconciliación ocurre tras cargar el catálogo y antes del render inicial.');

console.log('cart_restore_reconciliation_regression: PASS');
