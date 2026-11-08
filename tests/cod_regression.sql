-- Prueba transaccional: nunca persiste producto, pedido ni reserva sintéticos.
DO $test$
DECLARE
 prefix text:='SIM-COD-SEC-'||replace(gen_random_uuid()::text,'-','');
 admin_id uuid; pid uuid:=gen_random_uuid(); oid uuid; invref text;
 items jsonb; result jsonb; retry jsonb; changed_retry jsonb; report jsonb:='{}'::jsonb;
 n integer; stock integer; shipping numeric; message text;
BEGIN
 SELECT admin_user_id INTO admin_id FROM public.store_settings WHERE id=1 LIMIT 1;
 BEGIN
  INSERT INTO public.products(id,user_id,code,name,category,quantity,cost_price,sale_price,colors,sizes,variants)
  VALUES(pid,admin_id,prefix,'PRUEBA CONTRAENTREGA NO DESPACHAR','Otros',1,0,30000,ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb);
  items:=jsonb_build_array(jsonb_build_object('id',pid,'qty',1,'color','','size',''));
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  IF has_function_privilege('anon','public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric)','EXECUTE') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Anon no puede ejecutar el RPC COD con guard de cotización';
  END IF;
  SELECT count(*) INTO n FROM pg_attribute AS a
   WHERE a.attrelid='public.web_orders'::regclass AND a.attname IN ('total','discount_total','shipping')
     AND a.attnotnull AND NOT a.attisdropped LIMIT 1;
  IF n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'web_orders debe conservar NOT NULL en total/descuento/envío'; END IF;
  EXECUTE 'SET LOCAL ROLE anon';
  result:=public.create_contra_delivery_order_with_quote(prefix,'PRUEBA INTERNA','00000000','0000000000','simulacion@example.test','Cali','DIRECCION FICTICIA','SIMULACION',items,30000,0);
  IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Contraentrega no funciona: %',result; END IF;
  retry:=public.create_contra_delivery_order_with_quote(prefix,'PRUEBA INTERNA','00000000','0000000000','simulacion@example.test','Cali','DIRECCION FICTICIA','SIMULACION',items,30000,0);
  IF retry->>'success' IS DISTINCT FROM 'true' OR retry->>'duplicate' IS DISTINCT FROM 'true'
     OR retry->>'order_id' IS DISTINCT FROM result->>'order_id'
     OR (retry->>'total')::numeric IS DISTINCT FROM 30000::numeric
     OR (retry->>'discount_total')::numeric IS DISTINCT FROM 0::numeric
     OR (retry->>'shipping')::numeric IS DISTINCT FROM 0::numeric THEN
    RAISE EXCEPTION 'Contraentrega duplicada no conserva pedido/importe completo: %',retry;
  END IF;
  oid:=(result->>'order_id')::uuid;
  EXECUTE 'RESET ROLE';
  UPDATE public.products SET sale_price=35000 WHERE id=pid;
  EXECUTE 'SET LOCAL ROLE anon';
  changed_retry:=public.create_contra_delivery_order_with_quote(prefix,'PRUEBA INTERNA','00000000','0000000000','simulacion@example.test','Cali','DIRECCION FICTICIA','SIMULACION',items,35000,0);
  IF changed_retry->>'success' IS DISTINCT FROM 'false'
     OR changed_retry->>'duplicate' IS DISTINCT FROM 'true'
     OR changed_retry->>'quote_changed' IS DISTINCT FROM 'true'
     OR changed_retry->>'existing_order_id' IS DISTINCT FROM oid::text
     OR (changed_retry->>'existing_total')::numeric IS DISTINCT FROM 30000::numeric
     OR (changed_retry->>'total')::numeric IS DISTINCT FROM 35000::numeric THEN
    RAISE EXCEPTION 'Reintento COD con precio nuevo no detectó el pedido previo: %',changed_retry;
  END IF;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.web_orders WHERE client_reference=prefix LIMIT 1;
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'El reintento COD con precio cambiado creó un pedido duplicado'; END IF;
  SELECT w.inventory_reference,w.shipping INTO invref,shipping FROM public.web_orders w WHERE w.id=oid LIMIT 1;
  SELECT count(*) INTO n FROM public.inventory_reservations WHERE reference=invref LIMIT 1;
  IF n IS DISTINCT FROM 1 OR shipping IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Reserva COD o envío Cali incorrectos'; END IF;
  SELECT quantity INTO stock FROM public.products WHERE id=pid LIMIT 1;
  IF stock IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'COD reserva lógica modificó cantidad física'; END IF;
  report:=report||jsonb_build_object('anon_cod_creation',true,'cod_same_reference_same_order',true,'cod_changed_price_rejected',true,'cod_single_reservation',n,'cali_shipping',shipping,'stock_during_hold',stock);
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.web_orders WHERE id=oid LIMIT 1;
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Administrador no puede ver pedido COD'; END IF;
  result:=public.admin_update_web_order_status_secure(oid,'rechazado');
  IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No se pudo rechazar el pedido sintético: %',result; END IF;
  EXECUTE 'RESET ROLE';
  SELECT quantity INTO stock FROM public.products WHERE id=pid LIMIT 1;
  IF stock IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Rechazo COD alteró stock físico'; END IF;
  report:=report||jsonb_build_object('admin_cod_order_visible',true,'admin_cod_reject',true,'stock_after_reject',stock);
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='ROLLBACK_CONTROLADO_COD';
 EXCEPTION
  WHEN SQLSTATE 'ZX001' THEN report:=report||jsonb_build_object('rolled_back',true);
  WHEN OTHERS THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;report:=report||jsonb_build_object('failure',message,'sqlstate',SQLSTATE,'rolled_back',true);RAISE;
 END;
 SELECT count(*) INTO n FROM public.products WHERE code=prefix LIMIT 1;
 report:=report||jsonb_build_object('synthetic_products_remaining',n);
 IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'La prueba dejó productos sintéticos después del rollback: %',n; END IF;
 SELECT count(*) INTO n FROM public.web_orders WHERE client_reference=prefix LIMIT 1;
 report:=report||jsonb_build_object('synthetic_orders_remaining',n);
 IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'La prueba dejó pedidos sintéticos después del rollback: %',n; END IF;
 SELECT count(*) INTO n FROM public.inventory_reservations WHERE reference=invref LIMIT 1;
 report:=report||jsonb_build_object('synthetic_reservations_remaining',n);
 IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'La prueba dejó reservas sintéticas después del rollback: %',n; END IF;
 PERFORM set_config('sirevya.cod_report',report::text,true);
END;
$test$;
SELECT current_setting('sirevya.cod_report')::jsonb AS report LIMIT 1;
