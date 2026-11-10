-- Additive Telegram payload upgrade. Do not rewrite previously deployed migrations.
-- Keeps the existing toggle, outbox dedupe, grants, and scheduler contract intact.
BEGIN;

-- Replace the legacy deny-list payload check with an explicit top-level allowlist.
-- Product line objects are allowlisted separately so arbitrary nested keys cannot enter.
DO $drop_telegram_payload_checks$
BEGIN
  IF to_regclass('public.sirevya_telegram_outbox') IS NULL THEN
    RAISE EXCEPTION 'Falta public.sirevya_telegram_outbox; aplique primero la migración base de Telegram.';
  END IF;
  ALTER TABLE public.sirevya_telegram_outbox
    DROP CONSTRAINT IF EXISTS sirevya_telegram_outbox_payload_check;
END
$drop_telegram_payload_checks$;

CREATE OR REPLACE FUNCTION public._sirevya_telegram_payload_is_allowed(p_payload jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce(
    jsonb_typeof(p_payload) = 'object'
    AND public._sirevya_telegram_payload_key_count(p_payload) <= 18
    AND NOT EXISTS (
      SELECT 1
        FROM pg_catalog.jsonb_object_keys(p_payload) AS top_key(key_name)
       WHERE top_key.key_name <> ALL (ARRAY[
         'reference', 'order_reference', 'inventory_reference',
         'customer_name', 'city',
         'payment_method', 'payment_status', 'order_status',
         'reservation_status', 'total_cop',
         'products', 'total_units',
         'product_code', 'product_name', 'movement_type', 'quantity'
       ]::text[])
    )
    AND (
      p_payload->'products' IS NULL
      OR (
        jsonb_typeof(p_payload->'products') = 'array'
        AND jsonb_array_length(p_payload->'products') <= 50
        AND NOT EXISTS (
          SELECT 1
            FROM pg_catalog.jsonb_array_elements(p_payload->'products') AS product_line(value)
           WHERE jsonb_typeof(product_line.value) <> 'object'
              OR public._sirevya_telegram_payload_key_count(product_line.value) > 3
              OR EXISTS (
                SELECT 1
                  FROM pg_catalog.jsonb_object_keys(product_line.value) AS line_key(key_name)
                 WHERE line_key.key_name <> ALL (ARRAY['code', 'name', 'quantity']::text[])
              )
        )
      )
    ),
    false
  )
$function$;
REVOKE ALL ON FUNCTION public._sirevya_telegram_payload_is_allowed(jsonb) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.sirevya_telegram_outbox
  ADD CONSTRAINT sirevya_telegram_outbox_payload_check CHECK (
    public._sirevya_telegram_payload_is_allowed(payload)
  );

CREATE OR REPLACE FUNCTION public._sirevya_telegram_clean_text(p_value text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT left(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]', ' ', 'g'),
        '[[:space:]]+', ' ', 'g'
      )
    ),
    greatest(0, least(coalesce(p_max, 100), 500))
  )
$function$;
REVOKE ALL ON FUNCTION public._sirevya_telegram_clean_text(text, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._sirevya_telegram_clean_reference(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN v_reference = '' THEN NULL
    WHEN v_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
    ELSE v_reference
  END
  FROM (
    SELECT left(
      regexp_replace(btrim(coalesce(p_value, '')), '[^A-Za-z0-9._-]', '', 'g'),
      80
    ) AS v_reference
  ) AS cleaned
$function$;
REVOKE ALL ON FUNCTION public._sirevya_telegram_clean_reference(text) FROM PUBLIC, anon, authenticated;

-- Orders are intentionally normalized from only code/name/qty in their stored items.
-- No product lookup is performed here, and no complete items JSON is copied.
CREATE OR REPLACE FUNCTION public._sirevya_telegram_order_product_summary(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb;
  v_products jsonb := '[]'::jsonb;
  v_code text;
  v_name text;
  v_quantity integer;
  v_total_units bigint := 0;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('products', v_products, 'total_units', 0);
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS item(value) LOOP
    v_quantity := public._sirevya_telegram_safe_integer(v_item->>'qty');
    IF v_quantity IS NULL OR v_quantity < 1 THEN
      CONTINUE;
    END IF;
    v_code := public._sirevya_telegram_clean_text(v_item->>'code', 60);
    v_name := public._sirevya_telegram_clean_text(v_item->>'name', 100);
    v_products := v_products || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'code', NULLIF(v_code, ''),
        'name', NULLIF(v_name, ''),
        'quantity', v_quantity
      ))
    );
    v_total_units := v_total_units + v_quantity;
  END LOOP;

  RETURN jsonb_build_object('products', v_products, 'total_units', v_total_units);
END
$function$;
REVOKE ALL ON FUNCTION public._sirevya_telegram_order_product_summary(jsonb) FROM PUBLIC, anon, authenticated;

-- Reservations deliberately resolve product_id through products at event time.
-- Every reservation line remains represented; total_units is an additional summary.
CREATE OR REPLACE FUNCTION public._sirevya_telegram_reservation_product_summary(p_reference text)
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'products', coalesce(
      jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'code', NULLIF(public._sirevya_telegram_clean_text(p.code, 60), ''),
          'name', NULLIF(public._sirevya_telegram_clean_text(p.name, 100), ''),
          'quantity', r.quantity
        ))
        ORDER BY r.id::text
      ) FILTER (WHERE r.id IS NOT NULL),
      '[]'::jsonb
    ),
    'total_units', coalesce(sum(CASE WHEN r.quantity > 0 THEN r.quantity ELSE 0 END), 0)
  )
  FROM public.inventory_reservations AS r
  LEFT JOIN public.products AS p ON p.id = r.product_id
  WHERE r.reference = p_reference
$function$;
REVOKE ALL ON FUNCTION public._sirevya_telegram_reservation_product_summary(text) FROM PUBLIC, anon, authenticated;

-- Refreshes a reservation event after all lines visible in the current transaction
-- have been considered. Linking is by orders.reference or web_orders.inventory_reference;
-- web_orders.client_reference is kept as the separate commercial order reference.
CREATE OR REPLACE FUNCTION public._refresh_sirevya_telegram_reservation_event(
  p_reference text,
  p_event_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reference text := public._sirevya_telegram_clean_reference(p_reference);
  v_summary jsonb;
  v_payload jsonb;
  v_order_reference text;
  v_inventory_reference text;
  v_customer_name text;
  v_city text;
  v_payment_method text;
  v_payment_status text;
  v_order_status text;
  v_total numeric;
  v_reservation_status text;
  v_order_found boolean := false;
BEGIN
  IF p_event_type NOT IN (
    'reservation.created', 'reservation.released', 'reservation.expired',
    'reservation.whatsapp_reserved', 'reservation.whatsapp_confirmed'
  ) OR v_reference IS NULL THEN
    RETURN;
  END IF;

  v_summary := public._sirevya_telegram_reservation_product_summary(p_reference);
  v_reservation_status := CASE p_event_type
    WHEN 'reservation.released' THEN 'RELEASED'
    WHEN 'reservation.expired' THEN 'EXPIRED'
    WHEN 'reservation.whatsapp_reserved' THEN 'WHATSAPP_RESERVED'
    WHEN 'reservation.whatsapp_confirmed' THEN 'WHATSAPP_CONFIRMED'
    ELSE NULL
  END;
  IF v_reservation_status IS NULL THEN
    SELECT public._sirevya_telegram_clean_text(r.status, 32)
      INTO v_reservation_status
      FROM public.inventory_reservations AS r
     WHERE r.reference = p_reference
     ORDER BY r.id::text
     LIMIT 1;
  END IF;

  SELECT
    public._sirevya_telegram_clean_reference(o.reference),
    public._sirevya_telegram_clean_text(o.customer_name, 120),
    public._sirevya_telegram_clean_text(o.city, 80),
    public._sirevya_telegram_clean_text(o.payment_method, 40),
    public._sirevya_telegram_clean_text(o.payment_status, 32),
    public._sirevya_telegram_clean_text(o.order_status, 32),
    public._sirevya_telegram_safe_numeric(o.total::text)
    INTO v_order_reference, v_customer_name, v_city, v_payment_method,
         v_payment_status, v_order_status, v_total
    FROM public.orders AS o
   WHERE o.reference = p_reference
   ORDER BY o.created_at DESC
   LIMIT 1;
  v_order_found := FOUND;

  IF NOT v_order_found THEN
    SELECT
      public._sirevya_telegram_clean_reference(w.client_reference),
      public._sirevya_telegram_clean_reference(w.inventory_reference),
      public._sirevya_telegram_clean_text(w.customer_name, 120),
      public._sirevya_telegram_clean_text(w.customer_city, 80),
      public._sirevya_telegram_clean_text(w.payment_method, 40),
      NULL::text,
      public._sirevya_telegram_clean_text(w.status, 32),
      public._sirevya_telegram_safe_numeric(w.total::text)
      INTO v_order_reference, v_inventory_reference, v_customer_name, v_city,
           v_payment_method, v_payment_status, v_order_status, v_total
      FROM public.web_orders AS w
     WHERE w.inventory_reference = p_reference
     ORDER BY w.created_at DESC
     LIMIT 1;
    v_order_found := FOUND;
  END IF;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'reference', v_reference,
    'order_reference', NULLIF(v_order_reference, ''),
    'inventory_reference', NULLIF(v_inventory_reference, ''),
    'customer_name', NULLIF(v_customer_name, ''),
    'city', NULLIF(v_city, ''),
    'payment_method', NULLIF(v_payment_method, ''),
    'payment_status', NULLIF(v_payment_status, ''),
    'order_status', NULLIF(v_order_status, ''),
    'total_cop', v_total,
    'reservation_status', NULLIF(v_reservation_status, ''),
    'products', v_summary->'products',
    'total_units', v_summary->'total_units'
  ));

  -- A created reservation without a linked order remains pending. The claim RPC
  -- also fails closed for that case, so a later order INSERT can enrich it safely.
  UPDATE public.sirevya_telegram_outbox AS outbox
     SET payload = v_payload
   WHERE outbox.dedupe_key = 'reservation:' || v_reference || ':' || p_event_type
     AND outbox.event_type = p_event_type
     AND outbox.status = 'pending';
END
$function$;
REVOKE ALL ON FUNCTION public._refresh_sirevya_telegram_reservation_event(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._capture_sirevya_telegram_order_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_old jsonb;
  v_id text := coalesce(v_row->>'id', '');
  v_reference text := public._sirevya_telegram_clean_reference(
    coalesce(v_row->>'reference', v_row->>'client_reference', v_row->>'inventory_reference', '')
  );
  v_method text := CASE lower(btrim(coalesce(v_row->>'payment_method', '')))
    WHEN 'wompi' THEN 'Wompi'
    WHEN 'pse' THEN 'PSE'
    WHEN 'tarjeta' THEN 'Tarjeta'
    WHEN 'contra entrega' THEN 'Contra entrega'
    ELSE 'sin especificar'
  END;
  v_payment_status text := public._sirevya_telegram_clean_text(upper(v_row->>'payment_status'), 32);
  v_order_status text := public._sirevya_telegram_clean_text(upper(v_row->>'order_status'), 32);
  v_customer_name text := public._sirevya_telegram_clean_text(v_row->>'customer_name', 120);
  v_city text := public._sirevya_telegram_clean_text(v_row->>'city', 80);
  v_total numeric := public._sirevya_telegram_safe_numeric(v_row->>'total');
  v_summary jsonb := public._sirevya_telegram_order_product_summary(v_row->'items');
  v_payload jsonb;
  v_old_payment_status text;
  v_old_order_status text;
  v_payment_event text;
BEGIN
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'reference', v_reference,
    'customer_name', NULLIF(v_customer_name, ''),
    'city', NULLIF(v_city, ''),
    'payment_method', v_method,
    'payment_status', NULLIF(v_payment_status, ''),
    'order_status', NULLIF(v_order_status, ''),
    'total_cop', v_total,
    'products', v_summary->'products',
    'total_units', v_summary->'total_units'
  ));

  IF TG_OP = 'INSERT' THEN
    PERFORM public._enqueue_sirevya_telegram_notification(
      'order:' || v_id || ':created', 'order.created', TG_TABLE_NAME, v_id, v_payload
    );
    IF TG_TABLE_NAME = 'orders' AND v_payment_status = 'PENDING' THEN
      PERFORM public._enqueue_sirevya_telegram_notification(
        'order:' || v_id || ':payment:PENDING', 'payment.pending', TG_TABLE_NAME, v_id, v_payload
      );
    END IF;
    IF TG_TABLE_NAME = 'orders' AND v_reference IS NOT NULL THEN
      PERFORM public._refresh_sirevya_telegram_reservation_event(v_reference, 'reservation.created');
      PERFORM public._refresh_sirevya_telegram_reservation_event(v_reference, 'reservation.released');
      PERFORM public._refresh_sirevya_telegram_reservation_event(v_reference, 'reservation.expired');
      PERFORM public._refresh_sirevya_telegram_reservation_event(v_reference, 'reservation.whatsapp_reserved');
      PERFORM public._refresh_sirevya_telegram_reservation_event(v_reference, 'reservation.whatsapp_confirmed');
    END IF;
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  v_old_payment_status := public._sirevya_telegram_clean_text(upper(v_old->>'payment_status'), 32);
  v_old_order_status := public._sirevya_telegram_clean_text(upper(v_old->>'order_status'), 32);

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
        v_payment_event, TG_TABLE_NAME, v_id, v_payload
      );
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'orders'
     AND v_order_status IS DISTINCT FROM v_old_order_status
     AND v_order_status IN ('CANCELLED','CANCELED','CANCELADO','CANCELADA','ANULADO','ANULADA') THEN
    PERFORM public._enqueue_sirevya_telegram_notification(
      'order:' || v_id || ':cancelled', 'order.cancelled', TG_TABLE_NAME, v_id, v_payload
    );
  END IF;

  IF TG_TABLE_NAME = 'orders' AND v_reference IS NOT NULL THEN
    PERFORM public._refresh_sirevya_telegram_reservation_event(v_reference, 'reservation.created');
    PERFORM public._refresh_sirevya_telegram_reservation_event(v_reference, 'reservation.released');
    PERFORM public._refresh_sirevya_telegram_reservation_event(v_reference, 'reservation.expired');
    PERFORM public._refresh_sirevya_telegram_reservation_event(v_reference, 'reservation.whatsapp_reserved');
    PERFORM public._refresh_sirevya_telegram_reservation_event(v_reference, 'reservation.whatsapp_confirmed');
  END IF;
  RETURN NEW;
END
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
  v_id text := coalesce(v_row->>'id', '');
  v_reference text := public._sirevya_telegram_clean_reference(
    coalesce(v_row->>'client_reference', v_row->>'reference', v_row->>'inventory_reference', '')
  );
  v_inventory_reference text := public._sirevya_telegram_clean_reference(v_row->>'inventory_reference');
  v_method text := CASE lower(btrim(coalesce(v_row->>'payment_method', '')))
    WHEN 'wompi' THEN 'Wompi'
    WHEN 'pse' THEN 'PSE'
    WHEN 'tarjeta' THEN 'Tarjeta'
    WHEN 'contra entrega' THEN 'Contra entrega'
    ELSE 'sin especificar'
  END;
  v_status text := public._sirevya_telegram_clean_text(upper(v_row->>'status'), 32);
  v_payment_status text := public._sirevya_telegram_clean_text(upper(v_row->>'payment_status'), 32);
  v_customer_name text := public._sirevya_telegram_clean_text(v_row->>'customer_name', 120);
  v_city text := public._sirevya_telegram_clean_text(v_row->>'customer_city', 80);
  v_total numeric := public._sirevya_telegram_safe_numeric(v_row->>'total');
  v_summary jsonb := public._sirevya_telegram_order_product_summary(v_row->'items');
  v_payload jsonb;
  v_old_status text;
BEGIN
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'reference', v_reference,
    'inventory_reference', v_inventory_reference,
    'customer_name', NULLIF(v_customer_name, ''),
    'city', NULLIF(v_city, ''),
    'payment_method', v_method,
    'payment_status', NULLIF(v_payment_status, ''),
    'order_status', NULLIF(v_status, ''),
    'total_cop', v_total,
    'products', v_summary->'products',
    'total_units', v_summary->'total_units'
  ));

  IF TG_OP = 'INSERT' THEN
    PERFORM public._enqueue_sirevya_telegram_notification(
      'web-order:' || v_id || ':created', 'order.created', 'web_orders', v_id, v_payload
    );
    IF v_inventory_reference IS NOT NULL THEN
      PERFORM public._refresh_sirevya_telegram_reservation_event(v_inventory_reference, 'reservation.created');
      PERFORM public._refresh_sirevya_telegram_reservation_event(v_inventory_reference, 'reservation.released');
      PERFORM public._refresh_sirevya_telegram_reservation_event(v_inventory_reference, 'reservation.expired');
      PERFORM public._refresh_sirevya_telegram_reservation_event(v_inventory_reference, 'reservation.whatsapp_reserved');
      PERFORM public._refresh_sirevya_telegram_reservation_event(v_inventory_reference, 'reservation.whatsapp_confirmed');
    END IF;
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  v_old_status := public._sirevya_telegram_clean_text(upper(v_old->>'status'), 32);
  IF v_status IS DISTINCT FROM v_old_status
     AND v_status IN ('CANCELLED','CANCELED','CANCELADO','CANCELADA','ANULADO','ANULADA') THEN
    PERFORM public._enqueue_sirevya_telegram_notification(
      'web-order:' || v_id || ':cancelled', 'order.cancelled', 'web_orders', v_id, v_payload
    );
  END IF;
  IF v_inventory_reference IS NOT NULL THEN
    PERFORM public._refresh_sirevya_telegram_reservation_event(v_inventory_reference, 'reservation.created');
    PERFORM public._refresh_sirevya_telegram_reservation_event(v_inventory_reference, 'reservation.released');
    PERFORM public._refresh_sirevya_telegram_reservation_event(v_inventory_reference, 'reservation.expired');
    PERFORM public._refresh_sirevya_telegram_reservation_event(v_inventory_reference, 'reservation.whatsapp_reserved');
    PERFORM public._refresh_sirevya_telegram_reservation_event(v_inventory_reference, 'reservation.whatsapp_confirmed');
  END IF;
  RETURN NEW;
END
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
  v_id text := coalesce(v_row->>'id', '');
  v_reference_raw text := btrim(coalesce(v_row->>'reference', ''));
  v_reference text := public._sirevya_telegram_clean_reference(v_reference_raw);
  v_status text := public._sirevya_telegram_clean_text(upper(v_row->>'status'), 32);
  v_event text;
  v_summary jsonb;
  v_payload jsonb;
  v_old jsonb;
  v_old_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_old_status := public._sirevya_telegram_clean_text(upper(v_old->>'status'), 32);
    IF v_status IS NOT DISTINCT FROM v_old_status THEN
      RETURN NEW;
    END IF;
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
  IF v_event IS NULL THEN
    RETURN NEW;
  END IF;

  v_summary := public._sirevya_telegram_reservation_product_summary(v_reference_raw);
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'reference', v_reference,
    'reservation_status', NULLIF(v_status, ''),
    'products', v_summary->'products',
    'total_units', v_summary->'total_units'
  ));
  PERFORM public._enqueue_sirevya_telegram_notification(
    'reservation:' || coalesce(v_reference, v_id) || ':' || v_event,
    v_event, 'inventory_reservations', v_id, v_payload
  );
  IF v_reference IS NOT NULL THEN
    PERFORM public._refresh_sirevya_telegram_reservation_event(v_reference, v_event);
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public._capture_sirevya_telegram_reservation_event() FROM PUBLIC, anon, authenticated;

-- Recreate only the affected event triggers so the replacement functions are active.
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

-- Never claim a created reservation that is still detached from its order.
CREATE OR REPLACE FUNCTION public.claim_sirevya_telegram_notifications(
  p_limit integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 600
)
RETURNS TABLE(id uuid, event_type text, payload jsonb, attempt_count integer, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.sirevya_telegram_notification_settings AS settings
     WHERE settings.id = 1
       AND settings.enabled IS TRUE
       AND settings.dispatcher_ready IS TRUE
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
       AND (
         o.event_type <> 'reservation.created'
         OR NULLIF(public._sirevya_telegram_clean_reference(o.payload->>'order_reference'), '') IS NOT NULL
       )
     ORDER BY o.next_attempt_at, o.created_at
     FOR UPDATE SKIP LOCKED
      LIMIT LEAST(GREATEST(coalesce(p_limit, 5), 1), 5)
  )
  UPDATE public.sirevya_telegram_outbox AS o
     SET status = 'processing',
         attempt_count = LEAST(o.attempt_count + 1, 10),
         lease_until = now() + make_interval(secs => LEAST(GREATEST(coalesce(p_lease_seconds, 600), 30), 600)),
         claim_token = gen_random_uuid()
    FROM candidates AS c
   WHERE o.id = c.id
  RETURNING o.id, o.event_type, o.payload, o.attempt_count::integer, o.claim_token;
END
$function$;
REVOKE ALL ON FUNCTION public.claim_sirevya_telegram_notifications(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sirevya_telegram_notifications(integer, integer) TO service_role;

COMMIT;
