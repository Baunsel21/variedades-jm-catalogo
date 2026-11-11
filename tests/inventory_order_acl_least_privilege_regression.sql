BEGIN;
DO $acl$
DECLARE
  v_privilege text;
  v_relation text;
  v_fn regprocedure;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY['public.orders','public.inventory_reservations'] LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('anon',v_relation,v_privilege) OR has_table_privilege('authenticated',v_relation,v_privilege) THEN
        RAISE EXCEPTION 'Browser role retains % on %.',v_privilege,v_relation;
      END IF;
      IF NOT has_table_privilege('service_role',v_relation,v_privilege) AND v_privilege IN ('SELECT','INSERT','UPDATE','DELETE') THEN
        RAISE EXCEPTION 'service_role lost required % on %.',v_privilege,v_relation;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
    IF has_table_privilege('anon','public.product_images',v_privilege) THEN
      RAISE EXCEPTION 'anon retains % on product_images.',v_privilege;
    END IF;
  END LOOP;
  FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    IF NOT has_table_privilege('authenticated','public.product_images',v_privilege) THEN
      RAISE EXCEPTION 'authenticated admin path lost % on product_images.',v_privilege;
    END IF;
    IF NOT has_table_privilege('service_role','public.product_images',v_privilege) THEN
      RAISE EXCEPTION 'service_role lost % on product_images.',v_privilege;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.cleanup_inventory_reservations()'::regprocedure,
    'public.release_expired_inventory_reservations()'::regprocedure
  ] LOOP
    IF has_function_privilege('anon',v_fn,'EXECUTE') OR has_function_privilege('authenticated',v_fn,'EXECUTE') THEN
      RAISE EXCEPTION 'Browser role retains EXECUTE on %.',v_fn;
    END IF;
    IF NOT has_function_privilege('service_role',v_fn,'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lost EXECUTE on %.',v_fn;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_fn) THEN
      RAISE EXCEPTION 'Function % unexpectedly stopped being SECURITY DEFINER.',v_fn;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_class WHERE oid IN ('public.orders'::regclass,'public.inventory_reservations'::regclass,'public.product_images'::regclass) AND relrowsecurity) <> 3 THEN
    RAISE EXCEPTION 'RLS state changed unexpectedly.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_images'
      AND 'authenticated'::name=ANY(roles) AND coalesce(qual,'') ILIKE '%is_store_admin%'
  ) THEN
    RAISE EXCEPTION 'Authenticated product_images admin RLS policy is missing.';
  END IF;
END;
$acl$;

SET ROLE anon;
DO $anon_denial$
BEGIN
  BEGIN PERFORM public.cleanup_inventory_reservations();
    RAISE EXCEPTION 'anon executed cleanup_inventory_reservations';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.release_expired_inventory_reservations();
    RAISE EXCEPTION 'anon executed release_expired_inventory_reservations';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$anon_denial$;
RESET ROLE;

SET ROLE authenticated;
DO $authenticated_denial$
BEGIN
  BEGIN PERFORM public.cleanup_inventory_reservations();
    RAISE EXCEPTION 'authenticated executed cleanup_inventory_reservations';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.release_expired_inventory_reservations();
    RAISE EXCEPTION 'authenticated executed release_expired_inventory_reservations';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$authenticated_denial$;
RESET ROLE;

SET ROLE service_role;
SELECT public.cleanup_inventory_reservations();
SELECT public.release_expired_inventory_reservations();
RESET ROLE;
ROLLBACK;
