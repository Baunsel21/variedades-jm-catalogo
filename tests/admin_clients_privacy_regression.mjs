import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
function extract(name){const match=admin.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`));assert.ok(match,`Debe existir ${name}`);return match[0];}
const dataLines=admin.match(/const selectColumns=table==='web_orders'[\s\S]*?;\n\s*let query=sb\.from\(table\)\.select\(selectColumns\);/)?.[0];
assert.ok(dataLines,'Debe existir selección de columnas explícita en consultas administrativas');
assert.match(dataLines,/table==='clients'\?'id,name'/,'El listado solo consulta ID y nombre');
assert.ok(admin.includes("select('phone,note').eq('id',clientId).maybeSingle()"),'Los campos PII se consultan solo tras la acción explícita');
const fetchPage=extract('fetchTablePage');let listedColumns='';
const pageContext=vm.createContext({sb:{from:()=>({select:columns=>{listedColumns=columns;return {order(){return this},range:async()=>({data:[],error:null})}}})}});
vm.runInContext(fetchPage,pageContext);
await pageContext.fetchTablePage('clients',0,1000,'name',true);
assert.equal(listedColumns,'id,name','La ruta real del listado no descarga contacto');
const functions=['normalizeClientSearch','clearClientContactDetails','renderClientes','toggleClientContact'].map(extract).join('\n');
const nodes={buscarCliente:{value:''},clientsVisibleCount:{textContent:''}};
const host={innerHTML:'',dataset:{},addEventListener(){}};nodes.listaClientes=host;
let queryResolve;
let capturedTable='',capturedColumns='',capturedId='';
const clientRow={phone:'3115550101',note:'Dirección sensible <sin guardar>'};
let currentUser='admin-1',authorized=true;
const context=vm.createContext({
  $:id=>nodes[id]||null,
  esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])),
  clientes:[{id:'client-1',name:'María Gómez'}],moduleLoadErrors:{clients:''},
  clientContactCache:new Map(),clientContactLoads:new Map(),clientContactErrors:new Map(),clientSalesCache:new Map(),clientSalesLoads:new Map(),clientSalesErrors:new Map(),clientContactGeneration:0,
  adminSessionAuthorized:true,adminSessionUserId:'admin-1',adminAuthEpoch:7,
  sb:{
   auth:{getUser:async()=>({data:{user:{id:currentUser}},error:null}),signOut:async()=>({error:null})},
   rpc:async()=>({data:authorized,error:null}),
   from:table=>({select:columns=>({eq:(field,id)=>({maybeSingle:async()=>{capturedTable=table;capturedColumns=columns;capturedId=id;return await new Promise(resolve=>{queryResolve=resolve})}})})})
  },
  lockAdminPanel:()=>{context.adminAuthEpoch++;context.adminSessionAuthorized=false;},
  console:{warn(){}}
});
vm.runInContext(functions,context);
context.renderClientes();
assert.match(host.innerHTML,/María Gómez/);
assert.doesNotMatch(host.innerHTML,/3115550101|Dirección sensible/,'Listado no debe renderizar PII');
assert.equal(nodes.clientsVisibleCount.textContent,'1 de 1 cliente');
nodes.buscarCliente.value='inesistente';context.renderClientes();assert.match(host.innerHTML,/No hay clientes con ese nombre/);
nodes.buscarCliente.value='maria';context.renderClientes();
const pending=context.toggleClientContact('client-1');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(capturedTable,'clients');assert.equal(capturedColumns,'phone,note');assert.equal(capturedId,'client-1');
queryResolve({data:clientRow,error:null});await pending;
assert.match(host.innerHTML,/3115550101/);
assert.match(host.innerHTML,/Dirección sensible &lt;sin guardar&gt;/,'Escapa la nota sin persistirla');
await context.toggleClientContact('client-1');
assert.doesNotMatch(host.innerHTML,/3115550101|Dirección sensible/,'Ocultar elimina el detalle del DOM/cache');

let staleResolve;
context.sb.from=()=>({select:()=>({eq:()=>({maybeSingle:()=>new Promise(resolve=>{staleResolve=resolve})})})});
const staleRequest=context.toggleClientContact('client-1');
await new Promise(resolve=>setImmediate(resolve));
context.clearClientContactDetails({clearSearch:true,render:true});
staleResolve({data:clientRow,error:null});await staleRequest;
assert.doesNotMatch(host.innerHTML,/3115550101|Dirección sensible/,'Una respuesta tardía no revive PII tras salir de Clientes');
assert.equal(context.clientContactCache.size,0);
assert.equal(nodes.buscarCliente.value,'');

let unauthorizedQuery=false;
context.adminSessionAuthorized=true;context.adminAuthEpoch=9;context.clientContactGeneration++;
context.sb.rpc=async()=>({data:false,error:null});
context.sb.from=()=>{unauthorizedQuery=true;throw new Error('RLS guard should stop before table query')};
await context.toggleClientContact('client-1');
assert.equal(unauthorizedQuery,false,'Revalida is_store_admin antes de consultar datos sensibles');
assert.equal(context.adminSessionAuthorized,false,'Bloquea el panel si el permiso ya no existe');
context.adminSessionAuthorized=true;context.adminSessionUserId='admin-1';context.adminAuthEpoch=12;currentUser='admin-1';
context.sb.rpc=async()=>{currentUser='different-user';return {data:true,error:null}};
context.sb.from=()=>{unauthorizedQuery=true;throw new Error('User switch must stop before PII select')};
await context.toggleClientContact('client-1');
assert.equal(unauthorizedQuery,false,'Revalida la identidad justo antes de la lectura si la sesión cambió durante el permiso');
assert.equal(context.adminSessionAuthorized,false);

const relevant=admin.slice(admin.indexOf('function renderClientes()'),admin.indexOf('async function agregarProveedor()',admin.indexOf('function renderClientes()')));
assert.ok(!/localStorage|sessionStorage|console\.(log|warn|error)|URLSearchParams|location\./.test(relevant),'No persiste ni registra PII de cliente');
assert.ok(admin.includes("if(id!=='clientes'&&$('clientes')?.classList.contains('active'))clearClientContactDetails({clearSearch:true,render:true});"),'Oculta contacto al abandonar Clientes');
assert.ok(admin.includes("if(key==='clients')clearClientContactDetails({clearSearch:false,render:false});"),'Descarta cache al refrescar la lista');
assert.ok(admin.includes("if(authEpoch!==adminAuthEpoch||!adminSessionAuthorized||sessionUserId!==adminSessionUserId)return false;"),'La carga diferida descarta respuestas de otra sesión');

const deferredLoader=extract('loadAdminDeferredModule');
let finishList,staleAssigned=false,staleRendered=false;
const listHost={innerHTML:''};
const loadContext=vm.createContext({
  adminSessionAuthorized:true,adminSessionUserId:'admin-1',adminAuthEpoch:2,sb:{},
  adminDeferredModuleLoaded:{clients:false,suppliers:false,expenses:false,movements:false},adminDeferredModuleInFlight:{},moduleLoadErrors:{},
  $:()=>listHost,fetchAllTableRows:()=>new Promise(resolve=>{finishList=resolve}),
  clearClientContactDetails(){},clientes:[],renderClientes(){staleRendered=true;},renderProveedores(){},renderGastos(){},renderReportes(){},renderMovimientos(){},
  describeAdminTableError(){return 'error';},console
});
vm.runInContext(deferredLoader,loadContext);
const pendingList=loadContext.loadAdminDeferredModule('clients');
await new Promise(resolve=>setImmediate(resolve));
loadContext.adminAuthEpoch++;loadContext.adminSessionAuthorized=false;loadContext.adminDeferredModuleInFlight={};
finishList({data:[{id:'late-client',name:'Nombre tardío',phone:'3130000000',note:'nota tardía'}],error:null,orderMode:'stable'});
assert.equal(await pendingList,false);
assert.deepEqual(Array.from(loadContext.clientes),[],'Una lista diferida tardía no repuebla registros');
assert.equal(staleRendered,false,'Una lista diferida tardía no vuelve a renderizar tras logout');
console.log('OK admin_clients_privacy_regression: nombre/ID inicial, PII bajo demanda, autorización, escape y descarte stale.');
