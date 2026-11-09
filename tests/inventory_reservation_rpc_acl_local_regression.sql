BEGIN;
DO $privileges$
DECLARE
  v_is_security_definer boolean;
  v_settings text[];
BEGIN
  IF has_function_privilege('anon','public.attach_inventory_reservation(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'anon still has EXECUTE on attach_inventory_reservation';
  END IF;
  IF has_function_privilege('authenticated','public.attach_inventory_reservation(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated still has EXECUTE on attach_inventory_reservation';
  END IF;
  IF NOT has_function_privilege('service_role','public.attach_inventory_reservation(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on attach_inventory_reservation';
  END IF;
  IF has_function_privilege('anon','public.release_inventory_reservation(text)','EXECUTE') THEN
    RAISE EXCEPTION 'anon still has EXECUTE on release_inventory_reservation';
  END IF;
  IF has_function_privilege('authenticated','public.release_inventory_reservation(text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated still has EXECUTE on release_inventory_reservation';
  END IF;
  IF NOT has_function_privilege('service_role','public.release_inventory_reservation(text)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on release_inventory_reservation';
  END IF;

  SELECT p.prosecdef,p.proconfig INTO v_is_security_definer,v_settings
    FROM pg_proc AS p
   WHERE p.oid='public.release_inventory_reservation(text)'::regprocedure;
  IF v_is_security_definer IS DISTINCT FROM true OR NOT ('search_path=public, pg_temp'=ANY(v_settings)) THEN
    RAISE EXCEPTION 'release function security-definer/search_path contract changed unexpectedly';
  END IF;
  SELECT p.prosecdef,p.proconfig INTO v_is_security_definer,v_settings
    FROM pg_proc AS p
   WHERE p.oid='public.attach_inventory_reservation(text,text)'::regprocedure;
  IF v_is_security_definer IS DISTINCT FROM true OR NOT ('search_path=public, pg_temp'=ANY(v_settings)) THEN
    RAISE EXCEPTION 'attach function security-definer/search_path contract changed unexpectedly';
  END IF;
END;
$privileges$;

SET ROLE anon;
DO $anon_denial$
DECLARE v_denied boolean;
BEGIN
  v_denied:=false;
  BEGIN
    PERFORM public.release_inventory_reservation('JMRES-RELEASE-SYNTHETIC');
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'anon directly released a synthetic hold'; END IF;
  v_denied:=false;
  BEGIN
    PERFORM * FROM public.attach_inventory_reservation('JMRES-ATTACH-OLD-SYNTHETIC','JMRES-ATTACH-NEW-SYNTHETIC');
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'anon directly rebound a synthetic hold'; END IF;
END;
$anon_denial$;
RESET ROLE;

SET ROLE authenticated;
DO $authenticated_denial$
DECLARE v_denied boolean;
BEGIN
  v_denied:=false;
  BEGIN
    PERFORM public.release_inventory_reservation('JMRES-RELEASE-SYNTHETIC');
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'authenticated directly released a synthetic hold'; END IF;
  v_denied:=false;
  BEGIN
    PERFORM * FROM public.attach_inventory_reservation('JMRES-ATTACH-OLD-SYNTHETIC','JMRES-ATTACH-NEW-SYNTHETIC');
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'authenticated directly rebound a synthetic hold'; END IF;
END;
$authenticated_denial$;
RESET ROLE;

SET ROLE service_role;
SELECT public.release_inventory_reservation('JMRES-RELEASE-SYNTHETIC');
SELECT success FROM public.attach_inventory_reservation('JMRES-ATTACH-OLD-SYNTHETIC','JMRES-ATTACH-NEW-SYNTHETIC');
RESET ROLE;

DO $service_role_result$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.inventory_reservations WHERE reference='JMRES-RELEASE-SYNTHETIC' AND status='RELEASED') THEN
    RAISE EXCEPTION 'service_role can no longer release through the trusted server path';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_reservations WHERE reference='JMRES-ATTACH-NEW-SYNTHETIC' AND status='active') THEN
    RAISE EXCEPTION 'service_role can no longer attach through the trusted server path';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_reservations WHERE reference='JMRES-ATTACH-OLD-SYNTHETIC') THEN
    RAISE EXCEPTION 'attach left an unexpected old reference';
  END IF;
END;
$service_role_result$;

ROLLBACK;
