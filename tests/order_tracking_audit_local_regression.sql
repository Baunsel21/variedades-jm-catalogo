\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v uuid := '44444444-4444-4444-8444-444444444444';
  v_unrequested uuid := '66666666-6666-4666-8666-666666666666';
  v_unknown uuid := '55555555-5555-4555-8555-555555555555';
  result jsonb;
  n integer;
  row_json jsonb;
BEGIN
  IF has_table_privilege('anon', 'public.storefront_change_log', 'SELECT')
     OR has_table_privilege('anon', 'public.web_order_tracking', 'SELECT') THEN
    RAISE EXCEPTION 'unexpected anon access to tracking/audit tables (log %, tracking %)',
      has_table_privilege('anon', 'public.storefront_change_log', 'SELECT'),
      has_table_privilege('anon', 'public.web_order_tracking', 'SELECT');
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.storefront_change_log', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated role needs read privilege guarded by RLS';
  END IF;
  IF has_table_privilege('authenticated', 'public.web_order_tracking', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'authenticated must not write tracking table directly';
  END IF;
  IF has_function_privilege('anon', 'public.admin_set_web_order_tracking(uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.admin_set_web_order_tracking(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC execute leaked to anon/service_role';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_web_order_tracking(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must be able to call admin RPC (function checks admin status)';
  END IF;
  IF has_function_privilege('anon', 'public.admin_list_web_order_tracking(uuid[])', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.admin_list_web_order_tracking(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'tracking list RPC execute leaked to anon/service_role';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_list_web_order_tracking(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must be able to call the scoped tracking list RPC';
  END IF;
  IF to_regprocedure('public.admin_list_web_order_tracking(integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'unscoped legacy tracking list RPC must not remain callable';
  END IF;
  IF (SELECT count(*) FROM public.storefront_change_log WHERE entity_id=v) <> 0 THEN
    RAISE EXCEPTION 'migration must not backfill pre-existing orders';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  PERFORM set_config('request.jwt.claim.is_admin', 'true', true);
  INSERT INTO public.web_orders(id, status) VALUES (v_unrequested, 'confirmado');
  SET LOCAL ROLE authenticated;

  result := public.admin_set_web_order_tracking(v_unrequested, 'Carrier', 'GUIA-NO-SOLICITADA', NULL);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'second synthetic tracking create failed: %', result;
  END IF;
  result := public.admin_list_web_order_tracking(ARRAY[v]::uuid[]);
  IF jsonb_array_length(result) <> 0 THEN
    RAISE EXCEPTION 'scoped list must not return a tracked order outside the requested IDs: %', result;
  END IF;
  result := public.admin_list_web_order_tracking(ARRAY[v, v_unrequested, v_unknown]::uuid[]);
  IF jsonb_array_length(result) <> 1 OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(result) AS entry(value)
    WHERE value->>'web_order_id' = v_unrequested::text
  ) THEN
    RAISE EXCEPTION 'scoped list must include requested existing tracked rows and ignore nonexistent IDs: %', result;
  END IF;
  IF result @> jsonb_build_array(jsonb_build_object('web_order_id', v::text)) THEN
    RAISE EXCEPTION 'untracked requested order unexpectedly has a tracking row: %', result;
  END IF;
  IF jsonb_array_length(public.admin_list_web_order_tracking(ARRAY[]::uuid[])) <> 0 THEN
    RAISE EXCEPTION 'empty UUID array must return an empty list';
  END IF;
  BEGIN
    PERFORM public.admin_list_web_order_tracking(NULL::uuid[]);
    RAISE EXCEPTION 'NULL UUID array unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_list_web_order_tracking(ARRAY[v, NULL::uuid]);
    RAISE EXCEPTION 'UUID array with NULL element unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_list_web_order_tracking(ARRAY[[v, v_unrequested]]::uuid[]);
    RAISE EXCEPTION 'multidimensional UUID array unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_list_web_order_tracking(array_fill(v, ARRAY[5001]));
    RAISE EXCEPTION 'over-limit UUID array unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  result := public.admin_set_web_order_tracking(v, 'Servientrega', 'GUIA-LOCAL-001', 'https://tracking.example.test/GUIA-LOCAL-001');
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'changed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'tracking create failed: %', result;
  END IF;
  IF (SELECT count(*) FROM public.web_order_tracking WHERE web_order_id=v) <> 1 THEN
    RAISE EXCEPTION 'expected one tracking row';
  END IF;
  IF (SELECT count(*) FROM public.storefront_change_log WHERE entity_id=v AND event_type='tracking_created') <> 1 THEN
    RAISE EXCEPTION 'expected one tracking_created audit event';
  END IF;
  IF (SELECT count(*) FROM public.storefront_change_log WHERE entity_id=v AND event_type='order_created') <> 0 THEN
    RAISE EXCEPTION 'old orders must not get synthetic order_created history';
  END IF;

  result := public.admin_set_web_order_tracking(v, 'Servientrega', 'GUIA-LOCAL-001', 'https://tracking.example.test/GUIA-LOCAL-001');
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'changed' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'idempotent tracking save must be a no-op: %', result;
  END IF;
  IF (SELECT count(*) FROM public.storefront_change_log WHERE entity_id=v AND event_type='tracking_created') <> 1 THEN
    RAISE EXCEPTION 'identical save must not duplicate audit event';
  END IF;

  result := public.admin_set_web_order_tracking(v, 'Coordinadora', 'GUIA-LOCAL-002', 'https://tracking.example.test/GUIA-LOCAL-002');
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'changed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'tracking edit failed: %', result;
  END IF;
  IF (SELECT count(*) FROM public.storefront_change_log WHERE entity_id=v AND event_type='tracking_updated') <> 1 THEN
    RAISE EXCEPTION 'expected one tracking_updated event';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.storefront_change_log WHERE entity_id=v AND event_type='tracking_updated' AND tracking_url_changed)
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='storefront_change_log' AND column_name IN ('before_tracking_url','after_tracking_url')) THEN
    RAISE EXCEPTION 'tracking history must record only the URL-change flag, never URL snapshots';
  END IF;

  result := public.admin_set_web_order_tracking(v, 'Coordinadora', 'GUIA-X', 'javascript:alert(1)');
  IF result->>'code' IS DISTINCT FROM 'TRACKING_URL_INVALID' THEN
    RAISE EXCEPTION 'unsafe tracking URL must be rejected: %', result;
  END IF;
  result := public.admin_set_web_order_tracking(v, '', 'GUIA-X', NULL);
  IF result->>'code' IS DISTINCT FROM 'TRACKING_FIELDS_INVALID' THEN
    RAISE EXCEPTION 'empty carrier must be rejected: %', result;
  END IF;
  result := public.admin_set_web_order_tracking('55555555-5555-4555-8555-555555555555', 'Carrier', 'GUIA-X', NULL);
  IF result->>'code' IS DISTINCT FROM 'WEB_ORDER_NOT_FOUND' THEN
    RAISE EXCEPTION 'unknown order must be rejected: %', result;
  END IF;

  UPDATE public.web_orders SET status='enviado' WHERE id=v;
  UPDATE public.web_orders SET status='enviado' WHERE id=v;
  IF (SELECT count(*) FROM public.storefront_change_log WHERE entity_id=v AND event_type='status_changed') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one status_changed event';
  END IF;

  SELECT value INTO row_json FROM jsonb_array_elements(public.admin_list_web_order_tracking(ARRAY[v]::uuid[])) value LIMIT 1;
  IF row_json->>'carrier_name' IS DISTINCT FROM 'Coordinadora' OR row_json->>'tracking_number' IS DISTINCT FROM 'GUIA-LOCAL-002' THEN
    RAISE EXCEPTION 'admin tracking list did not reflect latest save: %', row_json;
  END IF;
  IF jsonb_array_length(public.admin_list_web_order_change_history(v, 1)) <> 1 THEN
    RAISE EXCEPTION 'history limit should be enforced';
  END IF;
  result := public.admin_list_web_order_change_history(v, 50);
  IF jsonb_array_length(result) <> 3 THEN
    RAISE EXCEPTION 'expected tracking create/update and status event, got % events: %', jsonb_array_length(result), result;
  END IF;
  IF NOT (result @> '[{"event_type":"status_changed","before_status":"confirmado","after_status":"enviado"}]'::jsonb) THEN
    RAISE EXCEPTION 'status audit event missing or incomplete: %', result;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.is_admin', 'false', true);
  SET LOCAL ROLE authenticated;
  IF (SELECT count(*) FROM public.storefront_change_log WHERE entity_id=v) <> 0 THEN
    RAISE EXCEPTION 'RLS should hide audit rows from a non-admin authenticated user';
  END IF;
  BEGIN
    PERFORM public.admin_list_web_order_tracking(ARRAY[v]::uuid[]);
    RAISE EXCEPTION 'non-admin RPC unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_set_web_order_tracking(v, 'Carrier', 'GUIA-X', NULL);
    RAISE EXCEPTION 'non-admin save unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
ROLLBACK;
