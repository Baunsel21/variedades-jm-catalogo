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

assert.match(source, /onpointerenter="photoHover\(event\)" onpointerleave="photoHoverLeave\(event\)"/,
  'Cada imagen maneja su propio hover y salida.');
assert.match(source, /onpointerdown="photoTouchStart\(event\)" onpointermove="photoTouchMove\(event\)" onpointerup="photoTouchEnd\(event\)" onpointercancel="photoTouchEnd\(event\)"/,
  'Los gestos táctiles permanecen ligados a la tarjeta.');
assert.match(source, /if\(!photo\.\_\_gesturePreviewChanged\)[\s\S]*?advancePhotoFromElement\(photo,1\)/,
  'El swipe horizontal previsualiza solo una vez durante el gesto.');
assert.match(source, /if\(changedPhoto\)restoreCardMainPhoto\(photo\)/,
  'El fin del gesto restaura la imagen principal.');

let timerId = 0;
const timers = new Map();
const context = {
  productos: [
    { id: 'A', image_paths: ['main-A.webp', 'second-A.webp'] },
    { id: 'B', image_paths: ['main-B.webp', 'second-B.webp'] },
    { id: 'C', image_paths: ['main-C.webp'] },
  ],
  productImages(product) { return product.image_paths; },
  setPhotoImage(photo, src) { photo.querySelector('img').src = src; },
  setTimeout(callback, delay) {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
  flushTimers() {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach(timer => timer.callback());
  },
};
vm.runInNewContext([
  extractFunction('restoreCardMainPhoto'),
  extractFunction('advancePhotoFromElement'),
  extractFunction('clearPhotoTouchTimer'),
  extractFunction('photoTouchStart'),
  extractFunction('photoTouchMove'),
  extractFunction('photoTouchEnd'),
  extractFunction('photoHover'),
  extractFunction('photoHoverLeave'),
].join('\n'), context);

function makeCard(id) {
  const card = { dataset: { productId: id } };
  const image = { src: `main-${id}.webp` };
  const photo = {
    dataset: { index: 0 },
    closest(selector) {
      assert.equal(selector, '.card');
      return card;
    },
    querySelector(selector) {
      assert.equal(selector, 'img');
      return image;
    },
  };
  return { card, photo, image };
}

const cardA = makeCard('A');
const cardB = makeCard('B');
const cardC = makeCard('C');
context.photoHover({ currentTarget: cardA.photo, pointerType: 'mouse' });
context.flushTimers();
assert.equal(cardA.image.src, 'second-A.webp');
assert.equal(cardA.photo.dataset.index, 1);
assert.equal(cardB.image.src, 'main-B.webp', 'Cambiar A no modifica la tarjeta B.');
context.photoHover({ currentTarget: cardB.photo, pointerType: 'mouse' });
context.flushTimers();
assert.equal(cardB.image.src, 'second-B.webp');
context.photoHoverLeave({ currentTarget: cardA.photo });
assert.equal(cardA.image.src, 'main-A.webp', 'Al salir de A vuelve su imagen principal.');
assert.equal(cardA.photo.dataset.index, 0);
assert.equal(cardB.image.src, 'second-B.webp', 'La salida de A no restaura ni altera B.');
context.photoHoverLeave({ currentTarget: cardB.photo });
assert.equal(cardB.image.src, 'main-B.webp');

let prevented = 0;
let stopped = 0;
context.photoTouchStart({ currentTarget: cardA.photo, pointerId: 7, clientX: 10, clientY: 12, pointerType: 'touch' });
context.photoTouchMove({ currentTarget: cardA.photo, pointerId: 7, clientX: 36, clientY: 13 });
assert.equal(cardA.image.src, 'second-A.webp', 'El swipe horizontal muestra temporalmente la segunda imagen.');
context.photoTouchEnd({
  currentTarget: cardA.photo,
  pointerId: 7,
  cancelable: true,
  preventDefault() { prevented += 1; },
  stopPropagation() { stopped += 1; },
});
assert.equal(cardA.image.src, 'main-A.webp', 'Al terminar el swipe se restaura inmediatamente la imagen principal.');
assert.equal(cardA.photo.dataset.index, 0);
assert.equal(prevented, 1);
assert.equal(stopped, 1, 'El gesto no abre el detalle por accidente.');

context.photoHover({ currentTarget: cardC.photo, pointerType: 'mouse' });
context.flushTimers();
assert.equal(cardC.image.src, 'main-C.webp', 'Si no existe segunda imagen, el hover no falla ni inventa una.');
context.photoHoverLeave({ currentTarget: cardC.photo });
context.photoTouchStart({ currentTarget: cardC.photo, pointerId: 8, clientX: 0, clientY: 0, pointerType: 'touch' });
context.photoTouchMove({ currentTarget: cardC.photo, pointerId: 8, clientX: 24, clientY: 1 });
context.photoTouchEnd({ currentTarget: cardC.photo, pointerId: 8, cancelable: true, preventDefault() {}, stopPropagation() {} });
assert.equal(cardC.photo.dataset.index, 0);

const quickTap = makeCard('B');
prevented = 0;
stopped = 0;
context.photoTouchStart({ currentTarget: quickTap.photo, pointerId: 9, clientX: 0, clientY: 0, pointerType: 'touch' });
context.photoTouchEnd({
  currentTarget: quickTap.photo,
  pointerId: 9,
  cancelable: true,
  preventDefault() { prevented += 1; },
  stopPropagation() { stopped += 1; },
});
assert.equal(quickTap.image.src, 'main-B.webp', 'Un toque breve no cambia la foto y mantiene el comportamiento de apertura de ficha.');
assert.equal(prevented, 0);
assert.equal(stopped, 0);

assert.deepEqual(context.productos[0].image_paths, ['main-A.webp', 'second-A.webp'], 'La vista previa no guarda ni reordena las imágenes del producto.');
console.log('catalog_card_image_preview_regression: PASS');
