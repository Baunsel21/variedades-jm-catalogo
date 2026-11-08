-- Prueba interna con claims SQL simulados, sin cuentas nuevas ni efectos externos.
-- Todas las filas y modificaciones se revierten al terminar el subbloque.
DO $test$
DECLARE
  prefix text := 'SIM-SEC-'||replace(gen_random_uuid()::text,'-','');
  admin_id uuid; outsider uuid:=gen_random_uuid(); test_product_id uuid:=gen_random_uuid();
  n integer; changed integer; denied integer:=0; message text; state text;
  report jsonb:='{}'::jsonb; fn record; args text;
  response jsonb;
BEGIN
  SELECT admin_user_id INTO admin_id FROM public.store_settings WHERE id=1 LIMIT 1;
  BEGIN
    INSERT INTO public.products(id,user_id,code,name,category,quantity,cost_price,sale_price,colors,sizes,variants)
    VALUES(test_product_id,admin_id,prefix,'PRUEBA DE PERMISOS NO PUBLICAR','Otros',1,0,30000,ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb);

    PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF public.is_store_admin() IS DISTINCT FROM true THEN RAISE EXCEPTION 'Administrador no reconocido'; END IF;
    SELECT count(*) INTO n FROM public.products WHERE id=test_product_id LIMIT 1;
    IF n<>1 THEN RAISE EXCEPTION 'Administrador perdió SELECT de productos'; END IF;
    UPDATE public.products SET name='PRUEBA DE PERMISOS NO PUBLICAR - actualizado' WHERE id=test_product_id;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'Administrador perdió UPDATE de productos'; END IF;
    INSERT INTO public.product_images(product_id,user_id,image_path,sort_order)
    VALUES(test_product_id,admin_id,'synthetic/no-physical-file.jpg',0);
    SELECT count(*) INTO n FROM public.product_images pi WHERE pi.product_id=test_product_id LIMIT 1;
    IF n<>1 THEN RAISE EXCEPTION 'Administrador perdió acceso a galería'; END IF;
    BEGIN
      INSERT INTO public.product_images(product_id,user_id,image_path,sort_order)
      VALUES(gen_random_uuid(),admin_id,'synthetic/invalid-owner.jpg',0);
      RAISE EXCEPTION 'Se permitió una imagen para un producto inexistente';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    SELECT count(*) INTO n FROM (SELECT id FROM public.categories LIMIT 1000) q LIMIT 1;
    report:=report||jsonb_build_object('admin_product_select_update',true,'admin_photo_insert_select',true,'photo_product_relation_enforced',true,'admin_categories_readable',true,'category_rows',n);
    EXECUTE 'RESET ROLE';

    PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF public.is_store_admin() IS DISTINCT FROM false THEN RAISE EXCEPTION 'Se autorizó cuenta ajena'; END IF;
    SELECT count(*) INTO n FROM public.products WHERE id=test_product_id LIMIT 1;
    IF n<>0 THEN RAISE EXCEPTION 'No administrador pudo leer producto privado'; END IF;
    UPDATE public.products SET name='NO DEBE GUARDARSE' WHERE id=test_product_id;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>0 THEN RAISE EXCEPTION 'No administrador pudo editar producto'; END IF;
    BEGIN
      INSERT INTO public.products(user_id,code,name,quantity,cost_price,sale_price)
      VALUES(outsider,prefix||'-FORGED','NO DEBE CREARSE',1,0,30000);
      RAISE EXCEPTION 'No administrador pudo insertar producto';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      INSERT INTO public.clients(user_id,name,phone,note) VALUES(outsider,'SINTÉTICO','0000000000','NO CREAR');
      RAISE EXCEPTION 'No administrador pudo insertar cliente';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      INSERT INTO public.web_orders DEFAULT VALUES;
      RAISE EXCEPTION 'No administrador pudo insertar un pedido directo';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    report:=report||jsonb_build_object('nonadmin_table_writes_blocked',true,'nonadmin_private_product_rows',n);

    FOR fn IN
      SELECT p.proname,p.proargtypes,p.prorettype='jsonb'::regtype AS returns_json FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
      WHERE ns.nspname='public' AND (p.proname LIKE 'admin\_%' ESCAPE '\' OR p.proname IN ('set_online_payment_status','set_public_storefront_promotion'))
      ORDER BY p.proname,p.oid LIMIT 100
    LOOP
      SELECT string_agg('NULL::'||format_type(t.oid,NULL),',' ORDER BY t.position) INTO args
      FROM unnest(fn.proargtypes::oid[]) WITH ORDINALITY AS t(oid,position) LIMIT 1;
      BEGIN
        response:=NULL;
        IF fn.returns_json THEN
          EXECUTE format('SELECT public.%I(%s) LIMIT 1',fn.proname,COALESCE(args,'')) INTO response;
          IF response->>'success'='false' AND response->>'message' ~* 'autorizaci' THEN
            denied:=denied+1;
            CONTINUE;
          END IF;
        ELSE
          EXECUTE format('SELECT public.%I(%s) LIMIT 1',fn.proname,COALESCE(args,''));
        END IF;
        RAISE EXCEPTION 'La RPC % no rechazó al usuario no administrador',fn.proname;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS message=MESSAGE_TEXT,state=RETURNED_SQLSTATE;
        IF state='42501' OR message ~* '(no autorizado|solo.*administrador|not authorized|admin.*required)' THEN denied:=denied+1;
        ELSE RAISE EXCEPTION 'RPC %: rechazo no demostrado (%): %',fn.proname,state,message; END IF;
      END;
    END LOOP;
    report:=report||jsonb_build_object('nonadmin_rpc_calls_rejected',denied);
    EXECUTE 'RESET ROLE';

    PERFORM set_config('request.jwt.claim.sub','',true);
    PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM public.confirm_inventory_reservation(prefix);
      RAISE EXCEPTION 'Visitante pudo confirmar inventario';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM public.reserve_inventory(prefix,'[]'::jsonb,10);
      RAISE EXCEPTION 'Visitante pudo reservar por la función interna';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      INSERT INTO public.web_orders DEFAULT VALUES;
      RAISE EXCEPTION 'Visitante pudo insertar pedido directo';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    SELECT count(*) INTO n FROM (SELECT name,sort_order FROM public.get_public_category_order() LIMIT 1000) q LIMIT 1;
    report:=report||jsonb_build_object('anon_internal_functions_denied',true,'anon_direct_order_insert_denied',true,'public_category_order_readable',true,'public_category_rows',n);
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='ROLLBACK_CONTROLADO_PERMISOS';
  EXCEPTION
    WHEN SQLSTATE 'ZX001' THEN report:=report||jsonb_build_object('rolled_back',true);
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT,state=RETURNED_SQLSTATE;
      report:=report||jsonb_build_object('failure',message,'sqlstate',state,'rolled_back',true);
  END;
  SELECT count(*) INTO n FROM public.products WHERE code LIKE prefix||'%' LIMIT 1;
  report:=report||jsonb_build_object('synthetic_products_remaining',n,'prefix',prefix);
  PERFORM set_config('sirevya.security_report',report::text,true);
END;
$test$;
SELECT current_setting('sirevya.security_report')::jsonb AS report LIMIT 1;
