import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const admin=fs.readFileSync(path.join(root,'admin.html'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261108120000_admin_web_orders_server_pagination.sql'),'utf8');
const regression=fs.readFileSync(path.join(root,'tests/orders_server_pagination_regression.sql'),'utf8');
const extractFunction=name=>{
  const match=admin.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match,`Función ${name} disponible para prueba aislada`);
  return match[0];
};
const context=vm.createContext({pedidosPage:1,pedidosPageSize:20});
for(const name of ['normalizeOrderFilterValue','orderDateKeyColombia','pedidoEstado','filterAdminOrders','adminOrdersFilterSignature','buildAdminOrdersPageRequest','normalizeAdminOrdersPagePayload','isMissingAdminOrdersPageRpc'])
  vm.runInContext(extractFunction(name),context);

const params=context.buildAdminOrdersPageRequest({search:'  María, compra_%  ',status:'pendiente',fromDate:'2026-11-01',toDate:'no-es-fecha',city:'Medellín',payment:'Contraentrega'},3,50);
assert.deepEqual(JSON.parse(JSON.stringify(params)),{
  p_search:'María, compra_%',p_status:'pendiente',p_from_date:'2026-11-01',p_to_date:null,
  p_city:'medellin',p_payment:'contraentrega',p_page:3,p_page_size:50
},'El payload conserva texto, normaliza facetas, valida fecha y permite solo tamaños esperados');
assert.equal(context.adminOrdersFilterSignature({search:' MEDÉLLIN ',city:'Cali'},2,50),context.adminOrdersFilterSignature({search:'medellin',city:'cali'},2,50),'La firma coincide con la normalización anterior de acentos/espacios');
assert.notEqual(context.adminOrdersFilterSignature({search:'medellin'},1,50),context.adminOrdersFilterSignature({search:'medellin'},2,50),'El snapshot identifica también la página');

const pageFixture={
  success:true,
  rows:[{id:'00000000-0000-0000-0000-000000000001',status:'pendiente',customer_city:'Medellín',items:[]}],
  total:41,page:3,page_size:20,total_pages:3,
  counts:{total:100,pending:12,confirmed:20,delivered:40},
  cities:[{value:'medellin',label:'Medellín'}],payments:[{value:'contraentrega',label:'Contraentrega'}],
  cities_truncated:true,payments_truncated:false
};
const normalized=JSON.parse(JSON.stringify(context.normalizeAdminOrdersPagePayload(pageFixture,'filter-key')));
assert.equal(normalized.rows.length,1);
assert.equal(normalized.total,41);
assert.equal(normalized.page,3);
assert.equal(normalized.pageSize,20);
assert.equal(normalized.counts.total,100,'El KPI global no se deriva solo de las filas de la página');
assert.equal(normalized.citiesTruncated,true,'La UI puede avisar cuando las facetas se limitan');
assert.equal(normalized.filtersKey,'filter-key');
assert.equal(context.normalizeOrderFilterValue('São Paulo'),'sao paulo','La normalización del cliente elimina toda marca diacrítica');
assert.throws(()=>context.normalizeAdminOrdersPagePayload({...pageFixture,page_size:30},'x'),/metadatos/i,'Rechaza tamaños no permitidos');
assert.throws(()=>context.normalizeAdminOrdersPagePayload({...pageFixture,rows:Array(21).fill(pageFixture.rows[0])},'x'),/metadatos/i,'Rechaza una respuesta que excede el límite de página');
assert.throws(()=>context.normalizeAdminOrdersPagePayload({...pageFixture,counts:{total:1,pending:2,confirmed:0,delivered:0}},'x'),/conteos globales/i,'No acepta contadores incoherentes');
assert.throws(()=>context.normalizeAdminOrdersPagePayload({...pageFixture,counts:{total:null,pending:0,confirmed:0,delivered:0}},'x'),/conteos globales/i,'Un NULL no se interpreta como cero en conteos globales');
assert.throws(()=>context.normalizeAdminOrdersPagePayload({...pageFixture,success:false,code:'ORDERS_PAGE_UNAUTHORIZED',message:'No autorizado'},'x'),/No autorizado/,'No transforma una denegación en lista vacía');

const dateNearMidnight='2026-11-08T02:00:00.000Z';
assert.equal(context.orderDateKeyColombia(dateNearMidnight),'2026-11-07','Las fronteras de fecha se interpretan en Colombia');
const legacyRows=[
  {id:'a',status:'pendiente',customer_city:'Medellín',payment_method:'Contraentrega',created_at:'2026-11-08T15:00:00Z',customer_name:'María Pérez'},
  {id:'b',status:'confirmado',customer_city:'Cali',payment_method:'Wompi',created_at:'2026-11-07T15:00:00Z',customer_name:'Ana'}
];
assert.equal(context.filterAdminOrders(legacyRows,{search:'maria',city:'medellin',fromDate:'2026-11-08'}).length,1,'El fallback legacy conserva búsqueda, acentos, ciudad y fecha');
const crossFieldOrder={id:'c',status:'pendiente',customer_name:'María Pérez',customer_phone:'+57 300 555 0101',customer_email:'',customer_city:'Cali',customer_address:'',payment_method:'Contraentrega'};
assert.equal(context.filterAdminOrders([crossFieldOrder],{search:'perez +57 300'}).length,1,'La búsqueda legacy admite términos que cruzan el nombre y teléfono');
assert.equal(context.isMissingAdminOrdersPageRpc({code:'PGRST202',message:'Could not find function admin_list_web_orders_page_v1'}),true,'Reconoce una función paginada ausente por nombre y código');
assert.equal(context.isMissingAdminOrdersPageRpc({code:'42883',message:'function public.is_store_admin does not exist'}),false,'Un error 42883 de dependencia interna no habilita SELECT legacy');
assert.equal(context.isMissingAdminOrdersPageRpc({code:'PGRST202',message:'Could not find function unrelated_rpc'}),false,'Un PGRST202 de otra RPC no habilita fallback');

for(const name of ['readAdminOrdersFilters','syncOrdersFilterOptions','getAdminOrdersGlobalCounts','paginateAdminOrders','renderPedidos'])
  vm.runInContext(extractFunction(name),context);
const elementIds=['buscarPedido','filtroPedidoEstado','ordersFromDate','ordersToDate','ordersCityFilter','ordersPaymentFilter','ordersTotal','ordersPending','ordersConfirmed','ordersDelivered','listaPedidos','ordersLoadStatus','ordersResultsSummary','ordersFacetNotice'];
const elements=Object.fromEntries(elementIds.map(id=>[id,{value:'',innerHTML:'',hidden:false,textContent:''}]));
context.$=id=>elements[id]||null;
context.esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
context.money=value=>'COP '+value;
context.pedidoEstadoLabel=value=>String(value||'');
context.pedidoEstadoBadge=value=>`<span>${context.esc(value)}</span>`;
context.estadosPedidoPermitidos=value=>[value];
context.pedidoItemsText=()=>'<div>Ítems de prueba</div>';
context.pedidosPage=3;context.pedidosPageSize=20;context.ordersServerPageMode=true;context.cargarPedidosBusy=false;
context.ordersPageSnapshot={...normalized,filtersKey:context.adminOrdersFilterSignature({},3,20)};
context.pedidos=normalized.rows;context.ordersFacetOptions={cities:normalized.cities,payments:normalized.payments,citiesTruncated:true,paymentsTruncated:false};
context.ordersFacetOptionsSignature='';context.pedidosLoadError='';context.moduleLoadErrors={};context.adminDeferredModuleLoaded={orders:true};
context.renderPedidos();
assert.equal(String(elements.ordersTotal.textContent),'100','El render mantiene el total global aunque solo haya una fila en la página');
assert.equal(String(elements.ordersPending.textContent),'12');
assert.match(elements.ordersResultsSummary.textContent,/41–41 de 41/,'El resumen usa el total filtrado de la página actual');
assert.match(elements.listaPedidos.innerHTML,/00000000-0000-0000-0000-000000000001/,'La página coincidente sí muestra su pedido');
assert.match(elements.listaPedidos.innerHTML,/3 \/ 3/,'El control anuncia la página y total-pages server-side');
assert.equal(elements.ordersFacetNotice.hidden,false,'La UI advierte cuando una faceta fue truncada');
context.pedidosPage=2;context.renderPedidos();
assert.doesNotMatch(elements.listaPedidos.innerHTML,/00000000-0000-0000-0000-000000000001/,'Una página stale no se conserva visualmente tras cambiar de página');
assert.match(elements.listaPedidos.innerHTML,/Consultando pedidos/);

const loader=extractFunction('cargarPedidos');
const orderPayload=id=>({success:true,rows:[{id,status:'pendiente'}],total:1,page:1,page_size:20,total_pages:1,counts:{total:1,pending:1,confirmed:0,delivered:0},cities:[],payments:[],cities_truncated:false,payments_truncated:false});
const createLoaderContext=(rpc,fetchLegacy=async()=>({data:[],error:null}))=>{
  const button={disabled:false,textContent:'↻ Actualizar pedidos',dataset:{}};
  const inputs=Object.fromEntries(['buscarPedido','filtroPedidoEstado','ordersFromDate','ordersToDate','ordersCityFilter','ordersPaymentFilter'].map(id=>[id,{value:''}]));
  const ctx=vm.createContext({
    pedidosPage:1,pedidosPageSize:20,ordersSearchDebounce:null,ordersLoadSequence:0,adminAuthEpoch:7,adminSessionAuthorized:true,adminSessionUserId:'admin',cargarPedidosBusy:false,
    pedidos:[],pedidosLoadError:'anterior',moduleLoadErrors:{orders:'anterior'},ordersServerPageMode:false,ordersPageSnapshot:null,
    ordersLegacyFallbackMode:false,ordersFacetOptions:{cities:[],payments:[],citiesTruncated:false,paymentsTruncated:false},ordersFacetOptionsSignature:'',adminDeferredModuleLoaded:{orders:false},
    sb:{rpc,auth:{getUser:async()=>({data:{user:{id:'admin'}},error:null}),signOut:async()=>({})}},$:id=>id==='refreshOrdersBtn'?button:(inputs[id]||null),
    renderDashboardPeriod(){},renderPedidos(){},setOrdersUpdatedAt(){},toast(){},lockAdminPanel(){},
    describeAdminTableError(_table,error){return String(error?.message||error||'error')},fetchAllTableRows:fetchLegacy
  });
  for(const name of ['normalizeOrderFilterValue','readAdminOrdersFilters','adminOrdersFilterSignature','buildAdminOrdersPageRequest','normalizeAdminOrdersPagePayload','isMissingAdminOrdersPageRpc','verifyAdminForLegacyOrdersFallback'])
    vm.runInContext(extractFunction(name),ctx);
  vm.runInContext(loader,ctx);
  return {ctx,button,inputs};
};
const pendingRequests=[];
const concurrent=createLoaderContext((name,args)=>new Promise(resolve=>pendingRequests.push({name,args,resolve})));
const olderRequest=concurrent.ctx.cargarPedidos();
concurrent.inputs.buscarPedido.value='latest query';
const newerRequest=concurrent.ctx.cargarPedidos();
assert.equal(pendingRequests.length,2);
assert.ok(pendingRequests.every(request=>request.name==='admin_list_web_orders_page_v1'));
assert.equal(pendingRequests[0].args.p_search,'');
assert.equal(pendingRequests[1].args.p_search,'latest query');
pendingRequests[1].resolve({data:orderPayload('newer'),error:null});
await newerRequest;
pendingRequests[0].resolve({data:orderPayload('older'),error:null});
await olderRequest;
assert.equal(concurrent.ctx.pedidos[0].id,'newer','La respuesta más reciente vence aunque la consulta anterior termine después');
assert.equal(concurrent.ctx.ordersPageSnapshot.rows[0].id,'newer');
assert.equal(concurrent.ctx.cargarPedidosBusy,false);
assert.equal(concurrent.button.disabled,false);

const logoutRequests=[];
const logoutRace=createLoaderContext((name,args)=>new Promise(resolve=>logoutRequests.push({name,args,resolve})));
const requestBeforeLogout=logoutRace.ctx.cargarPedidos();
logoutRace.ctx.adminAuthEpoch++;
logoutRace.ctx.ordersLoadSequence++;
logoutRace.ctx.adminSessionAuthorized=false;
logoutRace.ctx.cargarPedidosBusy=false;
logoutRace.ctx.pedidos=[];logoutRace.ctx.ordersPageSnapshot=null;
logoutRequests[0].resolve({data:orderPayload('after-logout'),error:null});
await requestBeforeLogout;
assert.equal(logoutRace.ctx.pedidos.length,0,'Una respuesta de usuario anterior no repuebla datos tras cerrar sesión');
assert.equal(logoutRace.ctx.ordersPageSnapshot,null);

let legacyReads=0,legacyColumns='';
const fallback=createLoaderContext(async name=>name==='is_store_admin'?({data:true,error:null}):({data:null,error:{code:'PGRST202',message:'Could not find function admin_list_web_orders_page_v1'}}),async(_table,_order,_ascending,columns)=>{legacyReads++;legacyColumns=columns;return {data:[{id:'legacy',status:'pendiente'}],error:null}});
await fallback.ctx.cargarPedidos();
assert.equal(legacyReads,1,'Solo RPC ausente activa carga legacy');
assert.equal(fallback.ctx.ordersServerPageMode,false);
assert.equal(fallback.ctx.ordersLegacyFallbackMode,true);
assert.equal(fallback.ctx.pedidos[0].id,'legacy');
assert.ok(!legacyColumns.includes('note')&&!legacyColumns.includes('client_reference')&&!legacyColumns.includes('inventory_reference')&&!legacyColumns.includes('inventory_state')&&!legacyColumns.includes('discount_total'),'El fallback selecciona solo columnas de las tarjetas');

let rejectedFallbackReads=0;
const noLongerAdmin=createLoaderContext(async name=>name==='is_store_admin'?({data:false,error:null}):({data:null,error:{code:'PGRST202',message:'Could not find function admin_list_web_orders_page_v1'}}),async()=>{rejectedFallbackReads++;return {data:[],error:null}});
await noLongerAdmin.ctx.cargarPedidos();
assert.equal(rejectedFallbackReads,0,'Si is_store_admin deja de confirmar la cuenta, no se realiza la lectura fallback');

let forbiddenFallbackReads=0;
const rpcFailure=createLoaderContext(async()=>({data:null,error:{code:'42501',message:'permission denied'}}),async()=>{forbiddenFallbackReads++;return {data:[],error:null}});
await rpcFailure.ctx.cargarPedidos();
assert.equal(forbiddenFallbackReads,0,'Un error de permisos no se degrada a SELECT legacy');
assert.match(rpcFailure.ctx.pedidosLoadError,/permission denied/);

let internalMissingReads=0;
const internalDependencyFailure=createLoaderContext(async()=>({data:null,error:{code:'42883',message:'function public.is_store_admin does not exist'}}),async()=>{internalMissingReads++;return {data:[],error:null}});
await internalDependencyFailure.ctx.cargarPedidos();
assert.equal(internalMissingReads,0,'Un 42883 de dependencia interna no activa fallback');

assert.ok(loader.includes("sb.rpc('admin_list_web_orders_page_v1',params)"),'La RPC server-side es la ruta primaria');
assert.ok(loader.indexOf("sb.rpc('admin_list_web_orders_page_v1'")<loader.indexOf("fetchAllTableRows('web_orders'"),'Solo una RPC ausente habilita el fallback legacy');
assert.equal((loader.match(/fetchAllTableRows\('web_orders'/g)||[]).length,1,'No hay lectura completa de pedidos por errores distintos a RPC ausente');
assert.ok(admin.includes('adminDeferredModuleLoaded.orders&&!ordersServerPageMode&&!ordersLegacyFallbackMode?fetchAllTableRows("web_orders"'),'La recarga general no vuelve a bajar columnas opcionales en los modos paginado/legacy');
assert.ok(admin.includes('async function fetchAllTableRows(table,orderColumn,ascending=true,selectOverride=null)')&&admin.includes("customer_neighborhood,payment_method,subtotal,shipping,total,items,status,created_at');"),'El fallback admite una proyección mínima de tarjeta');
assert.ok(admin.includes('ordersPageSnapshot?.filtersKey===filtersKey')&&admin.includes('ordersLoadSequence++'),'No se muestran páginas obsoletas tras cambiar filtros o sesión');
assert.ok(admin.includes('maxlength="120"')&&admin.includes('cambiarFiltroPedidos(true)'),'Búsqueda acotada y con debounce');
assert.ok(admin.includes('timeZone:"America/Bogota"'),'Las tarjetas muestran horas en la misma zona que los filtros');
assert.ok(admin.includes('No es conciliación financiera'),'Dashboard conserva la separación COD/finanzas');

assert.ok(migration.includes('public.is_store_admin()'),'La RPC comprueba el permiso administrativo dentro del servidor');
assert.ok(migration.includes('v_unsafe_read_policy')&&migration.includes('relrowsecurity')&&migration.includes("p.roles @> ARRAY['authenticated']::name[]"),'El preflight bloquea instalación si el SELECT legacy no está protegido por RLS admin-only');
assert.ok(migration.includes('SECURITY DEFINER')&&migration.includes("SET search_path TO 'public', 'pg_temp'"),'RPC SECURITY DEFINER fija un search_path seguro');
assert.ok(migration.includes('GRANT EXECUTE ON FUNCTION public.admin_list_web_orders_page_v1(text,text,date,date,text,text,integer,integer) TO authenticated;'),'Solo authenticated puede invocar la RPC; el guard decide admin');
assert.ok(migration.includes('FROM PUBLIC,anon,authenticated,service_role'),'No se amplía el acceso público ni service_role');
assert.ok(migration.includes("p_from_date::timestamp AT TIME ZONE 'America/Bogota'")&&migration.includes("(p_to_date+1)::timestamp AT TIME ZONE 'America/Bogota'"),'Los filtros de fecha usan límites locales de Bogotá');
assert.ok(migration.includes("normalize(lower(btrim(coalesce(p_value,''))),NFD)")&&migration.includes("U&'[\\0300-\\036f]'"),'La normalización server-side coincide con NFD y quita las marcas Unicode');
assert.ok(migration.includes('strpos(public.sirevya_normalize_web_order_filter'),'La búsqueda trata el texto como literal, no como patrón SQL wildcard');
assert.ok(migration.includes("concat_ws(' ',b.customer_name,b.customer_phone,b.customer_email,b.customer_city,b.customer_address,b.payment_method,b.status,b.id::text)"),'Búsqueda server-side concatena los mismos campos en el mismo orden que el fallback');
assert.ok(migration.includes('LIMIT 200')&&migration.includes('LIMIT 50')&&migration.includes('cities_truncated')&&migration.includes('payments_truncated'),'Facetas tienen límite y exponen truncamiento');
assert.ok(!/\b(?:INSERT\s+INTO|UPDATE\s+public\.web_orders|DELETE\s+FROM|TRUNCATE)\b/i.test(migration),'La RPC no modifica pedidos');
assert.ok(!/JOIN\s+public\.(?:orders|sales|inventory_movements)/i.test(migration),'La RPC no mezcla COD con Wompi, ventas ni movimientos');
assert.ok(regression.includes("has_function_privilege('anon'")&&regression.includes("has_function_privilege('service_role'")&&regression.includes('pg_policies')&&regression.includes('v_unsafe_read_policy')&&regression.includes('relrowsecurity')&&regression.includes('ROLLBACK;'),'La regresión SQL valida ACL/RLS y termina sin persistir cambios');

console.log('admin_orders_server_pagination_regression: PASS');
