import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Existe function ${name}.`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `La función ${name} tiene cuerpo.`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`No se pudo cerrar la función ${name}.`);
}

assert.match(source, /<section class="categoryPanel" id="catalogo"/);
assert.match(source, /<div id="categoryButtons" class="categoryButtons"><\/div>/);
assert.match(source, /\{name:'Todas',value:''\}/, 'La lista conserva el botón visible Todas.');
assert.doesNotMatch(source, /<div id="directCategoryBar"|id="directCategoryName"|class="backAllBtn"/);
assert.doesNotMatch(source, /Ver todos los productos/);
assert.doesNotMatch(source, /function setDirectCategoryMode|setDirectCategoryMode\(/);

let categoryButtonsHtml = '';
let selectedByClick = null;
const buttonListeners = [];
const buttons = [
  { dataset: { category: '' }, addEventListener(event, callback) { buttonListeners.push({ event, callback }); } },
  { dataset: { category: 'CADENA DE CUERPO' }, addEventListener(event, callback) { buttonListeners.push({ event, callback }); } },
];
const categoryBox = {
  set innerHTML(value) { categoryButtonsHtml = value; },
  querySelectorAll(selector) {
    assert.equal(selector, '.categoryBtn');
    return buttons;
  },
};
const categoryContext = vm.createContext({
  $: id => (id === 'categoryButtons' ? categoryBox : null),
  esc: value => String(value ?? ''),
  categoryIcon: () => 'icon',
  selectCategory: value => { selectedByClick = value; },
  updateCategoryButtons() {},
});
vm.runInContext(extractFunction('renderCategoryButtons'), categoryContext);
categoryContext.renderCategoryButtons(['CADENA DE CUERPO']);
assert.match(categoryButtonsHtml, /data-category=""/);
assert.match(categoryButtonsHtml, /catLabel">Todas<\/span>/);
assert.match(categoryButtonsHtml, /data-category="CADENA DE CUERPO"/);
assert.equal(buttonListeners.length, 2);
buttonListeners[0].callback();
assert.equal(selectedByClick, '', 'El botón Todas continúa restableciendo la categoría.');
buttonListeners[1].callback();
assert.equal(selectedByClick, 'CADENA DE CUERPO', 'Las categorías siguen seleccionables.');

const categoryNode = { value: 'CADENA DE CUERPO' };
const resetCalls = { paths: [], updates: 0, renders: 0, scrolls: [] };
const resetContext = vm.createContext({
  URL,
  window: {
    location: { href: 'https://sirevya.test/?categoria=CADENA%20DE%20CUERPO&precio_min=500#catalogo' },
    scrollTo: options => resetCalls.scrolls.push(options),
  },
  history: { replaceState: (_state, _title, path) => resetCalls.paths.push(path) },
  $: id => (id === 'category' ? categoryNode : null),
  updateCategoryButtons() { resetCalls.updates += 1; },
  render() { resetCalls.renders += 1; },
});
vm.runInContext(extractFunction('showAllCatalog'), resetContext);
resetContext.showAllCatalog();
assert.equal(categoryNode.value, '');
assert.deepEqual(resetCalls.paths, ['/?precio_min=500'], 'El reset elimina categoría/hash y conserva otros filtros URL.');
assert.equal(resetCalls.updates, 1);
assert.equal(resetCalls.renders, 1);
assert.equal(resetCalls.scrolls.length, 1);
assert.equal(resetCalls.scrolls[0].top, 0);
assert.equal(resetCalls.scrolls[0].behavior, 'auto');

console.log('PASS: se eliminó el encabezado redundante; “Todas” y el reset del catálogo conservan su comportamiento.');
