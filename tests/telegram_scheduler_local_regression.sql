\set ON_ERROR_STOP on
BEGIN;
SET LOCAL test.is_admin = 'true';
SET LOCAL test.uid = '22222222-2222-4222-8222-222222222222';

DO $assert_scheduler_install$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'sirevya-telegram-dispatch') <> 1 THEN
    RAISE EXCEPTION 'scheduler migration did not leave exactly one named job';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'sirevya-telegram-dispatch'
       AND schedule = '* * * * *'
       AND command = 'SELECT public.sirevya_telegram_schedule_tick();'
       AND active IS TRUE
  ) THEN RAISE EXCEPTION 'scheduled command does not match expected tick'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'scheduler extensions were not registered in the disposable DB';
  END IF;
  IF has_table_privilege('anon', 'net.http_request_queue', 'SELECT')
     OR has_table_privilege('authenticated', 'net.http_request_queue', 'SELECT')
     OR has_table_privilege('anon', 'net._http_response', 'SELECT')
     OR has_table_privilege('authenticated', 'net._http_response', 'SELECT') THEN
    RAISE EXCEPTION 'client roles can read pg_net request/response tables';
  END IF;
  IF has_sequence_privilege('anon', 'net.http_request_queue_id_seq', 'SELECT')
     OR has_sequence_privilege('authenticated', 'net.http_request_queue_id_seq', 'SELECT') THEN
    RAISE EXCEPTION 'client roles can read pg_net queue sequence';
  END IF;
  IF has_schema_privilege('anon', 'net', 'USAGE')
     OR has_schema_privilege('authenticated', 'net', 'USAGE')
     OR has_function_privilege('anon', 'net.http_post(text,jsonb,jsonb,jsonb,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'net.http_post(text,jsonb,jsonb,jsonb,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'client roles can call pg_net egress functions';
  END IF;
  IF has_function_privilege('anon', 'public.set_sirevya_telegram_dispatcher_ready(boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.set_sirevya_telegram_dispatcher_ready(boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.set_sirevya_telegram_dispatcher_ready(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'dispatcher readiness setter is not service_role-only';
  END IF;
END
$assert_scheduler_install$;

DO $assert_dispatcher_rpc_grants$
BEGIN
  IF has_function_privilege('anon', 'public.get_sirevya_telegram_project_url()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_sirevya_telegram_project_url()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_sirevya_telegram_project_url()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.release_sirevya_telegram_dispatch_lock(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.release_sirevya_telegram_dispatch_lock(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.release_sirevya_telegram_dispatch_lock(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'project URL and lock release RPC grants are incorrect';
  END IF;
END
$assert_dispatcher_rpc_grants$;

DO $assert_readiness$
DECLARE v_status jsonb;
BEGIN
  v_status := public.get_sirevya_telegram_notification_status();
  IF (v_status->>'scheduler_ready')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'status RPC failed to report scheduler ready: %', v_status;
  END IF;
  IF (v_status->>'enabled')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'notifications were not left disabled by default';
  END IF;
  IF (v_status->>'dispatcher_ready')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'dispatcher readiness was not false by default';
  END IF;
  IF (v_status->>'dispatch_in_flight')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'dispatch lock was not empty by default';
  END IF;
END
$assert_readiness$;

-- Disabled tick creates no HTTP request in the mock queue.
SELECT public.sirevya_telegram_schedule_tick();
DO $assert_disabled_tick$
BEGIN
  IF (SELECT count(*) FROM net.http_request_queue) <> 0 THEN
    RAISE EXCEPTION 'disabled scheduler enqueued an HTTP request';
  END IF;
END
$assert_disabled_tick$;

-- The mock function only records a request in this local table; it never performs network I/O.
DO $assert_enabled_tick$
DECLARE
  v_result jsonb;
  v_secret text;
  v_headers jsonb;
  v_url text;
  v_body jsonb;
  v_timeout integer;
  v_count bigint;
  v_job_id bigint;
  v_lock_token uuid;
  v_next_lock_token uuid;
BEGIN
  v_result := public.set_sirevya_telegram_notifications_enabled(true);
  IF v_result->>'code' IS DISTINCT FROM 'DISPATCHER_NOT_READY' OR COALESCE((v_result->>'success')::boolean, true) THEN
    RAISE EXCEPTION 'admin enabled before worker deployment verification: %', v_result;
  END IF;
  UPDATE public.sirevya_telegram_notification_settings SET enabled = true WHERE id = 1;
  INSERT INTO public.orders (id, reference, payment_method, payment_status, total, order_status)
  VALUES ('00000000-0000-4000-8000-000000000050', 'JM-SCHEDULER-SYNTHETIC', 'wompi', 'PENDING', 50000, 'new');
  SELECT count(*) INTO v_count FROM public.claim_sirevya_telegram_notifications(5, 600);
  IF v_count <> 0 THEN RAISE EXCEPTION 'claim proceeded before dispatcher readiness marker'; END IF;
  PERFORM public.sirevya_telegram_schedule_tick();
  IF (SELECT count(*) FROM net.http_request_queue) <> 0 THEN
    RAISE EXCEPTION 'scheduler sent request before dispatcher readiness marker';
  END IF;
  UPDATE public.sirevya_telegram_notification_settings SET enabled = false WHERE id = 1;
  -- Synthetic service_role-only acknowledgement simulates post-deploy verification; it sends no message.
  IF public.set_sirevya_telegram_dispatcher_ready(true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'dispatcher readiness could not be marked after scheduler checks';
  END IF;
  v_result := public.get_sirevya_telegram_notification_status();
  IF (v_result->>'dispatcher_ready')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'dispatcher readiness marker was not recorded';
  END IF;
  v_result := public.set_sirevya_telegram_notifications_enabled(true);
  IF (v_result->>'success')::boolean IS DISTINCT FROM true OR (v_result->>'enabled')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'admin could not enable after scheduler and worker readiness: %', v_result;
  END IF;
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'sirevya-telegram-dispatch' AND active IS TRUE LIMIT 1;
  IF v_job_id IS NULL THEN RAISE EXCEPTION 'active cron job disappeared before dynamic readiness test'; END IF;
  PERFORM cron.unschedule(v_job_id);
  SELECT count(*) INTO v_count FROM public.claim_sirevya_telegram_notifications(5, 600);
  IF v_count <> 0 THEN RAISE EXCEPTION 'claim proceeded after scheduler readiness was lost'; END IF;
  IF public._sirevya_telegram_scheduler_ready() IS DISTINCT FROM false THEN RAISE EXCEPTION 'scheduler helper stayed ready without the job'; END IF;
  PERFORM public.sirevya_telegram_schedule_tick();
  IF (SELECT count(*) FROM net.http_request_queue) <> 0 THEN
    RAISE EXCEPTION 'tick enqueued a request after scheduler readiness was lost';
  END IF;
  PERFORM cron.schedule('sirevya-telegram-dispatch', '* * * * *', 'SELECT public.sirevya_telegram_schedule_tick();');
  IF public._sirevya_telegram_scheduler_ready() IS DISTINCT FROM true THEN RAISE EXCEPTION 'scheduler readiness did not recover after restoring cron'; END IF;
  UPDATE cron.job SET command = 'SELECT 1;' WHERE jobname = 'sirevya-telegram-dispatch';
  IF public._sirevya_telegram_scheduler_ready() IS DISTINCT FROM false THEN RAISE EXCEPTION 'scheduler helper accepted an altered job command'; END IF;
  SELECT count(*) INTO v_count FROM public.claim_sirevya_telegram_notifications(5, 600);
  IF v_count <> 0 THEN RAISE EXCEPTION 'claim proceeded after the scheduled command was altered'; END IF;
  PERFORM public.sirevya_telegram_schedule_tick();
  IF (SELECT count(*) FROM net.http_request_queue) <> 0 THEN RAISE EXCEPTION 'tick dispatched with an altered cron command'; END IF;
  UPDATE cron.job SET command = 'SELECT public.sirevya_telegram_schedule_tick();' WHERE jobname = 'sirevya-telegram-dispatch';
  IF public._sirevya_telegram_scheduler_ready() IS DISTINCT FROM true THEN RAISE EXCEPTION 'scheduler helper did not recover after command restore'; END IF;
  PERFORM public.sirevya_telegram_schedule_tick();
  SELECT headers, url, body, timeout_milliseconds INTO v_headers, v_url, v_body, v_timeout FROM net.http_request_queue ORDER BY id LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'sirevya_telegram_dispatch_secret' ORDER BY created_at DESC LIMIT 1;
  IF v_headers->>'x-sirevya-dispatch-secret' IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'dispatcher secret header did not come from Vault';
  END IF;
  IF v_headers->>'Content-Type' IS DISTINCT FROM 'application/json'
     OR public._sirevya_telegram_payload_key_count(v_headers) <> 2 THEN
    RAISE EXCEPTION 'unexpected request headers: %', v_headers;
  END IF;
  IF v_url IS DISTINCT FROM 'https://hnlbbtnfmbnbkcgegufa.supabase.co/functions/v1/telegram-dispatch'
     OR v_body->>'action' IS DISTINCT FROM 'dispatch'
     OR public._sirevya_telegram_payload_key_count(v_body) <> 2 THEN
    RAISE EXCEPTION 'unexpected dispatcher URL/body: %, %', v_url, v_body;
  END IF;
  v_lock_token := (v_body->>'lock_token')::uuid;
  IF v_lock_token IS NULL THEN RAISE EXCEPTION 'scheduler did not include a lock token'; END IF;
  IF v_timeout <> 120000 THEN RAISE EXCEPTION 'worker request timeout does not fit the bounded batch: %', v_timeout; END IF;
  v_result := public.get_sirevya_telegram_notification_status();
  IF (v_result->>'dispatch_in_flight')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'status did not report the active scheduler lock'; END IF;
  PERFORM public.sirevya_telegram_schedule_tick();
  IF (SELECT count(*) FROM net.http_request_queue) <> 1 THEN RAISE EXCEPTION 'overlapping cron tick queued a second worker'; END IF;
  IF public.release_sirevya_telegram_dispatch_lock('00000000-0000-4000-8000-000000000099') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'a stale/non-owner token released the worker lock';
  END IF;
  IF public.release_sirevya_telegram_dispatch_lock(v_lock_token) IS DISTINCT FROM true THEN RAISE EXCEPTION 'current worker could not release its lock'; END IF;
  PERFORM public.sirevya_telegram_schedule_tick();
  SELECT (body->>'lock_token')::uuid INTO v_next_lock_token FROM net.http_request_queue ORDER BY id DESC LIMIT 1;
  IF (SELECT count(*) FROM net.http_request_queue) <> 2 OR v_next_lock_token IS NULL OR v_next_lock_token = v_lock_token THEN
    RAISE EXCEPTION 'lock release did not permit one new worker with a fresh token';
  END IF;
  v_lock_token := v_next_lock_token;
  UPDATE public.sirevya_telegram_notification_settings SET dispatch_lock_until = now() - interval '1 second' WHERE id = 1;
  PERFORM public.sirevya_telegram_schedule_tick();
  SELECT (body->>'lock_token')::uuid INTO v_next_lock_token FROM net.http_request_queue ORDER BY id DESC LIMIT 1;
  IF (SELECT count(*) FROM net.http_request_queue) <> 3 OR v_next_lock_token IS NULL OR v_next_lock_token = v_lock_token THEN
    RAISE EXCEPTION 'expired worker lease was not replaced with a fresh token';
  END IF;
  IF public.release_sirevya_telegram_dispatch_lock(v_lock_token) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'expired worker token released a newer worker lock';
  END IF;
  v_result := public.set_sirevya_telegram_notifications_enabled(false);
  IF (v_result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'admin could not disable after scheduler test'; END IF;
  IF public.set_sirevya_telegram_dispatcher_ready(false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'service role could not clear the worker readiness marker';
  END IF;
  v_result := public.set_sirevya_telegram_notifications_enabled(true);
  IF v_result->>'code' IS DISTINCT FROM 'DISPATCHER_NOT_READY' THEN
    RAISE EXCEPTION 'admin re-enabled notifications after worker readiness was cleared: %', v_result;
  END IF;
  PERFORM public.sirevya_telegram_schedule_tick();
  IF (SELECT count(*) FROM net.http_request_queue) <> 3 THEN
    RAISE EXCEPTION 'disabled tick made another HTTP request';
  END IF;
END
$assert_enabled_tick$;

ROLLBACK;
\echo 'telegram_scheduler_local_regression: PASS (mock extensions only; no network)'
