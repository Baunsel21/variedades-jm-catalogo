BEGIN;

-- Sandbox-only safety transition: a hosted checkout that expired before the
-- card form was submitted is not a Wompi payment error. It is recorded as a
-- terminal client-session event, preserving the same order/request/reserve.
ALTER TABLE public.storefront_wompi_payment_attempts
  DROP CONSTRAINT IF EXISTS storefront_wompi_attempt_status_ck;
ALTER TABLE public.storefront_wompi_payment_attempts
  ADD CONSTRAINT storefront_wompi_attempt_status_ck CHECK (
    status IN ('INITIATED','PENDING','APPROVED','DECLINED','VOIDED','ERROR','APPROVED_LATE','EXPIRED_BEFORE_SUBMISSION')
  );
ALTER TABLE public.storefront_wompi_payment_attempts
  DROP CONSTRAINT IF EXISTS storefront_wompi_manual_disposition_ck;
ALTER TABLE public.storefront_wompi_payment_attempts
  ADD CONSTRAINT storefront_wompi_manual_disposition_ck CHECK (
    manual_disposition IS NULL OR manual_disposition IN ('NO_TRANSACTION_VERIFIED','EXPIRED_BEFORE_SUBMISSION')
  );
ALTER TABLE public.storefront_wompi_recovery_audit
  DROP CONSTRAINT IF EXISTS storefront_wompi_recovery_audit_action_ck;
ALTER TABLE public.storefront_wompi_recovery_audit
  ADD CONSTRAINT storefront_wompi_recovery_audit_action_ck CHECK (
    action IN ('NO_TRANSACTION_VERIFIED','NO_ATTEMPT_ISSUED_VERIFIED','EXPIRED_BEFORE_SUBMISSION')
  );

CREATE OR REPLACE FUNCTION public.renew_storefront_wompi_expired_session(
  p_request_id uuid,
  p_snapshot_hash text,
  p_cart_hash text,
  p_customer_phone_hash text,
  p_customer_name text,
  p_customer_phone text,
  p_city text,
  p_address text,
  p_neighborhood text,
  p_customer_email text,
  p_items jsonb,
  p_coupon_code text,
  p_expected_quote jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_req public.storefront_wompi_checkout_requests%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_attempt public.storefront_wompi_payment_attempts%ROWTYPE;
  v_prepared jsonb;
  v_expiry timestamptz;
  v_amount bigint;
  v_new_ref text;
BEGIN
  IF p_request_id IS NULL OR coalesce(p_snapshot_hash,'') !~ '^[0-9a-f]{64}$'
     OR coalesce(p_cart_hash,'') !~ '^[0-9a-f]{64}$'
     OR coalesce(p_customer_phone_hash,'') !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_EXPIRED_SESSION_INPUT_INVALID');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-request:'||p_request_id::text));
  SELECT * INTO v_req FROM public.storefront_wompi_checkout_requests
   WHERE request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.state<>'published' OR v_req.snapshot_hash<>p_snapshot_hash
     OR v_req.cart_hash<>lower(p_cart_hash) OR v_req.customer_phone_hash<>lower(p_customer_phone_hash)
     OR v_req.expires_at IS NULL OR v_req.expires_at>now() THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_EXPIRED_SESSION_NOT_ELIGIBLE');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_req.reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_req.customer_phone_hash));
  SELECT * INTO v_order FROM public.orders WHERE reference=v_req.reference FOR UPDATE;
  SELECT * INTO v_lock FROM public.storefront_wompi_checkout_locks WHERE reference=v_req.reference FOR UPDATE;
  SELECT * INTO v_attempt FROM public.storefront_wompi_payment_attempts
   WHERE order_reference=v_req.reference ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_attempt.attempt_reference<>v_req.attempt_reference
     OR v_attempt.status<>'INITIATED' OR v_attempt.transaction_id IS NOT NULL
     OR v_attempt.checkout_request_id IS NULL OR v_attempt.checkout_request_id<>p_request_id
     OR v_order.reference IS NULL OR upper(coalesce(v_order.payment_status,''))<>'PENDING'
     OR v_order.transaction_id IS NOT NULL OR coalesce(v_order.wompi_reconciliation_required,false)
     OR coalesce(v_order.coupon_reconciliation_required,false)
     OR v_lock.reference IS NULL OR v_lock.transaction_id IS NOT NULL
     OR v_lock.reconciliation_required OR v_lock.expires_at>now() THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_EXPIRED_SESSION_STATE_CONFLICT');
  END IF;
  IF EXISTS (SELECT 1 FROM public.storefront_wompi_payment_attempts
    WHERE order_reference=v_req.reference AND status IN ('PENDING','APPROVED','APPROVED_LATE')) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_STATE_CONFLICT');
  END IF;
  IF lower(public._storefront_coupon_normalized_phone(v_order.phone))<>lower(public._storefront_coupon_normalized_phone(p_customer_phone))
     OR lower(btrim(v_order.customer_name))<>lower(btrim(p_customer_name))
     OR lower(btrim(v_order.city))<>lower(btrim(p_city))
     OR btrim(v_order.address)<>btrim(p_address)
     OR btrim(coalesce(v_order.neighborhood,''))<>btrim(coalesce(p_neighborhood,''))
     OR v_order.items IS DISTINCT FROM p_expected_quote->'items'
     OR v_order.total::numeric IS DISTINCT FROM (p_expected_quote->>'total')::numeric
     OR v_order.subtotal::numeric IS DISTINCT FROM (p_expected_quote->>'original_subtotal')::numeric
     OR v_order.shipping::numeric IS DISTINCT FROM (p_expected_quote->>'shipping')::numeric THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_EXPIRED_SESSION_SNAPSHOT_MISMATCH');
  END IF;
  v_prepared:=public.prepare_storefront_wompi_checkout(v_req.reference,p_items,p_city,p_coupon_code,p_customer_email,p_customer_phone,p_expected_quote);
  IF coalesce((v_prepared->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_prepared; END IF;
  v_expiry:=nullif(v_prepared->>'expires_at','')::timestamptz;
  IF v_expiry IS NULL OR v_expiry<=now()+interval '5 seconds' OR v_expiry>now()+interval '10 minutes' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_INVENTORY_EXPIRY_INVALID');
  END IF;
  v_amount:=round((p_expected_quote->>'total')::numeric*100)::bigint;
  v_new_ref:='SW-'||upper(replace(gen_random_uuid()::text,'-',''));
  UPDATE public.storefront_wompi_payment_attempts
    SET status='EXPIRED_BEFORE_SUBMISSION',terminal_at=now(),manual_disposition='EXPIRED_BEFORE_SUBMISSION',updated_at=now()
    WHERE attempt_reference=v_attempt.attempt_reference AND status='INITIATED' AND transaction_id IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_EXPIRED_SESSION_RACE'); END IF;
  INSERT INTO public.storefront_wompi_payment_attempts(
    attempt_reference,wompi_reference,is_legacy,order_reference,attempt_number,environment,amount_in_cents,currency,cart_hash,customer_phone_hash,status,checkout_request_id
  ) VALUES (v_new_ref,v_new_ref,false,v_req.reference,v_attempt.attempt_number+1,'test',v_amount,'COP',lower(p_cart_hash),lower(p_customer_phone_hash),'INITIATED',p_request_id);
  UPDATE public.storefront_wompi_checkout_locks SET status='active',expires_at=v_expiry,
    checkout_claimed_at=now(),checkout_request_id=p_request_id,transaction_id=NULL,terminal_at=NULL,updated_at=now()
   WHERE reference=v_req.reference AND transaction_id IS NULL AND reconciliation_required=false;
  UPDATE public.storefront_wompi_checkout_requests SET state='published',attempt_reference=v_new_ref,
    amount_in_cents=v_amount,expires_at=v_expiry,published_at=now(),updated_at=now()
   WHERE request_id=p_request_id;
  INSERT INTO public.storefront_wompi_recovery_audit(request_id,order_reference,attempt_reference,action,attestation_source)
    VALUES(p_request_id,v_req.reference,v_attempt.attempt_reference,'EXPIRED_BEFORE_SUBMISSION','HOSTED_CHECKOUT_EXPIRED_BEFORE_CARD_SUBMISSION')
    ON CONFLICT (attempt_reference,action) WHERE attempt_reference IS NOT NULL DO NOTHING;
  RETURN jsonb_build_object('success',true,'reference',v_req.reference,'attempt_reference',v_new_ref,
    'amount_in_cents',v_amount,'expires_at',v_expiry,'currency','COP','environment','test',
    'order_reused',true,'reservation_revalidated',true,'previous_attempt_expired',true);
END;
$function$;

REVOKE ALL ON FUNCTION public.renew_storefront_wompi_expired_session(uuid,text,text,text,text,text,text,text,text,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.renew_storefront_wompi_expired_session(uuid,text,text,text,text,text,text,text,text,text,jsonb,text,jsonb) TO service_role;

COMMIT;
