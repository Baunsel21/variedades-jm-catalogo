-- CANDIDATE ONLY: schedules the durable outbox worker. Do not apply without the approved backup/staging gate.
-- The job sends no request while notifications are disabled or no outbox event is due.
BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
-- pg_net keeps its own `net` namespace even when the extension is registered in `extensions`.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
-- Requests temporarily hold headers until sent; prevent client roles from reading queues or invoking egress functions.
REVOKE ALL ON SCHEMA net FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA net FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA net FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated;

DO $schedule$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') OR to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'pg_cron must be installed before scheduling Telegram notifications';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_net did not install; Telegram notifications remain unscheduled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'sirevya_telegram_dispatch_secret')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'sirevya_telegram_project_url') THEN
    RAISE EXCEPTION 'Telegram dispatch Vault secrets are missing; no schedule was created';
  END IF;

  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'sirevya-telegram-dispatch'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'sirevya-telegram-dispatch',
    '* * * * *',
    'SELECT public.sirevya_telegram_schedule_tick();'
  );
END;
$schedule$;

COMMIT;
