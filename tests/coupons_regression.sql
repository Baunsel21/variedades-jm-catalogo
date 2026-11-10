-- REGRESIÓN DE CUPONES: ejecutar solo en un proyecto aislado después de 20261109120000.
-- Todo fixture queda dentro de BEGIN/ROLLBACK; no hace pagos ni conserva pedidos,
-- productos, combos, cupones, reservas ni cambios de configuración.
BEGIN;

DO $coupons_regression$
DECLARE
  v_admin uuid;
  v_fake uuid:=gen_random_uuid();
  v_tag text:=upper(replace(gen_random_uuid()::text,'-',''));
  v_product_a uuid;
  v_product_b uuid;
  v_product_zero uuid;
  v_combo_id uuid;
  v_city_rule_id uuid;
  v_percent_id uuid;
  v_fixed_id uuid;
  v_minimum_id uuid;
  v_future_id uuid;
  v_expired_id uuid;
  v_disabled_id uuid;
  v_limit_id uuid;
  v_late_id uuid;
  v_release_id uuid;
  v_cod_id uuid;
  v_cod_retry_code text;
  v_prepare_code text;
  v_prepare_reference text;
  v_prepare_quote jsonb;
  v_prepare_result jsonb;
  v_tampered_quote jsonb;
  v_tampered_reference text;
  v_percent_result jsonb;
  v_fixed_result jsonb;
  v_quote jsonb;
  v_retry jsonb;
  v_result jsonb;
  v_ledger_id uuid;
  v_order_id uuid;
  v_client_reference text;
  v_items jsonb;
  v_pending_list jsonb;
  v_test_phone text;
  v_pending_reference text;
  v_linked_reference text;
  v_inventory_reference text;
  v_stock_before integer;
  v_stock_after integer;
  v_line_discount numeric;
  v_line_coupon numeric;
  v_line_net numeric;
  v_original_fee bigint;
  v_original_threshold bigint;
  v_n integer;
  v_count integer;
  v_data_type text;
  v_status text;
  v_reconciliation boolean;
BEGIN
  SELECT s.admin_user_id INTO v_admin FROM public.store_settings AS s WHERE s.id=1 LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'TEST FAILED: falta administrador de tienda'; END IF;
  SELECT s.national_shipping_cost,s.free_shipping_threshold
    INTO v_original_fee,v_original_threshold
    FROM public.storefront_shipping_settings AS s WHERE s.id=1 LIMIT 1;
  IF v_original_fee IS NULL THEN RAISE EXCEPTION 'TEST FAILED: falta configuración general de envíos'; END IF;

  -- ACL de tablas y funciones: el ledger/PII no es consultable directamente.
  IF has_table_privilege('public','public.storefront_coupons','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('anon','public.storefront_coupons','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('authenticated','public.storefront_coupons','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('service_role','public.storefront_coupons','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('public','public.storefront_coupon_redemptions','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('anon','public.storefront_coupon_redemptions','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('authenticated','public.storefront_coupon_redemptions','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('service_role','public.storefront_coupon_redemptions','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('public','public.storefront_wompi_checkout_locks','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('anon','public.storefront_wompi_checkout_locks','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('authenticated','public.storefront_wompi_checkout_locks','SELECT') IS DISTINCT FROM false
     OR has_table_privilege('service_role','public.storefront_wompi_checkout_locks','SELECT') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED: ACL directo de tablas de cupones no está revocado';
  END IF;
  IF has_function_privilege('anon','public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('authenticated','public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.create_contra_delivery_order_with_coupon(text,text,text,text,text,text,text,text,jsonb,text,numeric,numeric,numeric)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('authenticated','public.create_contra_delivery_order_with_coupon(text,text,text,text,text,text,text,text,jsonb,text,numeric,numeric,numeric)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.reserve_storefront_coupon_redemption(text,text,text,text,text,bigint,timestamptz)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.reserve_storefront_coupon_redemption(text,text,text,text,text,bigint,timestamptz)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.reserve_storefront_coupon_redemption(text,text,text,text,text,bigint,timestamptz)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.confirm_storefront_coupon_redemption(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.confirm_storefront_coupon_redemption(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.confirm_storefront_coupon_redemption(text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.release_storefront_coupon_redemption(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.release_storefront_coupon_redemption(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.release_storefront_coupon_redemption(text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.reserve_storefront_wompi_checkout_lock(text,text,text,integer)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.reserve_storefront_wompi_checkout_lock(text,text,text,integer)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.reserve_storefront_wompi_checkout_lock(text,text,text,integer)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.claim_storefront_wompi_checkout(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.claim_storefront_wompi_checkout(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.claim_storefront_wompi_checkout(text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.set_storefront_wompi_checkout_state(text,text,text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.set_storefront_wompi_checkout_state(text,text,text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.set_storefront_wompi_checkout_state(text,text,text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.expire_storefront_coupon_redemption(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.expire_storefront_coupon_redemption(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.expire_storefront_coupon_redemption(text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.reserve_order_inventory(text,jsonb,integer)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.reserve_order_inventory(text,jsonb,integer)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.reserve_order_inventory(text,jsonb,integer)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.confirm_inventory_reservation(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.confirm_inventory_reservation(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.confirm_inventory_reservation(text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.finalize_inventory_reservation(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.finalize_inventory_reservation(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.finalize_inventory_reservation(text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.prepare_storefront_wompi_checkout(text,jsonb,text,text,text,text,jsonb)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.prepare_storefront_wompi_checkout(text,jsonb,text,text,text,text,jsonb)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.prepare_storefront_wompi_checkout(text,jsonb,text,text,text,text,jsonb)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.list_pending_wompi_orders_for_phone(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.list_pending_wompi_orders_for_phone(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.list_pending_wompi_orders_for_phone(text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.mark_storefront_wompi_reconciliation(text,text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.mark_storefront_wompi_reconciliation(text,text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.mark_storefront_wompi_reconciliation(text,text)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: grants públicos/service_role de cupones no son mínimos';
  END IF;
  IF has_function_privilege('public','public.admin_list_storefront_coupons()','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('anon','public.admin_list_storefront_coupons()','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.admin_list_storefront_coupons()','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.admin_list_storefront_coupons()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('public','public.admin_save_storefront_coupon(uuid,text,text,bigint,bigint,integer,integer,timestamptz,timestamptz,boolean)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('anon','public.admin_save_storefront_coupon(uuid,text,text,bigint,bigint,integer,integer,timestamptz,timestamptz,boolean)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.admin_save_storefront_coupon(uuid,text,text,bigint,bigint,integer,integer,timestamptz,timestamptz,boolean)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.admin_save_storefront_coupon(uuid,text,text,bigint,bigint,integer,integer,timestamptz,timestamptz,boolean)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: grants del administrador de cupones no son mínimos';
  END IF;
  IF has_function_privilege('public','public._storefront_coupon_normalized_phone(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('anon','public._storefront_coupon_normalized_phone(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public._storefront_coupon_normalized_phone(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public._storefront_coupon_normalized_phone(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('public','public._storefront_coupon_customer_hash(text,text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('anon','public._storefront_coupon_customer_hash(text,text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public._storefront_coupon_customer_hash(text,text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public._storefront_coupon_customer_hash(text,text)','EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED: normalizador/hash del cliente no son privados';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='orders'
       AND column_name='coupon_reconciliation_required'
       AND data_type='boolean' AND is_nullable='NO'
       AND column_default='false'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: orders.coupon_reconciliation_required debe ser boolean NOT NULL DEFAULT false';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='orders'
       AND column_name='wompi_reconciliation_required'
       AND data_type='boolean' AND is_nullable='NO'
       AND column_default='false'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: orders.wompi_reconciliation_required debe ser boolean NOT NULL DEFAULT false';
  END IF;
  v_result:=public.list_pending_wompi_orders_for_phone('+57 (300) 123-4567');
  IF v_result->>'success' IS DISTINCT FROM 'true' OR jsonb_typeof(v_result->'orders') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'TEST FAILED: el RPC privado no devolvió una lista de pedidos pendientes';
  END IF;
  v_retry:=public.list_pending_wompi_orders_for_phone('0057 300 123 4567');
  IF v_retry->>'success' IS DISTINCT FROM 'true' OR v_retry->'orders' IS DISTINCT FROM v_result->'orders' THEN
    RAISE EXCEPTION 'TEST FAILED: la consulta de pedidos pendientes no canonicaliza formatos equivalentes';
  END IF;
  v_retry:=public.list_pending_wompi_orders_for_phone('1');
  IF v_retry->>'success' IS DISTINCT FROM 'false' OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_PHONE_INVALID' THEN
    RAISE EXCEPTION 'TEST FAILED: el RPC aceptó un teléfono inválido';
  END IF;
  v_result:=public.release_storefront_coupon_redemption('WOMPI-NO-LEDGER-'||v_tag);
  IF v_result->>'success' IS DISTINCT FROM 'false' OR v_result->>'code' IS DISTINCT FROM 'COUPON_REDEMPTION_NOT_FOUND' THEN
    RAISE EXCEPTION 'TEST FAILED: release sin ledger no devolvió el código legacy esperado: %',v_result;
  END IF;
  IF public._storefront_coupon_customer_hash('buyer@example.test','3001234567')
       IS DISTINCT FROM public._storefront_coupon_customer_hash(' BUYER@example.test ','+57 (300) 123-4567')
     OR public._storefront_coupon_customer_hash('buyer@example.test','3001234567')
       IS DISTINCT FROM public._storefront_coupon_customer_hash('buyer@example.test','0057 300 123 4567') THEN
    RAISE EXCEPTION 'TEST FAILED: el email/teléfono normalizado no es estable entre formatos nacionales';
  END IF;

  SELECT data_type INTO v_data_type
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='orders' AND column_name='coupon_discount_total' LIMIT 1;
  IF v_data_type IS DISTINCT FROM 'bigint' THEN RAISE EXCEPTION 'TEST FAILED: orders.coupon_discount_total debe ser bigint'; END IF;
  SELECT data_type INTO v_data_type
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='web_orders' AND column_name='coupon_discount_total' LIMIT 1;
  IF v_data_type IS DISTINCT FROM 'numeric' THEN RAISE EXCEPTION 'TEST FAILED: web_orders.coupon_discount_total debe ser numeric'; END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_index AS i
      JOIN pg_class AS t ON t.oid=i.indrelid
      JOIN pg_namespace AS n ON n.oid=t.relnamespace
      JOIN pg_attribute AS a ON a.attrelid=t.oid AND a.attname='reference' AND a.attnum>0
     WHERE n.nspname='public' AND t.relname='orders'
       AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
       AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum
  ) THEN RAISE EXCEPTION 'TEST FAILED: orders.reference no tiene índice único'; END IF;
  IF to_regprocedure('public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: el wrapper COD legacy desapareció';
  END IF;

  -- El administrador puede normalizar trim/uppercase; un uid ajeno no puede guardarlo.
  PERFORM set_config('request.jwt.claim.sub',v_fake::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_fake,'role','authenticated')::text,true);
  BEGIN
    PERFORM public.admin_save_storefront_coupon(NULL,'UNAUTHORIZED-'||v_tag,'percent',10,0,NULL,NULL,NULL,NULL,true);
    RAISE EXCEPTION 'TEST FAILED: un usuario ajeno pudo guardar un cupón';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: admin_save_storefront_coupon rechaza uid no administrador.';
  END;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  v_fixed_result:=public.admin_save_storefront_coupon(
    NULL,'  fixed_5_'||substr(v_tag,1,8)||'  ','fixed_amount',5000,0,NULL,NULL,NULL,NULL,true
  );
  v_fixed_id:=nullif(v_fixed_result->>'id','')::uuid;
  IF v_fixed_result->>'success' IS DISTINCT FROM 'true'
     OR v_fixed_result->>'code' IS DISTINCT FROM upper('fixed_5_'||substr(v_tag,1,8))
     OR v_fixed_result->>'discount_type' IS DISTINCT FROM 'fixed_amount' THEN
    RAISE EXCEPTION 'TEST FAILED: trim/uppercase o fixed_amount no funcionan: %',v_fixed_result;
  END IF;

  BEGIN
    INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
    VALUES(v_admin,'TEST-COUPON-A-'||substr(v_tag,1,18),'Cupón producto A','__coupon_'||v_tag,4,0,60000)
    RETURNING id INTO v_product_a;
    INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
    VALUES(v_admin,'TEST-COUPON-B-'||substr(v_tag,1,18),'Cupón producto B','__coupon_'||v_tag,4,0,60000)
    RETURNING id INTO v_product_b;
    INSERT INTO public.products(user_id,code,name,category,quantity,cost_price,sale_price)
    VALUES(v_admin,'TEST-COUPON-ZERO-'||substr(v_tag,1,14),'Cupón producto cero','__coupon_'||v_tag,4,0,0)
    RETURNING id INTO v_product_zero;

    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,global_limit,per_customer_limit,
      starts_at,end_at,enabled
    ) VALUES (
      'PCT10_'||substr(v_tag,1,8),'percent',10,60000,2,1,NULL,NULL,true
    ) RETURNING id INTO v_percent_id;
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,global_limit,per_customer_limit,
      starts_at,end_at,enabled
    ) VALUES (
      'MINIMUM_'||substr(v_tag,1,8),'fixed_amount',5000,200000,NULL,NULL,NULL,NULL,true
    ) RETURNING id INTO v_minimum_id;
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,enabled
    ) VALUES (
      'FUTURE_'||substr(v_tag,1,8),'fixed_amount',5000,0, true
    ) RETURNING id INTO v_future_id;
    UPDATE public.storefront_coupons SET starts_at=now()+interval '1 day' WHERE id=v_future_id;
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,enabled
    ) VALUES (
      'EXPIRED_'||substr(v_tag,1,8),'fixed_amount',5000,0,true
    ) RETURNING id INTO v_expired_id;
    UPDATE public.storefront_coupons SET end_at=now()-interval '1 second' WHERE id=v_expired_id;
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,enabled
    ) VALUES (
      'DISABLED_'||substr(v_tag,1,8),'fixed_amount',5000,0,false
    ) RETURNING id INTO v_disabled_id;
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,enabled
    ) VALUES (
      'LIMIT1_'||substr(v_tag,1,8),'fixed_amount',5000,0,true
    ) RETURNING id INTO v_limit_id;
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,enabled
    ) VALUES (
      'LATE_'||substr(v_tag,1,8),'fixed_amount',5000,0,true
    ) RETURNING id INTO v_late_id;
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,enabled
    ) VALUES (
      'RELEASE_'||substr(v_tag,1,8),'fixed_amount',5000,0,true
    ) RETURNING id INTO v_release_id;
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,enabled
    ) VALUES (
      'COD5_'||substr(v_tag,1,8),'fixed_amount',5000,0,true
    ) RETURNING id INTO v_cod_id;
    v_cod_retry_code:='COD_RETRY_'||substr(v_tag,1,8);
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,enabled
    ) VALUES (
      v_cod_retry_code,'fixed_amount',5000,0,true
    );
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,enabled
    ) VALUES (
      'FULL_'||substr(v_tag,1,8),'fixed_amount',60000,0,true
    );
    v_prepare_code:='PREPARE_'||substr(v_tag,1,8);
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,enabled
    ) VALUES (
      v_prepare_code,'fixed_amount',5000,0,true
    );

    -- Fuerza a que el umbral se evalúe después del cupón: 120000 bruto sería gratis,
    -- 108000 posterior al 10% debe pagar la tarifa nacional sintética.
    UPDATE public.storefront_shipping_settings
       SET national_shipping_cost=17000,free_shipping_threshold=110000
     WHERE id=1;

    v_items:=jsonb_build_array(
      jsonb_build_object('id',v_product_a::text,'qty',1,'color','','size',''),
      jsonb_build_object('id',v_product_b::text,'qty',1,'color','','size','')
    );
    v_test_phone:='3'||translate(lower(substr(v_tag,1,9)),'abcdef','012345');
    v_pending_reference:='WOMPI-STALE-'||v_tag;
    v_linked_reference:='WOMPI-LINKED-'||v_tag;
    INSERT INTO public.orders(
      reference,customer_name,phone,city,address,neighborhood,items,subtotal,shipping,total,
      payment_method,payment_status,transaction_id
    ) VALUES
      (v_pending_reference,'Prueba unlinked',v_test_phone,'Bogota','Dirección de prueba','Barrio de prueba',v_items,120000,17000,137000,'wompi','PENDING',NULL),
      (v_linked_reference,'Prueba vinculada',v_test_phone,'Bogota','Dirección de prueba','Barrio de prueba',v_items,120000,17000,137000,'wompi','PENDING','TX-LINK-'||substr(v_tag,1,12));
    UPDATE public.orders SET created_at=now()-interval '16 minutes'
     WHERE reference IN (v_pending_reference,v_linked_reference);
    v_pending_list:=public.list_pending_wompi_orders_for_phone(v_test_phone);
    IF v_pending_list->>'success' IS DISTINCT FROM 'true' OR (
      SELECT count(*) FROM jsonb_array_elements(v_pending_list->'orders') AS x(value)
       WHERE x.value->>'reference' IN (v_pending_reference,v_linked_reference)
         AND x.value?'created_at' AND x.value?'transaction_id'
    )<>2 THEN
      RAISE EXCEPTION 'TEST FAILED: pending RPC no devolvió created_at/transaction_id para ambas sesiones';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_pending_list->'orders') AS x(value)
       WHERE x.value->>'reference'=v_pending_reference
         AND x.value->'transaction_id'='null'::jsonb
         AND (x.value->>'created_at')::timestamptz<=now()-interval '15 minutes'
    ) OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_pending_list->'orders') AS x(value)
       WHERE x.value->>'reference'=v_linked_reference
         AND x.value->>'transaction_id'='TX-LINK-'||substr(v_tag,1,12)
    ) THEN
      RAISE EXCEPTION 'TEST FAILED: pending RPC no permite distinguir unlinked stale de pago vinculado';
    END IF;
    v_result:=public.mark_storefront_wompi_reconciliation(v_linked_reference,'TX-LINK-'||substr(v_tag,1,12));
    IF v_result->>'success' IS DISTINCT FROM 'true'
       OR v_result->>'order_flag_updated' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: el marcador no persistió la conciliación en la orden: %',v_result;
    END IF;
    UPDATE public.orders SET payment_status='APPROVED'
     WHERE reference=v_linked_reference;
    v_retry:=public.reserve_storefront_wompi_checkout_lock(
      'WOMPI-RECON-BLOCK-'||v_tag,v_test_phone,repeat('d',64),10
    );
    IF v_retry->>'success' IS DISTINCT FROM 'false'
       OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_RECONCILIATION_REQUIRED' THEN
      RAISE EXCEPTION 'TEST FAILED: un pedido aprobado en conciliación permitió otro checkout: %',v_retry;
    END IF;
    UPDATE public.orders
       SET wompi_reconciliation_required=false,coupon_reconciliation_required=true
     WHERE reference=v_linked_reference;
    v_retry:=public.reserve_storefront_wompi_checkout_lock(
      'WOMPI-COUPON-RECON-LOCK-'||v_tag,v_test_phone,repeat('e',64),10
    );
    IF v_retry->>'success' IS DISTINCT FROM 'false'
       OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_RECONCILIATION_REQUIRED' THEN
      RAISE EXCEPTION 'TEST FAILED: una marca solo de conciliación de cupón permitió nueva referencia: %',v_retry;
    END IF;
    v_prepare_quote:=public.get_storefront_cart_quote_with_coupon(v_items,'Bogota','','','');
    v_prepare_result:=public.prepare_storefront_wompi_checkout(
      'WOMPI-COUPON-RECON-PREP-'||v_tag,v_items,'Bogota','',
      'buyer@example.test',v_test_phone,v_prepare_quote
    );
    IF v_prepare_result->>'success' IS DISTINCT FROM 'false'
       OR v_prepare_result->>'code' IS DISTINCT FROM 'WOMPI_RECONCILIATION_REQUIRED' THEN
      RAISE EXCEPTION 'TEST FAILED: prepare Wompi ignoró coupon_reconciliation_required sin lock: %',v_prepare_result;
    END IF;

    -- La función legacy confirm_inventory_reservation debe serializar dos APPROVED
    -- para la misma referencia y no descontar stock más de una vez.
    v_inventory_reference:='WOMPI-IDEMPOTENT-'||v_tag;
    SELECT quantity INTO v_stock_before FROM public.products WHERE id=v_product_zero;
    v_result:=public.reserve_order_inventory(
      v_inventory_reference,
      jsonb_build_array(jsonb_build_object('id',v_product_zero::text,'qty',1,'color','','size','')),
      10
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: no se pudo crear la reserva sintética de inventario: %',v_result;
    END IF;
    v_result:=public.confirm_inventory_reservation(v_inventory_reference);
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: la primera confirmación no finalizó el stock: %',v_result;
    END IF;
    SELECT quantity INTO v_stock_after FROM public.products WHERE id=v_product_zero;
    IF v_stock_after IS DISTINCT FROM v_stock_before-1 THEN
      RAISE EXCEPTION 'TEST FAILED: la primera confirmación no descontó exactamente una unidad';
    END IF;
    v_result:=public.confirm_inventory_reservation(v_inventory_reference);
    IF v_result->>'success' IS DISTINCT FROM 'true'
       OR v_result->>'already_finalized' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: confirmación duplicada no fue idempotente: %',v_result;
    END IF;
    SELECT quantity INTO v_stock_after FROM public.products WHERE id=v_product_zero;
    IF v_stock_after IS DISTINCT FROM v_stock_before-1 THEN
      RAISE EXCEPTION 'TEST FAILED: confirmación duplicada descontó stock por segunda vez';
    END IF;

    SELECT public.get_storefront_cart_quote_with_coupon(
      v_items,'  BOGOTA  ','  pct10_'||substr(v_tag,1,8)||'  ','buyer@example.test','+57 (300) 123-4567'
    ) INTO v_quote;
    SELECT coalesce(sum((line->>'discount_total')::numeric),0),
           coalesce(sum((line->>'coupon_discount_total')::numeric),0),
           coalesce(sum((line->>'net_subtotal')::numeric),0)
      INTO v_line_discount,v_line_coupon,v_line_net
      FROM jsonb_array_elements(coalesce(v_quote->'items','[]'::jsonb)) AS lines(line);
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR (v_quote->>'original_subtotal')::numeric IS DISTINCT FROM 120000
       OR (v_quote->>'discount_total')::numeric IS DISTINCT FROM 12000
       OR (v_quote->>'coupon_discount_total')::numeric IS DISTINCT FROM 12000
       OR (v_quote->>'discounted_subtotal')::numeric IS DISTINCT FROM 108000
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 17000
       OR (v_quote->>'total')::numeric IS DISTINCT FROM 125000
       OR (v_quote->>'coupon_code') IS DISTINCT FROM upper('PCT10_'||substr(v_tag,1,8))
       OR v_line_discount IS DISTINCT FROM 12000
       OR v_line_coupon IS DISTINCT FROM 12000
       OR v_line_net IS DISTINCT FROM 108000
       OR jsonb_array_length(coalesce(v_quote->'discounts','[]'::jsonb)) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'TEST FAILED: percent, distribución exacta o envío posterior al cupón: %',v_quote;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_quote->'items') AS lines(line)
       WHERE NOT (line ? 'coupon_discount_total')
          OR (line->>'net_subtotal') IS NULL
    ) THEN
      RAISE EXCEPTION 'TEST FAILED: una línea no incluye coupon_discount_total/net_subtotal';
    END IF;

    -- Una línea gratuita al final no debe absorber el remanente redondeado.
    v_items:=jsonb_build_array(
      jsonb_build_object('id',v_product_a::text,'qty',1,'color','','size',''),
      jsonb_build_object('id',v_product_zero::text,'qty',1,'color','','size','')
    );
    SELECT public.get_storefront_cart_quote_with_coupon(
      v_items,'Bogotá','PCT10_'||substr(v_tag,1,8),'',''
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR (v_quote->>'coupon_discount_total')::numeric IS DISTINCT FROM 6000
       OR (v_quote->'items'->1->>'coupon_discount_total')::numeric IS DISTINCT FROM 0
       OR (v_quote->'items'->1->>'net_subtotal')::numeric IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'TEST FAILED: la distribución no concilió con una línea final en cero: %',v_quote;
    END IF;

    v_items:=jsonb_build_array(jsonb_build_object('id',v_product_a::text,'qty',1,'color','','size',''));
    SELECT public.get_storefront_cart_quote_with_coupon(
      v_items,'Bogotá','FIXED_5_'||substr(v_tag,1,8),'buyer@example.test','3001234567'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR (v_quote->>'coupon_discount_total')::numeric IS DISTINCT FROM 5000
       OR (v_quote->>'discount_total')::numeric IS DISTINCT FROM 5000
       OR (v_quote->>'discounted_subtotal')::numeric IS DISTINCT FROM 55000 THEN
      RAISE EXCEPTION 'TEST FAILED: fixed_amount no se aplicó: %',v_quote;
    END IF;

    -- La regla explícita de Cali vence al fallback gratis; el umbral se evalúa
    -- sobre $55.000 después del cupón (el subtotal original era $60.000).
    INSERT INTO public.storefront_shipping_rules(
      scope,name,priority,shipping_cost,free_shipping_threshold,enabled
    ) VALUES (
      'city','TEST-COUPON-CALI-'||substr(v_tag,1,12),1000,19000,55001,true
    ) RETURNING id INTO v_city_rule_id;
    INSERT INTO public.storefront_shipping_rule_destinations(rule_id,destination,destination_key)
    VALUES(v_city_rule_id,'Cali','cali');
    SELECT public.get_storefront_cart_quote_with_coupon(
      v_items,'Santiago de Cali','FIXED_5_'||substr(v_tag,1,8),'',''
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR v_quote->>'destination_status' IS DISTINCT FROM 'matched_city'
       OR v_quote->>'shipping_rule_id' IS DISTINCT FROM v_city_rule_id::text
       OR v_quote->>'shipping_rule_scope' IS DISTINCT FROM 'city'
       OR (v_quote->>'shipping_rule_cost')::numeric IS DISTINCT FROM 19000
       OR (v_quote->>'shipping_rule_threshold')::numeric IS DISTINCT FROM 55001
       OR (v_quote->>'coupon_discount_total')::numeric IS DISTINCT FROM 5000
       OR (v_quote->>'discounted_subtotal')::numeric IS DISTINCT FROM 55000
       OR (v_quote->>'shipping')::numeric IS DISTINCT FROM 19000
      OR (v_quote->>'total')::numeric IS DISTINCT FROM 74000
      OR v_quote->>'destination_status'='cali_free' THEN
      RAISE EXCEPTION 'TEST FAILED: cupón debe conservar regla city explícita cobrable de Cali y metadata: %',v_quote;
    END IF;
    DELETE FROM public.storefront_shipping_rule_destinations WHERE rule_id=v_city_rule_id;
    DELETE FROM public.storefront_shipping_rules WHERE id=v_city_rule_id;

    -- Wompi cotiza, bloquea, y reserva stock/cupón dentro de una transacción.
    SELECT public.get_storefront_cart_quote_with_coupon(v_items,'Bogotá',v_prepare_code,'','')
      INTO v_prepare_quote;
    v_prepare_reference:='WOMPI-PREPARE-'||v_tag;
    v_prepare_result:=public.prepare_storefront_wompi_checkout(
      v_prepare_reference,v_items,'Bogotá',v_prepare_code,'buyer@example.test','3001234567',v_prepare_quote
    );
    IF v_prepare_result->>'success' IS DISTINCT FROM 'true'
       OR (v_prepare_result->'quote'->>'total')::numeric IS DISTINCT FROM (v_prepare_quote->>'total')::numeric
       OR (v_prepare_result->'quote'->>'coupon_discount_total')::numeric IS DISTINCT FROM (v_prepare_quote->>'coupon_discount_total')::numeric
       OR v_prepare_result->'quote'->'items' IS DISTINCT FROM v_prepare_quote->'items'
       OR v_prepare_result->>'expires_at' IS NULL
       OR v_prepare_result::text ILIKE '%buyer@example.test%'
       OR v_prepare_result::text LIKE '%3001234567%' THEN
      RAISE EXCEPTION 'TEST FAILED: prepare Wompi no reservó con quote idéntico, expiración o respuesta sin PII: %',v_prepare_result;
    END IF;
    SELECT status INTO v_status FROM public.storefront_coupon_redemptions
     WHERE channel='wompi' AND reference=v_prepare_reference LIMIT 1;
    IF v_status IS DISTINCT FROM 'reserved' THEN
      RAISE EXCEPTION 'TEST FAILED: prepare Wompi no reservó exactamente el ledger del cupón';
    END IF;
    PERFORM public.release_inventory_reservation(v_prepare_reference);
    SELECT public.release_storefront_coupon_redemption(v_prepare_reference) INTO v_result;
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: no se pudo limpiar el fixture prepare Wompi: %',v_result;
    END IF;

    v_tampered_reference:='WOMPI-PREPARE-CHANGED-'||v_tag;
    v_tampered_quote:=v_prepare_quote||jsonb_build_object('total',(v_prepare_quote->>'total')::bigint+1);
    v_prepare_result:=public.prepare_storefront_wompi_checkout(
      v_tampered_reference,v_items,'Bogotá',v_prepare_code,'buyer@example.test','3001234567',v_tampered_quote
    );
    IF v_prepare_result->>'success' IS DISTINCT FROM 'false'
       OR v_prepare_result->>'code' IS DISTINCT FROM 'WOMPI_QUOTE_CHANGED'
       OR EXISTS (SELECT 1 FROM public.storefront_coupon_redemptions WHERE channel='wompi' AND reference=v_tampered_reference) THEN
      RAISE EXCEPTION 'TEST FAILED: quote alterado no se rechazó antes de reservar cupón/inventario: %',v_prepare_result;
    END IF;

    SELECT public.get_storefront_cart_quote_with_coupon(
      v_items,'Bogotá','MINIMUM_'||substr(v_tag,1,8),'buyer@example.test','3001234567'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'false' OR v_quote->>'code' IS DISTINCT FROM 'COUPON_MINIMUM_NOT_MET' THEN
      RAISE EXCEPTION 'TEST FAILED: mínimo de compra no se validó: %',v_quote;
    END IF;
    SELECT public.get_storefront_cart_quote_with_coupon(
      v_items,'Bogotá','FUTURE_'||substr(v_tag,1,8),'buyer@example.test','3001234567'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'false' OR v_quote->>'code' IS DISTINCT FROM 'COUPON_NOT_STARTED' THEN
      RAISE EXCEPTION 'TEST FAILED: ventana futura no se validó: %',v_quote;
    END IF;
    SELECT public.get_storefront_cart_quote_with_coupon(
      v_items,'Bogotá','EXPIRED_'||substr(v_tag,1,8),'buyer@example.test','3001234567'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'false' OR v_quote->>'code' IS DISTINCT FROM 'COUPON_EXPIRED' THEN
      RAISE EXCEPTION 'TEST FAILED: ventana expirada no se validó: %',v_quote;
    END IF;
    SELECT public.get_storefront_cart_quote_with_coupon(
      v_items,'Bogotá','DISABLED_'||substr(v_tag,1,8),'buyer@example.test','3001234567'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'false' OR v_quote->>'code' IS DISTINCT FROM 'COUPON_DISABLED' THEN
      RAISE EXCEPTION 'TEST FAILED: cupón disabled no se validó: %',v_quote;
    END IF;
    SELECT public.get_storefront_cart_quote_with_coupon(
      jsonb_build_array(jsonb_build_object('id',v_product_zero::text,'qty',1,'color','','size','')),
      'Bogotá','FIXED_5_'||substr(v_tag,1,8),'buyer@example.test','3001234567'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'false' OR v_quote->>'code' IS DISTINCT FROM 'COUPON_ZERO_DISCOUNT' THEN
      RAISE EXCEPTION 'TEST FAILED: cupón con descuento resultante cero no se rechazó: %',v_quote;
    END IF;

    -- Combo + cupón se rechaza sin apilar descuentos.
    INSERT INTO public.storefront_product_combos(
      product_a_id,product_b_id,title,enabled,rule_type,discount_type,discount_value
    ) VALUES (
      v_product_a,v_product_b,'TEST-COUPON-COMBO-'||v_tag,true,'product_pair','fixed_amount',1000
    ) RETURNING id INTO v_combo_id;
    SELECT public.get_storefront_cart_quote_with_coupon(
      v_items||jsonb_build_array(jsonb_build_object('id',v_product_b::text,'qty',1,'color','','size','')),
      'Bogotá','FIXED_5_'||substr(v_tag,1,8),'buyer@example.test','3001234567'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'false' OR v_quote->>'code' IS DISTINCT FROM 'COUPON_COMBO_CONFLICT' THEN
      RAISE EXCEPTION 'TEST FAILED: combo conflict no se rechazó: %',v_quote;
    END IF;

    v_result:=public.reserve_storefront_wompi_checkout_lock('WOMPI-LOCK-1-'||v_tag,'3001234567',repeat('a',64),10);
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: no se reservó el lock Wompi inicial: %',v_result;
    END IF;
    v_retry:=public.reserve_storefront_wompi_checkout_lock('WOMPI-LOCK-2-'||v_tag,'+57 300 123 4567',repeat('a',64),10);
    IF v_retry->>'success' IS DISTINCT FROM 'false'
       OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_ACTIVE_RESERVATION'
       OR v_retry->>'existing_reference' IS DISTINCT FROM 'WOMPI-LOCK-1-'||v_tag THEN
      RAISE EXCEPTION 'TEST FAILED: dos referencias consiguieron el mismo carrito/teléfono: %',v_retry;
    END IF;
    v_retry:=public.reserve_storefront_wompi_checkout_lock('WOMPI-LOCK-3-'||v_tag,'3001234567',repeat('b',64),10);
    IF v_retry->>'success' IS DISTINCT FROM 'false' OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_ACTIVE_OTHER_CART' THEN
      RAISE EXCEPTION 'TEST FAILED: un teléfono abrió dos carritos activos en paralelo: %',v_retry;
    END IF;
    v_result:=public.claim_storefront_wompi_checkout('WOMPI-LOCK-1-'||v_tag);
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'TEST FAILED: claim inicial no se adquirió: %',v_result; END IF;
    v_retry:=public.claim_storefront_wompi_checkout('WOMPI-LOCK-1-'||v_tag);
    IF v_retry->>'success' IS DISTINCT FROM 'false' OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_CHECKOUT_ALREADY_PREPARED' THEN
      RAISE EXCEPTION 'TEST FAILED: se reclamó más de una sesión Wompi: %',v_retry;
    END IF;
    v_result:=public.set_storefront_wompi_checkout_state('WOMPI-LOCK-1-'||v_tag,'pending','TX-LOCK-'||v_tag);
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'TEST FAILED: no se fijó el lock pending: %',v_result; END IF;
    v_retry:=public.set_storefront_wompi_checkout_state('WOMPI-LOCK-1-'||v_tag,'released',NULL);
    IF v_retry->>'success' IS DISTINCT FROM 'false' OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_TRANSACTION_LOCK_CONFLICT' THEN
      RAISE EXCEPTION 'TEST FAILED: un cleanup sin transaction_id liberó una transacción vinculada: %',v_retry;
    END IF;
    v_retry:=public.set_storefront_wompi_checkout_state('WOMPI-LOCK-1-'||v_tag,'pending','TX-OTHER-'||v_tag);
    IF v_retry->>'success' IS DISTINCT FROM 'false' OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_TRANSACTION_LOCK_CONFLICT' THEN
      RAISE EXCEPTION 'TEST FAILED: otra transacción tomó el lock existente: %',v_retry;
    END IF;
    v_retry:=public.reserve_storefront_wompi_checkout_lock('WOMPI-LOCK-2-'||v_tag,'3001234567',repeat('a',64),10);
    IF v_retry->>'success' IS DISTINCT FROM 'false' OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_TRANSACTION_PENDING' THEN
      RAISE EXCEPTION 'TEST FAILED: otra referencia ignoró una transacción pendiente: %',v_retry;
    END IF;
    v_retry:=public.reserve_storefront_wompi_checkout_lock('WOMPI-LOCK-3-'||v_tag,'3001234567',repeat('b',64),10);
    IF v_retry->>'success' IS DISTINCT FROM 'false' OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_TRANSACTION_PENDING' THEN
      RAISE EXCEPTION 'TEST FAILED: otra transacción usó un carrito distinto del teléfono pendiente: %',v_retry;
    END IF;
    v_result:=public.set_storefront_wompi_checkout_state('WOMPI-LOCK-1-'||v_tag,'released','TX-LOCK-'||v_tag);
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'TEST FAILED: no se liberó el lock terminal: %',v_result; END IF;
    v_result:=public.reserve_storefront_wompi_checkout_lock('WOMPI-LOCK-2-'||v_tag,'3001234567',repeat('a',64),10);
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'TEST FAILED: el lock liberado impidió el reintento con referencia nueva: %',v_result; END IF;
    v_retry:=public.set_storefront_wompi_checkout_state('WOMPI-LOCK-1-'||v_tag,'pending','TX-LOCK-'||v_tag);
    IF v_retry->>'success' IS DISTINCT FROM 'true' OR v_retry->>'late_approval_conflict' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: la aprobación tardía chocó con el nuevo lock sin ruta de conciliación: %',v_retry;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.storefront_wompi_checkout_locks AS l
       WHERE l.reference='WOMPI-LOCK-1-'||v_tag AND l.reconciliation_required
    ) THEN RAISE EXCEPTION 'TEST FAILED: el conflicto tardío no quedó persistido para conciliación'; END IF;
    v_retry:=public.set_storefront_wompi_checkout_state('WOMPI-LOCK-1-'||v_tag,'completed','TX-LOCK-'||v_tag);
    IF v_retry->>'success' IS DISTINCT FROM 'false' OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_RECONCILIATION_REQUIRED' THEN
      RAISE EXCEPTION 'TEST FAILED: un webhook tardío completó el lock sin conciliación explícita: %',v_retry;
    END IF;
    PERFORM public.claim_storefront_wompi_checkout('WOMPI-LOCK-2-'||v_tag);
    PERFORM public.set_storefront_wompi_checkout_state('WOMPI-LOCK-2-'||v_tag,'pending','TX-LOCK-2-'||v_tag);
    PERFORM public.set_storefront_wompi_checkout_state('WOMPI-LOCK-2-'||v_tag,'completed','TX-LOCK-2-'||v_tag);
    v_retry:=public.set_storefront_wompi_checkout_state('WOMPI-LOCK-2-'||v_tag,'released','TX-LOCK-2-'||v_tag);
    IF v_retry->>'success' IS DISTINCT FROM 'true' OR v_retry->>'state' IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'TEST FAILED: un evento terminal rebajó un lock ya completado: %',v_retry;
    END IF;
    v_retry:=public.reserve_storefront_wompi_checkout_lock('WOMPI-LOCK-4-'||v_tag,'3001234567',repeat('c',64),10);
    IF v_retry->>'success' IS DISTINCT FROM 'false' OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_RECONCILIATION_REQUIRED' THEN
      RAISE EXCEPTION 'TEST FAILED: una bandera de lock tardío no bloqueó referencias nuevas: %',v_retry;
    END IF;
    v_result:=public.reserve_storefront_wompi_checkout_lock('WOMPI-LOCK-3-'||v_tag,'3101234567',repeat('b',64),10);
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'TEST FAILED: no se preparó la referencia de prueba para cooldown: %',v_result; END IF;
    v_result:=public.set_storefront_wompi_checkout_state('WOMPI-LOCK-3-'||v_tag,'terminal_grace','TX-LOCK-3-'||v_tag);
    IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'state' IS DISTINCT FROM 'terminal_grace' THEN
      RAISE EXCEPTION 'TEST FAILED: no se fijó terminal_grace: %',v_result;
    END IF;
    v_retry:=public.reserve_storefront_wompi_checkout_lock('WOMPI-LOCK-4-'||v_tag,'3101234567',repeat('c',64),10);
    IF v_retry->>'success' IS DISTINCT FROM 'false' OR v_retry->>'code' IS DISTINCT FROM 'WOMPI_TERMINAL_GRACE' THEN
      RAISE EXCEPTION 'TEST FAILED: se inició otro pago durante terminal_grace: %',v_retry;
    END IF;
    UPDATE public.storefront_wompi_checkout_locks
       SET terminal_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute'
     WHERE reference='WOMPI-LOCK-3-'||v_tag;
    v_result:=public.reserve_storefront_wompi_checkout_lock('WOMPI-LOCK-4-'||v_tag,'3101234567',repeat('c',64),10);
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'TEST FAILED: el cooldown vencido impidió un nuevo intento: %',v_result; END IF;

    -- El límite por cliente no debe ser evadible desde la RPC COD pública con PII malformada.
    v_result:=public.reserve_storefront_coupon_redemption(
      'PCT10_'||substr(v_tag,1,8),'cod','COD-INVALID-EMAIL-'||v_tag,'a','3001234567',12000
    );
    IF v_result->>'success' IS DISTINCT FROM 'false' OR v_result->>'code' IS DISTINCT FROM 'COUPON_CUSTOMER_REQUIRED' THEN
      RAISE EXCEPTION 'TEST FAILED: identidad de email inválida pudo reservar cupón: %',v_result;
    END IF;
    v_result:=public.reserve_storefront_coupon_redemption(
      'PCT10_'||substr(v_tag,1,8),'cod','COD-INVALID-PHONE-'||v_tag,'buyer@example.test','1',12000
    );
    IF v_result->>'success' IS DISTINCT FROM 'false' OR v_result->>'code' IS DISTINCT FROM 'COUPON_CUSTOMER_REQUIRED' THEN
      RAISE EXCEPTION 'TEST FAILED: teléfono inválido pudo reservar cupón: %',v_result;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.storefront_coupon_redemptions AS r
       WHERE r.reference IN ('COD-INVALID-EMAIL-'||v_tag,'COD-INVALID-PHONE-'||v_tag)
    ) THEN
      RAISE EXCEPTION 'TEST FAILED: una identidad inválida dejó filas de ledger';
    END IF;

    -- Un fallo COD sin pedido adelanta expires_at; la misma referencia debe poder revalidarse.
    v_result:=public.reserve_storefront_coupon_redemption(
      v_cod_retry_code,'cod','COD-RETRY-FAIL-'||v_tag,'retry@example.test','3006543210',5000
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: reserva COD inicial para retry no se creó: %',v_result;
    END IF;
    UPDATE public.storefront_coupon_redemptions
       SET expires_at=now()-interval '1 second'
     WHERE channel='cod' AND reference='COD-RETRY-FAIL-'||v_tag AND status='reserved';
    v_retry:=public.reserve_storefront_coupon_redemption(
      v_cod_retry_code,'cod','COD-RETRY-FAIL-'||v_tag,'retry@example.test','3006543210',5000
    );
    IF v_retry->>'success' IS DISTINCT FROM 'true'
       OR v_retry->>'renewed_after_expiry' IS DISTINCT FROM 'true'
       OR v_retry->>'status' IS DISTINCT FROM 'reserved'
       OR (v_retry->>'expires_at')::timestamptz<=now() THEN
      RAISE EXCEPTION 'TEST FAILED: COD no renovó el mismo hold después de fallo sin pedido: %',v_retry;
    END IF;

    -- Un fallo anterior a la inserción de la orden expira el hold, pero permite
    -- revalidar y reusar esa misma referencia si el cupón sigue disponible.
    v_result:=public.reserve_storefront_coupon_redemption(
      'LATE_'||substr(v_tag,1,8),'wompi','WOMPI-EXPIRE-'||v_tag,'buyer@example.test','3001234567',5000
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'TEST FAILED: hold Wompi para expiración no se creó: %',v_result; END IF;
    v_result:=public.expire_storefront_coupon_redemption('WOMPI-EXPIRE-'||v_tag);
    IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'status' IS DISTINCT FROM 'reserved' THEN
      RAISE EXCEPTION 'TEST FAILED: hold fallido no expiró con estado reversible: %',v_result;
    END IF;
    v_retry:=public.reserve_storefront_coupon_redemption(
      'LATE_'||substr(v_tag,1,8),'wompi','WOMPI-EXPIRE-'||v_tag,'buyer@example.test','3001234567',5000
    );
    IF v_retry->>'success' IS DISTINCT FROM 'true' OR v_retry->>'renewed_after_expiry' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: no se pudo renovar el hold expirado same-reference: %',v_retry;
    END IF;

    -- Reserva Wompi: uso global/per-cliente bajo revalidación e idempotencia por referencia.
    v_result:=public.reserve_storefront_coupon_redemption(
      'PCT10_'||substr(v_tag,1,8),'wompi','WOMPI-1-'||v_tag,'buyer@example.test','3001234567',12000
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'status' IS DISTINCT FROM 'reserved' THEN
      RAISE EXCEPTION 'TEST FAILED: reserva Wompi inicial falló: %',v_result;
    END IF;
    v_ledger_id:=(v_result->>'id')::uuid;
    v_retry:=public.reserve_storefront_coupon_redemption(
      'PCT10_'||substr(v_tag,1,8),'wompi','WOMPI-1-'||v_tag,'buyer@example.test','300-123-4567',12000
    );
    IF v_retry->>'success' IS DISTINCT FROM 'true' OR v_retry->>'idempotent' IS DISTINCT FROM 'true'
       OR (v_retry->>'id')::uuid IS DISTINCT FROM v_ledger_id THEN
      RAISE EXCEPTION 'TEST FAILED: reserva Wompi no fue idempotente por referencia/cliente: %',v_retry;
    END IF;
    v_result:=public.confirm_storefront_coupon_redemption('WOMPI-1-'||v_tag);
    IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'status' IS DISTINCT FROM 'redeemed' THEN
      RAISE EXCEPTION 'TEST FAILED: confirmación Wompi no consumió el uso: %',v_result;
    END IF;
    v_result:=public.reserve_storefront_coupon_redemption(
      'PCT10_'||substr(v_tag,1,8),'wompi','WOMPI-SAME-CUSTOMER-'||v_tag,'buyer@example.test','3001234567',12000
    );
    IF v_result->>'success' IS DISTINCT FROM 'false' OR v_result->>'code' IS DISTINCT FROM 'COUPON_CUSTOMER_LIMIT' THEN
      RAISE EXCEPTION 'TEST FAILED: límite por cliente no se revalidó: %',v_result;
    END IF;
    v_result:=public.reserve_storefront_coupon_redemption(
      'PCT10_'||substr(v_tag,1,8),'wompi','WOMPI-2-'||v_tag,'other@example.test','3009999999',12000
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: segundo cliente legítimo no pudo reservar: %',v_result;
    END IF;
    v_result:=public.reserve_storefront_coupon_redemption(
      'PCT10_'||substr(v_tag,1,8),'wompi','WOMPI-3-'||v_tag,'third@example.test','3008888888',12000
    );
    IF v_result->>'success' IS DISTINCT FROM 'false' OR v_result->>'code' IS DISTINCT FROM 'COUPON_GLOBAL_LIMIT' THEN
      RAISE EXCEPTION 'TEST FAILED: límite global no se revalidó: %',v_result;
    END IF;

    -- Aprobación Wompi tardía: se honra y queda marcada para conciliación.
    v_result:=public.reserve_storefront_coupon_redemption(
      'LATE_'||substr(v_tag,1,8),'wompi','WOMPI-LATE-'||v_tag,'late@example.test','3007777777',5000
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'TEST FAILED: no se creó reserva tardía: %',v_result; END IF;
    UPDATE public.storefront_coupon_redemptions
       SET expires_at=now()-interval '1 second'
     WHERE id=(v_result->>'id')::uuid;
    v_retry:=public.reserve_storefront_coupon_redemption(
      'LATE_'||substr(v_tag,1,8),'wompi','WOMPI-LATE-'||v_tag,'late@example.test','3007777777',5000,now()+interval '5 minutes'
    );
    IF v_retry->>'success' IS DISTINCT FROM 'true'
       OR v_retry->>'renewed_after_expiry' IS DISTINCT FROM 'true'
       OR v_retry->>'status' IS DISTINCT FROM 'reserved' THEN
      RAISE EXCEPTION 'TEST FAILED: reintento Wompi no renovó el hold expirado de forma atómica: %',v_retry;
    END IF;
    UPDATE public.storefront_coupon_redemptions
       SET expires_at=now()-interval '1 second'
     WHERE id=(v_retry->>'id')::uuid;
    v_result:=public.confirm_storefront_coupon_redemption('WOMPI-LATE-'||v_tag);
    IF v_result->>'success' IS DISTINCT FROM 'true'
       OR v_result->>'reconciliation_required' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: aprobación tardía no marcó reconciliation_required: %',v_result;
    END IF;

    v_result:=public.reserve_storefront_coupon_redemption(
      'RELEASE_'||substr(v_tag,1,8),'wompi','WOMPI-RELEASE-'||v_tag,'release@example.test','3006666666',5000
    );
    IF v_result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'TEST FAILED: no se creó reserva liberable: %',v_result; END IF;
    v_result:=public.release_storefront_coupon_redemption('WOMPI-RELEASE-'||v_tag);
    IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'status' IS DISTINCT FROM 'released' THEN
      RAISE EXCEPTION 'TEST FAILED: DECLINED/ERROR no liberó el cupón: %',v_result;
    END IF;
    v_result:=public.release_storefront_coupon_redemption('WOMPI-RELEASE-'||v_tag);
    IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'idempotent' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: release no fue idempotente: %',v_result;
    END IF;
    v_result:=public.confirm_storefront_coupon_redemption('WOMPI-RELEASE-'||v_tag);
    IF v_result->>'success' IS DISTINCT FROM 'true'
       OR v_result->>'reconciliation_required' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TEST FAILED: aprobación autenticada posterior a release no se honró/conciliará: %',v_result;
    END IF;

    -- COD consume el uso al crear y el duplicate no aplica un cupón retroactivamente.
    v_client_reference:='TEST-COUPON-COD-'||v_tag;
    v_result:=public.create_contra_delivery_order_with_coupon(
      v_client_reference,'Cliente cupón','TEST-ONLY','3005555555','cod@example.test','Cali',
      'Dirección de prueba','Barrio de prueba',
      jsonb_build_array(jsonb_build_object('id',v_product_a::text,'qty',1,'color','','size','')),
      'COD5_'||substr(v_tag,1,8),55000,5000,5000
    );
    IF v_result->>'success' IS DISTINCT FROM 'true'
       OR (v_result->>'total')::numeric IS DISTINCT FROM 55000
       OR (v_result->>'discount_total')::numeric IS DISTINCT FROM 5000
       OR (v_result->>'coupon_discount_total')::numeric IS DISTINCT FROM 5000 THEN
      RAISE EXCEPTION 'TEST FAILED: COD con cupón no consumió la quote: %',v_result;
    END IF;
    v_order_id:=nullif(v_result->>'order_id','')::uuid;
    IF v_order_id IS NULL THEN RAISE EXCEPTION 'TEST FAILED: COD con cupón no devolvió order_id'; END IF;
    v_retry:=public.create_contra_delivery_order_with_coupon(
      v_client_reference,'Cliente cupón','TEST-ONLY','3005555555','cod@example.test','Cali',
      'Dirección de prueba','Barrio de prueba',
      jsonb_build_array(jsonb_build_object('id',v_product_a::text,'qty',1,'color','','size','')),
      'COD5_'||substr(v_tag,1,8),55000,5000,5000
    );
    IF v_retry->>'success' IS DISTINCT FROM 'true' OR v_retry->>'duplicate' IS DISTINCT FROM 'true'
       OR (v_retry->>'order_id')::uuid IS DISTINCT FROM v_order_id THEN
      RAISE EXCEPTION 'TEST FAILED: duplicate COD con cupón no fue idempotente: %',v_retry;
    END IF;
    v_retry:=public.create_contra_delivery_order_with_coupon(
      v_client_reference,'Cliente cupón','TEST-ONLY','3005555555','cod@example.test','Cali',
      'Otra dirección de prueba','Barrio de prueba',
      jsonb_build_array(jsonb_build_object('id',v_product_a::text,'qty',1,'color','','size','')),
      'COD5_'||substr(v_tag,1,8),55000,5000,5000
    );
    IF v_retry->>'success' IS DISTINCT FROM 'false'
       OR v_retry->>'duplicate' IS DISTINCT FROM 'true'
       OR v_retry->>'code' IS DISTINCT FROM 'COD_REFERENCE_CONFLICT'
       OR (v_retry->>'existing_order_id')::uuid IS DISTINCT FROM v_order_id THEN
      RAISE EXCEPTION 'TEST FAILED: COD duplicate aceptó cambios de datos personales/dirección: %',v_retry;
    END IF;
    v_retry:=public.create_contra_delivery_order_with_coupon(
      v_client_reference,'Cliente cupón','TEST-ONLY','3005555555','cod@example.test','Cali',
      'Dirección de prueba','Barrio de prueba',
      jsonb_build_array(jsonb_build_object('id',v_product_a::text,'qty',1,'color','','size','')),
      '',55000,0,0
    );
    IF v_retry->>'success' IS DISTINCT FROM 'false'
       OR v_retry->>'duplicate' IS DISTINCT FROM 'true'
       OR v_retry->>'code' IS DISTINCT FROM 'COD_REFERENCE_CONFLICT' THEN
      RAISE EXCEPTION 'TEST FAILED: COD legacy previo aceptó cupón retroactivo: %',v_retry;
    END IF;
    SELECT count(*) INTO v_count
      FROM public.storefront_coupon_redemptions AS r
     WHERE r.channel='cod' AND r.reference=v_client_reference AND r.status='redeemed' LIMIT 1;
    IF v_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST FAILED: COD no dejó un único ledger redeemed'; END IF;

    -- Default aprobado: COD sí puede aceptar un pedido de total cero.
    v_client_reference:='TEST-COUPON-COD-FREE-'||v_tag;
    v_result:=public.create_contra_delivery_order_with_coupon(
      v_client_reference,'Cliente cupón cero','TEST-ONLY','3005555556','codfree@example.test','Cali',
      'Dirección de prueba','Barrio de prueba',
      jsonb_build_array(jsonb_build_object('id',v_product_a::text,'qty',1,'color','','size','')),
      'FULL_'||substr(v_tag,1,8),0,60000,60000
    );
    IF v_result->>'success' IS DISTINCT FROM 'true'
       OR (v_result->>'total')::numeric IS DISTINCT FROM 0
       OR (v_result->>'discount_total')::numeric IS DISTINCT FROM 60000
       OR (v_result->>'coupon_discount_total')::numeric IS DISTINCT FROM 60000 THEN
      RAISE EXCEPTION 'TEST FAILED: COD con cupón total cero no respetó el default: %',v_result;
    END IF;

    -- Código vacío conserva las claves legacy y añade ceros de cupón.
    SELECT public.get_storefront_cart_quote_with_coupon(
      jsonb_build_array(jsonb_build_object('id',v_product_a::text,'qty',1,'color','','size','')),
      'Cali','','buyer@example.test','3001234567'
    ) INTO v_quote;
    IF v_quote->>'success' IS DISTINCT FROM 'true'
       OR (v_quote->>'coupon_discount_total')::numeric IS DISTINCT FROM 0
       OR v_quote->'coupon' IS DISTINCT FROM 'null'::jsonb
       OR NOT (v_quote ? 'original_subtotal') OR NOT (v_quote ? 'shipping') THEN
      RAISE EXCEPTION 'TEST FAILED: código vacío no preserva contrato legacy: %',v_quote;
    END IF;

    RAISE NOTICE 'PASS: fixtures de cupones, percent/fixed, formato, mínimo/ventana/disabled, conflicto combo, distribución, envío, límites, ledger tardío/liberado y COD verificados.';
  EXCEPTION WHEN OTHERS THEN
    RAISE;
  END;

  -- La prueba nunca debe dejar fixtures fuera del rollback controlado.
  SELECT count(*) INTO v_count FROM public.products WHERE category='__coupon_'||v_tag LIMIT 1;
  IF v_count<3 THEN RAISE EXCEPTION 'TEST FAILED: no se crearon fixtures aislados de productos'; END IF;
  SELECT count(*) INTO v_count FROM public.storefront_coupons WHERE code LIKE '%_'||substr(v_tag,1,8) LIMIT 1;
  IF v_count<8 THEN RAISE EXCEPTION 'TEST FAILED: no se crearon fixtures aislados de cupones'; END IF;
END;
$coupons_regression$;

ROLLBACK;
