-- CANDIDATE ONLY: Telegram event outbox. Do not apply to production without an approved, restorable backup/staging validation.
-- No order/payment/inventory path is replaced. Triggers observe committed table changes and default to disabled.
BEGIN;

CREATE OR REPLACE FUNCTION public._sirevya_telegram_payload_key_count(p_payload jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT count(*)::integer
  FROM pg_catalog.jsonb_object_keys(
    CASE WHEN pg_catalog.jsonb_typeof(p_payload) = 'object' THEN p_payload ELSE '{}'::jsonb END
  )
$function$;
REVOKE ALL ON FUNCTION public._sirevya_telegram_payload_key_count(jsonb) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.sirevya_telegram_notification_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  dispatcher_ready boolean NOT NULL DEFAULT false,
  dispatcher_ready_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO public.sirevya_telegram_notification_settings (id, enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sirevya_telegram_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE CHECK (length(dedupe_key) BETWEEN 1 AND 300),
  event_type text NOT NULL CHECK (event_type IN (
    'order.created', 'order.cancelled',
    'payment.pending', 'payment.approved', 'payment.rejected', 'payment.error', 'payment.voided',
    'inventory.stockout', 'inventory.restocked', 'inventory.movement',
    'reservation.created', 'reservation.released', 'reservation.expired',
    'reservation.whatsapp_reserved', 'reservation.whatsapp_confirmed'
  )),
  source_table text NOT NULL CHECK (source_table IN ('orders','web_orders','products','inventory_movements','inventory_reservations')),
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 128),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND public._sirevya_telegram_payload_key_count(payload) <= 12
    AND NOT (payload ?| ARRAY[
      'customer_name','customer_cedula','customer_phone','customer_email',
      'customer_city','customer_address','customer_neighborhood',
      'name','cedula','phone','email','address','neighborhood','note','items'
    ])
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','dead')),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  claim_token uuid,
  sent_at timestamptz,
  telegram_message_id text CHECK (telegram_message_id IS NULL OR telegram_message_id ~ '^[0-9]{1,30}$'),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code IN (
    'network','timeout','telegram_rate_limited','telegram_server_error',
    'telegram_rejected','telegram_auth','telegram_invalid_payload','worker_internal','db_completion'
  )),
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'processing') = (lease_until IS NOT NULL)),
  CHECK ((status = 'processing') = (claim_token IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS sirevya_telegram_outbox_due_idx
  ON public.sirevya_telegram_outbox (next_attempt_at, created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS sirevya_telegram_outbox_expired_lease_idx
  ON public.sirevya_telegram_outbox (lease_until, created_at)
  WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS sirevya_telegram_outbox_error_idx
  ON public.sirevya_telegram_outbox (last_error_at DESC)
  WHERE last_error_at IS NOT NULL;

ALTER TABLE public.sirevya_telegram_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sirevya_telegram_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sirevya_telegram_notification_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sirevya_telegram_outbox FROM PUBLIC, anon, authenticated;

-- The dispatcher key is generated inside Vault and is never returned to a client.
DO $vault_seed$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'sirevya_telegram_dispatch_secret'
  ) THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'sirevya_telegram_dispatch_secret',
      'Private high-entropy header used only by the scheduled Sirevya Telegram dispatcher'
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'sirevya_telegram_project_url'
  ) THEN
    PERFORM vault.create_secret(
      'https://hnlbbtnfmbnbkcgegufa.supabase.co',
      'sirevya_telegram_project_url',
      'Public Sirevya Supabase URL used by the scheduled Telegram dispatcher'
    );
  END IF;
END
$vault_seed$;

CREATE OR REPLACE FUNCTION public._enqueue_sirevya_telegram_notification(
  p_dedupe_key text,
  p_event_type text,
  p_source_table text,
  p_source_id text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sirevya_telegram_notification_settings
    WHERE id = 1 AND enabled IS TRUE
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.sirevya_telegram_outbox (
    dedupe_key, event_type, source_table, source_id, payload
  ) VALUES (
    left(p_dedupe_key, 300), p_event_type, p_source_table, left(p_source_id, 128), p_payload
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$function$;
REVOKE ALL ON FUNCTION public._enqueue_sirevya_telegram_notification(text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._capture_sirevya_telegram_order_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_old jsonb;
  v_id text := COALESCE(v_row->>'id', '');
  v_reference text := left(regexp_replace(COALESCE(v_row->>'reference', v_row->>'client_reference', v_row->>'inventory_reference', ''), '[^A-Za-z0-9._-]', '', 'g'), 80);
  v_method text := CASE lower(btrim(COALESCE(v_row->>'payment_method', '')))
    WHEN 'wompi' THEN 'Wompi' WHEN 'pse' THEN 'PSE' WHEN 'tarjeta' THEN 'Tarjeta'
    WHEN 'contra entrega' THEN 'Contra entrega' ELSE 'sin especificar' END;
  v_payment_status text := upper(left(regexp_replace(COALESCE(v_row->>'payment_status', ''), '[^A-Za-z0-9_ -]', '', 'g'), 32));
  v_order_status text := upper(left(regexp_replace(COALESCE(v_row->>'order_status', ''), '[^A-Za-z0-9_ -]', '', 'g'), 32));
  v_total numeric := NULLIF(v_row->>'total', '')::numeric;
  v_old_payment_status text;
  v_old_order_status text;
  v_payment_event text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._enqueue_sirevya_telegram_notification(
      'order:' || v_id || ':created', 'order.created', TG_TABLE_NAME, v_id,
      jsonb_build_object(
        'reference', NULLIF(v_reference, ''),
        'payment_method', v_method,
        'payment_status', NULLIF(v_payment_status, ''),
        'order_status', NULLIF(v_order_status, ''),
        'total_cop', v_total
      )
    );
    IF TG_TABLE_NAME = 'orders' AND v_payment_status = 'PENDING' THEN
      PERFORM public._enqueue_sirevya_telegram_notification(
        'order:' || v_id || ':payment:PENDING', 'payment.pending', TG_TABLE_NAME, v_id,
        jsonb_build_object('reference', NULLIF(v_reference, ''), 'payment_method', v_method, 'payment_status', v_payment_status, 'total_cop', v_total)
      );
    END IF;
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  v_old_payment_status := upper(left(regexp_replace(COALESCE(v_old->>'payment_status', ''), '[^A-Za-z0-9_ -]', '', 'g'), 32));
  v_old_order_status := upper(left(regexp_replace(COALESCE(v_old->>'order_status', ''), '[^A-Za-z0-9_ -]', '', 'g'), 32));

  IF TG_TABLE_NAME = 'orders' AND v_payment_status IS DISTINCT FROM v_old_payment_status THEN
    v_payment_event := CASE v_payment_status
      WHEN 'PENDING' THEN 'payment.pending'
      WHEN 'APPROVED' THEN 'payment.approved'
      WHEN 'DECLINED' THEN 'payment.rejected'
      WHEN 'REJECTED' THEN 'payment.rejected'
      WHEN 'FAILED' THEN 'payment.rejected'
      WHEN 'ERROR' THEN 'payment.error'
      WHEN 'VOIDED' THEN 'payment.voided'
      WHEN 'CANCELLED' THEN 'payment.voided'
      WHEN 'CANCELED' THEN 'payment.voided'
      ELSE NULL
    END;
    IF v_payment_event IS NOT NULL THEN
      PERFORM public._enqueue_sirevya_telegram_notification(
        'order:' || v_id || ':payment:' || v_payment_status,
        v_payment_event, TG_TABLE_NAME, v_id,
        jsonb_build_object(
          'reference', NULLIF(v_reference, ''),
          'payment_method', v_method,
          'payment_status', v_payment_status,
          'total_cop', v_total
        )
      );
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'orders'
     AND v_order_status IS DISTINCT FROM v_old_order_status
     AND v_order_status IN ('CANCELLED','CANCELED','CANCELADO','CANCELADA','ANULADO','ANULADA') THEN
    PERFORM public._enqueue_sirevya_telegram_notification(
      'order:' || v_id || ':cancelled', 'order.cancelled', TG_TABLE_NAME, v_id,
      jsonb_build_object('reference', NULLIF(v_reference, ''), 'order_status', v_order_status)
    );
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._capture_sirevya_telegram_order_event() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._capture_sirevya_telegram_web_order_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_old jsonb;
  v_id text := COALESCE(v_row->>'id', '');
  v_reference text := left(regexp_replace(COALESCE(v_row->>'client_reference', v_row->>'inventory_reference', v_row->>'reference', ''), '[^A-Za-z0-9._-]', '', 'g'), 80);
  v_method text := CASE lower(btrim(COALESCE(v_row->>'payment_method', '')))
    WHEN 'wompi' THEN 'Wompi' WHEN 'pse' THEN 'PSE' WHEN 'tarjeta' THEN 'Tarjeta'
    WHEN 'contra entrega' THEN 'Contra entrega' ELSE 'sin especificar' END;
  v_status text := upper(left(regexp_replace(COALESCE(v_row->>'status', ''), '[^A-Za-z0-9_ -]', '', 'g'), 32));
  v_old_status text;
  v_total numeric := NULLIF(v_row->>'total', '')::numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._enqueue_sirevya_telegram_notification(
      'web-order:' || v_id || ':created', 'order.created', 'web_orders', v_id,
      jsonb_build_object(
        'reference', NULLIF(v_reference, ''),
        'payment_method', v_method,
        'order_status', NULLIF(v_status, ''),
        'total_cop', v_total
      )
    );
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  v_old_status := upper(left(regexp_replace(COALESCE(v_old->>'status', ''), '[^A-Za-z0-9_ -]', '', 'g'), 32));
  IF v_status IS DISTINCT FROM v_old_status
     AND v_status IN ('CANCELLED','CANCELED','CANCELADO','CANCELADA','ANULADO','ANULADA') THEN
    PERFORM public._enqueue_sirevya_telegram_notification(
      'web-order:' || v_id || ':cancelled', 'order.cancelled', 'web_orders', v_id,
      jsonb_build_object('reference', NULLIF(v_reference, ''), 'order_status', v_status)
    );
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._capture_sirevya_telegram_web_order_event() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._capture_sirevya_telegram_reservation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_old jsonb;
  v_id text := COALESCE(v_row->>'id', '');
  v_reference text := left(regexp_replace(COALESCE(v_row->>'reference', ''), '[^A-Za-z0-9._-]', '', 'g'), 180);
  v_status text := upper(left(regexp_replace(COALESCE(v_row->>'status', ''), '[^A-Za-z0-9_ -]', '', 'g'), 32));
  v_old_status text;
  v_event text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_old_status := upper(left(regexp_replace(COALESCE(v_old->>'status', ''), '[^A-Za-z0-9_ -]', '', 'g'), 32));
    IF v_status IS NOT DISTINCT FROM v_old_status THEN RETURN NEW; END IF;
  END IF;

  v_event := CASE v_status
    WHEN 'ACTIVE' THEN CASE WHEN TG_OP = 'INSERT' THEN 'reservation.created' ELSE NULL END
    WHEN 'PENDING' THEN CASE WHEN TG_OP = 'INSERT' THEN 'reservation.created' ELSE NULL END
    WHEN 'WHATSAPP_RESERVED' THEN CASE WHEN TG_OP = 'INSERT' THEN 'reservation.whatsapp_reserved' ELSE NULL END
    WHEN 'WHATSAPP_CONFIRMED' THEN 'reservation.whatsapp_confirmed'
    WHEN 'RELEASED' THEN 'reservation.released'
    WHEN 'EXPIRED' THEN 'reservation.expired'
    ELSE NULL
  END;
  IF v_event IS NULL THEN RETURN NEW; END IF;

  PERFORM public._enqueue_sirevya_telegram_notification(
    'reservation:' || COALESCE(NULLIF(v_reference, ''), v_id) || ':' || v_event,
    v_event, 'inventory_reservations', v_id,
    jsonb_build_object('reference', NULLIF(v_reference, ''), 'reservation_status', v_status)
  );
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._capture_sirevya_telegram_reservation_event() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._capture_sirevya_telegram_product_stock_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_event text;
  v_data jsonb := to_jsonb(NEW);
  v_code text;
  v_name text;
BEGIN
  IF COALESCE(OLD.quantity, 0) > 0 AND COALESCE(NEW.quantity, 0) <= 0 THEN
    v_event := 'inventory.stockout';
  ELSIF COALESCE(OLD.quantity, 0) <= 0 AND COALESCE(NEW.quantity, 0) > 0 THEN
    v_event := 'inventory.restocked';
  ELSE
    RETURN NEW;
  END IF;
  v_code := left(regexp_replace(COALESCE(v_data->>'code', ''), '[[:cntrl:]]', '', 'g'), 60);
  v_name := left(regexp_replace(COALESCE(v_data->>'name', ''), '[[:cntrl:]]', '', 'g'), 80);
  PERFORM public._enqueue_sirevya_telegram_notification(
    'product:' || COALESCE(v_data->>'id', '') || ':' || v_event || ':' || txid_current()::text,
    v_event, 'products', COALESCE(v_data->>'id', ''),
    jsonb_build_object('product_code', NULLIF(v_code, ''), 'product_name', NULLIF(v_name, ''), 'quantity', COALESCE(NEW.quantity, 0))
  );
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._capture_sirevya_telegram_product_stock_event() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._capture_sirevya_telegram_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_data jsonb := to_jsonb(NEW);
  v_code text := left(regexp_replace(COALESCE(v_data->>'product_code', ''), '[[:cntrl:]]', '', 'g'), 60);
  v_name text := left(regexp_replace(COALESCE(v_data->>'product_name', ''), '[[:cntrl:]]', '', 'g'), 80);
  v_type text := left(regexp_replace(COALESCE(v_data->>'type', ''), '[^A-Za-z0-9_ -]', '', 'g'), 32);
  v_quantity integer := NULLIF(v_data->>'quantity', '')::integer;
BEGIN
  PERFORM public._enqueue_sirevya_telegram_notification(
    'inventory-movement:' || COALESCE(v_data->>'id', ''),
    'inventory.movement', 'inventory_movements', COALESCE(v_data->>'id', ''),
    jsonb_build_object(
      'product_code', NULLIF(v_code, ''),
      'product_name', NULLIF(v_name, ''),
      'movement_type', NULLIF(v_type, ''),
      'quantity', v_quantity
    )
  );
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._capture_sirevya_telegram_inventory_movement() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sirevya_telegram_orders_event ON public.orders;
CREATE TRIGGER sirevya_telegram_orders_event
AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public._capture_sirevya_telegram_order_event();

DROP TRIGGER IF EXISTS sirevya_telegram_web_orders_event ON public.web_orders;
CREATE TRIGGER sirevya_telegram_web_orders_event
AFTER INSERT OR UPDATE ON public.web_orders
FOR EACH ROW EXECUTE FUNCTION public._capture_sirevya_telegram_web_order_event();

DROP TRIGGER IF EXISTS sirevya_telegram_reservation_event ON public.inventory_reservations;
CREATE TRIGGER sirevya_telegram_reservation_event
AFTER INSERT OR UPDATE ON public.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION public._capture_sirevya_telegram_reservation_event();

DROP TRIGGER IF EXISTS sirevya_telegram_product_stock_event ON public.products;
CREATE TRIGGER sirevya_telegram_product_stock_event
AFTER UPDATE OF quantity ON public.products
FOR EACH ROW WHEN (OLD.quantity IS DISTINCT FROM NEW.quantity)
EXECUTE FUNCTION public._capture_sirevya_telegram_product_stock_event();

DROP TRIGGER IF EXISTS sirevya_telegram_inventory_movement_event ON public.inventory_movements;
CREATE TRIGGER sirevya_telegram_inventory_movement_event
AFTER INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public._capture_sirevya_telegram_inventory_movement();

CREATE OR REPLACE FUNCTION public.get_sirevya_telegram_dispatch_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'vault'
AS $function$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'sirevya_telegram_dispatch_secret'
  ORDER BY created_at DESC
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.get_sirevya_telegram_dispatch_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sirevya_telegram_dispatch_secret() TO service_role;

CREATE OR REPLACE FUNCTION public._sirevya_telegram_scheduler_ready()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_scheduled boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') OR to_regclass('cron.job') IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT count(*) = 1 AND COALESCE(bool_and(active IS TRUE AND schedule = $2 AND command = $3), false) FROM cron.job WHERE jobname = $1'
    INTO v_scheduled
    USING 'sirevya-telegram-dispatch', '* * * * *', 'SELECT public.sirevya_telegram_schedule_tick();';
  RETURN COALESCE(v_scheduled, false)
    AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'sirevya_telegram_dispatch_secret')
    AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'sirevya_telegram_project_url');
END;
$function$;
REVOKE ALL ON FUNCTION public._sirevya_telegram_scheduler_ready() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_sirevya_telegram_notification_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_enabled boolean;
  v_dispatcher_ready boolean;
  v_pending bigint;
  v_processing bigint;
  v_sent_24h bigint;
  v_dead bigint;
  v_last_error_at timestamptz;
  v_last_error_code text;
BEGIN
  IF NOT public.is_store_admin() THEN
    RAISE EXCEPTION 'No tienes autorización para consultar Telegram.' USING ERRCODE = '42501';
  END IF;
  SELECT enabled, dispatcher_ready INTO v_enabled, v_dispatcher_ready
    FROM public.sirevya_telegram_notification_settings WHERE id = 1;
  SELECT count(*) FILTER (WHERE status = 'pending'),
         count(*) FILTER (WHERE status = 'processing'),
         count(*) FILTER (WHERE status = 'sent' AND sent_at >= now() - interval '24 hours'),
         count(*) FILTER (WHERE status = 'dead'),
         max(last_error_at)
    INTO v_pending, v_processing, v_sent_24h, v_dead, v_last_error_at
    FROM public.sirevya_telegram_outbox;
  SELECT last_error_code INTO v_last_error_code
    FROM public.sirevya_telegram_outbox
   WHERE last_error_at IS NOT NULL
   ORDER BY last_error_at DESC
   LIMIT 1;
  RETURN jsonb_build_object(
    'enabled', COALESCE(v_enabled, false),
    'scheduler_ready', public._sirevya_telegram_scheduler_ready(),
    'dispatcher_ready', COALESCE(v_dispatcher_ready, false),
    'pending_count', COALESCE(v_pending, 0),
    'processing_count', COALESCE(v_processing, 0),
    'sent_last_24h', COALESCE(v_sent_24h, 0),
    'dead_count', COALESCE(v_dead, 0),
    'last_error_at', v_last_error_at,
    'last_error_code', v_last_error_code
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_sirevya_telegram_notification_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sirevya_telegram_notification_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_sirevya_telegram_notifications_enabled(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_dispatcher_ready boolean;
BEGIN
  IF NOT public.is_store_admin() THEN
    RAISE EXCEPTION 'No tienes autorización para cambiar Telegram.' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_SETTING');
  END IF;
  IF p_enabled THEN
    SELECT dispatcher_ready INTO v_dispatcher_ready
      FROM public.sirevya_telegram_notification_settings
     WHERE id = 1 FOR UPDATE;
    IF NOT public._sirevya_telegram_scheduler_ready() THEN
      RETURN jsonb_build_object('success', false, 'code', 'SCHEDULER_NOT_READY', 'enabled', false);
    END IF;
    IF COALESCE(v_dispatcher_ready, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'code', 'DISPATCHER_NOT_READY', 'enabled', false);
    END IF;
  END IF;
  INSERT INTO public.sirevya_telegram_notification_settings (id, enabled, updated_at, updated_by)
  VALUES (1, p_enabled, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        updated_at = now(),
        updated_by = auth.uid();
  RETURN jsonb_build_object('success', true, 'enabled', p_enabled);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_sirevya_telegram_notifications_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sirevya_telegram_notifications_enabled(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_sirevya_telegram_dispatcher_ready(p_ready boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_ready IS NULL OR (p_ready IS TRUE AND NOT public._sirevya_telegram_scheduler_ready()) THEN
    RETURN false;
  END IF;
  UPDATE public.sirevya_telegram_notification_settings
     SET dispatcher_ready = p_ready,
         dispatcher_ready_at = CASE WHEN p_ready THEN now() ELSE NULL END,
         enabled = CASE WHEN p_ready THEN enabled ELSE false END,
         updated_at = now()
   WHERE id = 1;
  RETURN FOUND;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_sirevya_telegram_dispatcher_ready(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_sirevya_telegram_dispatcher_ready(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_sirevya_telegram_notifications(p_limit integer DEFAULT 5, p_lease_seconds integer DEFAULT 600)
RETURNS TABLE(id uuid, event_type text, payload jsonb, attempt_count integer, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sirevya_telegram_notification_settings AS settings
     WHERE settings.id = 1 AND settings.enabled IS TRUE AND settings.dispatcher_ready IS TRUE
  ) OR NOT public._sirevya_telegram_scheduler_ready() THEN
    RETURN;
  END IF;
  UPDATE public.sirevya_telegram_outbox AS exhausted
     SET status = 'dead', lease_until = NULL, claim_token = NULL,
         last_error_code = 'timeout', last_error_at = now()
   WHERE exhausted.status = 'processing'
     AND exhausted.lease_until <= now()
     AND exhausted.attempt_count >= 7;
  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
      FROM public.sirevya_telegram_outbox AS o
     WHERE ((o.status = 'pending' AND o.next_attempt_at <= now())
         OR (o.status = 'processing' AND o.lease_until <= now()))
       AND o.attempt_count < 7
     ORDER BY o.next_attempt_at, o.created_at
     FOR UPDATE SKIP LOCKED
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 5)
  )
  UPDATE public.sirevya_telegram_outbox AS o
     SET status = 'processing',
         attempt_count = LEAST(o.attempt_count + 1, 10),
         lease_until = now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 600), 30), 600)),
         claim_token = gen_random_uuid()
    FROM candidates AS c
   WHERE o.id = c.id
  RETURNING o.id, o.event_type, o.payload, o.attempt_count::integer, o.claim_token;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_sirevya_telegram_notifications(integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sirevya_telegram_notifications(integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_sirevya_telegram_notification(p_id uuid, p_claim_token uuid, p_message_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.sirevya_telegram_outbox
     SET status = 'sent', sent_at = now(), lease_until = NULL, claim_token = NULL,
         telegram_message_id = CASE WHEN COALESCE(p_message_id, '') ~ '^[0-9]{1,30}$' THEN p_message_id ELSE NULL END,
         last_error_code = NULL, last_error_at = NULL
   WHERE id = p_id AND status = 'processing' AND claim_token = p_claim_token AND lease_until > now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_sirevya_telegram_notification(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sirevya_telegram_notification(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.retry_sirevya_telegram_notification(
  p_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_retryable boolean DEFAULT true,
  p_retry_after_seconds integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_attempts integer;
  v_delay integer;
  v_error text := CASE WHEN p_error_code IN (
    'network','timeout','telegram_rate_limited','telegram_server_error',
    'telegram_rejected','telegram_auth','telegram_invalid_payload','worker_internal','db_completion'
  ) THEN p_error_code ELSE 'worker_internal' END;
BEGIN
  SELECT attempt_count INTO v_attempts
    FROM public.sirevya_telegram_outbox
   WHERE id = p_id AND status = 'processing' AND claim_token = p_claim_token AND lease_until > now()
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_processing'; END IF;
  v_delay := CASE
    WHEN p_retry_after_seconds IS NOT NULL THEN LEAST(GREATEST(p_retry_after_seconds, 1), 3600)
    ELSE LEAST(3600, (60 * power(2, LEAST(GREATEST(v_attempts - 1, 0), 6)))::integer)
  END;
  v_status := CASE WHEN p_retryable IS TRUE AND v_attempts < 7 THEN 'pending' ELSE 'dead' END;
  UPDATE public.sirevya_telegram_outbox
     SET status = v_status,
         next_attempt_at = CASE WHEN v_status = 'pending' THEN now() + make_interval(secs => v_delay) ELSE next_attempt_at END,
         lease_until = NULL,
         claim_token = NULL,
         last_error_code = v_error,
         last_error_at = now()
   WHERE id = p_id AND status = 'processing' AND claim_token = p_claim_token AND lease_until > now();
  RETURN v_status;
END;
$function$;
REVOKE ALL ON FUNCTION public.retry_sirevya_telegram_notification(uuid,uuid,text,boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_sirevya_telegram_notification(uuid,uuid,text,boolean,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.sirevya_telegram_schedule_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'vault'
AS $function$
DECLARE
  v_enabled boolean;
  v_dispatcher_ready boolean;
  v_project_url text;
  v_dispatch_secret text;
  v_request_id bigint;
BEGIN
  SELECT enabled, dispatcher_ready INTO v_enabled, v_dispatcher_ready
    FROM public.sirevya_telegram_notification_settings
   WHERE id = 1;
  IF COALESCE(v_enabled, false) IS NOT TRUE
     OR COALESCE(v_dispatcher_ready, false) IS NOT TRUE
     OR NOT public._sirevya_telegram_scheduler_ready() THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sirevya_telegram_outbox
     WHERE (status = 'pending' AND next_attempt_at <= now())
        OR (status = 'processing' AND lease_until <= now())
     LIMIT 1
  ) THEN RETURN; END IF;
  SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets
   WHERE name = 'sirevya_telegram_project_url'
   ORDER BY created_at DESC LIMIT 1;
  SELECT decrypted_secret INTO v_dispatch_secret
    FROM vault.decrypted_secrets
   WHERE name = 'sirevya_telegram_dispatch_secret'
   ORDER BY created_at DESC LIMIT 1;
  IF COALESCE(v_project_url, '') = '' OR COALESCE(v_dispatch_secret, '') = '' THEN RETURN; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := $4)'
    INTO v_request_id
    USING v_project_url || '/functions/v1/telegram-dispatch',
          jsonb_build_object('Content-Type','application/json','x-sirevya-dispatch-secret',v_dispatch_secret),
          jsonb_build_object('action','dispatch'),
          120000;
END;
$function$;
REVOKE ALL ON FUNCTION public.sirevya_telegram_schedule_tick() FROM PUBLIC, anon, authenticated;

COMMIT;
