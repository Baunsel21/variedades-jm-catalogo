BEGIN;
DO $city_shipping_local_test$
DECLARE
  v_admin uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_product_id uuid;
  v_cali_rule_id uuid;
  v_zone_rule_id uuid;
  v_city_rule_id uuid;
  v_quote jsonb;
  v_settings jsonb;
  v_result jsonb;
  v_alias text;
  v_list_count bigint;
  v_delete_result jsonb;
BEGIN
  IF has_function_privilege('anon','public.get_public_storefront_shipping_settings()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('authenticated','public.admin_list_storefront_shipping_rules()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.admin_list_storefront_shipping_rules()','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.admin_save_storefront_shipping_rule(uuid,text,text,text[],bigint,bigint,integer,boolean)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('anon','public.admin_delete_storefront_shipping_rule(uuid)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('anon','public.normalize_storefront_delivery_city(text)','EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED: grants de RPC/reglas no respetan el mínimo esperado';
  END IF;
  IF has_table_privilege('anon','public.storefront_shipping_rules','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('authenticated','public.storefront_shipping_rules','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('service_role','public.storefront_shipping_rules','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('anon','public.storefront_shipping_rule_destinations','SELECT') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED: las tablas de reglas son directamente legibles';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.storefront_shipping_rules'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.storefront_shipping_rule_destinations'::regclass) THEN
    RAISE EXCEPTION 'TEST FAILED: RLS no quedó habilitado en tablas de reglas';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
  VALUES(v_admin,'LOCAL-CITY-001','Producto sintético','Ropa',4,0,100000)
  RETURNING id INTO v_product_id;

  IF public.normalize_storefront_delivery_city('  São Paulo,  ') IS DISTINCT FROM 'sao paulo' THEN
    RAISE EXCEPTION 'TEST FAILED: normalización Unicode o espacios';
  END IF;

  SELECT public.get_storefront_cart_quote(
    jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
    'Santiago de Cali'
  ) INTO v_quote;
  IF v_quote->>'success' IS DISTINCT FROM 'true'
     OR v_quote->>'destination_status' IS DISTINCT FROM 'cali_free'
     OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED: Cali no tiene envío gratis por defecto: %',v_quote;
  END IF;
  SELECT public.get_public_storefront_shipping_settings() INTO v_settings;
  IF (v_settings->>'free_shipping_in_cali')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: el estado público no refleja Cali gratis: %',v_settings;
  END IF;

  v_result:=public.admin_save_storefront_shipping_rule(
    NULL,'city','LOCAL-CALI',ARRAY['Cali'],18000,NULL,0,true
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'No se guardó la tarifa local de Cali: %',v_result;
  END IF;
  v_cali_rule_id:=(v_result->>'rule_id')::uuid;
  SELECT count(*) INTO v_list_count
    FROM public.admin_list_storefront_shipping_rules() AS r
   WHERE r.id=v_cali_rule_id AND r.scope='city' AND r.name='LOCAL-CALI'
     AND r.shipping_cost=18000 AND r.enabled AND r.destinations @> ARRAY['Cali']::text[];
  IF v_list_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED: el admin no recargó la regla Cali recién guardada';
  END IF;
  SELECT public.get_public_storefront_shipping_settings() INTO v_settings;
  IF (v_settings->>'free_shipping_in_cali')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED: el estado público afirma gratis con una regla paga: %',v_settings;
  END IF;
  FOREACH v_alias IN ARRAY ARRAY['Cali','Santiago de Cali','Cali Valle del Cauca'] LOOP
    SELECT public.get_storefront_cart_quote(
      jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
      v_alias
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR v_quote->>'destination_status' IS DISTINCT FROM 'matched_city'
       OR v_quote->>'shipping_rule_id' IS DISTINCT FROM v_cali_rule_id::text
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 18000 THEN
      RAISE EXCEPTION 'TEST FAILED: alias de Cali no usa la tarifa paga: %, %',v_alias,v_quote;
    END IF;
  END LOOP;

  BEGIN
    PERFORM public.admin_save_storefront_shipping_rule(
      NULL,'city','LOCAL-DUPLICATE-CALI',ARRAY['Santiago de Cali'],9000,NULL,0,true
    );
    RAISE EXCEPTION 'TEST FAILED: se permitió una segunda regla activa de Cali';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: alias duplicado de Cali rechazado.';
  END;
  BEGIN
    PERFORM public.admin_save_storefront_shipping_rule(
      NULL,'zone','LOCAL-ZONE-CALI',ARRAY['Cali','Palmira'],9000,NULL,0,true
    );
    RAISE EXCEPTION 'TEST FAILED: Cali fue admitida dentro de una zona';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    RAISE NOTICE 'PASS: Cali solo admite regla city explícita.';
  END;

  v_result:=public.admin_save_storefront_shipping_rule(
    v_cali_rule_id,'city','LOCAL-CALI-EDITED',ARRAY['Cali'],22000,150000,10,true
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se pudo editar tarifa/nombre de Cali: %',v_result; END IF;
  SELECT count(*) INTO v_list_count
    FROM public.admin_list_storefront_shipping_rules() AS r
   WHERE r.id=v_cali_rule_id AND r.name='LOCAL-CALI-EDITED' AND r.shipping_cost=22000
     AND r.free_shipping_threshold=150000 AND r.priority=10 AND r.enabled;
  IF v_list_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST FAILED: el admin no recargó los cambios de Cali'; END IF;
  SELECT public.get_storefront_cart_quote(
    jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
    'Cali'
  ) INTO v_quote;
  IF v_quote->>'shipping_rule_id' IS DISTINCT FROM v_cali_rule_id::text
     OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 22000 THEN
    RAISE EXCEPTION 'TEST FAILED: la tarifa editada de Cali no llegó a la cotización: %',v_quote;
  END IF;

  v_result:=public.admin_save_storefront_shipping_rule(
    v_cali_rule_id,'city','LOCAL-CALI-EDITED',ARRAY['Cali'],22000,50000,10,true
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se pudo editar umbral de Cali: %',v_result; END IF;
  SELECT public.get_storefront_cart_quote(
    jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
    'Cali Valle del Cauca'
  ) INTO v_quote;
  IF (v_quote->>'shipping')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED: umbral configurado no vuelve gratis la tarifa: %',v_quote;
  END IF;

  v_result:=public.admin_save_storefront_shipping_rule(
    v_cali_rule_id,'city','LOCAL-CALI-EDITED',ARRAY['Cali'],22000,NULL,10,false
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se pudo desactivar regla Cali: %',v_result; END IF;
  SELECT count(*) INTO v_list_count FROM public.admin_list_storefront_shipping_rules() AS r
   WHERE r.id=v_cali_rule_id AND NOT r.enabled;
  IF v_list_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST FAILED: el admin no recargó la regla desactivada'; END IF;
  SELECT public.get_storefront_cart_quote(
    jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),'Cali'
  ) INTO v_quote;
  IF v_quote->>'destination_status' IS DISTINCT FROM 'cali_free'
     OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED: una regla desactivada sigue afectando Cali: %',v_quote;
  END IF;
  v_result:=public.admin_save_storefront_shipping_rule(
    v_cali_rule_id,'city','LOCAL-CALI-EDITED',ARRAY['Cali'],22000,NULL,10,true
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se pudo reactivar regla Cali: %',v_result; END IF;
  SELECT public.get_storefront_cart_quote(
    jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),'Cali'
  ) INTO v_quote;
  IF v_quote->>'destination_status' IS DISTINCT FROM 'matched_city'
     OR (v_quote->>'shipping_rule_id') IS DISTINCT FROM v_cali_rule_id::text
     OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 22000 THEN
    RAISE EXCEPTION 'TEST FAILED: la regla reactivada no llegó a la cotización: %',v_quote;
  END IF;

  v_result:=public.admin_save_storefront_shipping_rule(
    NULL,'zone','LOCAL-ZONE-BOGOTA-CHIA',ARRAY['Bogotá','Chía'],14000,NULL,100,true
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se guardó zona local: %',v_result; END IF;
  v_zone_rule_id:=(v_result->>'rule_id')::uuid;
  v_result:=public.admin_save_storefront_shipping_rule(
    v_zone_rule_id,'zone','LOCAL-ZONE-BOGOTA-CHIA-EDITED',ARRAY['Bogotá','Chía'],16000,NULL,110,true
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se pudo editar zona local: %',v_result; END IF;
  SELECT count(*) INTO v_list_count FROM public.admin_list_storefront_shipping_rules() AS r
   WHERE r.id=v_zone_rule_id AND r.scope='zone' AND r.name='LOCAL-ZONE-BOGOTA-CHIA-EDITED'
     AND r.shipping_cost=16000 AND r.priority=110 AND r.enabled
     AND r.destinations @> ARRAY['Bogotá','Chía']::text[];
  IF v_list_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST FAILED: el admin no recargó los cambios de zona'; END IF;
  v_result:=public.admin_save_storefront_shipping_rule(
    NULL,'city','LOCAL-CITY-BOGOTA',ARRAY['Bogotá'],25000,NULL,0,true
  );
  IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se guardó ciudad local: %',v_result; END IF;
  v_city_rule_id:=(v_result->>'rule_id')::uuid;
  SELECT public.get_storefront_cart_quote(
    jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
    'Bogotá'
  ) INTO v_quote;
  IF v_quote->>'shipping_rule_id' IS DISTINCT FROM v_city_rule_id::text
     OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 25000 THEN
    RAISE EXCEPTION 'TEST FAILED: la regla city no prevalece sobre la zona: %',v_quote;
  END IF;
  SELECT public.get_storefront_cart_quote(
    jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
    'Chía'
  ) INTO v_quote;
  IF v_quote->>'shipping_rule_id' IS DISTINCT FROM v_zone_rule_id::text
     OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 16000 THEN
    RAISE EXCEPTION 'TEST FAILED: la regla de zona no se aplicó: %',v_quote;
  END IF;
  SELECT public.get_storefront_cart_quote(
    jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),
    'Ciudad Sin Regla'
  ) INTO v_quote;
  IF v_quote->>'destination_status' IS DISTINCT FROM 'fallback'
     OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 15000 THEN
    RAISE EXCEPTION 'TEST FAILED: la ciudad sin regla no usa tarifa nacional: %',v_quote;
  END IF;

  PERFORM set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  BEGIN
    PERFORM public.admin_save_storefront_shipping_rule(
      NULL,'city','LOCAL-UNAUTHORIZED',ARRAY['Palmira'],1,NULL,0,true
    );
    RAISE EXCEPTION 'TEST FAILED: usuario no admin pudo modificar reglas';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: edición restringida al administrador.';
  END;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  v_delete_result:=public.admin_delete_storefront_shipping_rule(v_cali_rule_id);
  IF v_delete_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se pudo eliminar la regla Cali sintética: %',v_delete_result; END IF;
  SELECT count(*) INTO v_list_count FROM public.admin_list_storefront_shipping_rules() AS r WHERE r.id=v_cali_rule_id;
  IF v_list_count IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'TEST FAILED: la regla Cali eliminada reapareció al recargar'; END IF;
  SELECT public.get_storefront_cart_quote(
    jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),'Cali'
  ) INTO v_quote;
  IF v_quote->>'destination_status' IS DISTINCT FROM 'cali_free'
     OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED: Cali no volvió al fallback después de eliminar la regla: %',v_quote;
  END IF;

  v_delete_result:=public.admin_delete_storefront_shipping_rule(v_zone_rule_id);
  IF v_delete_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se pudo eliminar la zona sintética: %',v_delete_result; END IF;
  SELECT count(*) INTO v_list_count FROM public.admin_list_storefront_shipping_rules() AS r WHERE r.id=v_zone_rule_id;
  IF v_list_count IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'TEST FAILED: la zona eliminada reapareció al recargar'; END IF;
  SELECT public.get_storefront_cart_quote(
    jsonb_build_array(jsonb_build_object('id',v_product_id::text,'qty',1,'color','','size','')),'Chía'
  ) INTO v_quote;
  IF v_quote->>'destination_status' IS DISTINCT FROM 'fallback'
     OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 15000 THEN
    RAISE EXCEPTION 'TEST FAILED: la zona eliminada no volvió al fallback: %',v_quote;
  END IF;

  RAISE NOTICE 'PASS: CRUD aislado create/list/edit/disable/enable/delete para city/zone, cotización, fallbacks, permisos y RLS.';
END
$city_shipping_local_test$;
ROLLBACK;
