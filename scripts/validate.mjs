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
 assert.ok(catalog.includes("const SIREVYA_CATALOG_FAVORITES_KEY='sirevya_catalog_favorites_v1';")&&catalog.includes('localStorage.setItem(SIREVYA_CATALOG_FAVORITES_KEY'),'Favoritos usan una clave local independiente');
 const favoriteStorageCode=[...catalog.matchAll(/function (?:loadCatalogFavorites|saveCatalogFavorites)\(\)\{[\s\S]*?\n\}/g)].map(match=>match[0]).join('\n');
 assert.ok(favoriteStorageCode&& !/WOMPI_(?:CART|RESERVATION|PENDING)/.test(favoriteStorageCode),'Guardar favoritos no lee ni modifica claves de carrito/reserva');
 assert.ok(catalog.includes('aria-pressed="false" onclick="toggleFavoriteFilter()"')&&catalog.includes('onclick="toggleProductFavorite('),'Favoritos accesibles desde filtro y tarjeta');
 assert.ok(catalog.includes('id="filterPriceMin"')&&catalog.includes('id="filterPriceMax"')&&catalog.includes('id="filterSizeOptions"')&&catalog.includes('id="filterAvailability"'),'El panel expone precio, talla y disponibilidad');
 assert.ok(catalog.includes('params.delete(\'favoritos\')')&&catalog.includes('function isSafeCatalogSearchForUrl(value)'),'La vista de favoritos no se comparte y búsqueda protege PII en URL');
 const favoriteMatcher=catalog.match(/function catalogProductMatchesFilters\(p,filters,colorIndex,sizeIndex\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(favoriteMatcher,'Predicado aislado de filtros del catálogo');
 const favoriteIds=new Set(['p1']);
 const favoriteContext=vm.createContext({normalizeText:value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(),productStockTotal:product=>Number(product.quantity)||0,isCatalogFavorite:id=>favoriteIds.has(String(id))});
 vm.runInContext(favoriteMatcher,favoriteContext);
 const inStockProduct={id:'p1',code:'C1',name:'Camiseta azul',category:'Ropa',sale_price:50000,quantity:2};
 const outOfStockProduct={id:'p2',code:'C2',name:'Camiseta roja',category:'Ropa',sale_price:90000,quantity:0};
 const colorIndex={byProduct:new Map([[inStockProduct,new Set(['azul'])],[outOfStockProduct,new Set(['rojo'])]])};
 const sizeIndex={byProduct:new Map([[inStockProduct,new Set(['m'])],[outOfStockProduct,new Set(['s'])]])};
 const baseFilters={query:'camiseta',category:'Ropa',minPrice:40000,maxPrice:60000,priceInvalid:false,availability:'available',colors:new Set(['azul']),sizes:new Set(['m']),favoritesOnly:true};
 assert.equal(favoriteContext.catalogProductMatchesFilters(inStockProduct,baseFilters,colorIndex,sizeIndex),true,'Filtros por búsqueda, categoría, precio, color, talla y favorito se combinan');
 assert.equal(favoriteContext.catalogProductMatchesFilters(outOfStockProduct,{...baseFilters,minPrice:null,maxPrice:null,colors:new Set(),sizes:new Set(),availability:'available',favoritesOnly:false},colorIndex,sizeIndex),false,'Disponibles excluye agotados por variante');
 assert.equal(favoriteContext.catalogProductMatchesFilters(outOfStockProduct,{...baseFilters,query:'',category:'',minPrice:null,maxPrice:null,colors:new Set(),sizes:new Set(),availability:'out',favoritesOnly:false},colorIndex,sizeIndex),true,'Filtro de agotados puede mostrarlos sin habilitar compra');
 const sizesMatch=catalog.match(/function availableSizesForProduct\(p,availability='available'\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(sizesMatch,'Faceta de tallas aislable');
 const sizesContext=vm.createContext({productStockTotal:product=>Number(product.variants?.reduce((sum,v)=>sum+v.stock,0))||0,variantList:product=>product.variants||[],parseVariantList:value=>Array.isArray(value)?value:[],normalizeText:value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
 vm.runInContext(sizesMatch,sizesContext);
 const sizeProduct={sizes:['M','L'],variants:[{size:'M',stock:2},{size:'L',stock:0}]};
 assert.deepEqual(Array.from(sizesContext.availableSizesForProduct(sizeProduct,'available')),['M'],'Faceta de talla solo ofrece opciones con stock');
 assert.deepEqual(Array.from(sizesContext.availableSizesForProduct(sizeProduct,'all')),['M','L'],'Modo catálogo completo incluye tallas agotadas');
 assert.deepEqual(Array.from(sizesContext.availableSizesForProduct(sizeProduct,'out')),[],'Filtro Agotados no incluye tallas sueltas de un producto disponible');
 const unavailableSizeProduct={sizes:['M','L'],variants:[{size:'M',stock:0},{size:'L',stock:0}]};
 assert.deepEqual(Array.from(sizesContext.availableSizesForProduct(unavailableSizeProduct,'out')),['M','L'],'Faceta de talla de productos agotados refleja sus variantes');
 const safeSearchMatch=catalog.match(/function isSafeCatalogSearchForUrl\(value\)\{[\s\S]*?\n\}/)?.[0];
 const urlSyncMatch=catalog.match(/function syncCatalogFiltersToUrl\(categoryOverride\)\{[\s\S]*?\n\}/)?.[0];
 const restoreFiltersMatch=catalog.match(/function restoreCatalogFiltersFromUrl\(preserveCurrentSearch=false\)\{[\s\S]*?\n\}/)?.[0];
 const colorsMatch=catalog.match(/function availableColorsForProduct\(p,availability='available'\)\{[\s\S]*?\n\}/)?.[0];
 const safeFacetValuesMatch=catalog.match(/function safeCatalogFilterValues\(params,key\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(safeSearchMatch&&urlSyncMatch&&restoreFiltersMatch&&colorsMatch&&sizesMatch&&safeFacetValuesMatch,'Reglas de URL compartible aislables');
 const restoreFields={search:{value:''},filterPriceMin:{value:''},filterPriceMax:{value:''},filterAvailability:{value:'available'},sort:{value:'recent'}};
 const restoreContext=vm.createContext({URLSearchParams,window:{location:{search:'?q=Camiseta+azul&color=Maria+Gomez&color=azul&talla=Datos+personales&talla=M&min=50000'}},
  productos:[{id:'p1',code:'C1',name:'Camiseta azul',category:'Ropa',quantity:2,colors:['Azul'],sizes:['M'],variants:[]}],
  normalizeText:value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(),productStockTotal:product=>Number(product.quantity)||0,
  parseVariantList:value=>Array.isArray(value)?value:String(value||'').split(',').map(part=>part.trim()).filter(Boolean),variantList:product=>product.variants||[],updateFavoriteControls:()=>{},
  catalogCreatedAtResolved:false,catalogCreatedAtAvailable:false,$:id=>restoreFields[id]||null});
 vm.runInContext(colorsMatch+'\n'+sizesMatch+'\n'+safeFacetValuesMatch+'\n'+safeSearchMatch+'\n'+restoreFiltersMatch,restoreContext);
 restoreContext.restoreCatalogFiltersFromUrl();
 assert.equal(restoreContext.selectedCatalogColors.size,1);assert.equal(restoreContext.selectedCatalogColors.has('azul'),true,'URL solo restaura colores del catálogo');
 assert.equal(restoreContext.selectedCatalogColorNames.get('azul'),'Azul');assert.equal(restoreContext.selectedCatalogSizes.size,1);assert.equal(restoreContext.selectedCatalogSizes.has('m'),true,'URL solo restaura tallas del catálogo');
 const urlFields={category:{value:'Ropa'},search:{value:'Camiseta azul'},filterPriceMin:{value:'50000'},filterPriceMax:{value:''},filterAvailability:{value:'all'},sort:{value:'price_asc'}};
 const historyMock={state:{sirevyaProductDetailOpen:true},replaceState(state,_title,url){this.state=state;this.url=url}};
 const urlContext=vm.createContext({URL,URLSearchParams,window:{location:{href:'https://shop.example/?producto=abc&favoritos=1&email=ana%40example.com&phone=3021234567#catalogo'}},history:historyMock,$:id=>urlFields[id]||null,
  productos:[{id:'abc',code:'C1',name:'Camiseta azul',category:'Ropa'}],normalizeText:value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(),
  selectedCatalogColors:new Set(['azul']),selectedCatalogColorNames:new Map([['azul','Azul']]),selectedCatalogSizes:new Set(['m']),selectedCatalogSizeNames:new Map([['m','M']]),
  readCatalogPriceLimit:id=>urlFields[id]?.value?Number(urlFields[id].value):null,console:{warn:()=>{}}});
 vm.runInContext(safeSearchMatch+'\n'+urlSyncMatch,urlContext);urlContext.syncCatalogFiltersToUrl();
 let sharedUrl=new URL(historyMock.url,'https://shop.example');
 assert.equal(sharedUrl.searchParams.get('producto'),'abc','Sincronizar filtros conserva el enlace directo al producto');
 assert.equal(sharedUrl.searchParams.get('categoria'),'Ropa');assert.equal(sharedUrl.searchParams.get('q'),'Camiseta azul');assert.equal(sharedUrl.searchParams.get('min'),'50000');
 assert.equal(sharedUrl.searchParams.get('color'),'Azul');assert.equal(sharedUrl.searchParams.get('talla'),'M');assert.equal(sharedUrl.searchParams.get('disp'),'all');assert.equal(sharedUrl.searchParams.get('orden'),'price_asc');
 assert.equal(sharedUrl.searchParams.has('favoritos'),false,'La lista local nunca se codifica en el URL');assert.equal(historyMock.state.sirevyaProductDetailOpen,true,'Los filtros conservan el estado del historial');
 assert.equal(sharedUrl.searchParams.has('email'),false);assert.equal(sharedUrl.searchParams.has('phone'),false,'No se conservan parámetros arbitrarios con PII');assert.equal(sharedUrl.hash,'#catalogo');
 urlContext.window.location.href='https://shop.example'+historyMock.url;urlFields.search.value='302 123 4567';urlContext.syncCatalogFiltersToUrl();sharedUrl=new URL(historyMock.url,'https://shop.example');
 assert.equal(sharedUrl.searchParams.has('q'),false,'Un número telefónico no se copia a la URL');
 urlContext.window.location.href='https://shop.example/?email=ana%40example.com#ana%40example.com';urlFields.search.value='correo@ejemplo.com';urlContext.syncCatalogFiltersToUrl();sharedUrl=new URL(historyMock.url,'https://shop.example');
 assert.equal(sharedUrl.searchParams.has('q'),false,'Un correo no se copia a la URL');assert.equal(sharedUrl.searchParams.has('email'),false);assert.equal(sharedUrl.hash,'','Un fragmento desconocido no se vuelve a compartir');
 const catalogDatesMigration=read('supabase/migrations/20261108080000_public_catalog_sort_metadata.sql');
 const catalogDatesRegression=read('tests/catalog_discovery_metadata.sql');
 assert.ok(catalogDatesMigration.includes('RETURNS TABLE(id uuid, created_at timestamptz)')&&catalogDatesMigration.includes('SELECT p.id, p.created_at'),'La RPC expone solo ID y fecha de creación');
 assert.ok(!/sale_price|cost_price|phone|email|quantity|variants/i.test(catalogDatesMigration),'La RPC no revela precio, clientes, stock ni variantes');
 assert.ok(catalogDatesMigration.includes('FROM PUBLIC, anon, authenticated, service_role')&&catalogDatesMigration.includes('TO anon, authenticated, service_role'),'La RPC tiene grants públicos explícitos y revoca el default');
 assert.ok(catalogDatesRegression.includes("has_function_privilege('public'")&&catalogDatesRegression.includes("has_function_privilege('anon'")&&catalogDatesRegression.includes("has_function_privilege('authenticated'")&&catalogDatesRegression.includes("has_function_privilege('service_role'"),'La regresión prueba las ACL por rol');
 assert.doesNotMatch(catalogDatesRegression,/^\s*(?:INSERT|UPDATE|DELETE)\b/im,'La regresión de metadata es de solo lectura');
 assert.ok(catalog.includes("fetchAllRpcRows('get_public_catalog_created_at')")&&catalog.includes('setCatalogRecentSortAvailable(false)'),'El catálogo tolera que la migración pública de fechas aún no esté instalada');
 const metadataApplyMatch=catalog.match(/function applyCatalogCreatedAtMetadata\(result\)\{[\s\S]*?\n\}/)?.[0];
 const metadataRefreshMatch=catalog.match(/async function refreshCatalogCreatedAtForCurrentProducts\(\)\{[\s\S]*?\n\}/)?.[0];
 const idsSignatureMatch=catalog.match(/function catalogProductIdsSignature\(\)\{[\s\S]*?\n\}/)?.[0];
 const recentSortAvailableMatch=catalog.match(/function setCatalogRecentSortAvailable\(available\)\{[\s\S]*?\n\}/)?.[0];
 const recentSortPendingMatch=catalog.match(/function setCatalogRecentSortPending\(\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(metadataApplyMatch&&metadataRefreshMatch&&idsSignatureMatch&&recentSortAvailableMatch&&recentSortPendingMatch,'Refresh de metadata por conjunto de IDs aislable');
 const recentOption={disabled:false,textContent:'Más recientes'};
 const sortSelect={value:'recent',querySelector:()=>recentOption};
 let dateResponse=[{id:'p1',created_at:'2026-02-01T00:00:00Z'},{id:'p2',created_at:'2026-02-02T00:00:00Z'}],metadataRenders=0,metadataUrlSyncs=0,metadataRequests=0;
 const metadataContext=vm.createContext({productos:[{id:'p1',created_at:'2026-02-01T00:00:00Z'}],normalizeDetailId:id=>String(id||'').trim().toLowerCase(),
  fetchAllRpcRows:async()=>{metadataRequests++;return {data:dateResponse,error:null}},$ :id=>id==='sort'?sortSelect:null,render:()=>{metadataRenders++},syncCatalogFiltersToUrl:()=>{metadataUrlSyncs++},
  catalogCreatedAtAvailable:true,catalogCreatedAtResolved:true,catalogCreatedAtProductIdsSignature:'p1',catalogCreatedAtRefreshSequence:0,catalogInitialLoadComplete:true,console:{warn:()=>{}}});
 vm.runInContext([idsSignatureMatch,recentSortAvailableMatch,recentSortPendingMatch,metadataApplyMatch,metadataRefreshMatch].join('\n'),metadataContext);
 metadataContext.productos.push({id:'p2'});metadataContext.setCatalogRecentSortPending();
 await metadataContext.refreshCatalogCreatedAtForCurrentProducts();
 assert.equal(metadataContext.catalogCreatedAtAvailable,true,'Un producto nuevo solicita nuevamente todas las fechas');
 assert.equal(metadataContext.productos.find(product=>product.id==='p2').created_at,'2026-02-02T00:00:00Z','El producto nuevo recibe su fecha antes de ordenar');
 assert.equal(metadataContext.catalogCreatedAtProductIdsSignature,'p1|p2');assert.equal(recentOption.disabled,false);assert.equal(sortSelect.value,'recent');
 await metadataContext.refreshCatalogCreatedAtForCurrentProducts();assert.equal(metadataRequests,1,'Un refresco sin cambio de IDs reutiliza la metadata existente');
 metadataContext.productos.push({id:'p3'});dateResponse=[{id:'p1',created_at:'2026-02-01T00:00:00Z'},{id:'p2',created_at:'2026-02-02T00:00:00Z'}];metadataContext.setCatalogRecentSortPending();
 await metadataContext.refreshCatalogCreatedAtForCurrentProducts();
 assert.equal(metadataContext.catalogCreatedAtAvailable,false,'Fechas incompletas no dejan novedad activa');assert.equal(sortSelect.value,'name_asc');assert.equal(recentOption.disabled,true);
 const inventoryRefreshMatch=catalog.match(/async function refreshInventoryStatus\(priority=false\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(inventoryRefreshMatch,'Refresh de inventario aislable');
 const metadataRefreshCall=inventoryRefreshMatch.indexOf('void refreshCatalogCreatedAtForCurrentProducts()');
 assert.ok(inventoryRefreshMatch.includes('if(productSetChanged){')&&metadataRefreshCall>inventoryRefreshMatch.indexOf('if(productSetChanged){')&&inventoryRefreshMatch.indexOf('setCatalogRecentSortPending()')<metadataRefreshCall,'El cableado invalida y recarga fechas solo al cambiar el conjunto de IDs');
 assert.equal((inventoryRefreshMatch.match(/void refreshCatalogCreatedAtForCurrentProducts\(\)/g)||[]).length,1,'Un cambio de stock con los mismos IDs no agrega una consulta de fechas');
 const raceResolvers=[];
 const raceOption={disabled:false,textContent:'Más recientes'},raceSelect={value:'recent',querySelector:()=>raceOption};
 const raceContext=vm.createContext({productos:[{id:'p1',created_at:'2026-02-01T00:00:00Z'}],normalizeDetailId:id=>String(id||'').trim().toLowerCase(),
  fetchAllRpcRows:()=>new Promise(resolve=>raceResolvers.push(resolve)),$:id=>id==='sort'?raceSelect:null,render:()=>{},syncCatalogFiltersToUrl:()=>{},
  catalogCreatedAtAvailable:true,catalogCreatedAtResolved:true,catalogCreatedAtProductIdsSignature:'p1',catalogCreatedAtRefreshSequence:0,catalogInitialLoadComplete:true,console:{warn:()=>{}}});
 vm.runInContext([idsSignatureMatch,recentSortAvailableMatch,recentSortPendingMatch,metadataApplyMatch,metadataRefreshMatch].join('\n'),raceContext);
 raceContext.productos.push({id:'p2'});raceContext.setCatalogRecentSortPending();const staleMetadataRequest=raceContext.refreshCatalogCreatedAtForCurrentProducts();
 raceContext.productos.push({id:'p3'});raceContext.setCatalogRecentSortPending();const currentMetadataRequest=raceContext.refreshCatalogCreatedAtForCurrentProducts();
 raceResolvers[1]({data:[{id:'p1',created_at:'2026-02-01T00:00:00Z'},{id:'p2',created_at:'2026-02-02T00:00:00Z'},{id:'p3',created_at:'2026-02-03T00:00:00Z'}],error:null});await currentMetadataRequest;
 raceResolvers[0]({data:[{id:'p1',created_at:'2026-02-01T00:00:00Z'},{id:'p2',created_at:'2026-02-02T00:00:00Z'}],error:null});await staleMetadataRequest;
 assert.equal(raceContext.productos.find(product=>product.id==='p3').created_at,'2026-02-03T00:00:00Z','La respuesta nueva gana aunque la lectura anterior resuelva después');
 const whatsappMatch=catalog.match(/function updateDetailWhatsAppLink\(\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(whatsappMatch&&catalog.includes('id="detailWhatsAppLink"'),'CTA de WhatsApp contextual aislable');
 const whatsappLink={href:'',attrs:{},setAttribute(key,value){this.attrs[key]=value}};
 const detailVariants={querySelector:selector=>selector==='.colorDot.active'?{dataset:{value:'Negro'}}:selector==='.sizeOption.active'?{dataset:{value:'M'}}:null};
 const whatsappContext=vm.createContext({$ :id=>id==='detailWhatsAppLink'?whatsappLink:null,document:{querySelector:()=>detailVariants},detailProduct:{id:'p1',name:'Camiseta básica',code:'C1',sale_price:50000},productDetailUrl:id=>'https://shop.example/?producto='+id,money:value=>'COP '+value});
 vm.runInContext(whatsappMatch,whatsappContext);whatsappContext.updateDetailWhatsAppLink();
 const whatsappMessage=new URL(whatsappLink.href).searchParams.get('text');
 assert.ok(whatsappMessage.includes('Camiseta básica')&&whatsappMessage.includes('Código: C1')&&whatsappMessage.includes('Color elegido: Negro')&&whatsappMessage.includes('Talla elegida: M')&&whatsappMessage.includes('producto=p1'),'WhatsApp incluye producto, variante y enlace directo');
 assert.ok(!whatsappMatch.includes('addToCart')&&!whatsappMatch.includes('reserve_order_inventory'),'Consulta contextual no añade ni reserva el producto');
 assert.ok(catalog.includes('function showCatalogCardImageFallback')&&catalog.includes('function showDetailImageFallback')&&catalog.includes('catalogImageFallback'),'Las imágenes fallidas tienen fallback accesible');
 assert.ok(catalog.includes("if(sort==='recent'&&catalogCreatedAtAvailable)arr.sort((a,b)=>(Date.parse(b.created_at||'')||0)-(Date.parse(a.created_at||'')||0))"),'Orden Más recientes usa created_at real solo si hay datos válidos');
 console.log('PASS: sintaxis, seguridad, envíos/COD, filtros, favoritos, URLs privadas, WhatsApp contextual e imágenes fallback.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
