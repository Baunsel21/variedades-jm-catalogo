import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
function extract(name){const match=admin.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`));assert.ok(match,`Debe existir ${name}`);return match[0];}
const nodes={buscarCliente:{value:''},clientsVisibleCount:{textContent:''}},host={innerHTML:'',dataset:{},addEventListener(){}};nodes.listaClientes=host;
const rows=Array.from({length:10},(_,index)=>({sale_date:`2026-11-${String(8-index%5).padStart(2,'0')}`,product_code:`SKU-${index}`,product_name:index===0?'<script>alert(1)</script>':'Producto '+index,quantity:1,sale_price:1000+index}));
let currentUser='admin-1',authorized=true,queryResult={data:rows,count:12,error:null},queryCalls=[];
function makeSupabase(){return {
 auth:{getUser:async()=>({data:{user:{id:currentUser}},error:null}),signOut:async()=>({error:null})},
 rpc:async name=>{queryCalls.push(['rpc',name]);return {data:authorized,error:null}},
 from:table=>({select:(columns,options)=>{queryCalls.push(['select',table,columns,options]);const chain={eq(field,value){queryCalls.push(['eq',field,value]);return this},is(field,value){queryCalls.push(['is',field,value]);return this},order(field,options){queryCalls.push(['order',field,options]);return this},range(start,end){queryCalls.push(['range',start,end]);return Promise.resolve(queryResult)}};return chain}})
}}
const ctx=vm.createContext({
  $:id=>nodes[id]||null,esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])),money:value=>`COP ${value}`,
  clientes:[{id:'client-1',name:'Cliente Uno'}],moduleLoadErrors:{clients:''},
  clientContactCache:new Map(),clientContactLoads:new Map(),clientContactErrors:new Map(),clientSalesCache:new Map(),clientSalesLoads:new Map(),clientSalesErrors:new Map(),clientContactGeneration:0,
  adminSessionAuthorized:true,adminSessionUserId:'admin-1',adminAuthEpoch:5,sb:makeSupabase(),
  lockAdminPanel(){ctx.adminAuthEpoch++;ctx.adminSessionAuthorized=false;},console:{warn(){}}
});
vm.runInContext(['normalizeClientSearch','renderClientSalesHistory','toggleClientSalesHistory','renderClientes'].map(extract).join('\n'),ctx);
ctx.renderClientes();
assert.match(host.innerHTML,/Ver ventas vinculadas/);
assert.doesNotMatch(host.innerHTML,/SKU-0|Producto 0/,'Ventas no se revelan en el listado inicial');
const pending=ctx.toggleClientSalesHistory('client-1');
await pending;
assert.match(host.innerHTML,/12 registro\(s\) de venta activa; se muestran hasta diez/);
assert.match(host.innerHTML,/no equivale a un pedido ni a una medida de recurrencia/);
assert.ok(host.innerHTML.indexOf('SKU-0')<host.innerHTML.indexOf('SKU-4'),'Los registros se ordenan de fecha más reciente a antigua');
assert.ok(host.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),'Nombres de producto se escapan');
assert.ok(!host.innerHTML.includes('<script>alert(1)</script>'));
assert.match(host.innerHTML,/2 registro\(s\) adicional\(es\) no se listan/,'El detalle limita el render a diez filas');
assert.equal(JSON.stringify(queryCalls.find(call=>call[0]==='select')),JSON.stringify(['select','sales','sale_date,product_code,product_name,quantity,sale_price',{count:'exact'}]));
assert.ok(queryCalls.some(call=>JSON.stringify(call)===JSON.stringify(['eq','client_id','client-1'])),'Filtra con el vínculo sales.client_id, no por PII');
assert.ok(queryCalls.some(call=>JSON.stringify(call)===JSON.stringify(['is','archived_at',null])),'Solo usa ventas activas/no archivadas');
assert.ok(queryCalls.some(call=>JSON.stringify(call)===JSON.stringify(['range',0,9])),'La consulta tiene un límite server-side de diez filas');
assert.ok(queryCalls.some(call=>JSON.stringify(call)===JSON.stringify(['order','sale_date',{ascending:false}])),'Ordena ventas recientes primero');
assert.ok(!/web_orders|customer_phone|customer_email/.test(admin.slice(admin.indexOf('async function toggleClientSalesHistory'),admin.indexOf('function renderClientes'))),'El historial no mezcla pedidos COD ni carga datos personales');
await ctx.toggleClientSalesHistory('client-1');
assert.doesNotMatch(host.innerHTML,/SKU-0|Producto 0/,'Ocultar elimina el historial del DOM/cache');

queryResult={data:[],count:0,error:null};
await ctx.toggleClientSalesHistory('client-1');
assert.match(host.innerHTML,/No hay registros de ventas activas vinculados por client_id/,'Cero se muestra solo tras respuesta confirmada');
await ctx.toggleClientSalesHistory('client-1');

let finishRows;
ctx.sb=makeSupabase();
ctx.sb.from=table=>({select:()=>({eq(){return this},is(){return this},order(){return this},range(){return new Promise(resolve=>{finishRows=resolve})}})});
queryResult={data:rows,count:12,error:null};
const staleRequest=ctx.toggleClientSalesHistory('client-1');
await new Promise(resolve=>setImmediate(resolve));
ctx.clientSalesCache.clear();ctx.clientSalesLoads.clear();ctx.clientSalesErrors.clear();ctx.clientContactGeneration++;
finishRows({data:rows,count:12,error:null});
await staleRequest;
assert.equal(ctx.clientSalesCache.size,0,'Una respuesta tardía no repuebla el historial tras salir');
assert.doesNotMatch(host.innerHTML,/SKU-0/);

let queried=false;
ctx.adminSessionAuthorized=true;ctx.adminSessionUserId='admin-1';ctx.adminAuthEpoch=20;ctx.clientContactGeneration++;
ctx.sb=makeSupabase();ctx.sb.rpc=async()=>({data:false,error:null});
ctx.sb.from=()=>{queried=true;throw new Error('No debe consultar sin permiso')};
await ctx.toggleClientSalesHistory('client-1');
assert.equal(queried,false,'Valida is_store_admin antes de consultar ventas relacionadas');
assert.equal(ctx.adminSessionAuthorized,false);
let switchedUserQuery=false;
ctx.adminSessionAuthorized=true;ctx.adminSessionUserId='admin-1';ctx.adminAuthEpoch=22;ctx.clientContactGeneration++;currentUser='admin-1';
ctx.sb=makeSupabase();ctx.sb.rpc=async()=>{currentUser='other-user';return {data:true,error:null}};
ctx.sb.from=()=>{switchedUserQuery=true;throw new Error('No debe consultar tras cambio de identidad')};
await ctx.toggleClientSalesHistory('client-1');
assert.equal(switchedUserQuery,false,'Vuelve a comprobar identidad justo antes de leer ventas');
assert.equal(ctx.adminSessionAuthorized,false);

const clear=extract('clearClientContactDetails');
vm.runInContext(clear,ctx);ctx.adminSessionAuthorized=true;ctx.clientSalesCache.set('client-1',{rows,count:1});ctx.clientSalesErrors.set('client-1','error');ctx.clearClientContactDetails({clearSearch:true,render:false});
assert.equal(ctx.clientSalesCache.size,0);assert.equal(ctx.clientSalesErrors.size,0);
assert.ok(admin.includes("select('sale_date,product_code,product_name,quantity,sale_price',{count:'exact'}).eq('client_id',clientId).is('archived_at',null).order('sale_date',{ascending:false}).range(0,9)"),'Consulta bajo demanda con columnas mínimas, client_id, ventas activas y límite');
console.log('OK admin_client_history_regression: lectura admin bajo demanda, client_id, límite server-side, escape y corte de filas stale.');
