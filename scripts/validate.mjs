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
 shippingContext.normalizeDeliveryCity=value=>String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[,.]+/g,' ').replace(/\s+/g,' ').trim();
 shippingContext.canonicalLocalDeliveryCity=value=>['cali','santiago de cali','cali valle del cauca'].includes(shippingContext.normalizeDeliveryCity(value))?'Cali':'';
 const resolverMatch=catalog.match(/function resolveStorefrontShippingRule\([\s\S]*?\n\}/);
 assert.ok(resolverMatch,'Resolutor local de tarifa por destino');
 vm.runInContext(resolverMatch[0],shippingContext);
 vm.runInContext(shippingMatch[0],shippingContext);
 const calcShipping=shippingContext.calculateStorefrontShipping;
 assert.equal(calcShipping('Cali',129999),0,'Cali sigue gratis');
 assert.equal(calcShipping('Bogotá',129999),15000,'Tarifa actual justo bajo el umbral');
 assert.equal(calcShipping('Bogotá',130000),0,'Umbral exacto actual');
 assert.equal(calcShipping('Bogotá',130001),0,'Por encima del umbral actual');
 assert.equal(calcShipping('Bogotá',149999,{national_shipping_cost:17500,free_shipping_threshold:150000}),17500,'Tarifa administrativa actualizada');
 assert.equal(calcShipping('Bogotá',150000,{national_shipping_cost:17500,free_shipping_threshold:150000}),0,'Umbral administrativo actualizado');
 assert.equal(calcShipping('Bogotá',999999,{national_shipping_cost:17500,free_shipping_threshold:null}),17500,'El umbral puede desactivarse');
 const cityZoneSettings={national_shipping_cost:15000,free_shipping_threshold:130000,destination_rules:[
  {id:'zone-1',scope:'zone',name:'Zona prioritaria',priority:100,shipping_cost:15000,free_shipping_threshold:50000,destinations:['Bogotá','Chía']},
  {id:'city-1',scope:'city',name:'Bogotá',priority:0,shipping_cost:25000,free_shipping_threshold:null,destinations:['Bogotá']},
  {id:'city-2',scope:'city',name:'São Paulo',priority:0,shipping_cost:11000,free_shipping_threshold:null,destinations:['São Paulo']}
 ]};
 assert.equal(shippingContext.resolveStorefrontShippingRule('BOGOTA',cityZoneSettings).kind,'city','La regla city prevalece sobre zona');
 assert.equal(calcShipping('Bogotá',100000,cityZoneSettings),25000,'Tarifa de ciudad específica');
 assert.equal(calcShipping('Bogotá,',100000,cityZoneSettings),25000,'La puntuación final se recorta en la clave del destino');
 assert.equal(calcShipping('Chía',49999,cityZoneSettings),15000,'Tarifa de zona bajo el mínimo');
 assert.equal(calcShipping('Chía',50000,cityZoneSettings),0,'Umbral exacto de zona');
 assert.equal(calcShipping('Destino sin regla',129999,cityZoneSettings),15000,'Fallback bajo su umbral general');
 assert.equal(calcShipping('Destino sin regla',130000,cityZoneSettings),0,'Fallback con umbral general exacto');
 assert.equal(calcShipping('Sao Paulo',100000,cityZoneSettings),11000,'Normalización Unicode amplia en la regla local');
 assert.equal(calcShipping('Santiago de Cali',999999,cityZoneSettings),0,'Alias de Cali no admite tarifa específica');
 const destinationNormalizer=admin.match(/function normalizeStorefrontShippingDestinationAdmin\([\s\S]*?\n\}/);
 assert.ok(destinationNormalizer,'Normalizador de destinos del panel');
 const destinationContext=vm.createContext({});vm.runInContext(destinationNormalizer[0],destinationContext);
 assert.equal(destinationContext.normalizeStorefrontShippingDestinationAdmin('  São Paulo  '),'sao paulo','El panel normaliza virgulilla/unicode');
 assert.equal(destinationContext.normalizeStorefrontShippingDestinationAdmin('Càceres, España'),'caceres espana','El panel normaliza acentos y puntuación');
 assert.equal(destinationContext.normalizeStorefrontShippingDestinationAdmin('Bogotá, '),'bogota','El panel recorta el espacio generado por la coma');
 const loadStart=catalog.indexOf('async function loadStorefrontShippingSettings(force=false){');
 const loadEnd=catalog.indexOf('\n\n// Referencia de Wompi',loadStart);
 assert.ok(loadStart>=0&&loadEnd>loadStart,'Carga de configuración aislable');
 let resolveInitialRpc;const initialRpc=new Promise(resolve=>{resolveInitialRpc=resolve});let shippingRpcCalls=0;const refreshTimers=[];
 const refreshContext=vm.createContext({storefrontShippingSettings:{national_shipping_cost:15000,free_shipping_threshold:130000,free_shipping_in_cali:true,destination_rules:[]},
  storefrontShippingSettingsLoaded:false,storefrontShippingSettingsPromise:null,storefrontShippingSettingsRefreshPending:false,
  sb:{rpc:()=>{shippingRpcCalls++;return shippingRpcCalls===1?initialRpc:Promise.resolve({data:{success:true,national_shipping_cost:20000,free_shipping_threshold:150000,free_shipping_in_cali:true,destination_rules:[]}})}},
  normalizeDeliveryCity:shippingContext.normalizeDeliveryCity,canonicalLocalDeliveryCity:shippingContext.canonicalLocalDeliveryCity,
  updateStorefrontShippingCopy:()=>{},renderCart:()=>{},$:()=>null,console:{warn:()=>{}},setTimeout:callback=>{refreshTimers.push(callback);return 1;}});
 vm.runInContext(catalog.slice(loadStart,loadEnd),refreshContext);
 const initialLoad=refreshContext.loadStorefrontShippingSettings(false);const forcedLoad=refreshContext.loadStorefrontShippingSettings(true);
 resolveInitialRpc({data:{success:true,national_shipping_cost:15000,free_shipping_threshold:130000,free_shipping_in_cali:true,destination_rules:[]}});
 await Promise.all([initialLoad,forcedLoad]);
 assert.equal(shippingRpcCalls,1,'El refresh simultáneo se coalesce mientras el primer read sigue activo');
 assert.equal(refreshTimers.length,1,'El refresh forzado pendiente se agenda al terminar la carga');
 refreshTimers.shift()();assert.equal(shippingRpcCalls,2,'El evento en vuelo provoca una segunda consulta');
 await refreshContext.storefrontShippingSettingsPromise;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(refreshContext.storefrontShippingSettings.national_shipping_cost,20000,'La lectura posterior reemplaza el snapshot anterior');
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
 const copyContext=vm.createContext({storefrontShippingSettings:{national_shipping_cost:17500,free_shipping_threshold:null,destination_rules:[]},storefrontShippingSettingsLoaded:false,storefrontShippingSettingsLoadError:false,
 storefrontShippingPolicyText:()=> 'Envío gratis en Cali; tarifa nacional vigente.',money:value=>`COP ${value}`,$:()=>paymentNote,
 document:{querySelector:s=>({'.jmTickerTrack [data-shipping-policy]':ticker,'.benefits .benefit:nth-child(1) small':caliBenefit,'.benefits .benefit:nth-child(2) small':benefit,'.cartShippingFoot span:first-child':foot,'.cartShippingTrack':null}[s]??null),
 querySelectorAll:s=>s==='.detailShippingBenefits .detailShippingRule'?detailRules:[]}});
 vm.runInContext(copyMatch[0],copyContext);
 copyContext.updateStorefrontShippingCopy();
 assert.equal(ticker.textContent,'✦ Consulta la tarifa vigente al seleccionar tu ciudad','El ticker mantiene copy neutral antes de verificar Supabase');
 assert.equal(caliBenefit.textContent,'Tarifa por confirmar','No se promete Cali gratis antes de verificar la configuración');
 assert.equal(foot.textContent,'Selecciona una ciudad para consultar el envío','El carrito espera la ciudad para calcular el destino');
 assert.equal(caliHeading.textContent,'Tarifa en Cali','La ficha mantiene Cali neutral antes del RPC');
 copyContext.storefrontShippingSettingsLoaded=true;copyContext.updateStorefrontShippingCopy();
 assert.equal(ticker.textContent,'✦ Envío nacional: tarifa vigente; Cali gratis','Ticker muestra estado general tras respuesta válida');
 assert.equal(caliBenefit.textContent,'Envío gratis','El beneficio de Cali se restaura tras configuración válida');
 assert.equal(caliHeading.textContent,'Envío gratis en Cali','La ficha restaura el beneficio de Cali tras el RPC');
 assert.equal(otherHeading.textContent,'Tarifa fuera de Cali','La ficha informa la tarifa nacional si el umbral está desactivado');
 copyContext.storefrontShippingSettings.destination_rules=[{id:'rule-bogota',scope:'city',name:'Bogotá',enabled:true,destinations:['Bogotá']}];
 copyContext.storefrontShippingSettings.free_shipping_threshold=150000;copyContext.updateStorefrontShippingCopy();
 assert.equal(ticker.textContent,'✦ Envío gratis en Cali · tarifas según ciudad o zona','Ticker no promete una regla global cuando hay tarifas por destino');
 assert.equal(benefit.textContent,'Tarifas y mínimos según ciudad o zona','Beneficio no atribuye el fallback a todas las ciudades');
 assert.equal(foot.textContent,'El costo exacto se confirma al seleccionar la ciudad','Carrito aclara cuándo se conoce el importe');
 assert.equal(caliHeading.textContent,'Envío gratis en Cali','La copia dinámica no reemplaza la tarjeta de Cali');
 assert.equal(otherHeading.textContent,'Tarifa por destino','La ficha indica cálculo por ciudad o zona');
 assert.equal(otherCopy.textContent,'El costo y el mínimo dependen de la ciudad o zona.','La ficha no inventa una regla global');
 copyContext.storefrontShippingSettings.free_shipping_threshold=200000;copyContext.updateStorefrontShippingCopy();
 assert.equal(ticker.textContent,'✦ Envío gratis en Cali · tarifas según ciudad o zona','El ticker no cambia a un umbral general al reconfigurar fallback');
 assert.equal(otherHeading.textContent,'Tarifa por destino','La ficha sigue siendo neutral al editar el fallback');
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
 progressContext.storefrontShippingSettings.destination_rules=[{id:'city-rule'}];progressContext.updateCartShippingProgress(75000);
 assert.equal(progressTrack.style.display,'none','El progreso se oculta si el umbral depende de ciudad/zona');
 assert.match(progressNodes.cartShippingMessage.textContent,/según tu ciudad o zona/,'El carrito evita una promesa de envío gratis ambigua');
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
 const cityShippingMigration=read('supabase/migrations/20261108070000_storefront_city_shipping_rules.sql');
 const wompiFunction=read('supabase/functions/wompi-create-checkout/index.ts');
 const codRestrictMigration=read('docs/deployment/restrict_legacy_cod_rpc_after_frontend.sql');
 const shippingTest=read('tests/shipping_config_regression.sql');
 const cityShippingTest=read('tests/storefront_city_shipping_regression.sql');
 const codTest=read('tests/cod_regression.sql');
 const codLegacyAclTest=read('tests/cod_legacy_acl.sql');
 const shippingMigrationOrder=fs.readdirSync(path.join(root,'supabase/migrations')).filter(name=>/^202611080(60000|60050|60100|70000)_/.test(name)).sort();
 assert.deepEqual(shippingMigrationOrder,['20261108060000_configurable_storefront_shipping.sql','20261108060050_restrict_admin_shipping_rpc.sql','20261108060100_cod_checkout_quote_guard.sql','20261108070000_storefront_city_shipping_rules.sql'],'Orden obligatorio de configuración, hotfix ACL, guard COD y tarifas por ciudad');
 assert.ok(shippingMigration.includes('VALUES (1,15000,130000) ON CONFLICT (id) DO NOTHING'),'Valores actuales como defaults sin sobrescribir datos');
 assert.ok(shippingMigration.includes('public.is_store_admin()'),'Guardia de administrador en el guardado');
 assert.ok(shippingAclMigration.includes('FROM PUBLIC,anon,service_role')&&shippingAclMigration.includes('TO authenticated'),'Hotfix ACL deja el RPC admin solo para authenticated');
 assert.ok(shippingTest.includes("has_function_privilege('public'")&&shippingTest.includes("has_function_privilege('anon'")&&shippingTest.includes("has_function_privilege('service_role'")&&shippingTest.includes("has_function_privilege('authenticated'"),'Prueba de grants exige solo authenticated para guardar tarifas');
 assert.ok(shippingMigration.includes('v_free_shipping_threshold IS NOT NULL AND v_subtotal>=v_free_shipping_threshold'),'Umbral calculado sobre subtotal con descuentos');
 assert.ok(shippingMigration.includes("v_normalized_city IN ('cali','santiago de cali','cali valle del cauca')"),'Cali conserva la excepción gratis server-side');
 assert.ok(shippingMigration.includes('TO anon,authenticated,service_role'),'Cotización pública y Wompi con grants explícitos');
 assert.ok(cityShippingMigration.includes('CREATE TABLE public.storefront_shipping_rules')&&cityShippingMigration.includes('ENABLE ROW LEVEL SECURITY'),'Reglas en tablas protegidas por RLS');
 assert.ok(cityShippingMigration.includes('REVOKE ALL ON TABLE public.storefront_shipping_rules FROM PUBLIC,anon,authenticated,service_role'),'Sin lectura/escritura directa de reglas');
 assert.ok(cityShippingMigration.includes('normalize(lower(btrim(coalesce(p_value,\'\'))),NFD)')&&cityShippingMigration.includes('U&\'[\\0300-\\036f]\'')&&cityShippingMigration.includes('SELECT btrim(regexp_replace('),'La normalización SQL elimina diacríticos y espacios residuales');
 assert.ok(cityShippingMigration.includes('admin_list_storefront_shipping_rules')&&cityShippingMigration.includes('admin_save_storefront_shipping_rule')&&cityShippingMigration.includes('admin_delete_storefront_shipping_rule')&&cityShippingMigration.includes('public.is_store_admin()'),'RPCs admin protegidas');
 assert.ok(cityShippingMigration.includes('FROM PUBLIC,anon,service_role'),'RPCs admin revocadas explícitamente para anon/service_role');
 assert.ok(cityShippingMigration.includes('REVOKE ALL ON FUNCTION public.admin_delete_storefront_shipping_rule(uuid) FROM PUBLIC,anon,service_role;')&&cityShippingMigration.includes('GRANT EXECUTE ON FUNCTION public.admin_delete_storefront_shipping_rule(uuid) TO authenticated;')&&cityShippingMigration.includes('PERFORM 1 FROM public.storefront_shipping_settings WHERE id=1 FOR UPDATE'),'Delete admin-only serializado por el singleton de envío');
 assert.ok(cityShippingMigration.includes('FOR UPDATE')&&cityShippingMigration.includes('FOR SHARE OF r'),'Cambios de regla serializados con cotizaciones');
 assert.ok(cityShippingMigration.includes("v_normalized_city IN ('cali','santiago de cali','cali valle del cauca')")&&cityShippingMigration.includes("v_destination_status:='fallback'"),'Cali gratis y destino sin regla con fallback explícito');
 assert.ok(cityShippingMigration.includes('shipping_rule_scope')&&cityShippingMigration.includes('destination_rules'),'Cotización y respuesta pública incluyen metadatos de regla');
 assert.ok(cityShippingTest.includes('ROLLBACK_CITY_SHIPPING_TEST')&&cityShippingTest.includes('matched_city')&&cityShippingTest.includes('matched_zone')&&cityShippingTest.includes('cali_free')&&cityShippingTest.includes('São Paulo'),'Regresión sintética de city/zona, Unicode, Cali y rollback');
 assert.ok(cityShippingTest.includes('admin_delete_storefront_shipping_rule')&&cityShippingTest.includes('un usuario ajeno pudo eliminar')&&cityShippingTest.includes('delete de regla no eliminó sus destinos'),'Regresión SQL prueba autorización y cascade del delete');
 assert.ok(cityShippingTest.includes('v_order_snapshot')&&cityShippingTest.includes('v_reservation_snapshot')&&cityShippingTest.includes('eliminar la regla cambió el pedido COD histórico')&&cityShippingTest.includes('eliminar la regla cambió la reserva histórica'),'La regresión comprueba que delete conserva el pedido/reserva COD completos');
 assert.ok(cityShippingTest.includes('public.create_contra_delivery_order_with_quote')&&cityShippingTest.includes('TEST-CITY-COD-')&&cityShippingTest.includes("v_retry->>'duplicate'")&&cityShippingTest.includes('v_retry_order_id IS DISTINCT FROM v_order_id')&&cityShippingTest.includes('v_order_count IS DISTINCT FROM 1'),'COD con regla ciudad y reintento idempotente sin pedido/reserva doble');
 assert.ok(cityShippingTest.includes('TEST-ZONE-TIE-')&&cityShippingTest.includes('v_expected_zone_rule_id:=least'),'La prueba cubre el desempate determinista entre zonas');
 assert.ok(catalog.includes("sb.rpc('get_public_storefront_shipping_settings')"),'El catálogo consulta la tarifa actual');
 assert.ok(admin.includes("sb.rpc('admin_save_storefront_shipping_settings'"),'El admin guarda la tarifa mediante RPC');
 assert.ok(admin.includes("sb.rpc('admin_list_storefront_shipping_rules'")&&admin.includes("sb.rpc('admin_save_storefront_shipping_rule'")&&admin.includes("sb.rpc('admin_delete_storefront_shipping_rule'"),'Panel consulta/guarda/elimina reglas por RPC admin');
 assert.ok(admin.includes('Reglas por ciudad o zona')&&admin.includes('no alteran pedidos ni reservas existentes'),'UI distingue reglas nuevas de pedidos históricos');
 assert.ok(admin.includes('id="shippingRulesSearch"')&&admin.includes('filterStorefrontShippingRulesAdmin')&&admin.includes('data-shipping-rule-delete'),'Reglas admin permiten buscar destinos y eliminar explícitamente');
 assert.ok(admin.includes('function resetStorefrontShippingRulesAdminState()')&&admin.includes('resetStorefrontShippingRulesAdminState();')&&admin.includes('if(!isCurrent())return false;'),'Estado/loading de reglas se limpia al logout y las respuestas tardías se descartan');
 assert.ok(admin.includes('no cambian qué ciudades tienen contraentrega'),'Editar tarifas no activa COD automáticamente');
 assert.ok(catalog.includes('resolveStorefrontShippingRule')&&catalog.includes('destination_rules'),'Catálogo resuelve reglas de ciudad/zona y fallback');
 assert.ok(catalog.includes("change?.type==='shipping-rules-changed'")&&catalog.includes("payload.type))void loadStorefrontShippingSettings(true)")&&catalog.includes("type==='shipping-rules-changed'"),'Cambios de reglas refrescan el catálogo entre pestañas y por Realtime');
 assert.ok(catalog.includes('if(force)storefrontShippingSettingsRefreshPending=true')&&catalog.includes('setTimeout(()=>{if(!storefrontShippingSettingsPromise)void loadStorefrontShippingSettings(true)},0)'),'El refresh forzado se encola si coincide con una carga en vuelo');
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
 console.log('PASS: sintaxis, SDK/SRI, seguridad admin, CSV, tarifas, COD, rollback y claves Wompi intactas.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
