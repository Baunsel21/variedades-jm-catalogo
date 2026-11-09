import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const open = html.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${name}`);
  let depth = 0;
  for (let index = open; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  assert.fail(`unclosed function ${name}`);
}

for (const id of ['detailImageFallback', 'galleryImageFallback']) {
  assert.match(html, new RegExp(`id="${id}"[^>]*class="imageLoadFallback"`));
}
assert.match(html, /onerror="showImageFallback\(this,'detailImageFallback'\)"/);
assert.match(html, /onerror="showImageFallback\(this,'galleryImageFallback'\)"/);
assert.match(html, /onerror="showCardImageFallback\(this\)" onload="clearCardImageFallback\(this\)"/);
assert.match(html, /onerror="replaceWithImageFallback\(this\)"/);
assert.match(html, /No se pudo cargar la imagen del producto\./);
assert.match(html, /\.imageLoadFallback\[hidden\],#productDetailModal \.detailImage\[hidden\],\.galleryMain\[hidden\]\{display:none!important\}/);
assert.match(html, /detailMainImage\.alt=String\(p\.name\|\|'Producto'\);detailMainImage\.loading=/);
assert.match(html, /\$\('detailImage'\)\.alt=String\(detailProduct\?\.name\|\|'Producto'\)/);

const functions = [
  'showImageFallback',
  'clearImageFallback',
  'replaceWithImageFallback',
  'showCardImageFallback',
  'clearCardImageFallback',
  'setPhotoImage',
].map(extractFunction);
for (const source of functions) {
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|\bsb\.(?:rpc|from)\s*\(/);
}

const elements = new Map();
const context = {
  $: (id) => elements.get(id),
  document: {
    createElement(tagName) {
      return {
        tagName,
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() { this.removed = true; },
      };
    },
  },
};
vm.runInNewContext(functions.join('\n'), context);

const message = { textContent: '' };
const detailFallback = {
  hidden: true,
  querySelector(selector) {
    assert.equal(selector, '[data-image-fallback-message]');
    return message;
  },
};
elements.set('detailImageFallback', detailFallback);
const detailImage = { hidden: false, alt: 'Corset de muestra' };
context.showImageFallback(detailImage, 'detailImageFallback');
assert.equal(detailImage.hidden, true);
assert.equal(detailFallback.hidden, false);
assert.equal(message.textContent, 'No se pudo cargar la imagen de Corset de muestra.');
context.clearImageFallback(detailImage, 'detailImageFallback');
assert.equal(detailImage.hidden, false);
assert.equal(detailFallback.hidden, true);

let replacement;
const thumbImage = {
  replaceWith(node) { replacement = node; },
};
context.replaceWithImageFallback(thumbImage);
assert.equal(replacement.className, 'noimg');
assert.equal(replacement.attributes.role, 'img');
assert.equal(replacement.attributes['aria-label'], 'Imagen no disponible');
assert.equal(replacement.textContent, '▧');

let appended;
let cardPlaceholder;
const photo = {
  querySelector(selector) {
    assert.equal(selector, '.photoImageFallback');
    return cardPlaceholder;
  },
  append(node) { appended = node; cardPlaceholder = node; },
};
const cardImage = {
  hidden: false,
  closest(selector) { assert.equal(selector, '.photo'); return photo; },
};
context.showCardImageFallback(cardImage);
assert.equal(cardImage.hidden, true);
assert.equal(appended.className, 'noimg photoImageFallback');
assert.equal(appended.attributes['aria-label'], 'Imagen no disponible');
context.clearCardImageFallback(cardImage);
assert.equal(cardImage.hidden, false);
assert.equal(appended.removed, true);

let carouselFallback;
const carouselPhoto = {
  querySelector() { return carouselFallback; },
};
carouselFallback = { remove() { this.removed = true; } };
const carouselImage = {
  hidden: true,
  src: 'old-image',
  closest() { return carouselPhoto; },
  removeAttribute(name) { assert.equal(name, 'data-src'); this.lazyAttributeRemoved = true; },
};
context.setPhotoImage({ querySelector() { return carouselImage; } }, 'next-image');
assert.equal(carouselImage.hidden, false);
assert.equal(carouselImage.src, 'next-image');
assert.equal(carouselImage.lazyAttributeRemoved, true);
assert.equal(carouselFallback.removed, true);

console.log('catalog_image_fallback_regression: PASS');
