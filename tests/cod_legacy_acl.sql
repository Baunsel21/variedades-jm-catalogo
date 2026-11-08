-- Ejecutar solo después de aplicar docs/deployment/restrict_legacy_cod_rpc_after_frontend.sql.
DO $cod_legacy_acl$
BEGIN
  IF has_function_privilege('anon','public.create_contra_delivery_order(text,text,text,text,text,text,text,text,jsonb)','EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED: RPC COD antiguo sigue ejecutable por anon';
  END IF;
  IF has_function_privilege('authenticated','public.create_contra_delivery_order(text,text,text,text,text,text,text,text,jsonb)','EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED: RPC COD antiguo sigue ejecutable por authenticated';
  END IF;
  IF has_function_privilege('service_role','public.create_contra_delivery_order(text,text,text,text,text,text,text,text,jsonb)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: se perdió el acceso interno de service_role';
  END IF;
  IF has_function_privilege('anon','public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: el endpoint COD con guard ya no es ejecutable por anon';
  END IF;
  RAISE NOTICE 'PASS: RPC legacy solo conserva service_role y el checkout usa el wrapper con guard.';
END;
$cod_legacy_acl$;
