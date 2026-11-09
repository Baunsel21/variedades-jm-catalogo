import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.match(source, /\.waHelpFloat\.is-covered\{visibility:hidden!important;pointer-events:none!important\}/,
  'El guard de colisión conserva un estado accesible cuando bloquea la CTA.');
assert.match(source, /#cartBar \.cartPanel,#productDetailModal \.detailPurchaseActions button/,
  'La CTA respeta el carrito y los botones de compra.');
assert.match(source, /window\.matchMedia\('\(max-width:700px\)'\)/,
  'El comportamiento de bloqueo distingue móvil de escritorio.');
assert.match(source, /window\.addEventListener\('scroll',scheduleWaHelpCollisionCheck,\{passive:true\}\)/);
assert.match(source, /window\.addEventListener\('resize',scheduleWaHelpCollisionCheck,\{passive:true\}\)/);

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

const classes = new Set();
const button = {
  getBoundingClientRect() { return { left: 300, top: 700, right: 390, bottom: 742, width: 90, height: 42 }; },
  classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } },
};
const card = {
  hidden: false,
  getBoundingClientRect() { return { left: 280, top: 720, right: 420, bottom: 900, width: 140, height: 180 }; },
};
let criticalRect = { left: 0, top: 0, right: 200, bottom: 400, width: 200, height: 400 };
const critical = {
  hidden: false,
  getBoundingClientRect() { return criticalRect; },
};
let viewport = 'mobile';
const selectors = [];
const context = {
  waHelpCollisionCheckPending: false,
  window: { matchMedia() { return { matches: viewport === 'mobile' }; } },
  document: {
    querySelector(selector) {
      assert.equal(selector, '.waHelpFloat');
      return button;
    },
    querySelectorAll(selector) {
      selectors.push(selector);
      if (selector.includes('#grid .card')) return [card];
      if (selector.includes('#cartBar .cartPanel')) return [critical];
      return [];
    },
  },
  requestAnimationFrame(callback) { callback(); },
};
vm.runInNewContext(`${extractFunction('updateWaHelpCollisionState')}\n${extractFunction('scheduleWaHelpCollisionCheck')}`, context);

context.scheduleWaHelpCollisionCheck();
assert.equal(selectors.some(selector => selector.includes('#grid .card')), false,
  'En celular las tarjetas del catálogo no apagan la CTA durante el scroll.');
assert.equal(classes.has('is-covered'), false,
  'La CTA móvil permanece visible aunque una tarjeta ocupe la esquina inferior.');

criticalRect = { left: 280, top: 720, right: 420, bottom: 900, width: 140, height: 180 };
context.scheduleWaHelpCollisionCheck();
assert.equal(classes.has('is-covered'), true,
  'En móvil la CTA se oculta si taparía un control crítico de compra.');

critical.hidden = true;
context.scheduleWaHelpCollisionCheck();
assert.equal(classes.has('is-covered'), false,
  'Un control oculto no produce colisiones fantasma.');

viewport = 'desktop';
critical.hidden = false;
criticalRect = { left: 0, top: 0, right: 200, bottom: 400, width: 200, height: 400 };
selectors.length = 0;
context.scheduleWaHelpCollisionCheck();
assert.equal(selectors.some(selector => selector.includes('#grid .card')), true,
  'En escritorio se conserva el guard de tarjetas existente.');
assert.equal(classes.has('is-covered'), true,
  'En escritorio una tarjeta que solapa la CTA la mantiene fuera de su contenido.');

console.log('storefront_wa_help_collision_regression: PASS');
