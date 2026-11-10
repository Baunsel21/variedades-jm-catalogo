\set ON_ERROR_STOP on
BEGIN;
SET LOCAL test.is_admin = 'false';
SET LOCAL test.uid = '11111111-1111-4111-8111-111111111111';

-- Events are dropped while the feature is disabled by default.
INSERT INTO public.orders (id, reference, customer_name, phone, address, items, total, payment_method, payment_status, order_status)
VALUES ('00000000-0000-4000-8000-000000000099', 'JM-TEST-DISABLED', 'PRIVATE PERSON DO NOT EXPORT', '3000000000', 'PRIVATE ADDRESS', '[{"name":"PRIVATE ITEM"}]', 1000, 'wompi', 'PENDING', 'new');
DO $assert_disabled$
BEGIN
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox) <> 0 THEN
    RAISE EXCEPTION 'notifications were enqueued while disabled';
  END IF;
END
$assert_disabled$;

DO $assert_safe_payload_casts$
BEGIN
  IF public._sirevya_telegram_safe_numeric('125000') IS DISTINCT FROM 125000::numeric
     OR public._sirevya_telegram_safe_numeric('not-a-number') IS NOT NULL
     OR public._sirevya_telegram_safe_numeric('') IS NOT NULL THEN
    RAISE EXCEPTION 'safe numeric conversion returned an unexpected value';
  END IF;
  IF public._sirevya_telegram_safe_integer('42') IS DISTINCT FROM 42
     OR public._sirevya_telegram_safe_integer('bad') IS NOT NULL
     OR public._sirevya_telegram_safe_integer('999999999999999999999999999999') IS NOT NULL THEN
    RAISE EXCEPTION 'safe integer conversion did not fail open';
  END IF;
  IF has_function_privilege('anon', 'public._sirevya_telegram_safe_numeric(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._sirevya_telegram_safe_numeric(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._sirevya_telegram_safe_integer(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._sirevya_telegram_safe_integer(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'safe conversion helpers must not be client-callable';
  END IF;
END
$assert_safe_payload_casts$;

-- Admin-only status and toggle authorization.
DO $assert_auth$
BEGIN
  BEGIN
    PERFORM public.get_sirevya_telegram_notification_status();
    RAISE EXCEPTION 'unauthorized status read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$assert_auth$;
SET LOCAL test.is_admin = 'true';
DO $assert_admin_toggle$
DECLARE v_result jsonb;
BEGIN
  v_result := public.set_sirevya_telegram_notifications_enabled(true);
  IF v_result->>'code' IS DISTINCT FROM 'DISPATCHER_NOT_READY' OR COALESCE((v_result->>'success')::boolean, true) THEN
    RAISE EXCEPTION 'notifications enabled before worker readiness: %', v_result;
  END IF;
  v_result := public.set_sirevya_telegram_notifications_enabled(false);
  IF (v_result->>'success')::boolean IS DISTINCT FROM true OR (v_result->>'enabled')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'admin could not disable notifications: %', v_result;
  END IF;
  IF public.set_sirevya_telegram_dispatcher_ready(true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'synthetic service_role could not mark a verified worker';
  END IF;
  v_result := public.set_sirevya_telegram_notifications_enabled(true);
  IF (v_result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'admin could not enable after readiness gates: %', v_result; END IF;
END
$assert_admin_toggle$;

-- Products exist before the Wompi reservation. The reservation event is deliberately
-- created before the order and must remain unclaimable until the order is linked.
INSERT INTO public.products (id, code, name, quantity)
VALUES ('00000000-0000-4000-8000-000000000010', 'SKU-10', 'Synthetic Shirt', 5),
       ('00000000-0000-4000-8000-000000000011', 'SKU-11', 'Synthetic Shoes', 4);
INSERT INTO public.inventory_reservations (id, product_id, quantity, reference, status, expires_at)
VALUES ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', 2, 'JM-TEST-001', 'active', now() + interval '10 minutes'),
       ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000011', 1, 'JM-TEST-001', 'active', now() + interval '10 minutes');
DO $assert_unlinked_reservation_waits$
BEGIN
  IF (SELECT count(*) FROM public.claim_sirevya_telegram_notifications(5, 600)) <> 0 THEN
    RAISE EXCEPTION 'unlinked reservation.created was claimed before its order existed';
  END IF;
END
$assert_unlinked_reservation_waits$;

-- New Wompi order and explicit pending payment; repeated identical status produces no duplicate.
INSERT INTO public.orders (id, reference, customer_name, phone, city, address, items, total, payment_method, payment_status, order_status)
VALUES ('00000000-0000-4000-8000-000000000001', 'JM-TEST-001', 'PRIVATE PERSON DO NOT EXPORT', '3000000001', 'Cali', 'PRIVATE ADDRESS', '[{"code":"SKU-10","name":"Synthetic Shirt","qty":2},{"code":"SKU-11","name":"Synthetic Shoes","qty":1}]', 130000, 'wompi', 'PENDING', 'new');
UPDATE public.orders SET city = 'Cali' WHERE id = '00000000-0000-4000-8000-000000000001';
UPDATE public.orders SET payment_status = 'PENDING' WHERE id = '00000000-0000-4000-8000-000000000001';
UPDATE public.orders SET payment_status = 'APPROVED' WHERE id = '00000000-0000-4000-8000-000000000001';
UPDATE public.orders SET payment_status = 'DECLINED' WHERE id = '00000000-0000-4000-8000-000000000001';
UPDATE public.orders SET payment_status = 'DECLINED' WHERE id = '00000000-0000-4000-8000-000000000001';
UPDATE public.orders SET payment_status = 'ERROR' WHERE id = '00000000-0000-4000-8000-000000000001';
UPDATE public.orders SET payment_status = 'VOIDED', order_status = 'CANCELLED' WHERE id = '00000000-0000-4000-8000-000000000001';
INSERT INTO public.orders (id, reference, customer_name, phone, address, items, total, payment_method, payment_status, order_status)
VALUES ('00000000-0000-4000-8000-000000000003', 'JM-TEST-METHOD', 'PRIVATE METHOD NAME', '3000000003', 'PRIVATE METHOD ADDRESS', '[]', 5000, 'CUSTOMER PHONE 3015550000', 'PENDING', 'new');

-- COD/new web order and cancellation, without exposing customer fields.
INSERT INTO public.web_orders (id, customer_name, customer_cedula, customer_phone, customer_email, customer_city, customer_address, note, payment_method, total, status, client_reference, inventory_reference, items)
VALUES ('00000000-0000-4000-8000-000000000002', 'PRIVATE COD NAME', '123456789', '3000000002', 'cod@example.test', 'Palmira', 'COD PRIVATE ADDRESS', 'PRIVATE NOTE', 'Contra entrega', 75000, 'pendiente', 'COD-TEST-002', 'RES-TEST-1', '[{"code":"SKU-10","name":"Synthetic Shirt","qty":1}]');
UPDATE public.web_orders SET status = 'cancelado' WHERE id = '00000000-0000-4000-8000-000000000002';

-- Inventory threshold and movement events.
UPDATE public.products SET quantity = 0 WHERE id = '00000000-0000-4000-8000-000000000010';
UPDATE public.products SET quantity = 3 WHERE id = '00000000-0000-4000-8000-000000000010';
UPDATE public.products SET quantity = 2 WHERE id = '00000000-0000-4000-8000-000000000010';
INSERT INTO public.inventory_movements (id, product_id, product_code, product_name, type, quantity, motive)
VALUES ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'SKU-10', 'Synthetic Shirt', 'OUT', 1, 'PRIVATE MOTIVE DO NOT EXPORT');

-- Multiple reservation lines with one reference generate one idempotent event per transition.
INSERT INTO public.inventory_reservations (id, product_id, quantity, reference, status, expires_at)
VALUES ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000010', 1, 'RES-TEST-1', 'active', now() + interval '10 minutes'),
       ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000011', 2, 'RES-TEST-1', 'active', now() + interval '10 minutes');
UPDATE public.inventory_reservations SET status = 'RELEASED' WHERE reference = 'JM-TEST-001';
INSERT INTO public.inventory_reservations (id, product_id, quantity, reference, status, expires_at)
VALUES ('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000010', 1, 'RES-TEST-WA', 'WHATSAPP_RESERVED', '9999-12-31 23:59:59+00');
UPDATE public.inventory_reservations SET status = 'WHATSAPP_CONFIRMED' WHERE id = '00000000-0000-4000-8000-000000000034';
INSERT INTO public.inventory_reservations (id, product_id, quantity, reference, status, expires_at)
VALUES ('00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000011', 1, 'RES-TEST-EXPIRE', 'active', now() - interval '1 minute');
UPDATE public.inventory_reservations SET status = 'EXPIRED' WHERE id = '00000000-0000-4000-8000-000000000035';

DO $assert_events$
DECLARE
  v_count bigint;
  v_result jsonb;
  v_id uuid;
  v_claim_token uuid;
  v_reclaimed_token uuid;
  v_state text;
  v_attempt integer;
  v_next timestamptz;
  v_expired_id uuid;
  v_expired_token uuid;
BEGIN
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'order.created') <> 3 THEN RAISE EXCEPTION 'unexpected order.created count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'payment.pending') <> 2 THEN RAISE EXCEPTION 'unexpected payment.pending count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'payment.approved') <> 1 THEN RAISE EXCEPTION 'unexpected payment.approved count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'payment.rejected') <> 1 THEN RAISE EXCEPTION 'unexpected payment.rejected count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'payment.error') <> 1 THEN RAISE EXCEPTION 'unexpected payment.error count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'payment.voided') <> 1 THEN RAISE EXCEPTION 'unexpected payment.voided count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'order.cancelled') <> 2 THEN RAISE EXCEPTION 'unexpected order.cancelled count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'inventory.stockout') <> 1 THEN RAISE EXCEPTION 'unexpected inventory.stockout count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'inventory.restocked') <> 1 THEN RAISE EXCEPTION 'unexpected inventory.restocked count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'inventory.movement') <> 1 THEN RAISE EXCEPTION 'unexpected inventory.movement count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'reservation.created') <> 3 THEN RAISE EXCEPTION 'reservation reference was not deduplicated'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'reservation.released') <> 1 THEN RAISE EXCEPTION 'reservation release was not deduplicated'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'reservation.expired') <> 1 THEN RAISE EXCEPTION 'unexpected reservation.expired count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'reservation.whatsapp_reserved') <> 1 THEN RAISE EXCEPTION 'unexpected WhatsApp reservation count'; END IF;
  IF (SELECT count(*) FROM public.sirevya_telegram_outbox WHERE event_type = 'reservation.whatsapp_confirmed') <> 1 THEN RAISE EXCEPTION 'unexpected WhatsApp confirmation count'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.sirevya_telegram_outbox
     WHERE payload ?| ARRAY['customer_cedula','customer_phone','customer_email','customer_address','customer_city','customer_neighborhood','note','items','name','phone','address','email','cedula']
        OR payload::text ILIKE '%PRIVATE ADDRESS%'
        OR payload::text ILIKE '%COD PRIVATE ADDRESS%'
        OR payload::text ILIKE '%PRIVATE NOTE%'
        OR payload::text ILIKE '%PRIVATE MOTIVE DO NOT EXPORT%'
        OR payload::text ILIKE '%CUSTOMER PHONE 3015550000%'
  ) THEN RAISE EXCEPTION 'PII or arbitrary values leaked into outbox'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sirevya_telegram_outbox
     WHERE source_id = '00000000-0000-4000-8000-000000000001'
       AND event_type = 'order.created'
       AND payload->>'reference' = 'JM-TEST-001'
       AND payload->>'order_reference' = 'JM-TEST-001'
       AND payload->>'customer_name' = 'PRIVATE PERSON DO NOT EXPORT'
       AND payload->>'city' = 'Cali'
       AND (payload->>'total_units')::integer = 3
       AND payload->'products' @> '[{"code":"SKU-10","name":"Synthetic Shirt","quantity":2},{"code":"SKU-11","name":"Synthetic Shoes","quantity":1}]'::jsonb
  ) THEN RAISE EXCEPTION 'order payload did not normalize customer, city and products'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sirevya_telegram_outbox
     WHERE source_id = '00000000-0000-4000-8000-000000000002'
       AND event_type = 'order.created'
       AND payload->>'order_reference' = 'COD-TEST-002'
       AND payload->>'city' = 'Palmira'
       AND payload->>'order_status' = 'PENDIENTE'
       AND payload->>'payment_method' = 'Contra entrega'
       AND payload->'products' @> '[{"code":"SKU-10","name":"Synthetic Shirt","quantity":1}]'::jsonb
  ) THEN RAISE EXCEPTION 'COD order did not include its short commercial reference'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sirevya_telegram_outbox
     WHERE event_type = 'reservation.created'
       AND payload->>'reference' = 'JM-TEST-001'
       AND payload->>'order_reference' = 'JM-TEST-001'
       AND payload->>'customer_name' = 'PRIVATE PERSON DO NOT EXPORT'
       AND payload->>'city' = 'Cali'
       AND (payload->>'total_units')::integer = 3
       AND payload->'products' @> '[{"code":"SKU-10","name":"Synthetic Shirt","quantity":2},{"code":"SKU-11","name":"Synthetic Shoes","quantity":1}]'::jsonb
  ) THEN RAISE EXCEPTION 'Wompi reservation was not linked to its order'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sirevya_telegram_outbox
     WHERE event_type = 'reservation.created'
       AND payload->>'reference' = 'RES-TEST-1'
       AND payload->>'order_reference' = 'COD-TEST-002'
       AND payload->>'inventory_reference' = 'RES-TEST-1'
       AND payload->>'city' = 'Palmira'
       AND (payload->>'total_units')::integer = 3
  ) THEN RAISE EXCEPTION 'COD reservation did not link by inventory_reference'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sirevya_telegram_outbox
     WHERE source_id = '00000000-0000-4000-8000-000000000003'
       AND event_type = 'order.created'
       AND payload->>'payment_method' = 'sin especificar'
  ) THEN RAISE EXCEPTION 'untrusted payment method was not normalized'; END IF;
  BEGIN
    INSERT INTO public.sirevya_telegram_outbox (dedupe_key, event_type, source_table, source_id, payload)
    VALUES ('synthetic-telegram-arbitrary-key', 'order.created', 'orders', 'allowlist-test', '{"arbitrary":"must reject"}'::jsonb);
    RAISE EXCEPTION 'arbitrary payload key unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  IF has_table_privilege('anon', 'public.sirevya_telegram_outbox', 'SELECT')
     OR has_table_privilege('authenticated', 'public.sirevya_telegram_outbox', 'SELECT') THEN
    RAISE EXCEPTION 'outbox table is directly readable by client roles';
  END IF;
  IF has_function_privilege('anon', 'public.claim_sirevya_telegram_notifications(integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_sirevya_telegram_notifications(integer,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_sirevya_telegram_notifications(integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'claim RPC grants are incorrect';
  END IF;
  IF has_function_privilege('anon', 'public.set_sirevya_telegram_dispatcher_ready(boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.set_sirevya_telegram_dispatcher_ready(boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.set_sirevya_telegram_dispatcher_ready(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'dispatcher readiness must be service_role-only';
  END IF;
  IF has_function_privilege('anon', 'public.complete_sirevya_telegram_notification(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.complete_sirevya_telegram_notification(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.complete_sirevya_telegram_notification(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.retry_sirevya_telegram_notification(uuid,uuid,text,boolean,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.retry_sirevya_telegram_notification(uuid,uuid,text,boolean,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.retry_sirevya_telegram_notification(uuid,uuid,text,boolean,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'complete/retry RPC grants are incorrect';
  END IF;
  v_result := public.get_sirevya_telegram_notification_status();
  IF (v_result->>'scheduler_ready')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'scheduler not ready in fixture'; END IF;
  IF (v_result->>'dispatcher_ready')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'worker gate was not marked ready in fixture'; END IF;

  SELECT id, claim_token INTO v_id, v_claim_token
    FROM public.claim_sirevya_telegram_notifications(25, 600) ORDER BY id LIMIT 1;
  IF v_id IS NULL OR v_claim_token IS NULL THEN RAISE EXCEPTION 'claim RPC did not return an owned lease'; END IF;
  SELECT status, attempt_count INTO v_state, v_attempt FROM public.sirevya_telegram_outbox WHERE id = v_id;
  IF v_state <> 'processing' OR v_attempt <> 1 THEN RAISE EXCEPTION 'claim did not lease/increment event'; END IF;
  IF public.retry_sirevya_telegram_notification(v_id, v_claim_token, 'telegram_rate_limited', true, 30) <> 'pending' THEN RAISE EXCEPTION 'retry did not reschedule transient failure'; END IF;
  SELECT next_attempt_at INTO v_next FROM public.sirevya_telegram_outbox WHERE id = v_id;
  IF v_next < now() + interval '29 seconds' THEN RAISE EXCEPTION 'retry_after was not applied'; END IF;
  UPDATE public.sirevya_telegram_outbox SET next_attempt_at = now() - interval '1 second' WHERE id = v_id;
  SELECT id, claim_token INTO v_id, v_reclaimed_token FROM public.claim_sirevya_telegram_notifications(1, 600) LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'due retry could not be claimed'; END IF;
  IF v_reclaimed_token IS NULL OR v_reclaimed_token = v_claim_token THEN RAISE EXCEPTION 'new claim did not rotate ownership token'; END IF;
  IF public.complete_sirevya_telegram_notification(v_id, v_claim_token, '919191') IS DISTINCT FROM false THEN RAISE EXCEPTION 'stale owner completed another worker claim'; END IF;
  IF public.retry_sirevya_telegram_notification(v_id, v_claim_token, 'timeout', true, NULL) <> 'not_processing' THEN RAISE EXCEPTION 'stale owner changed another worker claim'; END IF;
  IF public.complete_sirevya_telegram_notification(v_id, v_reclaimed_token, '919191') IS DISTINCT FROM true THEN RAISE EXCEPTION 'current owner complete RPC failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sirevya_telegram_outbox WHERE id = v_id AND status = 'sent' AND telegram_message_id = '919191') THEN RAISE EXCEPTION 'sent status not persisted'; END IF;

  SELECT id, claim_token INTO v_id, v_claim_token FROM public.sirevya_telegram_outbox WHERE status = 'processing' ORDER BY id LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE public.sirevya_telegram_outbox SET attempt_count = 7 WHERE id = v_id;
    IF public.retry_sirevya_telegram_notification(v_id, v_claim_token, 'sensitive arbitrary error', true, NULL) <> 'dead' THEN RAISE EXCEPTION 'max attempts did not dead-letter'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sirevya_telegram_outbox WHERE id = v_id AND last_error_code = 'worker_internal' AND status = 'dead') THEN RAISE EXCEPTION 'error code was not allowlisted'; END IF;
  END IF;
  SELECT id, claim_token INTO v_expired_id, v_expired_token FROM public.sirevya_telegram_outbox WHERE status = 'processing' ORDER BY id LIMIT 1;
  IF v_expired_id IS NOT NULL THEN
    UPDATE public.sirevya_telegram_outbox SET attempt_count = 7, lease_until = now() - interval '1 second' WHERE id = v_expired_id;
    SELECT count(*) INTO v_count FROM public.claim_sirevya_telegram_notifications(25, 600) WHERE id = v_expired_id;
    IF v_count <> 0 THEN RAISE EXCEPTION 'exhausted lease was reclaimed after the retry limit'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sirevya_telegram_outbox WHERE id = v_expired_id AND status = 'dead' AND claim_token IS NULL AND last_error_code = 'timeout') THEN
      RAISE EXCEPTION 'exhausted expired lease was not dead-lettered';
    END IF;
    IF public.complete_sirevya_telegram_notification(v_expired_id, v_expired_token, '919192') IS DISTINCT FROM false
       OR public.retry_sirevya_telegram_notification(v_expired_id, v_expired_token, 'timeout', true, NULL) <> 'not_processing' THEN
      RAISE EXCEPTION 'expired owner mutated a dead-lettered row';
    END IF;
  END IF;
END
$assert_events$;

SET LOCAL test.is_admin = 'false';
DO $assert_no_client_toggle$
BEGIN
  BEGIN
    PERFORM public.set_sirevya_telegram_notifications_enabled(false);
    RAISE EXCEPTION 'unauthorized toggle unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$assert_no_client_toggle$;

ROLLBACK;
\echo 'telegram_outbox_local_regression: PASS (synthetic transaction rolled back)'
