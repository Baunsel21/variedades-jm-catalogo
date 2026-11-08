import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extract(name){
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`Missing function ${name}`);
  const end=html.indexOf('\n}',start);
  assert.notEqual(end,-1,`Unterminated function ${name}`);
  return html.slice(start,end+2);
}
function makeElement(){
  return {textContent:'',disabled:false,title:'',attributes:{},setAttribute(name,value){this.attributes[name]=String(value);},removeAttribute(name){delete this.attributes[name];}};
}
let variantValidationCalls=0,saveCalls=0,renderCalls=0,toastMessages=[];
const elements={detailPrice:makeElement(),detailAdd:makeElement(),detailBuyNow:makeElement()};
const ctx=vm.createContext({
  money:value=>`COP ${Number(value).toLocaleString('en-US')}`,
  normalizeText:value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),
  productStockTotal:product=>Number(product?.quantity)||0,
  variantList:()=>[],
  isCatalogFavorite:()=>false,
  productIsBlockedForThisDevice:()=>false,
  showInventoryBlockedMessage:()=>{},
  showToast:message=>toastMessages.push(String(message)),
  validateVariants:()=>{variantValidationCalls++;return {color:'',size:''};},
  getPendingWompiReference:()=>null,
  saveWompiCart:()=>{saveCalls++;},
  renderCart:()=>{renderCalls++;},
  $:id=>elements[id]||null,
  cart:[],
  checkoutCart:null,
  detailProduct:null
});
vm.runInContext([
  extract('catalogProductPriceIsVerified'),
  extract('catalogPriceLabel'),
  extract('compareCatalogProductsByPrice'),
  extract('catalogProductMatchesFilters'),
  extract('syncDetailPriceAndPurchaseState'),
  extract('addToCart'),
  extract('detailBuyNow')
].join('\n'),ctx);

const valid={id:'valid',name:'Precio correcto',sale_price:2500,quantity:3};
const nullPrice={id:'null',name:'Precio ausente',sale_price:null,quantity:3};
const blankPrice={id:'blank',name:'Precio vacío',sale_price:'   ',quantity:3};
const negative={id:'negative',name:'Precio negativo',sale_price:-1,quantity:3};
assert.equal(ctx.catalogPriceLabel(valid),'COP 2,500');
for(const row of [nullPrice,blankPrice,negative]){
  assert.equal(ctx.catalogProductPriceIsVerified(row),false);
  assert.equal(ctx.catalogPriceLabel(row),'Por verificar');
}

const priceRows=[nullPrice,valid,{id:'higher',sale_price:9000,quantity:1},negative];
assert.deepEqual(JSON.parse(JSON.stringify(priceRows.sort(ctx.compareCatalogProductsByPrice).map(row=>row.id))),['valid','higher','null','negative']);
assert.deepEqual(JSON.parse(JSON.stringify(priceRows.sort((a,b)=>ctx.compareCatalogProductsByPrice(a,b,true)).map(row=>row.id))),['higher','valid','null','negative']);

const filters={priceInvalid:false,availability:'all',query:'',category:'',minPrice:0,maxPrice:5000,colors:new Set(),sizes:new Set(),favoritesOnly:false};
const index={byProduct:new Map()};
assert.equal(ctx.catalogProductMatchesFilters(valid,filters,index,index),true);
assert.equal(ctx.catalogProductMatchesFilters(nullPrice,filters,index,index),false,'Precio inválido no se trata como $0 en rango');
assert.equal(ctx.catalogProductMatchesFilters(valid,{...filters,minPrice:null,maxPrice:null},index,index),true);
assert.equal(ctx.catalogProductMatchesFilters(nullPrice,{...filters,minPrice:null,maxPrice:null},index,index),true,'Fuera de filtro por precio, el artículo puede mostrarse como Por verificar');

assert.equal(ctx.syncDetailPriceAndPurchaseState(nullPrice),false);
assert.equal(elements.detailPrice.textContent,'Por verificar');
assert.equal(elements.detailPrice.attributes['aria-label'],'Precio no verificado');
assert.equal(elements.detailAdd.disabled,true);
assert.equal(elements.detailBuyNow.disabled,true);
assert.equal(elements.detailAdd.attributes['aria-disabled'],'true');
assert.equal(ctx.syncDetailPriceAndPurchaseState(valid),true);
assert.equal(elements.detailPrice.textContent,'COP 2,500');
assert.equal(elements.detailAdd.disabled,false);
assert.equal(elements.detailBuyNow.disabled,false);

const event={preventDefault(){},stopPropagation(){}};
ctx.addToCart(nullPrice,event);
assert.equal(ctx.cart.length,0,'No se agrega producto con precio no verificado');
assert.equal(variantValidationCalls,0,'El guard ocurre antes de resolver variantes');
assert.equal(saveCalls,0);
assert.match(toastMessages.at(-1),/precio actual.*no está verificado/i);
ctx.detailProduct=nullPrice;
ctx.detailBuyNow(event);
assert.equal(ctx.checkoutCart,null,'Comprar ahora no crea snapshot de checkout con precio inválido');
assert.equal(variantValidationCalls,0);

assert.ok(html.includes('<div class="price">${catalogPriceLabel(p)}</div>'),'Tarjeta pública evita $0 por sale_price nulo');
assert.ok(html.includes('syncDetailPriceAndPurchaseState(p);')&&html.includes("'Precio: '+catalogPriceLabel(detailProduct)")&&html.includes('${catalogPriceLabel(item)}'),'Ficha, WhatsApp y productos relacionados usan etiqueta segura');
assert.ok(html.includes('compareCatalogProductsByPrice(a,b)')&&html.includes('compareCatalogProductsByPrice(a,b,true)'),'Orden ascendente y descendente deja precio desconocido al final');
assert.ok(html.includes("if(!catalogProductPriceIsVerified(p)){showToast('No se puede agregar")&&html.includes("if(!catalogProductPriceIsVerified(detailProduct)){showToast('No se puede continuar"),'Ambos caminos de compra bloquean el precio sin verificar');

console.log('PASS catalog_price_integrity_regression: null/negativo visible como Por verificar, sin compra, rango como $0 ni orden prioritario.');
