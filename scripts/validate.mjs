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

 const shippingMatch=catalog.match(/function calculateStorefrontShipping\([\s\S]*?\n\}/);
 assert.ok(shippingMatch,'Cálculo de tarifa local aislado');
 const shippingContext=vm.createContext({
  DEFAULT_STOREFRONT_SHIPPING_SETTINGS:{national_shipping_cost:15000,free_shipping_threshold:130000,free_shipping_in_cali:true},
  storefrontShippingSettings:{national_shipping_cost:15000,free_shipping_threshold:130000,free_shipping_in_cali:true}
 });
 vm.runInContext(shippingMatch[0],shippingContext);
 const calcShipping=shippingContext.calculateStorefrontShipping;
 assert.equal(calcShipping('Cali',129999),0,'Cali sigue gratis');
 assert.equal(calcShipping('Bogotá',129999),15000,'Tarifa actual justo bajo el umbral');
 assert.equal(calcShipping('Bogotá',130000),0,'Umbral exacto actual');
 assert.equal(calcShipping('Bogotá',130001),0,'Por encima del umbral actual');
 assert.equal(calcShipping('Bogotá',149999,{national_shipping_cost:17500,free_shipping_threshold:150000}),17500,'Tarifa administrativa actualizada');
 assert.equal(calcShipping('Bogotá',150000,{national_shipping_cost:17500,free_shipping_threshold:150000}),0,'Umbral administrativo actualizado');
 assert.equal(calcShipping('Bogotá',999999,{national_shipping_cost:17500,free_shipping_threshold:null}),17500,'El umbral puede desactivarse');
 assert.ok(!catalog.includes('$15.000')&&!catalog.includes('$130.000'),'HTML inicial no muestra tarifas antiguas mientras carga Supabase');
 assert.ok(catalog.includes('cartQuote.discount_total==null')&&catalog.includes('authoritativeComboQuote.discount_total==null'),'Checkout y Wompi rechazan cotizaciones parciales');
 assert.ok(catalog.includes('row?.national_shipping_cost==null')&&admin.includes('row?.national_shipping_cost==null'),'RPCs rechazan fee NULL en vez de tratarlo como $0');
 assert.ok(catalog.includes("document.querySelectorAll('.detailShippingBenefits .detailShippingRule')[1]"),'La política dinámica no reemplaza el beneficio permanente de Cali');
 assert.ok(catalog.includes('data-shipping-policy')&&catalog.includes("document.querySelector('.jmTickerTrack [data-shipping-policy]')"),'El ticker se actualiza por selector estable al activar/desactivar el umbral');
 const copyMatch=catalog.match(/function updateStorefrontShippingCopy\(\)\{[\s\S]*?\n\}/);
 assert.ok(copyMatch,'Actualizador del texto dinámico de envío');
 const ticker={textContent:'✦ Consulta las condiciones de envío vigentes'},benefit={textContent:''},foot={textContent:''},paymentNote={textContent:''};
 const caliHeading={textContent:'Envío gratis en Cali'},caliCopy={textContent:'Sin costo de envío en Cali.'};
 const otherHeading={textContent:''},otherCopy={textContent:''};
 const detailRules=[{querySelector:s=>s==='b'?caliHeading:caliCopy},{querySelector:s=>s==='b'?otherHeading:otherCopy}];
 const copyContext=vm.createContext({storefrontShippingSettings:{national_shipping_cost:17500,free_shipping_threshold:null},
  storefrontShippingPolicyText:()=> 'Envío gratis en Cali; tarifa nacional vigente.',money:value=>`COP ${value}`,$:()=>paymentNote,
  document:{querySelector:s=>({'.jmTickerTrack [data-shipping-policy]':ticker,'.benefits .benefit:nth-child(2) small':benefit,'.cartShippingFoot span:first-child':foot,'.cartShippingTrack':null}[s]??null),
   querySelectorAll:s=>s==='.detailShippingBenefits .detailShippingRule'?detailRules:[]}});
 vm.runInContext(copyMatch[0],copyContext);
 copyContext.updateStorefrontShippingCopy();
 assert.equal(ticker.textContent,'✦ Envío nacional: tarifa vigente; Cali gratis','Ticker muestra estado sin umbral');
 assert.equal(caliHeading.textContent,'Envío gratis en Cali','La copia dinámica no reemplaza la tarjeta de Cali');
 assert.equal(otherHeading.textContent,'Tarifa fuera de Cali','La ficha informa la tarifa si el umbral está desactivado');
 copyContext.storefrontShippingSettings.free_shipping_threshold=150000;copyContext.updateStorefrontShippingCopy();
 assert.equal(ticker.textContent,'✦ Envío gratis desde COP 150000 fuera de Cali','Ticker se actualiza al reactivar el umbral');
 assert.equal(otherHeading.textContent,'Envío gratis a otras ciudades','La ficha se actualiza al reactivar el umbral');
 const progressMatch=catalog.match(/function updateCartShippingProgress\(total\)\{[\s\S]*?\n\}/);
 assert.ok(progressMatch,'Actualizador del progreso de envío');
 const progressTrack={style:{},attrs:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]}};
 const progressNodes={cartShippingMessage:{innerHTML:''},cartShippingFill:{style:{},parentElement:progressTrack},cartShippingTruck:{style:{}},cartShippingPercent:{textContent:''}};
 const progressContext=vm.createContext({storefrontShippingSettings:{national_shipping_cost:17500,free_shipping_threshold:null},money:value=>`COP ${value}`,$:id=>progressNodes[id]??null});
 vm.runInContext(progressMatch[0],progressContext);
 progressContext.updateCartShippingProgress(100000);
 assert.equal(progressTrack.style.display,'none','No se muestra progreso con umbral desactivado');
 assert.equal(progressNodes.cartShippingPercent.textContent,'—','No se anuncia porcentaje falso sin umbral');
 progressContext.storefrontShippingSettings.free_shipping_threshold=150000;progressContext.updateCartShippingProgress(75000);
 assert.equal(progressTrack.style.display,'','El progreso aparece al activar umbral');
 assert.equal(progressNodes.cartShippingPercent.textContent,'50%','El porcentaje coincide con el umbral nuevo');
 const normalizeMatch=catalog.match(/function normalizeDeliveryCity\(value\)\{[\s\S]*?\n\}/);
 const canonicalMatch=catalog.match(/function canonicalLocalDeliveryCity\(value\)\{[\s\S]*?\n\}/);
 assert.ok(normalizeMatch&&canonicalMatch,'Normalización de ciudades de entrega');
 vm.runInContext(normalizeMatch[0],shippingContext);vm.runInContext(canonicalMatch[0],shippingContext);
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
 assert.ok(catalog.includes('quoteRejectedBeforeReservation=true')&&catalog.includes('!quoteRejectedBeforeReservation'),'Un rechazo de cotización no libera una reserva previa');
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
	 const promoCalendarMigration=read('supabase/migrations/20261108090000_storefront_combo_calendar_priority.sql');
	 const promoCalendarTest=read('tests/promotion_priority_regression.sql');
	 assert.ok(promoCalendarMigration.includes('ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0')&&promoCalendarMigration.includes("time_zone text NOT NULL DEFAULT 'America/Bogota'"),'Calendario añade prioridad/timezone con defaults compatibles');
	 assert.ok(promoCalendarMigration.includes('CHECK (priority BETWEEN 0 AND 1000)')&&promoCalendarMigration.includes("CHECK (time_zone='America/Bogota')"),'Servidor limita prioridad y zona horaria');
	 assert.ok(promoCalendarMigration.includes('ORDER BY c.priority DESC,c.created_at ASC,c.id ASC')&&promoCalendarMigration.includes('v_remaining[i]:=v_remaining[i]-v_units'),'Cotización ordena prioridad y conserva consumo único por unidad');
	 assert.ok(promoCalendarMigration.includes('CREATE OR REPLACE FUNCTION public.get_storefront_cart_quote(p_items jsonb, p_city text DEFAULT')&&promoCalendarMigration.includes('GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote(jsonb,text) TO anon,authenticated,service_role'),'La cotización conserva firma/grants Wompi-COD');
	 assert.ok(promoCalendarMigration.includes('admin_save_storefront_product_combo_v2')&&promoCalendarMigration.includes('admin_save_storefront_product_combo(')&&promoCalendarMigration.includes('auth.uid() IS DISTINCT FROM v_admin_user_id'),'RPC v2 tiene guardia admin y reutiliza validación de campos legacy');
	 assert.ok(promoCalendarMigration.includes('REVOKE ALL ON FUNCTION public.admin_save_storefront_product_combo_v2')&&promoCalendarMigration.includes('FROM PUBLIC,anon'),'RPC admin no es público/anon');
	 assert.ok(promoCalendarMigration.includes('to_regprocedure(\'public.admin_save_storefront_product_combo(')&&promoCalendarMigration.includes('TABLE(id uuid,%enabled boolean,%)'),'Migración falla temprano si el overload/retorno legacy requerido no coincide');
	 assert.ok(admin.includes("sb.rpc('admin_list_storefront_product_combos_v2')")&&admin.includes("sb.rpc('admin_save_storefront_product_combo_v2'")&&admin.includes('p_priority:priority')&&admin.includes('p_time_zone:STORE_CAMPAIGN_TIME_ZONE'),'Panel carga y guarda el calendario v2');
	 assert.ok(catalog.includes("sb.rpc('get_public_storefront_product_combos_v2')")&&catalog.includes("sb.rpc('get_public_storefront_product_combos')"),'Catálogo usa RPC pública v2 y fallback solo legacy');
	 assert.ok(admin.includes('America/Bogota')&&admin.includes('hora de Colombia')&&!admin.includes("message:'Descubre la temporada y aprovecha el envío gratis a Cali.'"),'Panel fija hora Colombia y copy sugerido neutral');
	 assert.ok(promoCalendarTest.includes('admin_save_storefront_product_combo_v2')&&promoCalendarTest.includes("request.jwt.claim.sub")&&promoCalendarTest.includes("has_function_privilege('service_role'")&&promoCalendarTest.includes('v_quote#>>\'{discounts,0,id}\'')&&promoCalendarTest.includes('v_line_discount IS DISTINCT FROM 7000')&&promoCalendarTest.includes('ROLLBACK;'),'Regresión invoca el guardado v2 y cubre grants/prioridad/paridad con rollback');
	 const campaignTimeBlock=admin.match(/const STORE_CAMPAIGN_TIME_ZONE='America\/Bogota';[\s\S]*?(?=function resetStorefrontComboForm\(\))/)?.[0];
	 assert.ok(campaignTimeBlock,'Helpers de conversión horaria para campañas');
	 const campaignTimeContext=vm.createContext({Intl});vm.runInContext(campaignTimeBlock,campaignTimeContext);
	 assert.equal(campaignTimeContext.campaignLocalDateTimeToIso('2026-11-07T12:34'),'2026-11-07T17:34:00.000Z','Fecha de Colombia convierte a instante UTC independientemente del navegador');
	 assert.equal(campaignTimeContext.campaignIsoToLocalDateTime('2026-11-07T17:34:00.000Z'),'2026-11-07T12:34','Instante UTC vuelve a hora de Colombia');
	 assert.throws(()=>campaignTimeContext.campaignLocalDateTimeToIso('2026-02-30T09:00'),/fecha/i,'Fecha inválida no se normaliza silenciosamente');
	 const comboPricingMatch=catalog.match(/function calculateStorefrontComboPricing\(items\)\{[\s\S]*?\n\}/);
	 assert.ok(comboPricingMatch,'Estimador local de descuentos de combos');
	 const comboProducts=[{id:'a',sale_price:100000,category:'A'},{id:'b',sale_price:100000,category:'B'}];
	 const comboContext=vm.createContext({productos:comboProducts,storefrontProductCombos:[
	  {id:'legacy',rule_type:'product_pair',product_a_id:'a',product_b_id:'b',discount_type:'fixed_amount',discount_value:20000,priority:0,created_at:'2026-01-01'},
	  {id:'priority',rule_type:'product_pair',product_a_id:'a',product_b_id:'b',discount_type:'fixed_amount',discount_value:7000,priority:1000,created_at:'2026-02-01'}
	 ],comboPriceForItem:item=>Number(comboProducts.find(product=>product.id===String(item.id))?.sale_price)||0});
	 vm.runInContext(comboPricingMatch[0],comboContext);
	 const priorityQuote=comboContext.calculateStorefrontComboPricing([{id:'a',qty:1},{id:'b',qty:1}]);
	 assert.equal(priorityQuote.applied.length,1,'Una pareja solo recibe un beneficio');
	 assert.equal(priorityQuote.applied[0].id,'priority','El estimador usa prioridad antes del orden histórico');
	 assert.equal(priorityQuote.discountTotal,7000,'El estimador coincide con el beneficio de mayor prioridad');
	 console.log('PASS: sintaxis, SDK/SRI, seguridad admin, CSV, tarifas, COD, campañas, timezone, prioridad y rollback.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
