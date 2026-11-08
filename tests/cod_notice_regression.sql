-- Regresión de storefront_cod_notice: contrato ACL/RLS y guard admin.
-- Ejecutar después de 20261108130000_storefront_cod_notice.sql en una base aislada.
-- No crea usuarios, no llama endpoints COD y no toca pedidos, inventario ni pagos.
-- La única fixture runtime es la fila singleton, modificada dentro de BEGIN/ROLLBACK.
BEGIN;

DO $cod_notice_regression$
DECLARE
  v_admin uuid;
  v_outsider uuid:=gen_random_uuid();
  v_table_oid oid;
  v_public_oid oid;
  v_admin_get_oid oid;
  v_admin_save_oid oid;
  v_function_oid oid;
  v_function_name text;
  v_definition text;
  v_config text[];
  v_language name;
  v_security_definer boolean;
  v_rls_enabled boolean;
  v_singleton_count integer;
  v_result jsonb;
  v_public_result jsonb;
  v_enabled boolean;
  v_title text;
  v_body text;
  v_before_enabled boolean;
  v_before_title text;
  v_before_body text;
BEGIN
  SELECT s.admin_user_id
    INTO v_admin
  FROM public.store_settings AS s
  WHERE s.id=1
  LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: falta administrador configurado para probar is_store_admin()';
  END IF;

  v_table_oid:='public.storefront_cod_notice_settings'::regclass;
  v_public_oid:=to_regprocedure('public.get_public_storefront_cod_notice()');
  v_admin_get_oid:=to_regprocedure('public.admin_get_storefront_cod_notice()');
  v_admin_save_oid:=to_regprocedure('public.admin_save_storefront_cod_notice(boolean,text,text)');
  IF v_table_oid IS NULL OR v_public_oid IS NULL OR v_admin_get_oid IS NULL OR v_admin_save_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: falta la tabla o alguna RPC del aviso COD';
  END IF;

  -- La tabla es privada incluso para service_role; el acceso se entrega solo por RPC.
  SELECT c.relrowsecurity
    INTO v_rls_enabled
  FROM pg_class AS c
  WHERE c.oid=v_table_oid
  LIMIT 1;
  IF v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED: storefront_cod_notice_settings no tiene RLS habilitado';
  END IF;

  SELECT count(*)
    INTO v_singleton_count
  FROM public.storefront_cod_notice_settings
  LIMIT 1;
  IF v_singleton_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED: el singleton COD debe tener exactamente una fila, recibió %',v_singleton_count;
  END IF;
  SELECT s.enabled,s.title,s.body
    INTO v_before_enabled,v_before_title,v_before_body
  FROM public.storefront_cod_notice_settings AS s
  WHERE s.id=1
  LIMIT 1;
  IF v_before_enabled IS DISTINCT FROM false
     OR v_before_title IS DISTINCT FROM ''
     OR v_before_body IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'TEST FAILED: el singleton nuevo no inicia disabled=false y copy vacío';
  END IF;

  FOR v_function_oid,v_function_name IN
    SELECT x.oid,x.function_name
    FROM (VALUES
      (v_public_oid,'get_public_storefront_cod_notice'),
      (v_admin_get_oid,'admin_get_storefront_cod_notice'),
      (v_admin_save_oid,'admin_save_storefront_cod_notice')
    ) AS x(oid,function_name)
  LOOP
    SELECT p.prosecdef,p.proconfig,l.lanname
      INTO v_security_definer,v_config,v_language
    FROM pg_proc AS p
    JOIN pg_language AS l ON l.oid=p.prolang
    WHERE p.oid=v_function_oid
    LIMIT 1;
    IF v_security_definer IS DISTINCT FROM true
       OR v_language IS DISTINCT FROM 'plpgsql'::name
       OR ('search_path=public, pg_temp'=ANY(coalesce(v_config,ARRAY[]::text[]))) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'TEST FAILED: % debe ser plpgsql SECURITY DEFINER con search_path fijo public, pg_temp',v_function_name;
    END IF;
  END LOOP;

  v_definition:=pg_get_functiondef(v_admin_get_oid);
  IF position('public.is_store_admin()' IN v_definition)=0 THEN
    RAISE EXCEPTION 'TEST FAILED: admin_get_storefront_cod_notice no comprueba is_store_admin()';
  END IF;
  v_definition:=pg_get_functiondef(v_admin_save_oid);
  IF position('public.is_store_admin()' IN v_definition)=0 THEN
    RAISE EXCEPTION 'TEST FAILED: admin_save_storefront_cod_notice no comprueba is_store_admin()';
  END IF;

  -- ACL de tabla: ningún rol cliente ni service_role puede leer o escribir directamente.
  -- PUBLIC es el pseudo-rol ACL grantee=0, no una fila de pg_roles.
  IF EXISTS (
    SELECT 1 FROM pg_class c,
      LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid=v_table_oid AND a.grantee=0
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p,
      LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid IN (v_public_oid,v_admin_get_oid,v_admin_save_oid)
      AND a.grantee=0 AND a.privilege_type='EXECUTE'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: PUBLIC conserva ACL sobre tabla o RPC de mensaje COD';
  END IF;
  IF has_table_privilege('anon','public.storefront_cod_notice_settings','SELECT')
     OR has_table_privilege('anon','public.storefront_cod_notice_settings','INSERT')
     OR has_table_privilege('anon','public.storefront_cod_notice_settings','UPDATE')
     OR has_table_privilege('anon','public.storefront_cod_notice_settings','DELETE')
     OR has_table_privilege('anon','public.storefront_cod_notice_settings','TRUNCATE')
     OR has_table_privilege('anon','public.storefront_cod_notice_settings','REFERENCES')
     OR has_table_privilege('anon','public.storefront_cod_notice_settings','TRIGGER')
     OR has_table_privilege('authenticated','public.storefront_cod_notice_settings','SELECT')
     OR has_table_privilege('authenticated','public.storefront_cod_notice_settings','INSERT')
     OR has_table_privilege('authenticated','public.storefront_cod_notice_settings','UPDATE')
     OR has_table_privilege('authenticated','public.storefront_cod_notice_settings','DELETE')
     OR has_table_privilege('authenticated','public.storefront_cod_notice_settings','TRUNCATE')
     OR has_table_privilege('authenticated','public.storefront_cod_notice_settings','REFERENCES')
     OR has_table_privilege('authenticated','public.storefront_cod_notice_settings','TRIGGER')
     OR has_table_privilege('service_role','public.storefront_cod_notice_settings','SELECT')
     OR has_table_privilege('service_role','public.storefront_cod_notice_settings','INSERT')
     OR has_table_privilege('service_role','public.storefront_cod_notice_settings','UPDATE')
     OR has_table_privilege('service_role','public.storefront_cod_notice_settings','DELETE')
     OR has_table_privilege('service_role','public.storefront_cod_notice_settings','TRUNCATE')
     OR has_table_privilege('service_role','public.storefront_cod_notice_settings','REFERENCES')
     OR has_table_privilege('service_role','public.storefront_cod_notice_settings','TRIGGER') THEN
    RAISE EXCEPTION 'TEST FAILED: la tabla del aviso COD conserva privilegios directos';
  END IF;

  -- RPC pública: solo anon/authenticated; devuelve únicamente el copy habilitado.
  IF has_function_privilege('anon','public.get_public_storefront_cod_notice()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('authenticated','public.get_public_storefront_cod_notice()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.get_public_storefront_cod_notice()','EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED: ACL de la RPC pública del aviso COD no es mínima';
  END IF;

  -- RPC administrativas: solo authenticated; service_role no recibe bypass por ACL.
  IF has_function_privilege('anon','public.admin_get_storefront_cod_notice()','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.admin_get_storefront_cod_notice()','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.admin_get_storefront_cod_notice()','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('anon','public.admin_save_storefront_cod_notice(boolean,text,text)','EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated','public.admin_save_storefront_cod_notice(boolean,text,text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.admin_save_storefront_cod_notice(boolean,text,text)','EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED: ACL de las RPC admin del aviso COD no es mínima';
  END IF;

  -- Fixture reversible: identidad autenticada ajena no puede leer ni escribir por las RPC admin.
  PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_outsider,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.admin_get_storefront_cod_notice() INTO v_result;
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR v_result->>'code' IS DISTINCT FROM 'COD_NOTICE_UNAUTHORIZED' THEN
    RAISE EXCEPTION 'TEST FAILED: admin_get aceptó un uid no administrador: %',v_result;
  END IF;
  SELECT public.admin_save_storefront_cod_notice(true,'NO AUTORIZADO','NO AUTORIZADO') INTO v_result;
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR v_result->>'code' IS DISTINCT FROM 'COD_NOTICE_UNAUTHORIZED' THEN
    RAISE EXCEPTION 'TEST FAILED: admin_save aceptó un uid no administrador: %',v_result;
  END IF;
  EXECUTE 'RESET ROLE';

  -- Claim del administrador configurado en staging: sin contraseña/token ni usuario nuevo.
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.admin_get_storefront_cod_notice() INTO v_result;
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR v_result->>'enabled' IS DISTINCT FROM 'false'
     OR v_result->>'title' IS DISTINCT FROM ''
     OR v_result->>'body' IS DISTINCT FROM ''
     OR v_result->>'updated_at' IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: admin_get no devolvió el singleton disabled esperado: %',v_result;
  END IF;

  FOR v_result IN
    SELECT x.result FROM (VALUES
      (public.admin_save_storefront_cod_notice(NULL,'Título','Contenido')),
      (public.admin_save_storefront_cod_notice(true,'','Contenido')),
      (public.admin_save_storefront_cod_notice(true,'Título',E'\n\t ')),
      (public.admin_save_storefront_cod_notice(true,repeat('x',121),'Contenido')),
      (public.admin_save_storefront_cod_notice(true,'Título',repeat('x',3001))),
      (public.admin_save_storefront_cod_notice(true,E'Título\n','Contenido')),
      (public.admin_save_storefront_cod_notice(true,'Título','Control'||chr(1))),
      (public.admin_save_storefront_cod_notice(true,U&'\00a0\2003','Contenido')),
      (public.admin_save_storefront_cod_notice(true,'Título',U&'\2003\2028\feff')),
      (public.admin_save_storefront_cod_notice(true,'Título','Control'||chr(133)))
    ) x(result)
  LOOP
    IF v_result->>'success' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'TEST FAILED: texto/estado inválido se aceptó: %',v_result;
    END IF;
  END LOOP;
  SELECT public.admin_get_storefront_cod_notice() INTO v_result;
  IF v_result->>'enabled' IS DISTINCT FROM 'false' OR v_result->>'title' IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'TEST FAILED: una validación fallida modificó el singleton';
  END IF;
  SELECT public.admin_save_storefront_cod_notice(true,repeat('🎁',120),repeat('🎁',3000)) INTO v_result;
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR char_length(v_result->>'title')<>120 OR char_length(v_result->>'body')<>3000 THEN
    RAISE EXCEPTION 'TEST FAILED: el límite debe contar caracteres Unicode, no bytes';
  END IF;
  SELECT public.admin_save_storefront_cod_notice(true,' Título ',E'Uno\r\nDos\rTres') INTO v_result;
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR v_result->>'title' IS DISTINCT FROM 'Título'
     OR v_result->>'body' IS DISTINCT FROM E'Uno\nDos\nTres' THEN
    RAISE EXCEPTION 'TEST FAILED: normalización título/CRLF inválida';
  END IF;
  SELECT public.admin_save_storefront_cod_notice(true,U&'\00a0\2003Título\3000\feff','Contenido') INTO v_result;
  IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'title' IS DISTINCT FROM 'Título' THEN
    RAISE EXCEPTION 'TEST FAILED: trim Unicode debe coincidir con String.trim()';
  END IF;

  SELECT public.admin_save_storefront_cod_notice(
    true,
    'Aviso COD de prueba',
    'Contenido de prueba; no es una orden ni una configuración de pago.'
  ) INTO v_result;
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR v_result->>'enabled' IS DISTINCT FROM 'true'
     OR v_result->>'title' IS DISTINCT FROM 'Aviso COD de prueba'
     OR v_result->>'body' IS DISTINCT FROM 'Contenido de prueba; no es una orden ni una configuración de pago.'
     OR v_result->>'updated_at' IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: admin_save no guardó el copy sintético: %',v_result;
  END IF;
  SELECT public.admin_get_storefront_cod_notice() INTO v_result;
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR v_result->>'enabled' IS DISTINCT FROM 'true'
     OR v_result->>'title' IS DISTINCT FROM 'Aviso COD de prueba'
     OR v_result->>'body' IS DISTINCT FROM 'Contenido de prueba; no es una orden ni una configuración de pago.' THEN
    RAISE EXCEPTION 'TEST FAILED: admin_get no leyó el copy guardado: %',v_result;
  END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT public.get_public_storefront_cod_notice() INTO v_public_result;
  IF v_public_result IS DISTINCT FROM jsonb_build_object(
    'success',true,
    'enabled',true,
    'title','Aviso COD de prueba',
    'body','Contenido de prueba; no es una orden ni una configuración de pago.'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: anon no recibió únicamente el copy habilitado: %',v_public_result;
  END IF;
  IF v_public_result ? 'updated_at' THEN
    RAISE EXCEPTION 'TEST FAILED: la RPC pública expuso updated_at';
  END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_outsider,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.get_public_storefront_cod_notice() INTO v_public_result;
  IF v_public_result IS DISTINCT FROM jsonb_build_object(
    'success',true,
    'enabled',true,
    'title','Aviso COD de prueba',
    'body','Contenido de prueba; no es una orden ni una configuración de pago.'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: authenticated no recibió el copy público habilitado: %',v_public_result;
  END IF;
  EXECUTE 'RESET ROLE';

  -- Disabled oculta título/cuerpo al público aunque el admin pueda conservar texto en la fila.
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.admin_save_storefront_cod_notice(false,'Copy conservado','No se debe publicar mientras esté disabled') INTO v_result;
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR v_result->>'enabled' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'TEST FAILED: admin_save no pudo desactivar el aviso: %',v_result;
  END IF;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT public.get_public_storefront_cod_notice() INTO v_public_result;
  IF v_public_result IS DISTINCT FROM jsonb_build_object(
    'success',true,
    'enabled',false,
    'title','',
    'body',''
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: anon recibió copy cuando el aviso estaba disabled: %',v_public_result;
  END IF;
  EXECUTE 'RESET ROLE';

  -- La reversibilidad la garantiza el ROLLBACK exterior: no se crea usuario ni fixture persistente.
  RAISE NOTICE 'PASS: ACL tabla/RPC, RLS, search_path, guard admin, límites/trim Unicode, copy enabled/disabled y claims anon/authenticated validados.';
END;
$cod_notice_regression$;

ROLLBACK;
