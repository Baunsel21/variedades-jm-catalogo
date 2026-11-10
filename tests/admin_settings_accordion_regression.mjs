import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
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
    else if (char === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  assert.fail(`unclosed function ${name}`);
}

class FakeElement {
  constructor(tagName, { id = '', classes = [], heading = '' } = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = classes.join(' ');
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.heading = heading;
    this.open = false;
    this.textContent = '';
    this.type = '';
    this.isBox = classes.includes('box');
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
    };
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child => child !== node);
      node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  querySelector(selector) {
    if (selector === ':scope > .sectionGrid' && this.id === 'config') return configGrid;
    if (selector === 'h3' && this.isBox) return { textContent: this.heading };
    return null;
  }
  addEventListener(type, handler) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(handler);
    this.listeners.set(type, listeners);
  }
  click() { for (const handler of this.listeners.get('click') || []) handler({ target: this }); }
}

const definitions = [
  ['connection', 'Conexión'], ['adminAccountSecurityBox', 'Seguridad de la cuenta'],
  ['onlinePaymentsSettingsBox', 'Pagos en línea'], ['storefrontShippingSettingsBox', 'Tarifas de envío'],
  ['wompiReconciliationBox', 'Conciliaciones Wompi pendientes'], ['telegramTestBox', 'Prueba de Telegram'],
  ['telegramAutomaticBox', 'Telegram automático'], ['codCitiesSettingsBox', 'Ciudades contraentrega'],
  ['seasonalPromoSettingsBox', 'Promoción emergente'], ['storefrontCombosAdminBox', 'Promociones de un producto con otro'],
  ['storefrontCouponsAdminBox', 'Cupones de descuento'], ['brand', 'Personalización'],
  ['categories', 'Categorías'], ['appearance', 'Apariencia'], ['backup', 'Copia de respaldo'],
  ['session', 'Sesión'], ['salesArchive', 'Archivo seguro de ventas'], ['reset', 'Reinicio total deshabilitado'],
];
const boxes = definitions.map(([id, heading]) => new FakeElement('div', { id, classes: ['box'], heading }));
const configGrid = new FakeElement('div', { classes: ['sectionGrid'] });
configGrid.children = boxes;
for (const box of boxes) box.parentNode = configGrid;
const config = new FakeElement('section', { id: 'config' });
const storage = new Map([['sirevya_admin_settings_telegram', 'open']]);
const document = { createElement: tagName => new FakeElement(tagName) };
const context = vm.createContext({
  $(id) { return id === 'config' ? config : null; },
  document,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, value); },
  },
});
vm.runInContext(`${extractFunction('initAdminSettingsAccordions')}\ninitAdminSettingsAccordions();`, context);

const accordions = configGrid.children.filter(child => child.classList.contains('adminSettingsAccordion'));
assert.equal(accordions.length, 9, 'Los módulos existentes se agrupan en nueve paneles temáticos.');
assert.equal(configGrid.children.filter(child => child.classList.contains('box')).length, 0, 'No quedan opciones sueltas fuera de acordeones.');
const groupedBoxes = accordions.flatMap(details => details.children.find(child => child.classList.contains('adminSettingsAccordionBody')).children);
assert.equal(groupedBoxes.length, boxes.length, 'Todas las cajas originales se conservan.');
for (const box of boxes) assert.ok(groupedBoxes.includes(box), `se conserva el nodo original ${box.id}`);
assert.ok(accordions.filter(details => details.dataset.settingsAccordion !== 'telegram').every(details => details.open === false), 'Los paneles comienzan contraídos por defecto.');
assert.equal(accordions.find(details => details.dataset.settingsAccordion === 'telegram').open, true, 'Se restaura el panel abierto guardado en el dispositivo.');
assert.equal(context.initAdminSettingsAccordions(), false, 'La inicialización idempotente no vuelve a mover los nodos.');

const controls = configGrid.children.find(child => child.classList.contains('adminSettingsAccordionTools'));
const expandAll = controls.children.find(button => button.textContent === 'Expandir todo');
const collapseAll = controls.children.find(button => button.textContent === 'Contraer todo');
expandAll.click();
assert.ok(accordions.every(details => details.open), 'Expandir todo abre los paneles.');
assert.equal(storage.get('sirevya_admin_settings_shipping'), 'open');
collapseAll.click();
assert.ok(accordions.every(details => !details.open), 'Contraer todo cierra los paneles.');
assert.equal(storage.get('sirevya_admin_settings_telegram'), 'closed');

assert.match(html, /\.adminSettingsAccordionBody\{grid-template-columns:1\.4fr 1fr/);
assert.match(html, /@media\(max-width:1100px\)\{\.adminSettingsAccordionBody\{grid-template-columns:1fr\}\}/);
console.log('admin_settings_accordion_regression: PASS');
