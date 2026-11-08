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
const context=vm.createContext({localStorage,Date:FixedDate,console,variantList:p=>Array.isArray(p?.variants)?p.variants:[],variantStock:()=>0});
const functions=[
 'reservationTimestampIsActive','normalizeReservationItems','reservationItemsMatch','rawReservationItems',
 'saveReservationRegistry','getReservationRegistry','findReservationRecordByReference','findReservationRecordForItems',
 'setCurrentReservationRecord','saveReservationRecord','updateReservationReference','forgetReservationRecord',
 'getPendingWompiReference','savePendingWompiReference','getActiveReservationReference','saveActiveReservationReference',
 'saveActiveReservationItems','saveReservationDraft','getActiveReservationItems','clearPendingWompiReference',
 'restoreCheckoutFromReservation','comboPriceForItem'
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
run('checkoutCart=null;restoreCheckoutFromReservation();');
assert.equal(run('checkoutCart[0].name'),'Nombre vigente');
assert.equal(run('checkoutCart[0].price'),50000);
assert.equal(get(keys.time),String(startedAt),'Restaurar no renueva el reloj de reserva');

// La confirmación vuelve a cotizar antes de crear COD/reserva o abrir Wompi.
const confirm=extract('confirmCheckout',true),pay=extract('payWithWompi',true);
assert.ok(confirm.indexOf('requestCheckoutQuote(couponCode,checkoutItems)')<confirm.indexOf('saveContraEntregaOrder(payload)'));
assert.ok(confirm.indexOf('requestCheckoutQuote(couponCode,checkoutItems)')<confirm.indexOf('payWithWompi(payload)'));
assert.ok(pay.indexOf('requestCheckoutQuote(couponCode,checkoutItems)')<pay.indexOf('saveReservationDraft(reservationReference,checkoutItems)'));
assert.ok(pay.indexOf('requestCheckoutQuote(couponCode,checkoutItems)')<pay.indexOf('fetch(WOMPI_SIGNATURE_ENDPOINT'));
assert.ok(!/requestCheckoutQuote\([^)]*item\.price/.test(confirm+pay),'No se envía el total persistido como quote autoritativo');
assert.deepEqual(localStorage.keys().sort(),[keys.cart,keys.cod,keys.items,keys.pending,keys.pendingTime,keys.reference,keys.registry,keys.time].sort(),'No se creó ninguna clave nueva para recuperación');
console.log('PASS cart_recovery_regression: claves históricas, TTL exacto, reloj futuro, reintento sin renovación, catálogo actual y cotización antes de side effects.');
