import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Debe existir function ${name}().`);
  const open = html.indexOf('{', start);
  assert.ok(open >= 0, `${name} debe tener cuerpo.`);
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

const openGalleryModalSource = extractFunction('openGalleryModal');
const galleryFocusablesSource = extractFunction('galleryFocusables');
const handleGalleryKeydownSource = extractFunction('handleGalleryKeydown');
const closeGallerySource = extractFunction('closeGallery');

assert.match(html, /<div id="galleryModal" class="galleryModal" role="dialog" aria-modal="true"[^>]*aria-label="Galería ampliada"[^>]*aria-describedby="galleryInfo"[^>]*aria-hidden="true"/);
assert.match(html, /<button id="galleryClose"[^>]*aria-label="Cerrar galería"/);
assert.match(html, /<button id="galleryPrev"[^>]*aria-label="Imagen anterior"/);
assert.match(html, /<button id="galleryNext"[^>]*aria-label="Imagen siguiente"/);
assert.match(html, /id="galleryInfo" class="galleryInfo" role="status" aria-live="polite" aria-atomic="true"/);
assert.match(html, /id="detailImage"[^>]*role="button" tabindex="0"[^>]*aria-haspopup="dialog"[^>]*onkeydown=/);
assert.match(html, /document\.addEventListener\('keydown',handleGalleryKeydown\)/);
assert.doesNotMatch(`${openGalleryModalSource}\n${galleryFocusablesSource}\n${handleGalleryKeydownSource}\n${closeGallerySource}`, /\b(?:fetch|XMLHttpRequest|sendBeacon|\.rpc\s*\(|\.from\s*\()/);

const focused = [];
const moves = [];
const openClasses = new Set();
const elements = {};
const document = {
  activeElement: null,
  body: { style: { overflow: '' } },
};
const makeControl = (id, display = 'block') => ({
  id,
  style: { display },
  disabled: false,
  hidden: false,
  isConnected: true,
  focus() { document.activeElement = this; focused.push(id); },
});
const closeButton = makeControl('galleryClose');
const prevButton = makeControl('galleryPrev');
const nextButton = makeControl('galleryNext');
const detailImage = makeControl('detailImage');
const opener = makeControl('opener');
const modal = {
  attrs: {},
  classList: {
    add(value) { openClasses.add(value); },
    remove(value) { openClasses.delete(value); },
    contains(value) { return openClasses.has(value); },
  },
  setAttribute(name, value) { this.attrs[name] = value; },
  contains(element) { return element === this || [closeButton, prevButton, nextButton].includes(element); },
  focus() { document.activeElement = this; focused.push('galleryModal'); },
};
const productDetailModal = { classList: { contains: () => true } };
Object.assign(elements, {
  galleryModal: modal,
  galleryClose: closeButton,
  galleryPrev: prevButton,
  galleryNext: nextButton,
  productDetailModal,
  detailImage,
});
const context = vm.createContext({
  $: id => elements[id] || null,
  document,
  galleryMove: direction => moves.push(direction),
});
vm.runInContext(`let galleryImages=['one.png','two.png']; let galleryReturnFocus=null;\n${openGalleryModalSource}\n${galleryFocusablesSource}\n${handleGalleryKeydownSource}\n${closeGallerySource}`, context);

context.openGalleryModal(opener);
assert.equal(modal.classList.contains('open'), true);
assert.equal(modal.attrs['aria-hidden'], 'false');
assert.equal(document.body.style.overflow, 'hidden');
assert.equal(document.activeElement, closeButton, 'Al abrir, el foco va al control de cierre.');

const keyEvent = (key, { shiftKey = false } = {}) => ({
  key,
  shiftKey,
  defaultPrevented: false,
  propagationStopped: false,
  preventDefault() { this.defaultPrevented = true; },
  stopPropagation() { this.propagationStopped = true; },
});
const left = keyEvent('ArrowLeft');
context.handleGalleryKeydown(left);
assert.deepEqual(moves, [-1]);
assert.equal(left.defaultPrevented, true);
assert.equal(left.propagationStopped, true);
const right = keyEvent('ArrowRight');
context.handleGalleryKeydown(right);
assert.deepEqual(moves, [-1, 1]);
assert.equal(right.defaultPrevented, true);

// Tab wraps between visible controls; Shift+Tab wraps in the opposite direction.
document.activeElement = nextButton;
const tabForward = keyEvent('Tab');
context.handleGalleryKeydown(tabForward);
assert.equal(document.activeElement, closeButton);
assert.equal(tabForward.defaultPrevented, true);
document.activeElement = closeButton;
const tabBackward = keyEvent('Tab', { shiftKey: true });
context.handleGalleryKeydown(tabBackward);
assert.equal(document.activeElement, nextButton);
assert.equal(tabBackward.defaultPrevented, true);

// A single-image guide hides navigation controls and does not change the image on arrow keys.
prevButton.style.display = 'none';
nextButton.style.display = 'none';
vm.runInContext("galleryImages=['guide.png']", context);
document.activeElement = closeButton;
const singleImageArrow = keyEvent('ArrowRight');
context.handleGalleryKeydown(singleImageArrow);
assert.deepEqual(moves, [-1, 1]);
assert.equal(singleImageArrow.defaultPrevented, false);

const escape = keyEvent('Escape');
context.handleGalleryKeydown(escape);
assert.equal(modal.classList.contains('open'), false);
assert.equal(modal.attrs['aria-hidden'], 'true');
assert.equal(document.body.style.overflow, 'hidden', 'La ficha de producto abierta conserva el scroll lock.');
assert.equal(document.activeElement, opener, 'Al cerrar, el foco vuelve al elemento que abrió el zoom.');
assert.equal(escape.defaultPrevented, true);
assert.equal(escape.propagationStopped, true);

console.log('OK catalog_gallery_accessibility_regression: dialog semántico, labels, keyboard trigger, focus return/trap, Escape y navegación por flechas sin red.');
