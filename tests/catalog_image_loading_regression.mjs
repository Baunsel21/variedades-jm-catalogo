import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const catalog=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extractFunction(name){
  const start=catalog.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`Missing function ${name}`);
  const end=catalog.indexOf('\n}',start);
  assert.notEqual(end,-1,`Unterminated function ${name}`);
  return catalog.slice(start,end+2);
}
assert.ok(catalog.includes('data-src="${esc(imgs[0])}" alt="${esc(p.name)}" loading="lazy" decoding="async"'),'Las imágenes de tarjetas quedan diferidas y decodificadas en segundo plano');

const images=[
  {key:'above',dataset:{src:'https://example.invalid/above.webp'},src:'',removed:[],removeAttribute(name){this.removed.push(name);delete this.dataset.src}},
  {key:'near',dataset:{src:'https://example.invalid/near.webp'},src:'',removed:[],removeAttribute(name){this.removed.push(name);delete this.dataset.src}},
  {key:'far',dataset:{src:'https://example.invalid/far.webp'},src:'',removed:[],removeAttribute(name){this.removed.push(name);delete this.dataset.src}}
];
let callback=null,options=null,observed=[],unobserved=[];
class FakeIntersectionObserver{
  constructor(cb,opts){callback=cb;options=opts}
  observe(image){observed.push(image.key)}
  unobserve(image){unobserved.push(image.key)}
}
const observerContext=vm.createContext({
  document:{querySelectorAll:selector=>selector==='#grid img[data-src]'?images:[]},
  window:{IntersectionObserver:FakeIntersectionObserver},
  IntersectionObserver:FakeIntersectionObserver
});
vm.runInContext(extractFunction('activateCatalogLazyImages'),observerContext);
observerContext.activateCatalogLazyImages();
assert.deepEqual(observed,['above','near','far']);
assert.equal(options.rootMargin,'160px 0px');
assert.equal(options.threshold,0.01);
callback([
  {isIntersecting:false,target:images[0]},
  {isIntersecting:true,target:images[1]},
  {isIntersecting:false,target:images[2]}
],{unobserve:image=>unobserved.push(image.key)});
assert.equal(images[0].src,'','Una tarjeta fuera del margen conserva data-src');
assert.equal(images[1].src,'https://example.invalid/near.webp');
assert.deepEqual(images[1].removed,['data-src']);
assert.deepEqual(unobserved,['near']);
assert.equal(images[2].src,'');

const fallbackImages=[
  {dataset:{src:'https://example.invalid/a.webp'},src:'',removeAttribute(name){delete this.dataset.src}},
  {dataset:{src:'https://example.invalid/b.webp'},src:'',removeAttribute(name){delete this.dataset.src}}
];
const fallbackContext=vm.createContext({document:{querySelectorAll:()=>fallbackImages},window:{}});
vm.runInContext(extractFunction('activateCatalogLazyImages'),fallbackContext);
fallbackContext.activateCatalogLazyImages();
assert.equal(fallbackImages[0].src,'https://example.invalid/a.webp');
assert.equal(fallbackImages[1].src,'https://example.invalid/b.webp');
assert.ok(fallbackImages.every(image=>!('src' in image.dataset)),'El fallback carga imágenes sin IntersectionObserver');

const galleryElements={
  galleryMain:{loading:'lazy',fetchPriority:'auto',decoding:'sync',src:'',alt:'',style:{}},
  galleryInfo:{textContent:''},
  galleryPrev:{style:{}},
  galleryNext:{style:{}}
};
const galleryContext=vm.createContext({
  galleryProduct:{name:'Producto de prueba'},
  galleryImages:['https://example.invalid/one.webp','https://example.invalid/two.webp'],
  galleryIndex:0,
  $:id=>galleryElements[id],
  animateGalleryImage:()=>{}
});
vm.runInContext(extractFunction('renderGallery'),galleryContext);
galleryContext.renderGallery();
assert.equal(galleryElements.galleryMain.loading,'eager');
assert.equal(galleryElements.galleryMain.fetchPriority,'high');
assert.equal(galleryElements.galleryMain.decoding,'async');
assert.equal(galleryElements.galleryMain.src,'https://example.invalid/one.webp');
assert.equal(galleryElements.galleryInfo.textContent,'1 / 2');

console.log('PASS catalog_image_loading_regression: IntersectionObserver/rootMargin, fallback sin soporte y prioridad eager de galería.');
