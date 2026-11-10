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
assert.equal(cardA.image.src, 'main-A.webp', 'Al retirar el cursor la tarjeta vuelve a la imagen principal.');

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
context.photoTouchEnd({ currentTarget: touchCardA.photo, pointerId: 11, pointerType: 'touch' });
context.photoHoverLeave({ currentTarget: touchCardA.photo });
assert.equal(touchCardA.image.src, 'main-A.webp', 'Al retirar el dedo la tarjeta vuelve a la imagen principal.');

let prevented = 0;
let stopped = 0;
context.photoClickGuard({
  currentTarget: touchCardA.photo,
  preventDefault() { prevented += 1; },
  stopPropagation() { stopped += 1; },
});
assert.equal(prevented, 0, 'El primer toque selecciona la foto y permite abrir la ficha de inmediato.');
assert.equal(stopped, 0);

context.photoTouchStart({ currentTarget: touchCardA.photo, pointerId: 12, clientX: 10, clientY: 12, pointerType: 'touch' });
context.photoTouchMove({ currentTarget: touchCardA.photo, pointerId: 12, clientX: 24, clientY: 12 });
context.photoTouchEnd({ currentTarget: touchCardA.photo, pointerId: 12, pointerType: 'touch' });
prevented = 0;
stopped = 0;
context.photoClickGuard({
  currentTarget: touchCardA.photo,
  preventDefault() { prevented += 1; },
  stopPropagation() { stopped += 1; },
});
assert.equal(prevented, 1, 'Un swipe horizontal intencional cambia la foto y no abre la ficha accidentalmente.');
assert.equal(stopped, 1);

context.photoTouchStart({ currentTarget: touchCardA.photo, pointerId: 13, clientX: 10, clientY: 12, pointerType: 'touch' });
context.photoTouchEnd({ currentTarget: touchCardA.photo, pointerId: 13, pointerType: 'touch' });
prevented = 0;
stopped = 0;
context.photoClickGuard({
  currentTarget: touchCardA.photo,
  preventDefault() { prevented += 1; },
  stopPropagation() { stopped += 1; },
});
assert.equal(prevented, 0, 'Un toque normal posterior al swipe abre la ficha sin esperar a que venza un temporizador.');
assert.equal(stopped, 0);

context.photoHover({ currentTarget: cardC.photo, pointerType: 'mouse' });
assert.equal(touchCardA.image.src, 'main-A.webp', 'Seleccionar C restaura la tarjeta activa anterior.');
assert.equal(cardC.image.src, 'main-C.webp', 'Un producto sin alternativa conserva su foto principal.');
assert.equal(vm.runInNewContext('selectedCatalogCardImageProductId', context), 'C', 'Solo el último producto interactuado queda seleccionado.');
assert.deepEqual(context.productos[0].image_paths, ['main-A.webp', 'second-A.webp'], 'La interacción no guarda ni reordena las imágenes.');

const touchEndBody = extractFunction('photoTouchEnd');
assert.match(touchEndBody, /event\.pointerType==='touch'\)restoreCardMainPhoto\(photo\)/, 'Levantar el dedo restaura la imagen sin interceptar el click.');

function exerciseSetPhotoImage(reducedMotion) {
  const animations = [];
  let cancelledAnimations = 0;
  let clearedFallbacks = 0;
  const image = {
    src: 'main-A.webp',
    removeAttribute(name) { assert.equal(name, 'data-src'); },
    animate(frames, options) {
      const animation = { frames, options, cancel() { cancelledAnimations += 1; } };
      animations.push(animation);
      return animation;
    },
  };
  const imageContext = vm.createContext({
    window: { matchMedia(query) { assert.equal(query, '(prefers-reduced-motion: reduce)'); return { matches: reducedMotion }; } },
    clearCardImageFallback(node) { assert.equal(node, image); clearedFallbacks += 1; },
  });
  vm.runInContext(extractFunction('setPhotoImage'), imageContext);
  imageContext.setPhotoImage({ querySelector(selector) { assert.equal(selector, 'img'); return image; } }, 'second-A.webp');
  imageContext.setPhotoImage({ querySelector(selector) { assert.equal(selector, 'img'); return image; } }, 'main-A.webp');
  return { image, animations, cancelledAnimations, clearedFallbacks };
}

const animatedImage = exerciseSetPhotoImage(false);
assert.equal(animatedImage.image.src, 'main-A.webp');
assert.equal(animatedImage.animations.length, 2);
assert.equal(animatedImage.cancelledAnimations, 1, 'El cambio rápido de tarjeta cancela el efecto previo y evita acumulación.');
assert.equal(animatedImage.animations[1].options.duration, 700, 'El cambio usa una transición de lujo dentro del rango solicitado.');
assert.equal(animatedImage.animations[1].options.easing, 'cubic-bezier(.22,.61,.36,1)');
assert.equal(animatedImage.animations[1].frames[0].opacity, .84, 'La imagen secundaria entra con un fundido gradual.');
assert.equal(animatedImage.animations[1].frames[0].transform, 'scale(.994)', 'El zoom de entrada es sutil.');
assert.equal(animatedImage.animations[1].frames[1].transform, 'scale(1)');
const reducedMotionImage = exerciseSetPhotoImage(true);
assert.equal(reducedMotionImage.animations.length, 0, 'La preferencia de movimiento reducido omite la animación.');
assert.equal(reducedMotionImage.image.src, 'main-A.webp', 'Movimiento reducido no impide el cambio de foto.');

console.log('catalog_card_image_preview_regression: PASS');
