-- REGRESIÓN DE ENVÍOS: ejecutar tras las migraciones 60000/60100.
-- Productos, combos y cambios de configuración viven en un sub-bloque con rollback.
-- No crea pedidos ni reservas; falla el SQL ante cualquier resultado incompleto.
DO $shipping_config_test$
DECLARE
  v_admin uuid;
  v_fake uuid;
  v_category text;
  v_tag text;
  v_client_reference text;
  v_id_below_a uuid;
  v_id_below_b uuid;
  v_id_at_a uuid;
  v_id_at_b uuid;
  v_original_fee bigint;
  v_original_threshold bigint;
  v_after_fee bigint;
  v_after_threshold bigint;
  v_quote jsonb;
  v_cod_result jsonb;
  v_admin_result jsonb;
  v_guard_result jsonb;
BEGIN
  SELECT admin_user_id INTO v_admin FROM public.store_settings WHERE id=1 LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'TEST FAILED: falta administrador de tienda'; END IF;
  SELECT national_shipping_cost,free_shipping_threshold
    INTO v_original_fee,v_original_threshold
    FROM public.storefront_shipping_settings WHERE id=1 LIMIT 1;
  IF v_original_fee IS NULL THEN RAISE EXCEPTION 'TEST FAILED: falta la fila de configuración de envíos'; END IF;

  IF has_function_privilege('anon','public.get_storefront_cart_quote(jsonb,text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.get_storefront_cart_quote(jsonb,text)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: la cotización no está concedida a anon y service_role';
  END IF;
  IF has_function_privilege('anon','public.admin_save_storefront_shipping_settings(bigint,bigint)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('public','public.admin_save_storefront_shipping_settings(bigint,bigint)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.admin_save_storefront_shipping_settings(bigint,bigint)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.admin_save_storefront_shipping_settings(bigint,bigint)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: grants del editor de envío no son mínimos';
  END IF;
  IF has_function_privilege('anon','public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: la RPC COD con guard debe estar accesible para checkout';
  END IF;

  v_tag:=replace(gen_random_uuid()::text,'-','');
  v_client_reference:='TEST-SHIP-COD-'||v_tag;
  BEGIN
    v_category := '__shipping_test_' || v_tag;
    INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
    VALUES (v_admin,'TEST-SHIP-'||substr(v_tag,1,20),'Prueba envío bajo A',v_category,1,0,100000)
    RETURNING id INTO v_id_below_a;
    INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
    VALUES (v_admin,'TEST-SHIP-'||substr(v_tag,1,20)||'B','Prueba envío bajo B',v_category,1,0,99999)
    RETURNING id INTO v_id_below_b;
    INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
    VALUES (v_admin,'TEST-SHIP-'||substr(v_tag,1,20)||'C','Prueba envío umbral A',v_category,1,0,100000)
    RETURNING id INTO v_id_at_a;
    INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
    VALUES (v_admin,'TEST-SHIP-'||substr(v_tag,1,20)||'D','Prueba envío umbral B',v_category,1,0,100000)
    RETURNING id INTO v_id_at_b;

    INSERT INTO public.storefront_product_combos(product_a_id,product_b_id,title,enabled,rule_type,discount_type,discount_value)
    VALUES (v_id_below_a,v_id_below_b,'TEST-SHIPPING-BELOW-'||v_tag,true,'product_pair','fixed_amount',50000);
    INSERT INTO public.storefront_product_combos(product_a_id,product_b_id,title,enabled,rule_type,discount_type,discount_value)
    VALUES (v_id_at_a,v_id_at_b,'TEST-SHIPPING-AT-'||v_tag,true,'product_pair','fixed_amount',50000);

    UPDATE public.storefront_shipping_settings
       SET national_shipping_cost=17500,free_shipping_threshold=150000
     WHERE id=1;

    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(
        jsonb_build_object('id',v_id_below_a::text,'qty',1,'color','','size',''),
        jsonb_build_object('id',v_id_below_b::text,'qty',1,'color','','size','')
      ),'Bogotá'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR (v_quote->>'original_subtotal')::numeric IS DISTINCT FROM 199999
       OR (v_quote->>'discount_total')::numeric IS DISTINCT FROM 50000
       OR (v_quote->>'discounted_subtotal')::numeric IS DISTINCT FROM 149999
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 17500
       OR (v_quote->>'total')::numeric IS DISTINCT FROM 167499 THEN
      RAISE EXCEPTION 'TEST FAILED: tarifa calculada después del descuento, debajo del mínimo: %',v_quote;
    END IF;

    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(
        jsonb_build_object('id',v_id_at_a::text,'qty',1,'color','','size',''),
        jsonb_build_object('id',v_id_at_b::text,'qty',1,'color','','size','')
      ),'Bogotá'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR (v_quote->>'original_subtotal')::numeric IS DISTINCT FROM 200000
       OR (v_quote->>'discount_total')::numeric IS DISTINCT FROM 50000
       OR (v_quote->>'discounted_subtotal')::numeric IS DISTINCT FROM 150000
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 0
       OR (v_quote->>'total')::numeric IS DISTINCT FROM 150000 THEN
      RAISE EXCEPTION 'TEST FAILED: envío gratis en el umbral después del descuento: %',v_quote;
    END IF;

    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(
        jsonb_build_object('id',v_id_below_a::text,'qty',1,'color','','size',''),
        jsonb_build_object('id',v_id_below_b::text,'qty',1,'color','','size','')
      ),'Santiago de Cali'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true' OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'TEST FAILED: alias de Cali debe conservar envío gratis: %',v_quote;
    END IF;

    UPDATE public.storefront_shipping_settings SET free_shipping_threshold=NULL WHERE id=1;
    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(
        jsonb_build_object('id',v_id_at_a::text,'qty',1,'color','','size',''),
        jsonb_build_object('id',v_id_at_b::text,'qty',1,'color','','size','')
      ),'Bogotá'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true' OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 17500 THEN
      RAISE EXCEPTION 'TEST FAILED: desactivar el mínimo debe cobrar la tarifa nacional: %',v_quote;
    END IF;

    -- La RPC permite al administrador, pero el mismo intento de un uid ajeno falla
    -- antes de tocar la fila; solo se simula identidad, no se inserta un usuario.
    PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
    v_admin_result:=public.admin_save_storefront_shipping_settings(17500,150000);
    IF v_admin_result->>'success' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: el administrador no puede guardar: %',v_admin_result;
    END IF;
    v_fake:=gen_random_uuid();
    PERFORM set_config('request.jwt.claim.sub',v_fake::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_fake,'role','authenticated')::text,true);
    v_guard_result:=public.admin_save_storefront_shipping_settings(99999,1);
    IF v_guard_result->>'success' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'TEST FAILED: un uid ajeno pudo cambiar las tarifas: %',v_guard_result;
    END IF;
    SELECT national_shipping_cost,free_shipping_threshold
      INTO v_after_fee,v_after_threshold FROM public.storefront_shipping_settings WHERE id=1 LIMIT 1;
    IF v_after_fee IS DISTINCT FROM 17500 OR v_after_threshold IS DISTINCT FROM 150000 THEN
      RAISE EXCEPTION 'TEST FAILED: el rechazo no autorizado cambió la configuración';
    END IF;

    -- El total desactualizado se rechaza antes del wrapper COD y no crea pedido/reserva.
    v_cod_result:=public.create_contra_delivery_order_with_quote(
      v_client_reference,'Cliente sintético','TEST-ONLY','0000000000','test@example.invalid','Bogotá',
      'Dirección de prueba','Barrio de prueba',
      jsonb_build_array(
        jsonb_build_object('id',v_id_at_a::text,'qty',1,'color','','size',''),
        jsonb_build_object('id',v_id_at_b::text,'qty',1,'color','','size','')
      ),150001,50000
    );
    IF v_cod_result->>'success' IS DISTINCT FROM 'false' OR v_cod_result->>'quote_changed' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: COD debe rechazar total mostrado desactualizado antes de crear pedido: %',v_cod_result;
    END IF;

    RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='ROLLBACK_SHIPPING_CONFIG_TEST';
  EXCEPTION
    WHEN SQLSTATE 'ZX001' THEN
      IF SQLERRM<>'ROLLBACK_SHIPPING_CONFIG_TEST' THEN RAISE; END IF;
      RAISE NOTICE 'PASS: combos/descuento, umbral exacto, Cali gratis, mínimo desactivado, guard admin/RPC y rechazo COD por total desactualizado.';
  END;

  SELECT national_shipping_cost,free_shipping_threshold
    INTO v_after_fee,v_after_threshold FROM public.storefront_shipping_settings WHERE id=1 LIMIT 1;
  IF v_after_fee IS DISTINCT FROM v_original_fee OR v_after_threshold IS DISTINCT FROM v_original_threshold THEN
    RAISE EXCEPTION 'TEST FAILED: rollback no restauró la configuración original';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE category=v_category LIMIT 1) THEN
    RAISE EXCEPTION 'TEST FAILED: quedaron productos sintéticos después del rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.storefront_product_combos WHERE title IN ('TEST-SHIPPING-BELOW-'||v_tag,'TEST-SHIPPING-AT-'||v_tag) LIMIT 1) THEN
    RAISE EXCEPTION 'TEST FAILED: quedaron combos sintéticos después del rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.web_orders WHERE client_reference=v_client_reference LIMIT 1) THEN
    RAISE EXCEPTION 'TEST FAILED: quedó un pedido COD de la prueba';
  END IF;
  RAISE NOTICE 'PASS: rollback confirmado; configuración restaurada y sin productos, combos ni pedidos sintéticos.';
END;
$shipping_config_test$;
