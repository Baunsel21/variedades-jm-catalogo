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

const functionNames = [
  'mobileMenuFocusableControls',
  'mobileMenuSetExpanded',
  'handleMobileMenuKeydown',
  'openMobileMenu',
  'closeMobileMenu',
];
const menuFunctions = functionNames.map(extractFunction).join('\n');
assert.match(html, /<button class="mobileMenuBtn"[^>]*aria-controls="mobileMenu"[^>]*aria-expanded="false"[^>]*onclick="openMobileMenu\(event\)"/);
assert.match(html, /<button class="detailHeaderMenu"[^>]*aria-controls="mobileMenu"[^>]*aria-expanded="false"[^>]*onclick="openMobileMenu\(event\)"/);
const menuListener = "document.addEventListener('keydown',handleMobileMenuKeydown)";
assert.equal(html.split(menuListener).length - 1, 1, 'El listener del menú se registra una sola vez.');
assert.ok(html.indexOf(menuListener) < html.indexOf("document.addEventListener('keydown',handleGalleryKeydown)"), 'El menú recibe Escape antes del listener de galería.');
assert.doesNotMatch(menuFunctions, /\b(?:fetch|XMLHttpRequest|sendBeacon)\b|\bsb\.(?:rpc|from)\s*\(/, 'El harness no ejecuta llamadas de red ni RPC.');

let document;
const focused = [];
const makeControl = (id, { disabled = false, hidden = false, display = 'block', visibility = 'visible' } = {}) => ({
  id,
  disabled,
  hidden,
  style: { display, visibility },
  attrs: {},
  isConnected: true,
  setAttribute(name, value) { this.attrs[name] = String(value); },
  getAttribute(name) { return this.attrs[name] ?? null; },
  closest() { return null; },
  getClientRects() { return this.style.display === 'none' || this.style.visibility === 'hidden' ? [] : [{}]; },
  focus() { document.activeElement = this; focused.push(id); },
});
const trigger = makeControl('headerMenuTrigger');
const detailTrigger = makeControl('detailMenuTrigger');
trigger.attrs['aria-expanded'] = 'false';
detailTrigger.attrs['aria-expanded'] = 'false';
const hiddenControl = makeControl('hiddenControl', { hidden: true });
const disabledControl = makeControl('disabledControl', { disabled: true });
const firstControl = makeControl('drawerBrandLink');
const closeControl = makeControl('drawerClose');
const lastControl = makeControl('lastDrawerLink');
const controls = [hiddenControl, disabledControl, firstControl, closeControl, lastControl];
const panel = {
  focus() { document.activeElement = this; focused.push('mobileMenuPanel'); },
  querySelectorAll() { return controls; },
};
const menuClasses = new Set();
const menu = {
  attrs: { 'aria-hidden': 'true' },
  classList: {
    add(value) { menuClasses.add(value); },
    remove(value) { menuClasses.delete(value); },
    contains(value) { return menuClasses.has(value); },
  },
  setAttribute(name, value) { this.attrs[name] = String(value); },
  querySelector(selector) { return selector === '.mobileMenuPanel' ? panel : null; },
  contains(element) { return element === this || element === panel || controls.includes(element); },
};
const categoryBox = { innerHTML: '', onclick: null, contains() { return true; } };
const galleryClasses = new Set(['open']);
const elements = {
  mobileMenu: menu,
  mobileMenuCategories: categoryBox,
  galleryModal: { classList: { contains: value => galleryClasses.has(value) } },
};
document = {
  activeElement: trigger,
  body: { style: { overflow: '' } },
  querySelectorAll(selector) {
    if (selector === '#category option') return [];
    if (selector === '[aria-controls="mobileMenu"]') return [trigger, detailTrigger];
    return [];
  },
};
const context = vm.createContext({
  $: id => elements[id] || null,
  document,
  window: { getComputedStyle: element => element.style },
  esc: value => String(value),
  selectCategoryFromMenu() {},
});
vm.runInContext(`let mobileMenuReturnFocus=null;\n${menuFunctions}`, context);

context.openMobileMenu({ currentTarget: trigger });
assert.equal(menu.classList.contains('open'), true, 'Abrir activa el drawer.');
assert.equal(menu.attrs['aria-hidden'], 'false');
assert.equal(trigger.getAttribute('aria-expanded'), 'true');
assert.equal(detailTrigger.getAttribute('aria-expanded'), 'true', 'Todos los triggers publican el estado expandido.');
assert.equal(document.activeElement, firstControl, 'Al abrir, el foco pasa al primer control visible y habilitado del drawer.');
assert.deepEqual(focused, ['drawerBrandLink']);

function keyEvent(key, { shiftKey = false } = {}) {
  return {
    key,
    shiftKey,
    defaultPrevented: false,
    propagationStopped: false,
    immediatePropagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; },
  };
}

document.activeElement = lastControl;
const tabForward = keyEvent('Tab');
context.handleMobileMenuKeydown(tabForward);
assert.equal(document.activeElement, firstControl, 'Tab desde el último control vuelve al primero.');
assert.equal(tabForward.defaultPrevented, true);
assert.equal(tabForward.immediatePropagationStopped, true, 'La trampa evita que otros overlays procesen el mismo Tab.');

document.activeElement = firstControl;
const tabBackward = keyEvent('Tab', { shiftKey: true });
context.handleMobileMenuKeydown(tabBackward);
assert.equal(document.activeElement, lastControl, 'Shift+Tab desde el primero vuelve al último.');
assert.equal(tabBackward.defaultPrevented, true);

document.activeElement = trigger;
const tabFromOutside = keyEvent('Tab');
context.handleMobileMenuKeydown(tabFromOutside);
assert.equal(document.activeElement, firstControl, 'El foco exterior se recupera dentro del drawer.');

const escape = keyEvent('Escape');
context.handleMobileMenuKeydown(escape);
assert.equal(menu.classList.contains('open'), false, 'Escape cierra el drawer.');
assert.equal(menu.attrs['aria-hidden'], 'true');
assert.equal(trigger.getAttribute('aria-expanded'), 'false');
assert.equal(detailTrigger.getAttribute('aria-expanded'), 'false');
assert.equal(document.activeElement, trigger, 'Escape devuelve el foco al trigger que abrió el drawer.');
assert.equal(escape.defaultPrevented, true);
assert.equal(escape.propagationStopped, true);
assert.equal(escape.immediatePropagationStopped, true, 'Escape del menú tiene prioridad sobre los demás listeners.');
assert.equal(galleryClasses.has('open'), true, 'Cerrar el menú no cierra la galería que esté detrás.');
assert.equal(document.body.style.overflow, 'hidden', 'Se conserva el bloqueo de scroll del overlay subyacente.');

const tabAfterClose = keyEvent('Tab');
context.handleMobileMenuKeydown(tabAfterClose);
assert.equal(tabAfterClose.defaultPrevented, false, 'El manejador queda inactivo con el menú cerrado.');
assert.equal(tabAfterClose.immediatePropagationStopped, false);

console.log('OK mobile_menu_accessibility_regression: aria-expanded, foco inicial, trampa de Tab, Escape prioritario y retorno de foco sin red.');
