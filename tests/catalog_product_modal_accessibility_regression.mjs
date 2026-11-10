import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Debe existir function ${name}().`);
  let signatureDepth = 0;
  let signatureQuote = '';
  let signatureEscaped = false;
  let open = -1;
  for (let i = html.indexOf('(', start); i < html.length; i++) {
    const ch = html[i];
    if (signatureQuote) {
      if (signatureEscaped) signatureEscaped = false;
      else if (ch === '\\') signatureEscaped = true;
      else if (ch === signatureQuote) signatureQuote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { signatureQuote = ch; continue; }
    if (ch === '(') signatureDepth++;
    else if (ch === ')' && --signatureDepth === 0) {
      open = i + 1;
      while (/\s/.test(html[open] || '')) open++;
      break;
    }
  }
  assert.ok(open >= 0 && html[open] === '{', `${name} debe tener cuerpo.`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  assert.fail(`No se pudo extraer ${name}().`);
}

const helperNames = [
  'productDetailFocusControl',
  'captureProductDetailReturnFocus',
  'productDetailFocusableControls',
  'focusProductDetailDialog',
  'restoreProductDetailReturnFocus',
  'handleProductDetailKeydown',
];
const helpers = helperNames.map(extractFunction).join('\n');
const openSource = extractFunction('openProductDetail');
const closeSource = extractFunction('closeProductDetail');
const buyNowSource = extractFunction('detailBuyNow');

assert.match(html, /<div class="productDetailBox" role="dialog" aria-modal="true" aria-labelledby="detailName">/);
assert.match(html, /id="detailName" class="detailName" role="heading" aria-level="2" tabindex="-1"/);
assert.match(html, /id="catalogo" tabindex="-1"/);
assert.match(html, /document\.addEventListener\('keydown',handleProductDetailKeydown\)/);
assert.match(openSource, /captureProductDetailReturnFocus\(event\)/);
assert.match(openSource, /focusProductDetailDialog\(\)/);
assert.match(closeSource, /restoreProductDetailReturnFocus\(/);
assert.match(buyNowSource, /closeProductDetail\(null,\{restoreFocus:false\}\)/);
assert.match(buyNowSource, /customerName.*focus/);
assert.doesNotMatch(helpers, /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\s*\(|\bsb\.rpc\s*\(|\bsb\.from\s*\(/);

const focused = [];
const openClasses = new Set(['open']);
const overlayState = {
  galleryModal: new Set(),
  checkoutModal: new Set(),
  mobileMenu: new Set(),
  cartBar: new Set(),
  privacyModal: new Set(),
  orderSuccess: new Set(),
};
const document = { activeElement: null, body: { style: { overflow: 'hidden' } } };
const makeControl = (id, tagName = 'BUTTON', tabIndex = 0) => ({
  id,
  tagName,
  tabIndex,
  disabled: false,
  hidden: false,
  isConnected: true,
  style: { display: 'block' },
  focus() { document.activeElement = this; focused.push(id); },
  getAttribute() { return null; },
  getClientRects() { return [{ width: 1, height: 1 }]; },
  closest() { return null; },
});
const opener = makeControl('opener');
const title = makeControl('detailName', 'DIV', -1);
const first = makeControl('firstControl');
const last = makeControl('lastControl');
const closeButton = makeControl('detailClose');
const catalog = makeControl('catalogo', 'SECTION', -1);
const modal = {
  classList: { contains: value => openClasses.has(value) },
  querySelectorAll: () => [first, last],
  querySelector: () => closeButton,
  contains: element => [title, first, last, closeButton].includes(element),
};
const elements = { productDetailModal: modal, detailName: title, catalogo: catalog };
for (const [id, classes] of Object.entries(overlayState)) {
  elements[id] = { classList: { contains: value => classes.has(value) } };
}
let closeCalls = 0;
const context = vm.createContext({
  $: id => elements[id] || null,
  document,
  window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
  closeProductDetail: () => { closeCalls++; },
});
vm.runInContext(`let productDetailReturnFocus=null;\n${helpers}`, context);

const keyEvent = (key, { shiftKey = false } = {}) => ({
  key,
  shiftKey,
  defaultPrevented: false,
  propagationStopped: false,
  preventDefault() { this.defaultPrevented = true; },
  stopPropagation() { this.propagationStopped = true; },
});

document.activeElement = opener;
context.captureProductDetailReturnFocus({ currentTarget: opener, target: opener });
context.focusProductDetailDialog();
assert.equal(document.activeElement, title, 'Al abrir, el foco llega al título dinámico de la ficha.');

document.activeElement = last;
const tabForward = keyEvent('Tab');
context.handleProductDetailKeydown(tabForward);
assert.equal(document.activeElement, first, 'Tab desde el último control vuelve al primero.');
assert.equal(tabForward.defaultPrevented, true);

document.activeElement = first;
const tabBackward = keyEvent('Tab', { shiftKey: true });
context.handleProductDetailKeydown(tabBackward);
assert.equal(document.activeElement, last, 'Shift+Tab desde el primer control vuelve al último.');
assert.equal(tabBackward.defaultPrevented, true);

document.activeElement = catalog;
const tabOutside = keyEvent('Tab');
context.handleProductDetailKeydown(tabOutside);
assert.equal(document.activeElement, first, 'El foco fuera del diálogo se devuelve al primer control.');

const escape = keyEvent('Escape');
context.handleProductDetailKeydown(escape);
assert.equal(closeCalls, 1, 'Escape cierra la ficha cuando no hay otro overlay activo.');
assert.equal(escape.defaultPrevented, true);
assert.equal(escape.propagationStopped, true);

overlayState.galleryModal.add('open');
const nestedEscape = keyEvent('Escape');
context.handleProductDetailKeydown(nestedEscape);
assert.equal(closeCalls, 1, 'La galería conserva prioridad y Escape no cierra la ficha de fondo.');
assert.equal(nestedEscape.defaultPrevented, false);
overlayState.galleryModal.clear();

context.restoreProductDetailReturnFocus(true);
assert.equal(document.activeElement, opener, 'Al cerrar, el foco vuelve al control que abrió el producto.');

document.activeElement = makeControl('body', 'BODY', -1);
context.captureProductDetailReturnFocus(null);
context.restoreProductDetailReturnFocus(true);
assert.equal(document.activeElement, catalog, 'Un deep link sin disparador devuelve el foco al catálogo.');

document.activeElement = opener;
context.captureProductDetailReturnFocus({ currentTarget: opener });
const focusCount = focused.length;
context.restoreProductDetailReturnFocus(false);
assert.equal(focused.length, focusCount, 'Al pasar de la ficha a checkout no se restaura foco a un overlay cerrado.');

console.log('OK catalog_product_modal_accessibility_regression: diálogo etiquetado, foco inicial/retorno, Tab trap, Escape y transición a checkout sin red.');
