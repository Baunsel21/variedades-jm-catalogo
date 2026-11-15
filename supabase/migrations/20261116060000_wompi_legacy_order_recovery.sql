-- Candidata local/scratch únicamente. Depende de 20261116050000_wompi_verified_retry_attempts.sql.
-- Importa dos transacciones Wompi legacy verificadas por un Edge Function admin,
-- conserva la misma orden/referencia y revalida quote, inventario y cupón en una transacción.
BEGIN;

CREATE OR REPLACE FUNCTION public.recover_storefront_wompi_legacy_order(
  p_order_reference text,
  p_cart_hash text,
  p_customer_email text,
  p_verified_attempts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_order_reference,''));
  v_order public.orders%ROWTYPE;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_phone text;
  v_phone_hash text;
  v_email text:=lower(btrim(coalesce(p_customer_email,'')));
  v_coupon_code text;
  v_quote jsonb;
  v_inventory jsonb;
  v_prepared jsonb;
  v_attempt record;
  v_attempt_number integer:=0;
  v_tx1 text;
  v_tx2 text;
  v_terminal1 timestamptz;
  v_terminal2 timestamptz;
  v_terminal_at timestamptz;
  v_attempt_ref1 text;
  v_attempt_ref2 text;
  v_amount bigint;
  v_expected_amount bigint;
  v_existing_count integer;
  v_existing_match_count integer;
  v_other_reference text;
  v_product_lock_id public.products.id%TYPE;
  v_expires_at timestamptz;
  v_already_recovered boolean:=false;
  v_message text;
  v_detail text;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR p_cart_hash IS NULL OR p_cart_hash !~ '^[0-9a-fA-F]{64}$'
     OR p_verified_attempts IS NULL OR jsonb_typeof(p_verified_attempts) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_verified_attempts)<>2 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_INPUT_INVALID');
  END IF;

  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.reference=v_reference AND lower(o.payment_method)='wompi';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_ORDER_NOT_FOUND'); END IF;
  v_phone:=public._storefront_coupon_normalized_phone(v_order.phone);
  IF v_phone !~ '^[0-9]{10}$' THEN RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_PHONE_INVALID'); END IF;
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  v_expected_amount:=round(v_order.total::numeric*100)::bigint;
  v_coupon_code:=upper(btrim(coalesce(v_order.coupon_code,'')));
  IF v_expected_amount<=0 OR (v_coupon_code<>'' AND
      (length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_ORDER_SNAPSHOT_INVALID');
  END IF;

  -- Canonical order: reference -> phone, matching the installed webhook lock RPCs.
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.reference=v_reference AND lower(o.payment_method)='wompi' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_ORDER_NOT_FOUND'); END IF;
  IF v_order.wompi_reconciliation_required=true OR v_order.coupon_reconciliation_required=true THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED');
  END IF;

  FOR v_attempt IN
    SELECT value,ordinality FROM jsonb_array_elements(p_verified_attempts) WITH ORDINALITY AS x(value,ordinality)
     ORDER BY ordinality
  LOOP
    IF jsonb_typeof(v_attempt.value) IS DISTINCT FROM 'object'
       OR coalesce(v_attempt.value->>'transaction_id','') !~ '^[A-Za-z0-9_-]{1,120}$'
       OR coalesce(v_attempt.value->>'reference','') IS DISTINCT FROM v_reference
       OR upper(coalesce(v_attempt.value->>'status','')) IS DISTINCT FROM 'ERROR'
       OR upper(coalesce(v_attempt.value->>'currency','')) IS DISTINCT FROM 'COP'
       OR lower(coalesce(v_attempt.value->>'environment','')) IS DISTINCT FROM 'prod'
       OR coalesce(v_attempt.value->>'amount_in_cents','') !~ '^[0-9]+$'
       OR coalesce(v_attempt.value->>'terminal_at','')='' THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_TRANSACTION_MISMATCH');
    END IF;
    v_amount:=(v_attempt.value->>'amount_in_cents')::bigint;
    IF v_amount<>v_expected_amount THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_AMOUNT_MISMATCH');
    END IF;
    IF v_attempt.ordinality=1 THEN
      v_tx1:=v_attempt.value->>'transaction_id';
      v_terminal1:=(v_attempt.value->>'terminal_at')::timestamptz;
    ELSE
      v_tx2:=v_attempt.value->>'transaction_id';
      v_terminal2:=(v_attempt.value->>'terminal_at')::timestamptz;
    END IF;
  END LOOP;
  IF v_tx1 IS NULL OR v_tx2 IS NULL OR v_tx1=v_tx2 OR v_terminal1 IS NULL OR v_terminal2 IS NULL
     OR v_terminal1>v_terminal2 OR v_terminal1>now()-interval '15 minutes'
     OR v_terminal2>now()-interval '15 minutes' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_TERMINAL_GRACE');
  END IF;
  v_terminal_at:=v_terminal2;

  -- All pricing/source locks and current quote verification occur before writes.
  PERFORM 1 FROM public.storefront_shipping_settings s WHERE s.id=1 FOR SHARE;
  LOCK TABLE public.storefront_product_combos IN SHARE MODE;
  LOCK TABLE public.storefront_shipping_rules IN SHARE MODE;
  LOCK TABLE public.storefront_shipping_rule_destinations IN SHARE MODE;
  FOR v_product_lock_id IN
    SELECT DISTINCT p.id FROM public.products p
      JOIN jsonb_array_elements(v_order.items) requested(item) ON p.id::text=requested.item->>'id'
     ORDER BY p.id
  LOOP
    PERFORM 1 FROM public.products p WHERE p.id=v_product_lock_id FOR NO KEY UPDATE OF p;
  END LOOP;
  IF v_coupon_code<>'' THEN
    PERFORM 1 FROM public.storefront_coupons c WHERE c.code=v_coupon_code FOR UPDATE;
  END IF;
  v_quote:=public.get_storefront_cart_quote_with_coupon(v_order.items,v_order.city,v_coupon_code,'','');
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true
     OR jsonb_typeof(v_quote->'items') IS DISTINCT FROM 'array'
     OR v_quote->'items' IS DISTINCT FROM v_order.items
     OR round((v_quote->>'original_subtotal')::numeric,0)<>round(v_order.subtotal::numeric,0)
     OR round((v_quote->>'shipping')::numeric,0)<>round(v_order.shipping::numeric,0)
     OR round((v_quote->>'total')::numeric,0)<>round(v_order.total::numeric,0)
     OR round(coalesce((v_quote->>'coupon_discount_total')::numeric,0),0)<>round(coalesce(v_order.coupon_discount_total,0)::numeric,0)
     OR coalesce(nullif(v_quote->>'coupon_id',''),'')<>coalesce(v_order.coupon_id::text,'')
     OR upper(coalesce(v_quote->>'coupon_code',''))<>v_coupon_code
     OR upper(coalesce(v_quote->>'currency','COP'))<>'COP' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_QUOTE_CHANGED');
  END IF;
  IF round((v_quote->>'total')::numeric*100)::bigint<>v_expected_amount THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_AMOUNT_MISMATCH');
  END IF;

  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l
   WHERE l.reference=v_reference FOR UPDATE;
  IF FOUND THEN
    IF v_lock.customer_phone_hash<>v_phone_hash
       OR (v_lock.cart_hash<>lower(p_cart_hash) AND v_lock.cart_hash<>repeat('0',64))
       OR v_lock.reconciliation_required=true
       OR v_lock.status='completed'
       OR (v_lock.transaction_id IS NOT NULL AND v_lock.transaction_id NOT IN (v_tx1,v_tx2)) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_LOCK_CONFLICT');
    END IF;
    IF v_lock.status IN ('active','pending') AND v_lock.expires_at>now()
       AND v_lock.checkout_claimed_at>now()-interval '10 minutes' THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_ALREADY_PREPARED');
    END IF;
    IF v_lock.status='terminal_grace' AND v_lock.terminal_at IS NOT NULL THEN
      v_terminal_at:=greatest(v_terminal_at,v_lock.terminal_at);
      IF v_terminal_at>now()-interval '15 minutes' THEN
        RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_TERMINAL_GRACE');
      END IF;
    END IF;
  END IF;
  SELECT l.reference INTO v_other_reference FROM public.storefront_wompi_checkout_locks l
   WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_reference
     AND l.status IN ('active','pending','terminal_grace') LIMIT 1 FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART'); END IF;

  SELECT count(*) INTO v_existing_count FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=v_reference;
  SELECT count(*) INTO v_existing_match_count FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=v_reference AND a.is_legacy=true AND a.wompi_reference=v_reference
     AND a.environment='prod' AND a.currency='COP' AND a.amount_in_cents=v_expected_amount
     AND a.cart_hash=lower(p_cart_hash) AND a.customer_phone_hash=v_phone_hash
     AND a.status='ERROR' AND a.terminal_at IS NOT NULL
     AND ((a.attempt_number=1 AND a.transaction_id=v_tx1 AND a.terminal_at=v_terminal1)
       OR (a.attempt_number=2 AND a.transaction_id=v_tx2 AND a.terminal_at=v_terminal2));
  IF v_existing_count=0 THEN
    IF upper(coalesce(v_order.payment_status,''))<>'PENDING'
       OR nullif(btrim(coalesce(v_order.transaction_id,'')),'') IS NOT NULL THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_ORDER_STATE_CONFLICT');
    END IF;
  ELSIF v_existing_count=2 AND v_existing_match_count=2 THEN
    IF upper(coalesce(v_order.payment_status,''))<>'ERROR' OR v_order.transaction_id IS DISTINCT FROM v_tx2 THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_ORDER_STATE_CONFLICT');
    END IF;
    v_already_recovered:=true;
    SELECT a.attempt_reference INTO v_attempt_ref2 FROM public.storefront_wompi_payment_attempts a
     WHERE a.order_reference=v_reference AND a.is_legacy=true AND a.transaction_id=v_tx2;
    SELECT a.attempt_reference INTO v_attempt_ref1 FROM public.storefront_wompi_payment_attempts a
     WHERE a.order_reference=v_reference AND a.is_legacy=true AND a.transaction_id=v_tx1;
  ELSE
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_HISTORY_CONFLICT');
  END IF;

  IF v_coupon_code<>'' THEN
    IF v_email='' THEN RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_COUPON_EMAIL_REQUIRED'); END IF;
    IF EXISTS (SELECT 1 FROM public.storefront_coupon_redemptions r
        WHERE r.channel='wompi' AND r.reference=v_reference AND r.status='released'
          AND (r.coupon_id IS DISTINCT FROM v_order.coupon_id OR r.code IS DISTINCT FROM v_coupon_code
            OR r.discount_total IS DISTINCT FROM coalesce(v_order.coupon_discount_total,0))) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_COUPON_CONFLICT');
    END IF;
  ELSIF coalesce(v_order.coupon_discount_total,0)<>0 OR v_order.coupon_id IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_COUPON_SNAPSHOT_INVALID');
  END IF;

  -- All mutations are inside this subtransaction. Any quote, stock, coupon, lock,
  -- uniqueness or RPC failure rolls back the entire recovery before returning.
  BEGIN
    IF NOT v_already_recovered THEN
      v_attempt_ref1:='SW-'||upper(replace(gen_random_uuid()::text,'-',''));
      v_attempt_ref2:='SW-'||upper(replace(gen_random_uuid()::text,'-',''));
      INSERT INTO public.storefront_wompi_payment_attempts(
        attempt_reference,wompi_reference,is_legacy,order_reference,attempt_number,environment,
        amount_in_cents,currency,cart_hash,customer_phone_hash,status,transaction_id,verified_at,terminal_at
      ) VALUES
        (v_attempt_ref1,v_reference,true,v_reference,1,'prod',v_expected_amount,'COP',lower(p_cart_hash),v_phone_hash,'ERROR',v_tx1,now(),v_terminal1),
        (v_attempt_ref2,v_reference,true,v_reference,2,'prod',v_expected_amount,'COP',lower(p_cart_hash),v_phone_hash,'ERROR',v_tx2,now(),v_terminal2);
      UPDATE public.orders SET payment_status='ERROR',transaction_id=v_tx2,updated_at=now()
       WHERE reference=v_reference AND payment_method ILIKE 'wompi'
         AND upper(payment_status)='PENDING' AND transaction_id IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECOVERY_ABORT',DETAIL='WOMPI_LEGACY_ORDER_STATE_CONFLICT'; END IF;
    END IF;

    IF v_coupon_code<>'' THEN
      UPDATE public.storefront_coupon_redemptions r
         SET released_attempt_reference=v_attempt_ref2,updated_at=now()
       WHERE r.channel='wompi' AND r.reference=v_reference AND r.status='released'
         AND r.coupon_id=v_order.coupon_id AND r.code=v_coupon_code
         AND r.discount_total=coalesce(v_order.coupon_discount_total,0)
         AND r.customer_hash=public._storefront_coupon_customer_hash(v_email,v_order.phone);
      IF EXISTS (SELECT 1 FROM public.storefront_coupon_redemptions r
          WHERE r.channel='wompi' AND r.reference=v_reference AND r.status='released'
            AND (r.coupon_id IS DISTINCT FROM v_order.coupon_id OR r.code IS DISTINCT FROM v_coupon_code
              OR r.discount_total IS DISTINCT FROM coalesce(v_order.coupon_discount_total,0)
              OR r.customer_hash IS DISTINCT FROM public._storefront_coupon_customer_hash(v_email,v_order.phone))) THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECOVERY_ABORT',DETAIL='WOMPI_LEGACY_COUPON_CONFLICT';
      END IF;
    END IF;

    v_prepared:=public.prepare_storefront_wompi_checkout(
      v_reference,v_order.items,v_order.city,v_coupon_code,v_email,v_order.phone,v_quote
    );
    IF coalesce((v_prepared->>'success')::boolean,false) IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECOVERY_ABORT',
        DETAIL=coalesce(v_prepared->>'code','WOMPI_LEGACY_PREPARATION_FAILED');
    END IF;
    v_expires_at:=nullif(v_prepared->>'expires_at','')::timestamptz;
    IF v_expires_at IS NULL OR v_expires_at<=now()+interval '5 seconds'
       OR v_expires_at>now()+interval '10 minutes' THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECOVERY_ABORT',DETAIL='WOMPI_LEGACY_RESERVATION_EXPIRY_INVALID';
    END IF;

    IF v_lock.reference IS NULL THEN
      INSERT INTO public.storefront_wompi_checkout_locks(
        reference,customer_phone_hash,cart_hash,status,expires_at,checkout_claimed_at,
        transaction_id,terminal_at,reconciliation_required,updated_at
      ) VALUES(v_reference,v_phone_hash,lower(p_cart_hash),'terminal_grace',v_expires_at,NULL,
        v_tx2,v_terminal_at,false,now());
    ELSE
      UPDATE public.storefront_wompi_checkout_locks SET customer_phone_hash=v_phone_hash,
        cart_hash=lower(p_cart_hash),status='terminal_grace',expires_at=v_expires_at,
        checkout_claimed_at=NULL,transaction_id=v_tx2,terminal_at=v_terminal_at,
        reconciliation_required=false,updated_at=now()
       WHERE reference=v_reference;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT,v_detail=PG_EXCEPTION_DETAIL;
    RETURN jsonb_build_object('success',false,'code',coalesce(nullif(v_detail,''),'WOMPI_LEGACY_RECOVERY_FAILED'),
      'message','No se realizó la recuperación; las escrituras parciales fueron revertidas.');
  END;

  RETURN jsonb_build_object('success',true,'reference',v_reference,'order_reused',true,
    'legacy_attempts_registered',2,'reservation_expires_at',v_expires_at,
    'payment_started',false,'order_created',false,'idempotent',v_already_recovered);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_RECOVERY_VALIDATION_FAILED',
    'message','No se pudo validar el pedido y las dos transacciones; no se modificó ningún dato.');
END;
$function$;
REVOKE ALL ON FUNCTION public.recover_storefront_wompi_legacy_order(text,text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.recover_storefront_wompi_legacy_order(text,text,text,jsonb)
  TO service_role;

COMMIT;
