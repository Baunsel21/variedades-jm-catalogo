import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`unclosed function ${name}`);
}

assert.match(source, /class="detailRelatedSwipeHint">Desliza para descubrir más productos ↔<\/p><div class="detailRelatedPagination" aria-hidden="true"><span class="detailRelatedDot is-active"><\/span><span class="detailRelatedDot"><\/span><span class="detailRelatedDot"><\/span><\/div>/,
  'Los tres puntos aparecen centrados debajo de la instrucción y la copia decorativa queda fuera del árbol accesible.');
assert.match(source, /\.detailRelatedPagination\{[^}]*justify-content:center/);
assert.match(source, /\.detailRelatedDot\.is-active\{[^}]*transform:scale\(1\.24\)/);
assert.ok(source.includes('@media(prefers-reduced-motion:reduce){.detailComboChoices{scroll-behavior:auto!important;}.detailRelatedDot{transition:none!important;}}'));
assert.ok(source.includes('host.innerHTML=`<div class="detailAccordionGroup">${descriptionSection}${sizeGuideSection}${deliverySection}</div>${comboSection}${relatedSection}`;\n bindDetailRelatedCarouselIndicators(host);'),
  'La ficha conecta los dots al track que acaba de renderizarse.');

const dots = Array.from({ length: 3 }, () => ({
  active: false,
  classList: { toggle(name, force) { if (name === 'is-active') this.active = Boolean(force); } },
}));
const section = {
  querySelectorAll(selector) {
    assert.equal(selector, '.detailRelatedDot');
    return dots;
  },
};
const listeners = {};
const track = {
  scrollWidth: 1200,
  clientWidth: 300,
  scrollLeft: 0,
  closest(selector) {
    assert.equal(selector, '.detailRelatedSection');
    return section;
  },
  addEventListener(name, handler, options) {
    listeners[name] = handler;
    listeners[`${name}Options`] = options;
  },
};
const resizeHandlers = {};
const context = {
  document: {
    querySelectorAll(selector) {
      assert.equal(selector, '#productDetailModal .detailRelatedGrid');
      return [track];
    },
  },
  window: {
    addEventListener(name, handler, options) {
      resizeHandlers[name] = handler;
      resizeHandlers[`${name}Options`] = options;
    },
  },
};
vm.runInNewContext([
  'let detailRelatedResizeListenerBound=false;',
  extractFunction('updateDetailRelatedCarouselIndicators'),
  extractFunction('refreshDetailRelatedCarouselIndicators'),
  extractFunction('bindDetailRelatedCarouselIndicators'),
].join('\n'), context);

const host = {
  querySelector(selector) {
    assert.equal(selector, '.detailRelatedGrid');
    return track;
  },
};
context.bindDetailRelatedCarouselIndicators(host);
const activeDot = () => dots.findIndex(dot => dot.classList.active);
assert.equal(activeDot(), 0, 'Al inicio se activa el primer punto.');
assert.equal(listeners.scrollOptions.passive, true, 'El listener de scroll es pasivo.');
assert.equal(resizeHandlers.resizeOptions.passive, true, 'El recálculo de layout es pasivo.');

track.scrollLeft = 350;
listeners.scroll();
assert.equal(activeDot(), 1, 'El punto central se activa al avanzar por el track.');
track.scrollLeft = 700;
listeners.scroll();
assert.equal(activeDot(), 2, 'El tercer punto se activa en el tercio final.');
track.scrollLeft = 900;
resizeHandlers.resize();
assert.equal(activeDot(), 2, 'Al final del carrusel permanece activo el último punto incluso al cambiar el layout.');

track.scrollLeft = 0;
track.scrollWidth = track.clientWidth;
context.updateDetailRelatedCarouselIndicators(track);
assert.equal(activeDot(), 0, 'Sin overflow, el estado inicial es determinista.');

console.log('catalog_related_carousel_indicators_regression: PASS');
