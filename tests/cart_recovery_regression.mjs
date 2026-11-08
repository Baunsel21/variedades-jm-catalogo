import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extract(name,asyncFn=false){
 const prefix=asyncFn?'async function ':'function ';
 const text=html.match(new RegExp(prefix+name+'\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}'))?.[0];
 assert.ok(text,`No se encontró ${name}`);return text;
}
const keysBlock=html.match(/const WOMPI_PENDING_REFERENCE_KEY=[\s\S]*?const WOMPI_RESERVATION_TTL=10\*60\*1000;/)?.[0];
assert.ok(keysBlock,'Se mantienen las claves y TTL históricos');
const cartBootstrap=html.match(/try\{\n const savedCart=JSON\.parse\(localStorage\.getItem\(WOMPI_CART_KEY\)\|\|'null'\);\n if\(Array\.isArray\(savedCart\)\) cart=savedCart;\n\}catch\(e\)\{[^\n]+\}/)?.[0];
assert.ok(cartBootstrap,'Ejecuta el bootstrap real de carrito persistido');
assert.ok(html.includes("const WOMPI_CART_KEY='jm_wompi_cart_v5';"));
assert.ok(html.includes("const COD_ORDER_DRAFT_KEY='jm_cod_order_draft_v1';"));

class StorageFixture{
 #map=new Map();
 getItem(key){return this.#map.has(String(key))?this.#map.get(String(key)):null}
 setItem(key,value){this.#map.set(String(key),String(value))}
 removeItem(key){this.#map.delete(String(key))}
 keys(){return [...this.#map.keys()]}
}
const localStorage=new StorageFixture();
const clock={now:1_000_000};
class FixedDate extends Date{static now(){return clock.now}}
const dom=new Map();
class ElementFixture{
 constructor(id=''){this.id=id;this.className='';this.textContent='';this.value='';this.hidden=false;this.attributes=new Map();this.style={};this.parentElement=null;this.classList={add(){},remove(){}}}
 setAttribute(name,value){this.attributes.set(name,String(value))}
 removeAttribute(name){this.attributes.delete(name)}
 getAttribute(name){return this.attributes.get(name)||null}
 after(node){dom.set(node.id,node)}
}
const documentFixture={createElement:()=>new ElementFixture(),querySelector:selector=>selector==='.cartShippingLocalNote'?(dom.get('cartShippingLocalNote')||null):null,body:{style:{}}};
const context=vm.createContext({localStorage,Date:FixedDate,console,document:documentFixture,$:id=>dom.get(id)||null,variantList:p=>Array.isArray(p?.variants)?p.variants:[],variantStock:()=>0});
const functions=[
 'reservationTimestampIsActive','normalizeReservationItems','reservationItemsMatch','rawReservationItems',
 'saveReservationRegistry','getReservationRegistry','findReservationRecordByReference','findReservationRecordForItems',
 'setCurrentReservationRecord','saveReservationRecord','updateReservationReference','forgetReservationRecord',
 'getPendingWompiReference','savePendingWompiReference','getActiveReservationReference','saveActiveReservationReference',
 'saveActiveReservationItems','saveReservationDraft','getActiveReservationItems','clearPendingWompiReference',
 'getCheckoutItems','restoreCheckoutFromReservation','catalogProductPriceIsVerified','cartCatalogRecoveryState','ensureCheckoutCatalogVerified','cartCatalogRecoveryMessage','updateCartCatalogRecoveryNotice','comboPriceForItem','updateCartShippingProgress','updateShipping','updateCheckoutSummary','buildOrderPayload','renderCart'
];
vm.runInContext(keysBlock+'\nlet productos=[],cart=[],checkoutCart=null;\n'+functions.map(name=>extract(name)).join('\n'),context);
const run=source=>vm.runInContext(source,context);
const get=key=>localStorage.getItem(key);
const setJson=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
const TTL=10*60*1000;
const keys={pending:'jm_wompi_pending_reference_v5',pendingTime:'jm_wompi_pending_time_v5',cart:'jm_wompi_cart_v5',time:'jm_wompi_reservation_time_v5',reference:'jm_wompi_reservation_reference_v6',items:'jm_wompi_reservation_items_v2',registry:'jm_wompi_reservations_v3',cod:'jm_cod_order_draft_v1'};

assert.equal(run('WOMPI_RESERVATION_TTL'),TTL);
assert.equal(run('reservationTimestampIsActive(Date.now()-WOMPI_RESERVATION_TTL)'),true,'El límite exacto de diez minutos conserva compatibilidad');
assert.equal(run('reservationTimestampIsActive(Date.now()-WOMPI_RESERVATION_TTL-1)'),false,'La reserva expira al superar los diez minutos');
assert.equal(run('reservationTimestampIsActive(Date.now()+60000)'),true,'Tolera hasta 60 s de desfase de reloj');
assert.equal(run('reservationTimestampIsActive(Date.now()+60001)'),false,'Un timestamp futuro mayor no se considera reserva vigente');
assert.equal(run('reservationTimestampIsActive(Number.NaN)'),false);

const reservation={reference:'res-1',startedAt:clock.now-TTL,items:[{id:'P1',qty:2,color:'Sin color',size:'Única'}]};
setJson(keys.registry,[reservation]);
assert.equal(run('getReservationRegistry().length'),1,'El borde exacto sigue activo');
assert.equal(JSON.parse(get(keys.registry))[0].startedAt,reservation.startedAt,'Leer no renueva el reloj');
clock.now+=1;assert.equal(run('getReservationRegistry().length'),0,'TTL+1 se descarta');assert.deepEqual(JSON.parse(get(keys.registry)),[]);

clock.now=1_000_000;
setJson(keys.registry,[{...reservation,startedAt:clock.now+60000}]);
assert.equal(run('getReservationRegistry().length'),1,'El registro tolera hasta 60 s de desfase futuro');
setJson(keys.registry,[{...reservation,startedAt:clock.now+60001}]);
assert.deepEqual(JSON.parse(run('JSON.stringify(getReservationRegistry())')),[],'Un registro futuro manipulado no se devuelve como activo');
assert.deepEqual(JSON.parse(get(keys.registry)),[],'El registro inválido se elimina del índice local');

// Las referencias pendientes obedecen la misma ventana y se limpian localmente si están expiradas o en futuro anómalo.
localStorage.setItem(keys.pending,'pay-expired');localStorage.setItem(keys.pendingTime,String(clock.now-TTL-1));
assert.equal(run('getPendingWompiReference()'),'');assert.equal(get(keys.pending),null);assert.equal(get(keys.pendingTime),null);
localStorage.setItem(keys.pending,'pay-future');localStorage.setItem(keys.pendingTime,String(clock.now+60001));
assert.equal(run('getPendingWompiReference()'),'');assert.equal(get(keys.pending),null);
localStorage.setItem(keys.pending,'pay-valid');localStorage.setItem(keys.pendingTime,String(clock.now+60000));
assert.equal(run('getPendingWompiReference()'),'pay-valid');assert.equal(get(keys.pendingTime),String(clock.now+60000));

// Un puntero de reserva vencido/futuro no puede reabrir checkout; se limpia solo el puntero local.
localStorage.setItem(keys.reference,'reservation-stale');localStorage.setItem(keys.time,String(clock.now+60001));
localStorage.setItem(keys.items,JSON.stringify([{id:'p1',qty:2}]));
assert.equal(run('getActiveReservationReference()'),'');
for(const key of [keys.reference,keys.time,keys.items,keys.pending,keys.pendingTime])assert.equal(get(key),null,`No se limpió puntero viejo: ${key}`);
setJson(keys.registry,[{...reservation,reference:'reservation-expired',startedAt:clock.now-TTL-1}]);
localStorage.setItem(keys.reference,'reservation-expired');localStorage.setItem(keys.time,String(clock.now-TTL-1));
localStorage.setItem(keys.items,JSON.stringify([{id:'p1',qty:2}]));run('checkoutCart=null;restoreCheckoutFromReservation();');
assert.equal(run('checkoutCart'),null,'Un puntero vencido no puede restaurar/reabrir el checkout');
assert.equal(get(keys.reference),null);

// Al persistir un reintento no se reinicia el TTL ni se toca el draft COD.
clock.now=2_000_000;const startedAt=clock.now-4*60*1000;
setJson(keys.registry,[{reference:'reservation-old',startedAt,items:[{id:'p1',qty:1,color:'Rojo',size:'M'}]}]);
localStorage.setItem(keys.reference,'reservation-old');localStorage.setItem(keys.time,String(startedAt));
localStorage.setItem(keys.items,JSON.stringify([{id:'p1',qty:1,color:'Rojo',size:'M'}]));localStorage.setItem(keys.cod,'cod-reference-preserved');
run("savePendingWompiReference('payment-retry')");
assert.equal(get(keys.time),String(startedAt),'El reintento no extiende los diez minutos');
assert.equal(get(keys.pendingTime),String(startedAt),'El tiempo pendiente conserva el inicio original');
assert.equal(get(keys.reference),'payment-retry');
const rows=JSON.parse(get(keys.registry));assert.equal(rows.find(r=>r.reference==='payment-retry').startedAt,startedAt);
assert.equal(get(keys.cod),'cod-reference-preserved','La clave COD es independiente');

// La recuperación del checkout usa el precio actual del catálogo, no el precio persistido.
localStorage.setItem(keys.cart,JSON.stringify([{id:'p1',name:'Nombre anterior',price:42000,qty:2,max:8,color:'',size:''}]));
run('cart=[];');run(cartBootstrap);
assert.equal(run('cart[0].price'),42000,'El snapshot se conserva para compatibilidad, no es autoridad de precio');
run("productos=[{id:'p1',name:'Nombre vigente',code:'SKU-1',sale_price:50000,quantity:0,variants:[]}];");
assert.equal(run('comboPriceForItem(cart[0])'),50000,'El importe del resumen usa el precio del catálogo cargado');
const cartAnchor=new ElementFixture('cartItems'),checkoutAnchor=new ElementFixture('checkoutSummaryItems');dom.set(cartAnchor.id,cartAnchor);dom.set(checkoutAnchor.id,checkoutAnchor);
assert.match(run('cartCatalogRecoveryMessage(cart)'),/precio de uno o más productos cambió/i);
run("updateCartCatalogRecoveryNotice('cartRecoveryNotice','cartItems',cart,'cartRecoveryNotice')");
const cartNotice=dom.get('cartRecoveryNotice');assert.ok(cartNotice);assert.equal(cartNotice.hidden,false);assert.equal(cartNotice.getAttribute('role'),'status');assert.equal(cartNotice.getAttribute('aria-live'),'polite');
assert.match(cartNotice.textContent,/usa el precio actual del catálogo/i);assert.ok(!cartNotice.textContent.includes('<script'));
run("checkoutCart=[{id:'p1',name:'Nombre vigente',price:50000,qty:2,color:'',size:''}];updateCartCatalogRecoveryNotice('checkoutRecoveryNotice','checkoutSummaryItems',checkoutCart,'checkoutRecoveryNotice')");
assert.equal(dom.get('checkoutRecoveryNotice').hidden,false,'La comparación usa también el snapshot del carrito al restaurar reserva');
run("productos=[];const missingNotice=cartCatalogRecoveryMessage(cart)");
assert.match(run('missingNotice'),/no se pudo volver a verificar/i);assert.ok(!run('missingNotice').includes('Nombre vigente'));
run("productos=[{id:'p1',name:'Nombre vigente',code:'SKU-1',sale_price:42000,quantity:0,variants:[]}];updateCartCatalogRecoveryNotice('cartRecoveryNotice','cartItems',cart,'cartRecoveryNotice')");
assert.equal(dom.get('cartRecoveryNotice').hidden,true,'El aviso desaparece si el precio ya coincide');
run("productos[0].sale_price=50000");
run('checkoutCart=null');
setJson(keys.registry,[{reference:'payment-retry',startedAt,items:[{id:'p1',qty:2,color:'',size:''},{id:'missing',qty:1,color:'',size:''}]}]);
localStorage.setItem(keys.reference,'payment-retry');localStorage.setItem(keys.time,String(startedAt));
localStorage.setItem(keys.items,JSON.stringify([{id:'p1',qty:2,color:'',size:''},{id:'missing',qty:1,color:'',size:''}]));
run('checkoutCart=null;restoreCheckoutFromReservation();');
assert.equal(run('checkoutCart[0].name'),'Nombre vigente');
assert.equal(run('checkoutCart[0].price'),50000);
assert.equal(run('checkoutCart.length'),2,'La restauración conserva la línea ausente en vez de reducir el carrito');
assert.equal(run('checkoutCart[1].id'),'missing');assert.equal(run('checkoutCart[1].price'),0);
assert.equal(run('cartCatalogRecoveryState(checkoutCart).productUnverified'),true);
run("let toastMessage='';function showToast(value){toastMessage=String(value)}");
assert.equal(run('ensureCheckoutCatalogVerified(checkoutCart)'),false,'El guard detiene items fuera del catálogo');
assert.match(run('toastMessage'),/no se inició ningún pedido ni pago/i);
assert.equal(run('buildOrderPayload()'),null,'No genera payload con precio cero para una línea desconocida');
run("updateCartCatalogRecoveryNotice('checkoutRecoveryNotice','checkoutSummaryItems',checkoutCart,'checkoutRecoveryNotice')");
assert.equal(dom.get('checkoutRecoveryNotice').hidden,false,'El producto ausente mantiene visible el aviso del checkout');
assert.equal(get(keys.time),String(startedAt),'Restaurar no renueva el reloj de reserva');

for(const id of ['checkoutItemSummary','checkoutSubtotal','checkoutDiscountTotalRow','checkoutDiscountTotalLabel','checkoutDiscountTotal','checkoutCouponDiscountRow','checkoutCouponDiscount','checkoutShippingTotal','checkoutTotal'])dom.set(id,new ElementFixture(id));
run(`let checkoutShipping=11000,storefrontShippingSettingsLoaded=true,storefrontShippingSettingsLoadError=false;
const money=value=>'$'+Number(value||0);const esc=value=>String(value??'');const productImages=()=>[];const variantImageUrl=()=>'';
function checkoutDisplayPricing(){const lines=checkoutCart.map(item=>{const product=productos.find(row=>String(row.id)===String(item.id));const price=product?Number(product.sale_price)||0:0;return {item,product,originalSubtotal:price*item.qty,netSubtotal:price*item.qty,discountTotal:0,lineDiscount:0};});const subtotal=lines.reduce((n,line)=>n+line.originalSubtotal,0);return {lines,originalSubtotal:subtotal,subtotal,discountTotal:0,isCouponQuote:false,total:subtotal,couponDiscountTotal:0,applied:[]};}
`);
run('updateCheckoutSummary()');
assert.equal(dom.get('checkoutSubtotal').textContent,'—','No muestra subtotal parcial con un artículo ausente');
assert.equal(dom.get('checkoutShippingTotal').textContent,'Por verificar');
assert.equal(dom.get('checkoutTotal').textContent,'—','No presenta un total válido de un checkout parcial');
assert.ok(dom.get('checkoutSummaryItems').innerHTML.includes('Por verificar'),'La línea ausente no muestra precio $0');
for(const id of ['shippingValue','shippingNote','customerCity','customerCityOther'])dom.set(id,new ElementFixture(id));
dom.get('customerCity').value='Medellín';
run(`function updateContraEntregaAvailability(){};function checkoutCityValue(){const selected=String($('customerCity')?.value||'');return selected==='Otra'?String($('customerCityOther')?.value||'').trim():selected};
function currentCheckoutCouponQuote(){return null};
function resolveStorefrontShippingRule(){return {threshold:150000,kind:'fallback',fee:15000,name:'general'};};function calculateStorefrontShipping(){return 15000};function storefrontShippingPolicyText(){return 'El envío se calcula por destino.'};
checkoutDisplayPricing=()=>({lines:checkoutCart.map(item=>{const product=productos.find(row=>String(row.id)===String(item.id));const price=product?Number(product.sale_price)||0:0;return {item,product,originalSubtotal:price*item.qty,netSubtotal:price*item.qty,discountTotal:item.id==='p1'?100:0,lineDiscount:item.id==='p1'?100:0};}),originalSubtotal:100000,subtotal:99900,discountTotal:100,isCouponQuote:false,total:99900,couponDiscountTotal:0,applied:[{title:'Combo parcial',units:1,discount:100}]});
updateShipping();`);
assert.equal(dom.get('shippingValue').textContent,'Por verificar','El resumen superior no muestra tarifa/GRATIS sobre subtotal parcial');
assert.match(dom.get('shippingNote').textContent,/cotización completa/);
assert.equal(dom.get('checkoutComboDiscountSummary').hidden,true,'El resumen de combo del checkout se oculta con una línea ausente');
assert.equal(dom.get('checkoutComboDiscountSummary').innerHTML,'');
assert.ok(!dom.get('checkoutSummaryItems').innerHTML.includes('checkoutSummaryPriceWrap'),'Checkout no muestra descuento por línea cuando falta otro producto');
assert.equal(dom.get('checkoutShippingTotal').textContent,'Por verificar');
assert.equal(dom.get('checkoutTotal').textContent,'—');
run("checkoutCart=[{id:'p1',name:'Nombre vigente',price:50000,qty:2,color:'',size:''}];productos=[{id:'p1',name:'Nombre vigente',sale_price:50000,quantity:5,variants:[]}];$('customerCity').value='';updateShipping();");
assert.equal(dom.get('shippingValue').textContent,'Selecciona una ciudad');
assert.equal(dom.get('checkoutShippingTotal').textContent,'Por verificar','No presenta GRATIS si todavía no hay ciudad');
assert.equal(dom.get('checkoutTotal').textContent,'—','No presenta subtotal más envío cero sin destino');
run("$('customerCity').value='Otra';$('customerCityOther').value='';updateShipping();");
assert.equal(dom.get('shippingValue').textContent,'Escribe tu ciudad');
assert.equal(dom.get('checkoutShippingTotal').textContent,'Por verificar');
assert.equal(dom.get('checkoutTotal').textContent,'—');
const shippingTrack=new ElementFixture('cartShippingTrack'),shippingFill=new ElementFixture('cartShippingFill');shippingFill.parentElement=shippingTrack;
for(const node of [shippingTrack,shippingFill,new ElementFixture('cartShippingMessage'),new ElementFixture('cartShippingTruck'),new ElementFixture('cartShippingPercent'),new ElementFixture('cartShippingLocalNote')])dom.set(node.id,node);
run('storefrontShippingSettingsLoaded=true;storefrontShippingSettingsLoadError=false;updateCartShippingProgress(50000,false)');
assert.equal(dom.get('cartShippingTrack').hidden,true,'No calcula barra/umbral con subtotal parcial');
assert.equal(dom.get('cartShippingLocalNote').hidden,true,'No muestra beneficio de Cali con una línea sin verificar');
assert.ok(!dom.get('cartShippingMessage').textContent.includes('gratis'));
assert.ok(html.includes('discountLine.hidden=recoveryState.productUnverified||priced.discountTotal<=0')&&html.includes('updateCartShippingProgress(total,!recoveryState.productUnverified)'),'El drawer oculta combos/progreso sobre subtotal incompleto');
assert.ok(html.includes('discountBox.hidden=recoveryState.productUnverified||priced.isCouponQuote||priced.discountTotal<=0')&&html.includes('if(cartCatalogRecoveryState(getCheckoutItems()).productUnverified)'),'Checkout oculta descuentos parciales y evita promesas de envío/umbral incompletas');
for(const id of ['cartBar','cartSummary','cartDrawerTotal','cartDiscountLine'])dom.set(id,new ElementFixture(id));
run(`cart=[{id:'p1',name:'Nombre vigente',code:'SKU-1',price:42000,qty:2,color:'',size:''},{id:'missing',name:'Producto reservado no disponible en el catálogo',price:0,qty:1,color:'',size:''}];
cartOpen=true;function updateCartBadge(){};
function calculateStorefrontComboPricing(rows){const lines=rows.map((item,index)=>({item,index,product:productos.find(row=>String(row.id)===String(item.id)),unitPrice:index===0?50000:0,lineDiscount:index===0?100:0}));return {lines,subtotal:50000,originalSubtotal:50000,discountTotal:100,applied:[{title:'Combo',discount:100}]};}
renderCart();`);
assert.equal(dom.get('cartDrawerTotal').textContent,'—','Drawer no muestra total parcial');
assert.match(dom.get('cartSummary').textContent,/Total por verificar/);
assert.equal(dom.get('cartDiscountLine').hidden,true,'Drawer oculta descuento calculado sobre solo parte del carrito');
assert.equal(dom.get('cartDiscountLine').innerHTML,'');
assert.ok(dom.get('cartItems').innerHTML.includes('Por verificar'),'Drawer marca la línea ausente');
assert.ok(!dom.get('cartItems').innerHTML.includes('Ahorro'),'Drawer no conserva ahorro parcial por línea');

// La confirmación vuelve a cotizar antes de crear COD/reserva o abrir Wompi.
const confirm=extract('confirmCheckout',true),pay=extract('payWithWompi',true);
const cod=extract('saveContraEntregaOrder',true),payloadBuilder=extract('buildOrderPayload');
assert.ok(confirm.indexOf('ensureCheckoutCatalogVerified(checkoutItems)')<confirm.indexOf('getCheckoutValidationErrors()'),'El checkout detiene catálogo incompleto antes de validar/enviar');
assert.ok(confirm.indexOf('requestCheckoutQuote(couponCode,checkoutItems)')<confirm.indexOf('ensureCheckoutCatalogVerified(getCheckoutItems())',confirm.indexOf('requestCheckoutQuote(couponCode,checkoutItems)')),'La confirmación vuelve a comprobar catálogo al salir del await de cotización');
assert.ok(pay.indexOf('ensureCheckoutCatalogVerified()')<pay.indexOf('requestCheckoutQuote(couponCode,checkoutItems)')&&pay.indexOf('cartCatalogRecoveryState(getCheckoutItems()).productUnverified')<pay.indexOf('saveReservationDraft(reservationReference,checkoutItems)'),'Wompi bloquea antes/después de cotizar y antes de guardar reserva');
assert.ok(cod.indexOf('ensureCheckoutCatalogVerified()')<cod.indexOf('sb.rpc('),'COD bloquea antes de registrar pedido');
assert.ok(payloadBuilder.indexOf('ensureCheckoutCatalogVerified()')<payloadBuilder.indexOf('const payload='),'El payload de precio cero se suprime si falta producto/precio');
assert.ok(confirm.indexOf('requestCheckoutQuote(couponCode,checkoutItems)')<confirm.indexOf('saveContraEntregaOrder(payload)'));
assert.ok(confirm.indexOf('requestCheckoutQuote(couponCode,checkoutItems)')<confirm.indexOf('payWithWompi(payload)'));
assert.ok(pay.indexOf('requestCheckoutQuote(couponCode,checkoutItems)')<pay.indexOf('saveReservationDraft(reservationReference,checkoutItems)'));
assert.ok(pay.indexOf('requestCheckoutQuote(couponCode,checkoutItems)')<pay.indexOf('fetch(WOMPI_SIGNATURE_ENDPOINT'));
assert.ok(!/requestCheckoutQuote\([^)]*item\.price/.test(confirm+pay),'No se envía el total persistido como quote autoritativo');
assert.deepEqual(localStorage.keys().sort(),[keys.cart,keys.cod,keys.items,keys.pending,keys.pendingTime,keys.reference,keys.registry,keys.time].sort(),'No se creó ninguna clave nueva para recuperación');
console.log('PASS cart_recovery_regression: TTL/reloj, restauración sin líneas perdidas, bloqueos de payload COD/Wompi, total no parcial y cotización antes de side effects.');
