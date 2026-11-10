import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const catalog = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  let start = source.indexOf(marker);
  assert.notEqual(start, -1, `function exists: ${name}`);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const open = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

const productId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actionCalls = [];
const actionContext = vm.createContext({
  esc(value) { return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); },
  productos: [{ id: productId }],
  calls: actionCalls,
  isSafeAdminProductId: null,
  openProduct(id, button) { actionCalls.push(['view', id, button]); },
  compartirProducto(id) { actionCalls.push(['share', id]); },
  editarProducto(id) { actionCalls.push(['edit', id]); },
  borrarProducto(id) { actionCalls.push(['delete', id]); },
  closeModal(restore) { actionCalls.push(['close', restore]); },
  document: { activeElement: null },
});
vm.runInContext([
  extractFunction(admin, 'isSafeAdminProductId'),
  extractFunction(admin, 'renderInventoryActionButtons'),
  extractFunction(admin, 'handleInventoryProductAction'),
].join('\n'), actionContext);
assert.equal(actionContext.isSafeAdminProductId(productId), true);
assert.equal(actionContext.isSafeAdminProductId("' ); alert(1);//"), false);
const rendered = actionContext.renderInventoryActionButtons({ id: productId, name: `Vestido </button><img src=x onerror=alert(1)>` });
assert.match(rendered, /data-product-id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"/);
assert.doesNotMatch(rendered, /onclick=/i, 'product IDs never enter inline JavaScript');
assert.doesNotMatch(rendered, /<img src=x/, 'product names remain escaped in the button label');
assert.match(rendered, /aria-label="Ver Vestido &lt;\/button&gt;/);

function makeActionEvent(action, id, hostId = 'inventoryCards') {
  const host = { id: hostId };
  const button = { dataset: { inventoryAction: action, productId: id }, closest(selector) { return selector === '#inventoryCards,#tablaProductos,#modalBody' ? host : null; } };
  let prevented = false;
  return { target: { closest(selector) { return selector === 'button[data-inventory-action][data-product-id]' ? button : null; } }, preventDefault() { prevented = true; }, get prevented() { return prevented; }, button, host };
}
const validView = makeActionEvent('view', productId);
actionContext.handleInventoryProductAction(validView);
assert.equal(actionCalls[0][0], 'view');
assert.equal(actionCalls[0][1], productId);
const hostile = makeActionEvent('delete', "' ); alert(1);//");
actionContext.handleInventoryProductAction(hostile);
assert.equal(hostile.prevented, true);
assert.equal(actionCalls.length, 1, 'invalid or injected product ID never dispatches an action');
const modalEdit = makeActionEvent('edit', productId, 'modalBody');
actionContext.handleInventoryProductAction(modalEdit);
assert.deepEqual(actionCalls.slice(1).map(call => call[0]), ['close', 'edit']);
assert.equal(actionCalls[1][1], false, 'editing from the dialog does not restore focus to a disappearing control');

assert.match(admin, /role="dialog" aria-modal="true" aria-labelledby="modalTitle"/);
assert.match(admin, /aria-label="Cerrar detalle del producto"/);
assert.match(admin, /window\.addEventListener\('keydown',handleProductModalKeydown\)/);
assert.match(admin, /modal\.querySelector\('\[data-product-modal-close\]'\)/);
assert.match(admin, /if\(token!==productModalRenderToken\|\|!modal\.classList\.contains\('show'\)\)return/);

const adminFocusContext = vm.createContext({ document: { activeElement: null } });
vm.runInContext(extractFunction(admin, 'trapDialogTabKey'), adminFocusContext);
let focusTarget = null, prevented = false;
const first = { getAttribute() { return null; }, focus() { focusTarget = 'first'; } }, last = { getAttribute() { return null; }, focus() { focusTarget = 'last'; } };
const dialog = { querySelectorAll() { return [first, last]; }, contains(node) { return node === first || node === last; }, focus() { focusTarget = 'dialog'; } };
adminFocusContext.document.activeElement = first;
adminFocusContext.trapDialogTabKey({ key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } }, dialog);
assert.equal(focusTarget, 'last');
assert.equal(prevented, true);
focusTarget = null; prevented = false; adminFocusContext.document.activeElement = last;
adminFocusContext.trapDialogTabKey({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } }, dialog);
assert.equal(focusTarget, 'first');
assert.equal(prevented, true);
focusTarget = null; prevented = false; adminFocusContext.document.activeElement = first;
adminFocusContext.trapDialogTabKey({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } }, dialog);
assert.equal(focusTarget, null, 'ordinary forward tab remains native');
assert.equal(prevented, false);

assert.match(catalog, /<section id="cartBar" class="cartBar" aria-hidden="true" onclick=/);
assert.match(catalog, /role="dialog" aria-modal="true" aria-labelledby="cartDrawerTitle"/);
assert.match(catalog, /class="cartClose"[^>]*aria-label="Cerrar carrito"/);
assert.match(catalog, /hideCart\(false\);\s*updateShipping\(\);\s*\$\('checkoutModal'\)\.classList\.add\('open'\)/);

const cartState = { cartOpen: true, cartFocusReturn: null, cart: ['item'], calls: [], document: { activeElement: null, body: { style: {} } } };
let cartFirst = null, cartLast = null;
const cartDialog = {
  querySelectorAll() { return [cartFirst, cartLast]; },
  contains(node) { return node === cartFirst || node === cartLast; },
  focus() { cartState.calls.push('dialog-focus'); },
};
const cartClose = { focus() { cartState.calls.push('close-focus'); } };
const cartBar = { setAttribute(name, value) { this[name] = value; }, classList: { remove(name) { cartState.calls.push('remove:' + name); } }, querySelector(selector) { return selector === '[role="dialog"]' ? cartDialog : selector === '.cartClose' ? cartClose : null; } };
const checkoutModal = { classList: { contains() { return false; } } };
Object.assign(cartState, {
  $(id) { return id === 'cartBar' ? cartBar : id === 'checkoutModal' ? checkoutModal : null; },
  renderCart() { cartState.calls.push('render'); },
  showToast() { cartState.calls.push('toast'); },
});
vm.createContext(cartState);
cartFirst = { hidden: false, style: {}, getAttribute() { return null; }, focus() { cartState.calls.push('first-focus'); } };
cartLast = { hidden: false, style: {}, getAttribute() { return null; }, focus() { cartState.calls.push('last-focus'); } };
vm.runInContext([
  extractFunction(catalog, 'cartDialogFocusables'),
  extractFunction(catalog, 'handleCartDialogKeydown'),
  extractFunction(catalog, 'toggleCart'),
  extractFunction(catalog, 'hideCart'),
].join('\n'), cartState);
const cartKeyEvent = { key: 'Tab', shiftKey: true, preventDefault() { this.prevented = true; }, stopPropagation() {} };
cartState.document.activeElement = cartFirst;
cartState.handleCartDialogKeydown(cartKeyEvent);
assert.equal(cartKeyEvent.prevented, true);
assert.ok(cartState.calls.includes('last-focus'), 'Shift+Tab wraps to the last cart control');
let openerFocused = false;
const opener = { isConnected: true, focus() { openerFocused = true; } };
cartState.document.activeElement = opener;
cartState.cartOpen = false;
cartState.toggleCart();
assert.equal(cartState.cartOpen, true);
assert.equal(cartState.cartFocusReturn, opener);
assert.ok(cartState.calls.includes('close-focus'), 'opening the cart moves focus into the drawer');
cartState.hideCart();
assert.equal(cartState.cartOpen, false);
assert.equal(openerFocused, true, 'closing the cart returns focus to its opener');

console.log('PASS admin inventory action safety and modal/cart keyboard focus regressions.');
