-- REGRESIÓN DE PROMOCIONES/ENVÍO: ejecutar tras migraciones city/zone y combos/calendario.
-- Inserta productos, combos y reglas city/zone sintéticas dentro de una transacción revertida.
-- No crea pedidos ni reservas, no modifica tarifas generales ni pagos/datos históricos.
BEGIN;

DO $promotion_priority_test$
DECLARE
  v_admin uuid;
  v_tag text;
  v_product_a uuid;
  v_product_b uuid;
  v_sale_price_product uuid;
  v_high_priority_combo uuid;
  v_legacy_combo uuid;
  v_city_rule_id uuid;
  v_zone_rule_id uuid;
  v_quote jsonb;
  v_quote_definition text;
  v_saved jsonb;
  v_line_discount numeric;
  v_calendar_priority integer;
  v_time_zone text;
BEGIN
  SELECT admin_user_id INTO v_admin FROM public.store_settings WHERE id=1 LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'TEST FAILED: falta administrador de tienda'; END IF;

  IF has_function_privilege('anon','public.get_public_storefront_product_combos_v2()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.get_public_storefront_product_combos_v2()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.get_storefront_cart_quote(jsonb,text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('authenticated','public.get_storefront_cart_quote(jsonb,text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.get_storefront_cart_quote(jsonb,text)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: RPC público de combos o cotización no es ejecutable por anon';
  END IF;
  SELECT pg_get_functiondef('public.get_storefront_cart_quote(jsonb,text)'::regprocedure)
    INTO v_quote_definition;
  IF position('sale_price IS NULL' IN v_quote_definition)=0 THEN
    RAISE EXCEPTION 'TEST FAILED: la RPC instalada debe rechazar productos sin precio antes de cotizar';
  END IF;
  IF has_function_privilege('public','public.admin_list_storefront_product_combos_v2()','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('anon','public.admin_list_storefront_product_combos_v2()','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('anon','public.admin_save_storefront_product_combo_v2(uuid,text,uuid,uuid,text,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone,text,numeric,numeric,text,text,integer,text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.admin_list_storefront_product_combos_v2()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('authenticated','public.admin_save_storefront_product_combo_v2(uuid,text,uuid,uuid,text,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone,text,numeric,numeric,text,text,integer,text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.admin_list_storefront_product_combos_v2()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.admin_save_storefront_product_combo_v2(uuid,text,uuid,uuid,text,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone,text,numeric,numeric,text,text,integer,text)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: grants de RPC administrativos de campañas no son mínimos';
  END IF;

  v_tag:=replace(gen_random_uuid()::text,'-','');
  BEGIN
    INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
    VALUES(v_admin,'TEST-NULL-PRICE-'||substr(v_tag,1,20),'Precio faltante','__test_null_price_'||substr(v_tag,1,12),1,0,NULL)
    RETURNING id INTO v_sale_price_product;
  EXCEPTION WHEN not_null_violation OR check_violation THEN
    v_sale_price_product:=NULL;
  END;
  IF v_sale_price_product IS NOT NULL THEN
    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(jsonb_build_object('id',v_sale_price_product,'qty',1)),
      'Bogotá'
    ) INTO v_quote;
    IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM false
       OR coalesce(v_quote->>'message','') NOT ILIKE '%precio%' THEN
      RAISE EXCEPTION 'TEST FAILED: la cotización no rechazó un sale_price NULL.';
    END IF;
  END IF;
  BEGIN
    INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
    VALUES(v_admin,'TEST-CAL-A-'||substr(v_tag,1,20),'Prueba calendario A','__test_cal_'||substr(v_tag,1,12),2,0,100000)
    RETURNING id INTO v_product_a;
    INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
    VALUES(v_admin,'TEST-CAL-B-'||substr(v_tag,1,20),'Prueba calendario B','__test_cal_'||substr(v_tag,1,12),2,0,100000)
    RETURNING id INTO v_product_b;

    PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
    SELECT public.admin_save_storefront_product_combo_v2(
      NULL,'product_pair',v_product_a,v_product_b,NULL,NULL,
      'TEST-CAL-PRIORITY-'||substr(v_tag,1,12),'Prueba de prioridad','Ver',true,
      NULL,NULL,'fixed_amount',7000,NULL,'home',NULL,1000,'America/Bogota'
    ) INTO v_saved;
    v_high_priority_combo:=nullif(v_saved->>'id','')::uuid;
    IF v_high_priority_combo IS NULL OR v_saved->>'enabled' IS DISTINCT FROM 'true'
       OR v_saved->>'priority' IS DISTINCT FROM '1000'
       OR v_saved->>'time_zone' IS DISTINCT FROM 'America/Bogota' THEN
      RAISE EXCEPTION 'TEST FAILED: RPC admin v2 no devolvió id/enabled/prioridad/zona esperados';
    END IF;

    -- El legacy es más antiguo, pero prioridad explícita debe ganar y consumir las unidades.
    INSERT INTO public.storefront_product_combos(
      product_a_id,product_b_id,title,message,button_label,enabled,discount_type,discount_value,
      priority,time_zone,created_at
    ) VALUES(
      v_product_a,v_product_b,'TEST-CAL-LEGACY-'||substr(v_tag,1,12),'Prueba de desempate','Ver',true,
      'fixed_amount',20000,0,'America/Bogota',now()-interval '1 day'
    ) RETURNING id INTO v_legacy_combo;

    INSERT INTO public.storefront_shipping_rules(
      scope,name,priority,shipping_cost,free_shipping_threshold,enabled
    ) VALUES (
      'zone','TEST-ZONE-'||substr(v_tag,1,12),100,28000,NULL,true
    ) RETURNING id INTO v_zone_rule_id;
    INSERT INTO public.storefront_shipping_rule_destinations(rule_id,destination,destination_key)
    VALUES(v_zone_rule_id,'Cartagena','cartagena');
    INSERT INTO public.storefront_shipping_rules(
      scope,name,priority,shipping_cost,free_shipping_threshold,enabled
    ) VALUES (
      'city','TEST-CITY-'||substr(v_tag,1,12),0,21000,195000,true
    ) RETURNING id INTO v_city_rule_id;
    INSERT INTO public.storefront_shipping_rule_destinations(rule_id,destination,destination_key)
    VALUES(v_city_rule_id,'Cartagena','cartagena');

    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(
        jsonb_build_object('id',v_product_a::text,'qty',1,'color','','size',''),
        jsonb_build_object('id',v_product_b::text,'qty',1,'color','','size','')
      ),'Cali'
    ) INTO v_quote;

    SELECT coalesce(sum((line->>'discount_total')::numeric),0)
      INTO v_line_discount
      FROM jsonb_array_elements(coalesce(v_quote->'items','[]'::jsonb)) AS lines(line);

    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR (v_quote->>'original_subtotal')::numeric IS DISTINCT FROM 200000
       OR (v_quote->>'discount_total')::numeric IS DISTINCT FROM 7000
       OR (v_quote->>'discounted_subtotal')::numeric IS DISTINCT FROM 193000
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 0
       OR (v_quote->>'total')::numeric IS DISTINCT FROM 193000
       OR v_line_discount IS DISTINCT FROM 7000
       OR jsonb_array_length(coalesce(v_quote->'discounts','[]'::jsonb)) IS DISTINCT FROM 1
       OR v_quote#>>'{discounts,0,id}' IS DISTINCT FROM v_high_priority_combo::text THEN
      RAISE EXCEPTION 'TEST FAILED: prioridad, consumo único por unidades o paridad de línea: %',v_quote;
    END IF;

    -- Una regla de ciudad gana a una zona con prioridad mayor; el umbral usa $193.000 netos, no $200.000 brutos.
    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(
        jsonb_build_object('id',v_product_a::text,'qty',1,'color','','size',''),
        jsonb_build_object('id',v_product_b::text,'qty',1,'color','','size','')
      ),'Cartagena'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR v_quote->>'normalized_city' IS DISTINCT FROM 'cartagena'
       OR v_quote->>'destination_status' IS DISTINCT FROM 'matched_city'
       OR v_quote->>'shipping_rule_scope' IS DISTINCT FROM 'city'
       OR v_quote->>'shipping_rule_name' IS DISTINCT FROM 'TEST-CITY-'||substr(v_tag,1,12)
       OR (v_quote->>'shipping_rule_cost')::numeric IS DISTINCT FROM 21000
       OR (v_quote->>'shipping_rule_threshold')::numeric IS DISTINCT FROM 195000
       OR (v_quote->>'discounted_subtotal')::numeric IS DISTINCT FROM 193000
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 21000
       OR (v_quote->>'total')::numeric IS DISTINCT FROM 214000 THEN
      RAISE EXCEPTION 'TEST FAILED: prioridad ciudad/zona o umbral posdescuento no se conservó: %',v_quote;
    END IF;

    SELECT priority,time_zone INTO v_calendar_priority,v_time_zone
      FROM public.get_public_storefront_product_combos_v2() WHERE id=v_high_priority_combo LIMIT 1;
    IF v_calendar_priority IS DISTINCT FROM 1000 OR v_time_zone IS DISTINCT FROM 'America/Bogota' THEN
      RAISE EXCEPTION 'TEST FAILED: salida pública del calendario difiere de la regla guardada';
    END IF;
    IF v_legacy_combo IS NULL THEN RAISE EXCEPTION 'TEST FAILED: no se creó la regla legacy sintética'; END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED: %',SQLERRM;
  END;
END $promotion_priority_test$;

ROLLBACK;
