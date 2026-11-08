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
class NodeFixture{
  constructor(){this.disabled=false;this.textContent='';this.innerHTML='';this.dataset={};}
}
const priceHelper=extract('catalogProductPriceIsVerified');
let toastMessages=[],saveCalls=0,renderCalls=0;
const ctx=vm.createContext({
  console,
  money:value=>`$${Number(value).toFixed(0)}`,
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
  productStockTotal:product=>Number(product?.quantity)||0,
  comboCategoryMatches:(product,category)=>String(product?.category||'')===String(category||''),
  productNeedsComboOptions:()=>false,
  showToast:message=>toastMessages.push(String(message)),
  saveWompiCart:()=>{saveCalls++;},
  renderCart:()=>{renderCalls++;},
  storefrontProductCombos:[],
  productos:[],
  cart:[]
});
const functions=[
  priceHelper,
  extract('getStorefrontComboRepresentativeProducts'),
  extract('storefrontComboHasVerifiedCandidates'),
  extract('getStorefrontComboPartnerOptions'),
  extract('storefrontComboPairPreview'),
  extract('storefrontComboPairSummaryMarkup'),
  extract('comboCatalogProductOptions'),
  extract('updateStorefrontComboCatalogChoice'),
  extract('addSelectedStorefrontComboToCart')
];
vm.runInContext(functions.join('\n'),ctx);
const validA={id:'a1',name:'Artículo A',category:'A',sale_price:1000,quantity:2};
const validB={id:'b1',name:'Artículo B',category:'B',sale_price:2000,quantity:2};
const nullPrice={id:'b0',name:'Sin precio',category:'B',sale_price:null,quantity:2};
const negativePrice={id:'b2',name:'Precio negativo',category:'B',sale_price:-1,quantity:2};
ctx.productos=[validA,validB,nullPrice,negativePrice];
const combo={id:'combo-1',rule_type:'category_pair',category_a:'A',category_b:'B',discount_type:'percent',discount_value:10};
ctx.storefrontProductCombos=[combo];

const valid=ctx.storefrontComboPairPreview(combo,validA,validB);
assert.deepEqual(JSON.parse(JSON.stringify(valid)),{verified:true,original:3000,discount:300,total:2700});
for(const invalid of [nullPrice,negativePrice]){
  const preview=ctx.storefrontComboPairPreview(combo,validA,invalid);
  assert.equal(preview.verified,false);
  assert.equal(preview.original,null);
  assert.equal(preview.discount,null);
  assert.equal(preview.total,null);
  const markup=ctx.storefrontComboPairSummaryMarkup(preview);
  assert.match(markup,/pendientes de verificación/);
  assert.doesNotMatch(markup,/Ahorro|\$0|\$1000/);
}

const options=ctx.comboCatalogProductOptions('B');
assert.ok(options.includes('b1'));
assert.ok(!options.includes('b0')&&!options.includes('b2'),'Selector filtra precios nulos y negativos');
assert.deepEqual(JSON.parse(JSON.stringify(ctx.getStorefrontComboPartnerOptions(validA,combo))).map(row=>row.id),['b1']);
assert.equal(ctx.getStorefrontComboPartnerOptions(nullPrice,combo).length,0,'Un producto base sin precio tampoco genera preview');
ctx.productos=[validA,nullPrice,negativePrice];
assert.equal(ctx.storefrontComboHasVerifiedCandidates(combo),false,'No expone la tarjeta de categoría si no quedan precios verificables');
ctx.productos=[validA,validB,nullPrice,negativePrice];
assert.equal(ctx.storefrontComboHasVerifiedCandidates(combo),true,'La tarjeta aparece cuando hay candidatos verificables en ambas categorías');
const pairCombo={id:'pair',rule_type:'product_pair',product_a_id:'a1',product_b_id:'b0'};
assert.equal(ctx.getStorefrontComboRepresentativeProducts(pairCombo),null,'El combo fijo no elige producto con precio inválido');
assert.equal(ctx.storefrontComboHasVerifiedCandidates(pairCombo),false,'No expone la tarjeta de pareja si cualquiera de los precios es inválido');

const summary=new NodeFixture(),openA=new NodeFixture(),openB=new NodeFixture(),add=new NodeFixture();
const selectA={value:'a1'},selectB={value:'b0'};
const card={dataset:{catalogComboId:'combo-1'},querySelector(selector){
  if(selector==='select[data-combo-choice="a"]')return selectA;
  if(selector==='select[data-combo-choice="b"]')return selectB;
  if(selector==='[data-combo-price-summary]')return summary;
  if(selector==='[data-combo-open-selected="a"]')return openA;
  if(selector==='[data-combo-open-selected="b"]')return openB;
  if(selector==='[data-combo-add-selected]')return add;
  return null;
}};
ctx.updateStorefrontComboCatalogChoice(card);
assert.match(summary.textContent,/no se pudo verificar/i);
assert.equal(openA.disabled,false);
assert.equal(openB.disabled,true);
assert.equal(add.disabled,true);

let prevented=false,stopped=false;
ctx.addSelectedStorefrontComboToCart({closest:()=>card},{preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
assert.equal(prevented,true);
assert.equal(stopped,true);
assert.equal(ctx.cart.length,0,'No agrega al carrito un combo con precio incompleto');
assert.equal(saveCalls,0,'No persiste carrito no verificable');
assert.equal(renderCalls,0);
assert.match(toastMessages.at(-1),/precio.*no está verificado/i);

selectB.value='b1';
ctx.updateStorefrontComboCatalogChoice(card);
assert.equal(add.disabled,false);
assert.ok(summary.innerHTML.includes('$300')&&summary.innerHTML.includes('$2700'),'Preview válido conserva cálculo confirmado');
ctx.addSelectedStorefrontComboToCart({closest:()=>card},{preventDefault(){},stopPropagation(){}});
assert.equal(ctx.cart.length,2);
assert.equal(saveCalls,1);
assert.equal(renderCalls,1);
assert.match(toastMessages.at(-1),/Ahorras \$300/);

assert.ok(html.includes('!catalogProductPriceIsVerified(product))return []')&&html.includes('catalogProductPriceIsVerified(p)&&comboCategoryMatches(p,category)'),'Socios y opciones del catálogo requieren precio verificable');
assert.ok(html.includes('storefrontComboPairSummaryMarkup(preview)')&&html.includes('catalogProductPriceIsVerified(primary)?money(primary.sale_price)')&&html.includes('catalogProductPriceIsVerified(product)?money(product.sale_price)'),'Tarjetas y ficha no reemplazan precio inválido por cero');
assert.ok(html.includes('.filter(storefrontComboHasVerifiedCandidates).slice(0,8)'),'La tarjeta promocional solo aparece si hay candidatos con precios verificados');

console.log('PASS combo_preview_regression: precio inválido fail-closed en selector, preview, tarjetas, detalle, carrito y toast.');
