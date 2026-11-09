import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const admin=read('admin.html'),catalog=read('index.html');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sirevya-validate-'));
try{
 for(const [name,html] of [['admin',admin],['catalog',catalog]]){
  let i=0;
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/application\/ld\+json/i.test(match[1])){JSON.parse(match[2]);continue;}
   const file=path.join(temp,`${name}-${i++}.js`);fs.writeFileSync(file,match[2]);
   const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
   assert.equal(result.status,0,`${name}: ${result.stderr}`);
  }
 }
 const sdk=html=>html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)" crossorigin="anonymous"><\/script>/);
 assert.ok(sdk(admin)&&sdk(catalog),'SDK exacto e integridad obligatorios');
 assert.deepEqual(sdk(admin).slice(1),sdk(catalog).slice(1),'SDK idéntico en ambas superficies');
 assert.ok(!/supabase-js@2"/.test(admin+catalog),'Sin SDK flotante');
 assert.ok(admin.includes("sb.rpc('is_store_admin')"));
 assert.ok(admin.includes('onAuthStateChange')&&admin.includes("signOut({scope:'local'})"));
 assert.ok(!/async function signup\(/.test(admin),'No alta pública oculta');
 for(const rpc of ['admin_update_web_order_status_secure','admin_adjust_inventory_movement_secure','admin_register_inventory_sale_secure','admin_delete_product_secure','admin_archive_sales'])assert.ok(admin.includes(rpc),rpc);
 assert.ok(catalog.includes("sb.rpc('get_public_category_order')"));
 assert.ok(catalog.includes('mailto:sirevya99@gmail.com')&&!catalog.includes('573128561773'));
 assert.ok(catalog.includes('refreshInventoryStatus()},15000)'));
 assert.ok(admin.includes('refreshPublicAvailability()},15000)'));
 const cell=admin.match(/function safeCSVCell\(value\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(cell,'Serializador CSV común');
 const context=vm.createContext({});vm.runInContext(cell,context);
 for(const text of ['=1+1','+SUM(A1:A2)','-cmd','@calc','  =HYPERLINK("https://example.test")','\t=1+1'])assert.ok(context.safeCSVCell(text).startsWith('"\''),`Fórmula neutralizada: ${text}`);
 assert.equal(context.safeCSVCell(-25),'"-25"');
 assert.equal(context.safeCSVCell('Camisa "M"'),'"Camisa ""M"""');
 assert.equal(context.safeCSVCell('Cali'),'"Cali"');
 assert.ok(admin.includes("${esc(({home:'Pantalla de inicio'"),'Etiqueta de promoción escapada');

 const promoUrlMatch=catalog.match(/function safeSeasonalPromoUrl\(value\)\{[\s\S]*?\n\}/);
 assert.ok(promoUrlMatch,'Normalizador de destino promocional');
 const promoUrlContext=vm.createContext({URL,location:{href:'https://sirevya.com.co/'}});
 vm.runInContext(promoUrlMatch[0],promoUrlContext);
 assert.equal(promoUrlContext.safeSeasonalPromoUrl('#contactanos'),'#contactanos','Anchor local permitido');
 assert.equal(promoUrlContext.safeSeasonalPromoUrl('https://promo.example/oferta'),'https://promo.example/oferta','Destino externo HTTPS permitido');
 for(const unsafeUrl of ['http://promo.example/oferta','//promo.example/oferta','javascript:alert(1)','data:text/html,unsafe'])assert.equal(promoUrlContext.safeSeasonalPromoUrl(unsafeUrl),'#catalogo',`Destino no seguro rechazado: ${unsafeUrl}`);

 const shippingMatch=catalog.match(/function calculateStorefrontShipping\([\s\S]*?\n\}/);
 assert.ok(shippingMatch,'Cálculo de tarifa local aislado');
 const normalizeMatch=catalog.match(/function normalizeDeliveryCity\(value\)\{[\s\S]*?\n\}/);
 const canonicalMatch=catalog.match(/function canonicalLocalDeliveryCity\(value\)\{[\s\S]*?\n\}/);
 assert.ok(normalizeMatch&&canonicalMatch,'Normalización de ciudades de entrega');
 const shippingContext=vm.createContext({
  DEFAULT_STOREFRONT_SHIPPING_SETTINGS:{national_shipping_cost:15000,free_shipping_threshold:130000,free_shipping_in_cali:true},
  storefrontShippingSettings:{national_shipping_cost:15000,free_shipping_threshold:130000,free_shipping_in_cali:true}
 });
 vm.runInContext(normalizeMatch[0],shippingContext);vm.runInContext(canonicalMatch[0],shippingContext);
 vm.runInContext(shippingMatch[0],shippingContext);
 const calcShipping=shippingContext.calculateStorefrontShipping;
 assert.equal(calcShipping('Cali',129999),0,'Cali sigue gratis');
 for(const alias of ['Santiago de Cali','Cali Valle del Cauca'])assert.equal(calcShipping(alias,129999),0,`El costo local conserva envío gratis para ${alias}`);
 assert.equal(calcShipping('Bogotá',129999),15000,'Tarifa actual justo bajo el umbral');
 assert.equal(calcShipping('Bogotá',130000),0,'Umbral exacto actual');
 assert.equal(calcShipping('Bogotá',130001),0,'Por encima del umbral actual');
 assert.equal(calcShipping('Bogotá',149999,{national_shipping_cost:17500,free_shipping_threshold:150000}),17500,'Tarifa administrativa actualizada');
 assert.equal(calcShipping('Bogotá',150000,{national_shipping_cost:17500,free_shipping_threshold:150000}),0,'Umbral administrativo actualizado');
 assert.equal(calcShipping('Bogotá',999999,{national_shipping_cost:17500,free_shipping_threshold:null}),17500,'El umbral puede desactivarse');
 assert.ok(!catalog.includes('$15.000')&&!catalog.includes('$130.000'),'HTML inicial no muestra tarifas antiguas mientras carga Supabase');
 assert.ok(catalog.includes('cartQuote.discount_total==null')&&catalog.includes('authoritativeComboQuote.discount_total==null'),'Checkout y Wompi rechazan cotizaciones parciales');
 assert.ok(catalog.includes('row?.national_shipping_cost==null')&&admin.includes('row?.national_shipping_cost==null'),'RPCs rechazan fee NULL en vez de tratarlo como $0');
 assert.ok(catalog.includes("const rules=document.querySelectorAll('.detailShippingBenefits .detailShippingRule');")&&catalog.includes('const caliShippingRule=rules[0]')&&catalog.includes('const otherCityShippingRule=rules[1]'),'Los beneficios de Cali y otros destinos se actualizan por separado');
 assert.ok(catalog.includes('data-shipping-policy')&&catalog.includes("document.querySelector('.jmTickerTrack [data-shipping-policy]')"),'El ticker se actualiza por selector estable al activar/desactivar el umbral');
 const copyMatch=catalog.match(/function updateStorefrontShippingCopy\(\)\{[\s\S]*?\n\}/);
 assert.ok(copyMatch,'Actualizador del texto dinámico de envío');
 const ticker={textContent:'✦ Consulta las condiciones de envío vigentes'},caliBenefit={textContent:''},benefit={textContent:''},foot={textContent:''},paymentNote={textContent:''};
 const caliHeading={textContent:'Tarifa de envío en Cali'},caliCopy={textContent:'Se confirma al verificar la configuración vigente.'};
 const otherHeading={textContent:''},otherCopy={textContent:''};
 const detailRules=[{querySelector:s=>s==='b'?caliHeading:caliCopy},{querySelector:s=>s==='b'?otherHeading:otherCopy}];
 const copyContext=vm.createContext({storefrontShippingSettings:{national_shipping_cost:17500,free_shipping_threshold:null},storefrontShippingSettingsLoaded:false,storefrontShippingSettingsLoadError:false,
 storefrontShippingPolicyText:()=> 'Envío gratis en Cali; tarifa nacional vigente.',money:value=>`COP ${value}`,$:()=>paymentNote,
 document:{querySelector:s=>({'.jmTickerTrack [data-shipping-policy]':ticker,'.benefits .benefit:nth-child(1) small':caliBenefit,'.benefits .benefit:nth-child(2) small':benefit,'.cartShippingFoot span:first-child':foot,'.cartShippingTrack':null}[s]??null),
 querySelectorAll:s=>s==='.detailShippingBenefits .detailShippingRule'?detailRules:[]}});
 vm.runInContext(copyMatch[0],copyContext);
 copyContext.updateStorefrontShippingCopy();
 assert.equal(caliBenefit.textContent,'Tarifa por confirmar','No se promete Cali gratis antes de verificar la configuración');
 assert.equal(caliHeading.textContent,'Tarifa en Cali','La ficha mantiene Cali neutral antes del RPC');
 copyContext.storefrontShippingSettingsLoaded=true;copyContext.updateStorefrontShippingCopy();
 assert.equal(ticker.textContent,'✦ Envío nacional: tarifa vigente; Cali gratis','Ticker muestra estado sin umbral');
 assert.equal(caliBenefit.textContent,'Envío gratis','El beneficio de Cali se restaura tras la configuración válida');
 assert.equal(caliHeading.textContent,'Envío gratis en Cali','La ficha restaura el beneficio de Cali tras el RPC');
 assert.equal(otherHeading.textContent,'Tarifa fuera de Cali','La ficha informa la tarifa si el umbral está desactivado');
 copyContext.storefrontShippingSettings.free_shipping_threshold=150000;copyContext.updateStorefrontShippingCopy();
 assert.equal(ticker.textContent,'✦ Envío gratis desde COP 150000 fuera de Cali','Ticker se actualiza al reactivar el umbral');
 assert.equal(otherHeading.textContent,'Envío gratis a otras ciudades','La ficha se actualiza al reactivar el umbral');
 const progressMatch=catalog.match(/function updateCartShippingProgress\(total\)\{[\s\S]*?\n\}/);
 assert.ok(progressMatch,'Actualizador del progreso de envío');
 const progressTrack={style:{},attrs:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]}};
 const progressNodes={cartShippingMessage:{innerHTML:'',textContent:''},cartShippingFill:{style:{},parentElement:progressTrack},cartShippingTruck:{style:{}},cartShippingPercent:{textContent:''}};
 const progressLocalNote={hidden:false};
 const progressContext=vm.createContext({storefrontShippingSettings:{national_shipping_cost:17500,free_shipping_threshold:null},storefrontShippingSettingsLoaded:false,storefrontShippingSettingsLoadError:false,money:value=>`COP ${value}`,$:id=>progressNodes[id]??null,document:{querySelector:selector=>selector==='.cartShippingLocalNote'?progressLocalNote:null}});
 vm.runInContext(progressMatch[0],progressContext);
 progressContext.updateCartShippingProgress(100000);
 assert.equal(progressLocalNote.hidden,true,'La nota de Cali se oculta antes de verificar settings');
 assert.equal(progressNodes.cartShippingMessage.textContent,'Consultando la tarifa vigente de envío…','El carrito anuncia carga pendiente sin prometer Cali gratis');
 progressContext.storefrontShippingSettingsLoaded=true;
 progressContext.updateCartShippingProgress(100000);
 assert.equal(progressTrack.style.display,'none','No se muestra progreso con umbral desactivado');
 assert.equal(progressNodes.cartShippingPercent.textContent,'—','No se anuncia porcentaje falso sin umbral');
 assert.equal(progressLocalNote.hidden,false,'La nota de Cali se restaura después de verificar la configuración');
 progressContext.storefrontShippingSettings.free_shipping_threshold=150000;progressContext.updateCartShippingProgress(75000);
 assert.equal(progressTrack.style.display,'','El progreso aparece al activar umbral');
 assert.equal(progressNodes.cartShippingPercent.textContent,'50%','El porcentaje coincide con el umbral nuevo');
 for(const alias of ['Cali','Santiago de Cali','Cali Valle del Cauca'])assert.equal(shippingContext.canonicalLocalDeliveryCity(alias),'Cali',`Alias gratis conservado: ${alias}`);

 const formMatch=admin.match(/function readStorefrontShippingAdminForm\(\)\{[\s\S]*?\n\}/);
 assert.ok(formMatch,'Parser de tarifa del formulario admin');
 const fields={shippingNationalCost:{value:''},shippingFreeThresholdEnabled:{checked:true},shippingFreeThreshold:{value:''}};
 const adminContext=vm.createContext({$:(id)=>fields[id]});
 vm.runInContext(formMatch[0],adminContext);
 const blankForm=adminContext.readStorefrontShippingAdminForm();
 assert.ok(Number.isNaN(blankForm.fee),'Tarifa vacía no se convierte en $0');
 assert.ok(Number.isNaN(blankForm.threshold),'Umbral activo vacío se rechaza');
 fields.shippingNationalCost.value='0';fields.shippingFreeThresholdEnabled.checked=false;
 const zeroAndNoThreshold=adminContext.readStorefrontShippingAdminForm();
 assert.equal(zeroAndNoThreshold.fee,0,'Tarifa cero es válida cuando se ingresa explícitamente');
 assert.equal(zeroAndNoThreshold.threshold,null,'Umbral desactivado se representa como NULL');
 assert.ok(admin.includes('row.free_shipping_in_cali!==true'),'Respuesta de guardado valida la regla Cali');

 const shippingMigration=read('supabase/migrations/20261108060000_configurable_storefront_shipping.sql');
 const shippingAclMigration=read('supabase/migrations/20261108060050_restrict_admin_shipping_rpc.sql');
 const codGuardMigration=read('supabase/migrations/20261108060100_cod_checkout_quote_guard.sql');
 const wompiFunction=read('supabase/functions/wompi-create-checkout/index.ts');
 const codRestrictMigration=read('docs/deployment/restrict_legacy_cod_rpc_after_frontend.sql');
 const shippingTest=read('tests/shipping_config_regression.sql');
 const codTest=read('tests/cod_regression.sql');
 const codLegacyAclTest=read('tests/cod_legacy_acl.sql');
 const shippingMigrationOrder=fs.readdirSync(path.join(root,'supabase/migrations')).filter(name=>/^2026110806(0000|0050|0100)_/.test(name)).sort();
 assert.deepEqual(shippingMigrationOrder,['20261108060000_configurable_storefront_shipping.sql','20261108060050_restrict_admin_shipping_rpc.sql','20261108060100_cod_checkout_quote_guard.sql'],'Orden obligatorio de configuración, hotfix ACL y guard COD');
 assert.ok(shippingMigration.includes('VALUES (1,15000,130000) ON CONFLICT (id) DO NOTHING'),'Valores actuales como defaults sin sobrescribir datos');
 assert.ok(shippingMigration.includes('public.is_store_admin()'),'Guardia de administrador en el guardado');
 assert.ok(shippingAclMigration.includes('FROM PUBLIC,anon,service_role')&&shippingAclMigration.includes('TO authenticated'),'Hotfix ACL deja el RPC admin solo para authenticated');
 assert.ok(shippingTest.includes("has_function_privilege('public'")&&shippingTest.includes("has_function_privilege('anon'")&&shippingTest.includes("has_function_privilege('service_role'")&&shippingTest.includes("has_function_privilege('authenticated'"),'Prueba de grants exige solo authenticated para guardar tarifas');
 assert.ok(shippingMigration.includes('v_free_shipping_threshold IS NOT NULL AND v_subtotal>=v_free_shipping_threshold'),'Umbral calculado sobre subtotal con descuentos');
 assert.ok(shippingMigration.includes("v_normalized_city IN ('cali','santiago de cali','cali valle del cauca')"),'Cali conserva la excepción gratis server-side');
 assert.ok(shippingMigration.includes('TO anon,authenticated,service_role'),'Cotización pública y Wompi con grants explícitos');
 assert.ok(catalog.includes("sb.rpc('get_public_storefront_shipping_settings')"),'El catálogo consulta la tarifa actual');
 assert.ok(admin.includes("sb.rpc('admin_save_storefront_shipping_settings'"),'El admin guarda la tarifa mediante RPC');
 assert.ok(catalog.includes("sb.rpc('create_contra_delivery_order_with_quote'"),'Contraentrega verifica el total confirmado');
 assert.ok(catalog.includes('payload.expected_total=serverTotal;')&&catalog.includes('payload.expected_total=quotedTotal;'),'Wompi y COD usan el importe COP presentado');
 assert.ok(catalog.includes('const expectedAmountInCents=Math.round(Number(authoritativeComboQuote?.total))*100;'),'Comparación Wompi respeta el redondeo COP de servidor');
 const wompiQuoteGuardOffset=wompiFunction.indexOf('code: "WOMPI_QUOTE_CHANGED"');
 const wompiReserveOffset=wompiFunction.indexOf('const reservationResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/reserve_order_inventory`');
 assert.ok(wompiQuoteGuardOffset>=0&&wompiReserveOffset>wompiQuoteGuardOffset&&wompiFunction.includes('expectedDiscountTotal !== discountTotal'),'Wompi rechaza cambios antes de reservar o crear pedido');
 assert.ok(wompiFunction.includes('const expectedTotal = Number(expectedTotalRaw);')&&wompiFunction.includes('expectedAmountsAreNumeric')&&wompiFunction.includes('Number.isSafeInteger(expectedTotal)')&&wompiFunction.includes('Number.isSafeInteger(expectedDiscountTotal)'),'Wompi exige importes COP enteros numéricos antes de comparar');
 assert.ok(!wompiFunction.includes('Math.round(Number(expectedTotalRaw))')&&!wompiFunction.includes('Math.round(Number(expectedDiscountRaw))'),'Wompi no redondea silenciosamente un total fraccionario del cliente');
 assert.ok(!catalog.includes("sb.rpc('release_inventory_reservation'")&&!catalog.includes("sb.rpc('attach_inventory_reservation'"),'El navegador no libera ni reasocia reservas privilegiadas');
 assert.ok(catalog.includes('result.duplicate===true&&result.existing_order_id'),'COD explica al cliente si el pedido previo tiene otro total');
 assert.ok(codGuardMigration.includes('FOR SHARE')&&codGuardMigration.includes('quote_changed'),'COD bloquea cambios de tarifa entre cotización y creación');
 assert.ok(codGuardMigration.includes('v_quote->>\'total\' IS NULL')&&codGuardMigration.includes('v_existing_total IS NULL')&&codGuardMigration.includes('v_existing_discount_total IS NULL')&&codGuardMigration.includes('v_existing_shipping IS NULL'),'COD falla cerrado ante importes NULL/incompletos');
 assert.ok(codGuardMigration.includes('v_result->>\'total\' IS NULL')&&codGuardMigration.includes('v_result->>\'discount_total\' IS NULL')&&codGuardMigration.includes('v_result->>\'shipping\' IS NULL'),'COD revierte si la función interna no devuelve todos los importes');
 assert.ok(codGuardMigration.includes('jsonb_typeof(v_result->\'success\') IS DISTINCT FROM \'boolean\'')&&codGuardMigration.includes('v_result IS NULL'),'COD revierte respuestas legacy nulas o sin success booleano');
 assert.ok(codGuardMigration.includes("'discount_total',v_existing_discount_total")&&codGuardMigration.includes("'shipping',v_existing_shipping"),'COD normaliza éxito duplicado con importes persistidos verificados');
 assert.ok(codGuardMigration.includes("v_result->>'discount_total' IS NOT NULL")&&codGuardMigration.includes("v_result->>'shipping' IS NOT NULL")&&codGuardMigration.includes('RETURN v_result||jsonb_build_object'),'COD valida importes devueltos y normaliza los omitidos antes del éxito');
 assert.ok(codRestrictMigration.startsWith('-- Aplicar SOLO después de publicar index.html')&&codRestrictMigration.includes('FROM PUBLIC,anon,authenticated'),'El SQL de corte COD está fuera de migraciones automáticas');
 assert.ok(shippingTest.includes('ROLLBACK_SHIPPING_CONFIG_TEST')&&shippingTest.includes('storefront_product_combos'),'Prueba SQL sintética con descuentos y rollback');
 assert.ok(!shippingTest.includes('::numeric<>'),'Las aserciones SQL no aceptan NULL como falso positivo');
 assert.ok(shippingTest.includes('rollback no restauró la configuración original'),'La prueba SQL verifica postcondición de rollback');
 assert.ok(codTest.includes('create_contra_delivery_order_with_quote(')&&codTest.includes('has_function_privilege'),'Regresión COD usa el RPC nuevo y verifica acceso');
 assert.ok(codTest.includes('IS DISTINCT FROM true')&&codTest.includes('stock IS DISTINCT FROM 1'),'Regresión COD no omite aserciones por NULL');
 assert.ok(codTest.includes("retry->>'discount_total'")&&codTest.includes("retry->>'shipping'"),'Regresión COD exige importes completos al devolver duplicado');
 assert.ok(codTest.includes("a.attname IN ('total','discount_total','shipping')")&&codTest.includes('a.attnotnull')&&codTest.includes('web_orders debe conservar NOT NULL'),'La regresión verifica restricciones no nulas de importes históricos');
 assert.ok(codTest.includes('La prueba dejó productos sintéticos')&&codTest.includes('La prueba dejó reservas sintéticas'),'Rollback COD falla si quedan residuos');
 assert.ok(codTest.includes('cod_changed_price_rejected')&&codTest.includes('creó un pedido duplicado'),'La regresión comprueba reintento COD con cambio de precio');
 assert.ok(codLegacyAclTest.includes('RPC COD antiguo sigue ejecutable')&&codLegacyAclTest.includes('wrapper con guard'),'Prueba del corte COD posdespliegue');
 for(const key of [
  "const WOMPI_PENDING_REFERENCE_KEY='jm_wompi_pending_reference_v5';",
  "const WOMPI_PENDING_TIME_KEY='jm_wompi_pending_time_v5';",
  "const WOMPI_CART_KEY='jm_wompi_cart_v5';",
  "const WOMPI_RESERVATION_TIME_KEY='jm_wompi_reservation_time_v5';",
  "const WOMPI_RESERVATION_REFERENCE_KEY='jm_wompi_reservation_reference_v6';",
  "const WOMPI_RESERVATION_ITEMS_KEY='jm_wompi_reservation_items_v2';",
  "const WOMPI_RESERVATIONS_KEY='jm_wompi_reservations_v3';",

  "const COD_ORDER_DRAFT_KEY='jm_cod_order_draft_v1';"
 ])assert.ok(catalog.includes(key),`Clave de carrito/reserva conservada: ${key}`);

const ordersSection=admin.match(/<section id="pedidos"[\s\S]*?<\/section>/)?.[0];
	 assert.ok(ordersSection&&['ordersFromDate','ordersToDate','ordersCityFilter','ordersPaymentFilter','ordersResultsSummary','ordersLoadStatus'].every(id=>ordersSection.includes(`id="${id}"`)),'Pedidos ofrece filtros explícitos y estados accesibles de carga/resultados');
	 assert.ok(ordersSection.includes('aria-live="polite"')&&ordersSection.includes('limpiarFiltrosPedidos()')&&admin.includes('data-orders-page=')&&admin.includes('cambiarTamanoPaginaPedidos'),'Pedidos anuncia resultados y renderiza controles de página');
	 assert.ok(admin.includes("admin_update_web_order_status_secure")&&admin.includes('pedidosLoadError')&&admin.includes('No se pudo actualizar la lista.'),'Los filtros conservan RPC segura y distinguen error de lista vacía');
	 assert.ok(admin.includes('function cambiarFiltroPedidos(){pedidosPage=1;renderPedidos();}')&&admin.includes('pedidosPageSize=size;pedidosPage=1;renderPedidos();')&&admin.includes('const pending=pedidos.filter')&&admin.includes('const confirmed=pedidos.filter')&&admin.includes('const delivered=pedidos.filter'),'Filtrar reinicia página y los conteos continúan globales');
	 const orderClickHandler=admin.slice(admin.indexOf("ordersBox.addEventListener('click'"),admin.indexOf("ordersBox.addEventListener('change'"));
	 assert.ok(orderClickHandler.indexOf("button[data-orders-page]")<orderClickHandler.indexOf("button[data-order-action]"),'El listener atiende navegación de página sin interferir con acciones de pedido');
	 const orderHelpers=['function pedidoEstado(p)','function normalizeOrderFilterValue(value)','function orderDateKeyColombia(value)','function filterAdminOrders(rows,filters={})','function paginateAdminOrders(rows,page,pageSize)'];
	 const extractOrderHelper=(signature,nextSignature)=>{
	  const start=admin.indexOf(signature);assert.notEqual(start,-1,`Helper de pedidos encontrado: ${signature}`);
	  const end=admin.indexOf(nextSignature,start);assert.notEqual(end,-1,`Cierre de helper de pedidos: ${signature}`);return admin.slice(start,end);
	 };
	 const orderHelperCode=[
	  extractOrderHelper(orderHelpers[0],'function pedidoEstadoLabel'),
	  extractOrderHelper(orderHelpers[1],'function orderDateKeyColombia'),
	  extractOrderHelper(orderHelpers[2],'function filterAdminOrders'),
	  extractOrderHelper(orderHelpers[3],'function paginateAdminOrders'),
	  extractOrderHelper(orderHelpers[4],'function syncOrdersFilterOptions')
	 ].join('\n');
	 const orderContext=vm.createContext({Intl});vm.runInContext(orderHelperCode,orderContext);
	 assert.equal(orderContext.orderDateKeyColombia('2026-11-08T04:30:00Z'),'2026-11-07','Fecha de pedidos convertida explícitamente a America/Bogota');
	 const orderFixtures=[
	  {id:'cod-1',status:'pendiente',created_at:'2026-11-08T04:30:00Z',customer_name:'Ana',customer_city:'Bogotá',payment_method:'Contraentrega'},
	  {id:'cod-2',status:'enviado',created_at:'2026-11-08T15:00:00Z',customer_name:'Bea',customer_city:'Cali',payment_method:'Contraentrega'},
	  {id:'cod-3',status:'entregado',created_at:'2026-11-08T12:00:00Z',customer_name:'Cata',customer_city:'Cartagena',payment_method:'Efectivo'},
	  {id:'cod-invalid-date',status:'pendiente',created_at:'not-a-date',customer_name:'Dora',customer_city:'Bogotá',payment_method:'Contraentrega'}
	 ];
	 const filteredOrderIds=orderContext.filterAdminOrders(orderFixtures,{search:'BOGOTÁ',status:'pendiente',fromDate:'2026-11-07',toDate:'2026-11-07',city:'bogota',payment:'contraentrega'}).map(row=>row.id);
	 assert.deepEqual(filteredOrderIds,['cod-1'],'Filtros combinados normalizan acentos, ciudad, pago y fecha Colombia');
	 assert.deepEqual(orderContext.filterAdminOrders(orderFixtures,{fromDate:'2026-11-07',toDate:'2026-11-07'}).map(row=>row.id),['cod-1'],'Fecha inválida no pasa un filtro temporal');
	 assert.equal(orderContext.filterAdminOrders(orderFixtures,{city:'medellin'}).length,0,'Filtro sin coincidencias devuelve vacío verificable');
	 const manyOrders=Array.from({length:47},(_,index)=>({id:`order-${index+1}`}));
	 const pageThree=orderContext.paginateAdminOrders(manyOrders,3,20);
	 assert.equal(pageThree.total,47);assert.equal(pageThree.totalPages,3);assert.equal(pageThree.page,3);
	 assert.deepEqual(pageThree.items.map(row=>row.id),Array.from({length:7},(_,index)=>`order-${index+41}`),'Paginación muestra el tramo correcto sin descartar pedidos');
	 assert.equal(orderContext.paginateAdminOrders(manyOrders,99,20).page,3,'Página fuera de rango se limita a la última');
	 assert.equal(orderContext.paginateAdminOrders(manyOrders,1,10).pageSize,20,'Tamaño no permitido usa el valor seguro por defecto');
	 const orderHelperSection=admin.slice(admin.indexOf('function normalizeOrderFilterValue(value)'),admin.indexOf('function applyDefaultSirevyaCategoryOrder'));
	 assert.ok(!/\b(localStorage|sessionStorage)\b/.test(orderHelperSection),'Filtros y página se mantienen solo en memoria');

 await import('../tests/inventory_reservation_client_boundary_regression.mjs');
 await import('../tests/admin_dashboard_pending_orders_regression.mjs');
 await import('../tests/checkout_quote_success_contract_regression.mjs');
 await import('../tests/storefront_cod_settings_fail_closed_regression.mjs');
 await import('../tests/admin_csv_import_ui_regression.mjs');
	 console.log('PASS: sintaxis, SDK/SRI, seguridad admin/COD, CSV, tarifas, rollback, claves Wompi y filtros/paginación de pedidos.');

}finally{fs.rmSync(temp,{recursive:true,force:true});}
