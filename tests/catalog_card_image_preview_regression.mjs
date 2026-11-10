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
  'Las tarjetas mantienen handlers de puntero sin cambiar la galería interna.');
assert.match(source, /onpointerdown="photoTouchStart\(event\)" onpointermove="photoTouchMove\(event\)" onpointerup="photoTouchEnd\(event\)" onpointercancel="photoTouchEnd\(event\)"/,
  'Los gestos táctiles permanecen ligados a la tarjeta.');

let photoNodes = [];
const context = {
  productos: [
    { id: 'A', image_paths: ['main-A.webp', 'second-A.webp'] },
    { id: 'B', image_paths: ['main-B.webp', 'second-B.webp'] },
    { id: 'C', image_paths: ['main-C.webp'] },
  ],
  document: {
    querySelectorAll(selector) {
      assert.equal(selector, '.photo[data-photo]');
      return photoNodes;
    },
  },
  productImages(product) { return product.image_paths; },
  setPhotoImage(photo, src) { photo.querySelector('img').src = src; },
  clearTimeout() {},
  Date,
};
vm.runInNewContext([
  "let selectedCatalogCardImageProductId='';",
  extractFunction('restoreCardMainPhoto'),
  extractFunction('findCatalogCardPhoto'),
  extractFunction('selectCatalogCardAlternative'),
  extractFunction('restoreSelectedCatalogCardImage'),
  extractFunction('clearPhotoTouchTimer'),
  extractFunction('photoTouchStart'),
  extractFunction('photoTouchMove'),
  extractFunction('photoTouchEnd'),
  extractFunction('photoClickGuard'),
  extractFunction('photoHover'),
  extractFunction('photoHoverLeave'),
].join('\n'), context);

function makeCard(id) {
  const card = { dataset: { productId: id } };
  const image = { src: `main-${id}.webp` };
  const photo = {
    dataset: { photo: `photo-${id}`, index: '0' },
    closest(selector) {
      assert.equal(selector, '.card');
      return card;
    },
    querySelector(selector) {
      assert.equal(selector, 'img');
      return image;
    },
  };
  card.querySelector = selector => selector === '.photo' ? photo : null;
  return { card, photo, image };
}

const cardA = makeCard('A');
const cardB = makeCard('B');
const cardC = makeCard('C');
photoNodes = [cardA.photo, cardB.photo, cardC.photo];

context.photoHover({ currentTarget: cardA.photo, pointerType: 'mouse' });
assert.equal(cardA.image.src, 'second-A.webp', 'El hover muestra la foto alternativa.');
context.photoHoverLeave({ currentTarget: cardA.photo });
assert.equal(cardA.image.src, 'second-A.webp', 'La foto alternativa persiste después de retirar el cursor.');

context.photoHover({ currentTarget: cardB.photo, pointerType: 'mouse' });
assert.equal(cardA.image.src, 'main-A.webp', 'Al seleccionar B, A vuelve a su imagen principal.');
assert.equal(cardB.image.src, 'second-B.webp', 'Solo la tarjeta activa muestra su alternativa.');

const cardBAfterRender = makeCard('B');
photoNodes = [cardBAfterRender.photo];
assert.equal(context.restoreSelectedCatalogCardImage(), true, 'Una reconstrucción de tarjetas conserva la selección visible.');
assert.equal(cardBAfterRender.image.src, 'second-B.webp');

const touchCardA = makeCard('A');
photoNodes = [cardBAfterRender.photo, touchCardA.photo];
context.photoTouchStart({ currentTarget: touchCardA.photo, pointerId: 11, clientX: 10, clientY: 12, pointerType: 'touch' });
assert.equal(touchCardA.image.src, 'second-A.webp', 'El primer toque muestra la alternativa.');
assert.equal(cardBAfterRender.image.src, 'main-B.webp', 'El toque restaura la tarjeta seleccionada anterior.');
context.photoTouchEnd({ currentTarget: touchCardA.photo, pointerId: 11 });
context.photoHoverLeave({ currentTarget: touchCardA.photo });
assert.equal(touchCardA.image.src, 'second-A.webp', 'La alternativa sigue tras retirar el dedo y salir del elemento.');

let prevented = 0;
let stopped = 0;
context.photoClickGuard({
  currentTarget: touchCardA.photo,
  preventDefault() { prevented += 1; },
  stopPropagation() { stopped += 1; },
});
assert.equal(prevented, 1, 'El primer toque selecciona la foto sin abrir el producto.');
assert.equal(stopped, 1);

context.photoTouchStart({ currentTarget: touchCardA.photo, pointerId: 12, clientX: 10, clientY: 12, pointerType: 'touch' });
context.photoTouchEnd({ currentTarget: touchCardA.photo, pointerId: 12 });
prevented = 0;
stopped = 0;
context.photoClickGuard({
  currentTarget: touchCardA.photo,
  preventDefault() { prevented += 1; },
  stopPropagation() { stopped += 1; },
});
assert.equal(prevented, 0, 'El siguiente toque abre la ficha normal de la tarjeta ya seleccionada.');
assert.equal(stopped, 0);

context.photoHover({ currentTarget: cardC.photo, pointerType: 'mouse' });
assert.equal(touchCardA.image.src, 'main-A.webp', 'Seleccionar C restaura la tarjeta activa anterior.');
assert.equal(cardC.image.src, 'main-C.webp', 'Un producto sin alternativa conserva su foto principal.');
assert.equal(vm.runInNewContext('selectedCatalogCardImageProductId', context), 'C', 'Solo el último producto interactuado queda seleccionado.');
assert.deepEqual(context.productos[0].image_paths, ['main-A.webp', 'second-A.webp'], 'La interacción no guarda ni reordena las imágenes.');

const touchEndBody = extractFunction('photoTouchEnd');
assert.doesNotMatch(touchEndBody, /restoreCardMainPhoto\(/, 'Levantar el dedo no restaura la alternativa seleccionada.');

function exerciseSetPhotoImage(reducedMotion) {
  let animationOptions = null;
  let clearedFallbacks = 0;
  const image = {
    src: 'main-A.webp',
    removeAttribute(name) { assert.equal(name, 'data-src'); },
    animate(frames, options) { animationOptions = options; },
  };
  const imageContext = vm.createContext({
    window: { matchMedia(query) { assert.equal(query, '(prefers-reduced-motion: reduce)'); return { matches: reducedMotion }; } },
    clearCardImageFallback(node) { assert.equal(node, image); clearedFallbacks += 1; },
  });
  vm.runInContext(extractFunction('setPhotoImage'), imageContext);
  imageContext.setPhotoImage({ querySelector(selector) { assert.equal(selector, 'img'); return image; } }, 'second-A.webp');
  return { image, animationOptions, clearedFallbacks };
}

const animatedImage = exerciseSetPhotoImage(false);
assert.equal(animatedImage.image.src, 'second-A.webp');
assert.equal(animatedImage.animationOptions.duration, 210, 'El cambio visual usa una transición breve y sutil.');
assert.equal(animatedImage.animationOptions.easing, 'cubic-bezier(.2,.65,.3,1)');
const reducedMotionImage = exerciseSetPhotoImage(true);
assert.equal(reducedMotionImage.animationOptions, null, 'La preferencia de movimiento reducido omite la animación.');
assert.equal(reducedMotionImage.image.src, 'second-A.webp', 'Movimiento reducido no impide el cambio de foto.');

console.log('catalog_card_image_preview_regression: PASS');
