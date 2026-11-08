-- Verificación de contrato/ACL solamente; no consulta filas de pedidos ni muta datos.
BEGIN;
DO $test$
DECLARE
  v_page_oid oid;
  v_normalizer_oid oid;
  v_return_type text;
  v_definition text;
  v_security_definer boolean;
  v_config text[];
  v_orders_rls_enabled boolean;
  v_admin_read_policy boolean;
  v_unsafe_read_policy boolean;
BEGIN
  v_page_oid:=to_regprocedure('public.admin_list_web_orders_page_v1(text,text,date,date,text,text,integer,integer)');
  v_normalizer_oid:=to_regprocedure('public.sirevya_normalize_web_order_filter(text)');
  IF v_page_oid IS NULL OR v_normalizer_oid IS NULL THEN
    RAISE EXCEPTION 'Falta la RPC paginada o su normalizador';
  END IF;

  SELECT pg_get_function_result(v_page_oid),p.prosecdef,p.proconfig
    INTO v_return_type,v_security_definer,v_config
  FROM pg_proc AS p WHERE p.oid=v_page_oid LIMIT 1;
  v_definition:=pg_get_functiondef(v_page_oid);
  IF v_return_type IS DISTINCT FROM 'jsonb' OR v_security_definer IS DISTINCT FROM true
     OR array_to_string(v_config,',') NOT LIKE '%search_path=public, pg_temp%' THEN
    RAISE EXCEPTION 'La RPC debe devolver jsonb y usar SECURITY DEFINER con search_path fijado';
  END IF;
  IF position('public.is_store_admin()' IN v_definition)=0
     OR position('America/Bogota' IN v_definition)=0
     OR position('LIMIT v_page_size' IN v_definition)=0
     OR position('cities_truncated' IN v_definition)=0 THEN
    RAISE EXCEPTION 'Falta el guard admin, la fecha de Colombia, el límite o la marca de facetas';
  END IF;
  IF position('JOIN public.orders' IN v_definition)>0
     OR position('JOIN public.sales' IN v_definition)>0
     OR position('INSERT INTO public.web_orders' IN v_definition)>0 THEN
    RAISE EXCEPTION 'La RPC no puede mezclar fuentes ni modificar web_orders';
  END IF;

  IF has_function_privilege('authenticated','public.admin_list_web_orders_page_v1(text,text,date,date,text,text,integer,integer)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon','public.admin_list_web_orders_page_v1(text,text,date,date,text,text,integer,integer)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role','public.admin_list_web_orders_page_v1(text,text,date,date,text,text,integer,integer)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('public','public.admin_list_web_orders_page_v1(text,text,date,date,text,text,integer,integer)','EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'La RPC debe ser ejecutable solo por authenticated; el guard valida admin';
  END IF;
  IF has_function_privilege('authenticated','public.sirevya_normalize_web_order_filter(text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('anon','public.sirevya_normalize_web_order_filter(text)','EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'El helper de normalización no debe exponerse a clientes';
  END IF;
  SELECT c.relrowsecurity INTO v_orders_rls_enabled
  FROM pg_class AS c WHERE c.oid='public.web_orders'::regclass LIMIT 1;
  SELECT EXISTS(
    SELECT 1 FROM pg_policies AS p
    WHERE p.schemaname='public' AND p.tablename='web_orders' AND p.cmd='SELECT'
      AND p.roles @> ARRAY['authenticated']::name[]
      AND position('is_store_admin' IN coalesce(p.qual,''))>0
  ) INTO v_admin_read_policy;
  SELECT EXISTS(
    SELECT 1 FROM pg_policies AS p
    WHERE p.schemaname='public' AND p.tablename='web_orders' AND p.cmd='SELECT'
      AND (p.roles @> ARRAY['public']::name[] OR p.roles @> ARRAY['anon']::name[] OR p.roles @> ARRAY['authenticated']::name[])
      AND (p.qual IS NULL OR position('is_store_admin' IN p.qual)=0)
  ) INTO v_unsafe_read_policy;
  IF v_orders_rls_enabled IS DISTINCT FROM true
     OR has_table_privilege('authenticated','public.web_orders','SELECT') IS DISTINCT FROM true
     OR v_admin_read_policy IS DISTINCT FROM true
     OR v_unsafe_read_policy IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'El fallback SELECT requiere GRANT authenticated y policy RLS de solo administrador';
  END IF;
  PERFORM set_config('sirevya.orders_page_test','{"acl":true,"security_definer":true,"read_only":true,"rolled_back":true}',true);
END;
$test$;
ROLLBACK;
