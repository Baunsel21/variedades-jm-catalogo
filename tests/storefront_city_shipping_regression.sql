-- FASE 2: ejecutar solo en un proyecto Supabase aislado tras 60000/60050/60100/70000.
-- Usa productos y reglas sintéticas en un subbloque que siempre se revierte.
-- El pedido/reserva COD sintético también queda dentro del rollback; no hace pagos ni movimientos físicos.
DO $shipping_city_rules_test$
DECLARE
  v_admin uuid;
  v_fake uuid:=gen_random_uuid();
  v_product_id uuid;
  v_city_rule_id uuid;
  v_zone_rule_id uuid;
  v_zone_tie_rule_id uuid;
  v_expected_zone_rule_id uuid;
  v_medellin_rule_id uuid;
  v_unicode_rule_id uuid;
  v_client_reference text;
  v_inventory_reference text;
  v_reservation_count integer;
  v_order_id uuid;
  v_retry_order_id uuid;
  v_order_count integer;
  v_tag text:=replace(gen_random_uuid()::text,'-','');
  v_original_fee bigint;
  v_original_threshold bigint;
  v_cod_enabled boolean;
  v_cod_cities text[];
  v_cod_enabled_after boolean;
  v_cod_cities_after text[];
  v_expected_fallback bigint;
  v_expected_zone_fee bigint;
  v_result jsonb;
  v_quote jsonb;
  v_cod_result jsonb;
  v_retry jsonb;
BEGIN
  SELECT admin_user_id INTO v_admin FROM public.store_settings WHERE id=1 LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'TEST FAILED: falta administrador de tienda'; END IF;
  SELECT national_shipping_cost,free_shipping_threshold
    INTO v_original_fee,v_original_threshold
    FROM public.storefront_shipping_settings WHERE id=1 LIMIT 1;
  IF v_original_fee IS NULL THEN RAISE EXCEPTION 'TEST FAILED: falta tarifa general'; END IF;
  SELECT enabled,allowed_cities INTO v_cod_enabled,v_cod_cities
    FROM public.storefront_cod_settings WHERE id=1 LIMIT 1;

  IF has_function_privilege('anon','public.get_public_storefront_shipping_settings()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('public','public.admin_list_storefront_shipping_rules()','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.admin_list_storefront_shipping_rules()','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.admin_list_storefront_shipping_rules()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.admin_list_storefront_shipping_rules()','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('public','public.admin_save_storefront_shipping_rule(uuid,text,text,text[],bigint,bigint,integer,boolean)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.admin_save_storefront_shipping_rule(uuid,text,text,text[],bigint,bigint,integer,boolean)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('anon','public.admin_save_storefront_shipping_rule(uuid,text,text,text[],bigint,bigint,integer,boolean)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.admin_save_storefront_shipping_rule(uuid,text,text,text[],bigint,bigint,integer,boolean)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: grants de lectura pública y administración de reglas no son mínimos';
  END IF;
  IF has_table_privilege('anon','public.storefront_shipping_rules','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('authenticated','public.storefront_shipping_rules','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('service_role','public.storefront_shipping_rules','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('anon','public.storefront_shipping_rule_destinations','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('authenticated','public.storefront_shipping_rule_destinations','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('service_role','public.storefront_shipping_rule_destinations','SELECT') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED: las tablas de reglas permiten lectura directa';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_fake::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_fake,'role','authenticated')::text,true);
  BEGIN
    PERFORM public.admin_save_storefront_shipping_rule(NULL,'city','TEST-UNAUTHORIZED-'||v_tag,ARRAY['Destino ajeno'],1,NULL,0,true);
    RAISE EXCEPTION 'TEST FAILED: un usuario ajeno pudo guardar una regla de envío';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: el RPC de reglas rechaza un uid no administrador.';
  END;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  BEGIN
    IF public.normalize_storefront_delivery_city('  São Paulo,  ') IS DISTINCT FROM 'sao paulo' THEN
      RAISE EXCEPTION 'TEST FAILED: normalización Unicode dejó un espacio residual';
    END IF;
    INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
    VALUES(v_admin,'TEST-CITY-SHIP-'||substr(v_tag,1,20),'Producto sintético de tarifa','__city_ship_'||v_tag,1,0,100000)
    RETURNING id INTO v_product_id;

    v_result:=public.admin_save_storefront_shipping_rule(
      NULL,'zone','TEST-ZONE-'||v_tag,ARRAY['Bogotá','Chía'],15000,50000,100,true
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se creó la zona sintética: %',v_result; END IF;
    v_zone_rule_id:=(v_result->>'rule_id')::uuid;

    v_result:=public.admin_save_storefront_shipping_rule(
      NULL,'zone','TEST-ZONE-TIE-'||v_tag,ARRAY['Chía','Palmira'],19000,NULL,100,true
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se creó la segunda zona sintética: %',v_result; END IF;
    v_zone_tie_rule_id:=(v_result->>'rule_id')::uuid;

    v_result:=public.admin_save_storefront_shipping_rule(
      NULL,'city','TEST-CITY-'||v_tag,ARRAY['Bogotá','Santa Fe de Bogotá'],25000,NULL,0,true
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se creó la regla de ciudad sintética: %',v_result; END IF;
    v_city_rule_id:=(v_result->>'rule_id')::uuid;

    v_result:=public.admin_save_storefront_shipping_rule(
      NULL,'city','TEST-MEDELLIN-'||v_tag,ARRAY['Medellín'],18000,200000,0,true
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se creó la regla de Medellín sintética: %',v_result; END IF;
    v_medellin_rule_id:=(v_result->>'rule_id')::uuid;

    -- La regla city gana sobre una zona coincidente, aunque la zona tenga prioridad.
    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
      'Bogotá'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR v_quote->>'destination_status' IS DISTINCT FROM 'matched_city'
       OR v_quote->>'shipping_rule_id' IS DISTINCT FROM v_city_rule_id::text
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 25000 THEN
      RAISE EXCEPTION 'TEST FAILED: la regla por ciudad no prevalece sobre la zona: %',v_quote;
  END IF;

  -- COD y su reintento deben persistir la cotización específica, no el fallback legacy.
    UPDATE public.storefront_cod_settings SET enabled=true,allowed_cities=ARRAY['Bogotá'] WHERE id=1;
    IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAILED: no se pudo aislar la configuración COD sintética'; END IF;
    v_client_reference:='TEST-CITY-COD-'||v_tag;
    v_cod_result:=public.create_contra_delivery_order_with_quote(
      v_client_reference,'Cliente sintético','TEST-ONLY','0000000000','city-test@example.invalid','Bogotá',
      'Dirección de prueba','Barrio de prueba',
      jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
      125000,0
    );
    IF v_cod_result->>'success' IS DISTINCT FROM 'true'
       OR (v_cod_result->>'shipping')::numeric IS DISTINCT FROM 25000
       OR (v_cod_result->>'total')::numeric IS DISTINCT FROM 125000
       OR (v_cod_result->>'discount_total')::numeric IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'TEST FAILED: COD no persistió la regla de ciudad: %',v_cod_result;
    END IF;
    v_order_id:=nullif(v_cod_result->>'order_id','')::uuid;
    IF v_order_id IS NULL THEN RAISE EXCEPTION 'TEST FAILED: COD no devolvió el pedido creado'; END IF;
    v_retry:=public.create_contra_delivery_order_with_quote(
      v_client_reference,'Cliente sintético','TEST-ONLY','0000000000','city-test@example.invalid','Bogotá',
      'Dirección de prueba','Barrio de prueba',
      jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
      125000,0
    );
    IF v_retry->>'success' IS DISTINCT FROM 'true'
       OR v_retry->>'duplicate' IS DISTINCT FROM 'true'
       OR (v_retry->>'shipping')::numeric IS DISTINCT FROM 25000
       OR (v_retry->>'total')::numeric IS DISTINCT FROM 125000
       OR (v_retry->>'discount_total')::numeric IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'TEST FAILED: reintento COD de regla por ciudad no fue idempotente: %',v_retry;
    END IF;
    v_retry_order_id:=nullif(v_retry->>'order_id','')::uuid;
    IF v_retry_order_id IS DISTINCT FROM v_order_id THEN RAISE EXCEPTION 'TEST FAILED: el reintento devolvió otro pedido COD'; END IF;
    SELECT count(*) INTO v_order_count FROM public.web_orders WHERE client_reference=v_client_reference AND payment_method='Contra entrega' LIMIT 1;
    IF v_order_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST FAILED: el reintento dejó más de un pedido COD (%)',v_order_count; END IF;
    SELECT inventory_reference INTO v_inventory_reference
      FROM public.web_orders WHERE client_reference=v_client_reference AND payment_method='Contra entrega' LIMIT 1;
    IF v_inventory_reference IS NULL THEN RAISE EXCEPTION 'TEST FAILED: el pedido COD sintético no registró reserva'; END IF;
    SELECT count(*) INTO v_reservation_count FROM public.inventory_reservations WHERE reference=v_inventory_reference LIMIT 1;
    IF v_reservation_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST FAILED: el reintento COD duplicó la reserva (% filas)',v_reservation_count; END IF;

    -- La zona se aplica a otro miembro y usa su umbral exacto después del subtotal.
    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
      'Chía'
    ) INTO v_quote;
    v_expected_zone_rule_id:=least(v_zone_rule_id,v_zone_tie_rule_id);
    v_expected_zone_fee:=CASE WHEN v_expected_zone_rule_id=v_zone_rule_id THEN 0 ELSE 19000 END;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR v_quote->>'destination_status' IS DISTINCT FROM 'matched_zone'
       OR v_quote->>'shipping_rule_id' IS DISTINCT FROM v_expected_zone_rule_id::text
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM v_expected_zone_fee THEN
      RAISE EXCEPTION 'TEST FAILED: el desempate estable de zonas o su umbral no se aplicaron: %',v_quote;
    END IF;

    -- Se normalizan acentos, mayúsculas y espacios repetidos igual que en navegador.
    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
      '  MEDELLIN  '
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR v_quote->>'destination_status' IS DISTINCT FROM 'matched_city'
       OR v_quote->>'shipping_rule_id' IS DISTINCT FROM v_medellin_rule_id::text
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 18000 THEN
      RAISE EXCEPTION 'TEST FAILED: no se normalizó Medellín sin tilde: %',v_quote;
    END IF;

    v_result:=public.admin_save_storefront_shipping_rule(
      NULL,'city','TEST-SAOPAULO-'||v_tag,ARRAY['São Paulo'],11000,NULL,0,true
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se creó la regla Unicode sintética: %',v_result; END IF;
    v_unicode_rule_id:=(v_result->>'rule_id')::uuid;
    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
      'Sao Paulo'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR v_quote->>'destination_status' IS DISTINCT FROM 'matched_city'
       OR v_quote->>'shipping_rule_id' IS DISTINCT FROM v_unicode_rule_id::text
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 11000 THEN
      RAISE EXCEPTION 'TEST FAILED: no se normalizó el acento Unicode de São: %',v_quote;
    END IF;

    -- Los alias vigentes de Cali conservan prioridad absoluta y no se cobran.
    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
      'Santiago de Cali'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR v_quote->>'destination_status' IS DISTINCT FROM 'cali_free'
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'TEST FAILED: Cali debe seguir gratis: %',v_quote;
    END IF;

    -- Un destino sin regla usa el fallback general actual, incluido su umbral.
    v_expected_fallback:=CASE
      WHEN v_original_threshold IS NOT NULL AND 100000>=v_original_threshold THEN 0
      ELSE v_original_fee
    END;
    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
      'Ciudad Sin Regla '||v_tag
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR v_quote->>'destination_status' IS DISTINCT FROM 'fallback'
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM v_expected_fallback THEN
      RAISE EXCEPTION 'TEST FAILED: la ciudad sin regla no usa el fallback: %',v_quote;
    END IF;
    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),''
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'TEST FAILED: ciudad vacía recibió una cotización de envío: %',v_quote;
    END IF;

    -- Una ciudad no puede tener dos reglas city activas tras normalizar alias.
    BEGIN
      PERFORM public.admin_save_storefront_shipping_rule(
        NULL,'city','TEST-DUPLICATE-'||v_tag,ARRAY['BOGOTA'],1,NULL,0,true
      );
      RAISE EXCEPTION 'TEST FAILED: se permitió duplicar una ciudad normalizada';
    EXCEPTION WHEN SQLSTATE '23505' THEN
      RAISE NOTICE 'PASS: destino city duplicado rechazado.';
    END;

    -- Cali tampoco puede recibir una regla de cobro personalizada.
    BEGIN
      PERFORM public.admin_save_storefront_shipping_rule(
        NULL,'city','TEST-CALI-'||v_tag,ARRAY['Cali'],1,NULL,0,true
      );
      RAISE EXCEPTION 'TEST FAILED: se permitió cambiar la excepción gratuita de Cali';
    EXCEPTION WHEN SQLSTATE '22023' THEN
      RAISE NOTICE 'PASS: tarifa custom para Cali rechazada.';
    END;

    RAISE EXCEPTION USING ERRCODE='ZX701',MESSAGE='ROLLBACK_CITY_SHIPPING_TEST';
  EXCEPTION
    WHEN SQLSTATE 'ZX701' THEN
      IF SQLERRM<>'ROLLBACK_CITY_SHIPPING_TEST' THEN RAISE; END IF;
      RAISE NOTICE 'PASS: reglas por ciudad/zona, precedencia, normalización, Cali, fallback y validaciones.';
  END;

  IF EXISTS(SELECT 1 FROM public.products WHERE id=v_product_id LIMIT 1) THEN
    RAISE EXCEPTION 'TEST FAILED: quedó un producto sintético después del rollback';
  END IF;
  IF EXISTS(SELECT 1 FROM public.storefront_shipping_rules WHERE id IN (v_zone_rule_id,v_zone_tie_rule_id,v_city_rule_id,v_medellin_rule_id) LIMIT 1) THEN
    RAISE EXCEPTION 'TEST FAILED: quedaron reglas sintéticas después del rollback';
  END IF;
  IF EXISTS(SELECT 1 FROM public.storefront_shipping_rules WHERE id=v_unicode_rule_id LIMIT 1) THEN
    RAISE EXCEPTION 'TEST FAILED: quedó una regla Unicode sintética después del rollback';
  END IF;
  IF EXISTS(SELECT 1 FROM public.storefront_shipping_rule_destinations WHERE rule_id IN (v_zone_rule_id,v_zone_tie_rule_id,v_city_rule_id,v_medellin_rule_id,v_unicode_rule_id) LIMIT 1) THEN
    RAISE EXCEPTION 'TEST FAILED: quedaron destinos sintéticos después del rollback';
  END IF;
  IF EXISTS(SELECT 1 FROM public.web_orders WHERE client_reference=v_client_reference LIMIT 1) THEN
    RAISE EXCEPTION 'TEST FAILED: quedó un pedido COD sintético después del rollback';
  END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_reservations WHERE reference=v_inventory_reference LIMIT 1) THEN
    RAISE EXCEPTION 'TEST FAILED: quedó una reserva COD sintética después del rollback';
  END IF;
  SELECT enabled,allowed_cities INTO v_cod_enabled_after,v_cod_cities_after
    FROM public.storefront_cod_settings WHERE id=1 LIMIT 1;
  IF v_cod_enabled_after IS DISTINCT FROM v_cod_enabled OR v_cod_cities_after IS DISTINCT FROM v_cod_cities THEN
    RAISE EXCEPTION 'TEST FAILED: el rollback no restauró la configuración COD original';
  END IF;
  RAISE NOTICE 'PASS: rollback confirmado; no quedan productos, reglas, destinos, pedidos ni reservas sintéticas.';
END
$shipping_city_rules_test$;
