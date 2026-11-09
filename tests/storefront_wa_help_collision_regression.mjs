import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.match(source, /\.waHelpFloat\.is-covered\{visibility:hidden!important;pointer-events:none!important\}/,
  'Una colisión conserva el espacio pero retira la CTA del área de interacción.');
assert.match(source, /#grid \.card,#cartBar \.cartPanel,#productDetailModal\.open,#productDetailModal \.detailPurchaseActions button,#productDetailModal \.detailRelatedCard/,
  'Se vigilan tarjetas, carrito, ficha y sus acciones importantes.');
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
const blocker = rect => ({
  hidden: false,
  getBoundingClientRect() { return rect; },
});
const update = extractFunction('updateWaHelpCollisionState');
const context = {};
vm.runInNewContext(update, context);

assert.equal(context.updateWaHelpCollisionState(button, [blocker({ left: 0, top: 0, right: 200, bottom: 400, width: 200, height: 400 })]), false);
assert.equal(classes.has('is-covered'), false, 'La asesoría se conserva visible cuando no tapa contenido.');
assert.equal(context.updateWaHelpCollisionState(button, [blocker({ left: 280, top: 720, right: 420, bottom: 900, width: 140, height: 180 })]), true);
assert.equal(classes.has('is-covered'), true, 'Una tarjeta intersectada oculta la CTA.');
assert.equal(context.updateWaHelpCollisionState(button, [
  { ...blocker({ left: 280, top: 720, right: 420, bottom: 900, width: 140, height: 180 }), hidden: true },
]), false, 'Un control oculto no crea una colisión fantasma.');
assert.equal(classes.has('is-covered'), false, 'La CTA reaparece cuando queda despejada.');

console.log('storefront_wa_help_collision_regression: PASS');
