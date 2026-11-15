-- Candidata local/scratch únicamente. No aplicar en producción sin preflight y autorización separada.
-- Request fencing, cancelación idempotente y recuperación manual auditada de intentos sin transaction_id.
BEGIN;

ALTER TABLE public.storefront_wompi_payment_attempts
  ADD COLUMN IF NOT EXISTS checkout_request_id uuid,
  ADD COLUMN IF NOT EXISTS manual_disposition text,
  ADD COLUMN IF NOT EXISTS manual_verified_at timestamptz;
ALTER TABLE public.storefront_wompi_payment_attempts
  DROP CONSTRAINT IF EXISTS storefront_wompi_manual_disposition_ck;
ALTER TABLE public.storefront_wompi_payment_attempts
  ADD CONSTRAINT storefront_wompi_manual_disposition_ck
  CHECK (manual_disposition IS NULL OR manual_disposition='NO_TRANSACTION_VERIFIED');
DROP INDEX IF EXISTS public.storefront_wompi_attempt_open_order_uq;
CREATE UNIQUE INDEX storefront_wompi_attempt_open_order_uq
  ON public.storefront_wompi_payment_attempts(order_reference)
  WHERE status IN ('INITIATED','PENDING') AND manual_disposition IS NULL;

CREATE TABLE public.storefront_wompi_checkout_requests (
  request_id uuid PRIMARY KEY,
  reference text NOT NULL,
  snapshot_hash text NOT NULL,
  cart_hash text NOT NULL,
  customer_phone_hash text NOT NULL,
  state text NOT NULL DEFAULT 'started',
  attempt_reference text,
  amount_in_cents bigint,
  order_created_by_request boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  published_at timestamptz,
  manual_verified_at timestamptz,
  cancel_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storefront_wompi_request_reference_ck CHECK (reference ~ '^[A-Za-z0-9_-]{1,120}$'),
  CONSTRAINT storefront_wompi_request_snapshot_hash_ck CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT storefront_wompi_request_cart_hash_ck CHECK (cart_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT storefront_wompi_request_phone_hash_ck CHECK (customer_phone_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT storefront_wompi_request_state_ck CHECK (state IN (
    'started','lock_active','prepared','claimed','order_created','attempt_issued','published',
    'cancelled','terminal','manual_recovery_required','no_transaction_verified'
  )),
  CONSTRAINT storefront_wompi_request_amount_ck CHECK (amount_in_cents IS NULL OR amount_in_cents>0)
);
CREATE UNIQUE INDEX storefront_wompi_request_active_reference_uq
  ON public.storefront_wompi_checkout_requests(reference)
  WHERE state IN ('started','lock_active','prepared','claimed','order_created');
CREATE INDEX storefront_wompi_request_state_updated_idx
  ON public.storefront_wompi_checkout_requests(state,updated_at);

CREATE TABLE public.storefront_wompi_checkout_cancel_tombstones (
  request_id uuid PRIMARY KEY,
  cancelled_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.storefront_wompi_checkout_locks
  ADD COLUMN IF NOT EXISTS checkout_request_id uuid;
ALTER TABLE public.storefront_wompi_checkout_locks
  ADD CONSTRAINT storefront_wompi_lock_request_fk
  FOREIGN KEY (checkout_request_id) REFERENCES public.storefront_wompi_checkout_requests(request_id);
ALTER TABLE public.storefront_wompi_payment_attempts
  ADD CONSTRAINT storefront_wompi_attempt_request_fk
  FOREIGN KEY (checkout_request_id) REFERENCES public.storefront_wompi_checkout_requests(request_id);
CREATE INDEX storefront_wompi_attempt_request_idx
  ON public.storefront_wompi_payment_attempts(checkout_request_id,attempt_number DESC)
  WHERE checkout_request_id IS NOT NULL;

CREATE TABLE public.storefront_wompi_recovery_audit (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid,
  order_reference text NOT NULL,
  attempt_reference text,
  admin_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('NO_TRANSACTION_VERIFIED','NO_ATTEMPT_ISSUED_VERIFIED')),
  attestation_source text NOT NULL CHECK (attestation_source='WOMPI_PRODUCTION_MERCHANT_DASHBOARD'),
  attested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storefront_wompi_recovery_audit_request_fk
    FOREIGN KEY (request_id) REFERENCES public.storefront_wompi_checkout_requests(request_id)
);
CREATE UNIQUE INDEX storefront_wompi_recovery_audit_attempt_action_uq
  ON public.storefront_wompi_recovery_audit(attempt_reference,action) WHERE attempt_reference IS NOT NULL;
CREATE UNIQUE INDEX storefront_wompi_recovery_audit_request_action_uq
  ON public.storefront_wompi_recovery_audit(request_id,action) WHERE request_id IS NOT NULL;
CREATE INDEX storefront_wompi_recovery_audit_order_idx
  ON public.storefront_wompi_recovery_audit(order_reference,attested_at DESC);

CREATE TABLE public.storefront_wompi_manual_recovery_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_reference text NOT NULL,
  order_reference text NOT NULL,
  transaction_id text NOT NULL,
  provider_status text NOT NULL CHECK (provider_status IN ('PENDING','APPROVED','DECLINED','VOIDED','ERROR')),
  amount_in_cents bigint NOT NULL,
  currency text NOT NULL CHECK (currency='COP'),
  environment text NOT NULL CHECK (environment='prod'),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_reference,transaction_id)
);
ALTER TABLE public.storefront_wompi_checkout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_wompi_checkout_cancel_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_wompi_recovery_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_wompi_manual_recovery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storefront_wompi_checkout_requests,
  public.storefront_wompi_checkout_cancel_tombstones,public.storefront_wompi_recovery_audit,public.storefront_wompi_manual_recovery_events
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.storefront_wompi_checkout_requests IS
  'Idempotency and cancellation fence for a single Wompi checkout request; contains only opaque identifiers and hashes, no customer PII.';
COMMENT ON TABLE public.storefront_wompi_recovery_audit IS
  'Append-only administrator attestations for manually verified absence of a Wompi production transaction; no PII or secret values.';
COMMENT ON TABLE public.storefront_wompi_manual_recovery_events IS
  'Late provider events received after a manual no-transaction attestation; fences fulfilment and preserves evidence without overwriting the attempt.';

CREATE OR REPLACE FUNCTION public.start_storefront_wompi_checkout_request(
  p_request_id uuid,p_reference text,p_snapshot_hash text,p_cart_hash text,p_customer_phone_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE v_req public.storefront_wompi_checkout_requests%ROWTYPE; v_attempt public.storefront_wompi_payment_attempts%ROWTYPE;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE; v_order public.orders%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR coalesce(p_reference,'') !~ '^[A-Za-z0-9_-]{1,120}$'
     OR coalesce(p_snapshot_hash,'') !~ '^[0-9a-f]{64}$'
     OR coalesce(p_cart_hash,'') !~ '^[0-9a-f]{64}$'
     OR coalesce(p_customer_phone_hash,'') !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_INPUT_INVALID');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-request:'||p_request_id::text));
  IF EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_cancel_tombstones t WHERE t.request_id=p_request_id) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_CANCELLED');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||p_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||p_customer_phone_hash));
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r
   WHERE r.request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF v_req.reference<>p_reference OR v_req.snapshot_hash<>p_snapshot_hash
       OR v_req.cart_hash<>p_cart_hash OR v_req.customer_phone_hash<>p_customer_phone_hash THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_SNAPSHOT_MISMATCH');
    END IF;
    IF v_req.state='cancelled' THEN RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_CANCELLED'); END IF;
    IF v_req.state='published' THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_NOT_REPLAYABLE');
    END IF;
    IF v_req.state='manual_recovery_required' THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_RECOVERY_REQUIRED');
    END IF;
    IF v_req.state='no_transaction_verified' THEN
      IF v_req.manual_verified_at IS NULL OR v_req.manual_verified_at+interval '15 minutes'>now() THEN
        RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_RETRY_GRACE',
          'retry_after',v_req.manual_verified_at+interval '15 minutes');
      END IF;
      UPDATE public.storefront_wompi_checkout_requests SET state='started',updated_at=now()
       WHERE request_id=p_request_id RETURNING * INTO v_req;
    END IF;
    IF v_req.state='attempt_issued' THEN
      SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a
       WHERE a.checkout_request_id=p_request_id AND a.attempt_reference=v_req.attempt_reference;
      SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l WHERE l.reference=p_reference;
      SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=p_reference;
      IF NOT FOUND OR v_attempt.attempt_reference IS NULL OR v_lock.reference IS NULL OR v_order.reference IS NULL OR v_attempt.status<>'INITIATED'
         OR v_attempt.transaction_id IS NOT NULL OR v_attempt.manual_disposition IS NOT NULL
         OR v_attempt.environment<>'prod' OR v_attempt.currency<>'COP'
         OR v_attempt.amount_in_cents<>v_req.amount_in_cents
         OR v_req.expires_at IS NULL OR v_req.expires_at<=now()
         OR v_lock.status<>'active' OR v_lock.checkout_request_id<>p_request_id
         OR v_lock.transaction_id IS NOT NULL OR v_lock.reconciliation_required
         OR upper(coalesce(v_order.payment_status,''))<>'PENDING' OR v_order.transaction_id IS NOT NULL
         OR v_order.wompi_reconciliation_required OR v_order.coupon_reconciliation_required THEN
        RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_NOT_REPLAYABLE');
      END IF;
    RETURN jsonb_build_object('success',true,'request_state',v_req.state,'replay_ready',false,
      'reference',v_req.reference,'attempt_reference',v_req.attempt_reference,
        'amount_in_cents',v_req.amount_in_cents,'expires_at',v_req.expires_at,
        'order_created_by_request',v_req.order_created_by_request);
    END IF;
    RETURN jsonb_build_object('success',true,'request_state',v_req.state,'replay_ready',false,
      'reference',v_req.reference,'attempt_reference',v_req.attempt_reference,
      'amount_in_cents',v_req.amount_in_cents,'expires_at',v_req.expires_at,
      'order_created_by_request',v_req.order_created_by_request);
  END IF;
  BEGIN
    INSERT INTO public.storefront_wompi_checkout_requests(
      request_id,reference,snapshot_hash,cart_hash,customer_phone_hash,state
    ) VALUES (p_request_id,p_reference,p_snapshot_hash,p_cart_hash,p_customer_phone_hash,'started')
    RETURNING * INTO v_req;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_ALREADY_ACTIVE');
  END;
  RETURN jsonb_build_object('success',true,'request_state','started','replay_ready',false,
    'reference',p_reference,'order_created_by_request',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.advance_storefront_wompi_checkout_request(
  p_request_id uuid,p_snapshot_hash text,p_step text,p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE v_req public.storefront_wompi_checkout_requests%ROWTYPE; v_result jsonb; v_success boolean:=false;
  v_attempt_reference text; v_new_state text; v_order public.orders%ROWTYPE;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE; v_attempt public.storefront_wompi_payment_attempts%ROWTYPE;
  v_latest integer; v_lock_found boolean; v_attempt_found boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-request:'||p_request_id::text));
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r WHERE r.request_id=p_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_NOT_FOUND'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_req.reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_req.customer_phone_hash));
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r WHERE r.request_id=p_request_id FOR UPDATE;
  IF v_req.snapshot_hash<>p_snapshot_hash THEN RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_SNAPSHOT_MISMATCH'); END IF;
  IF v_req.state IN ('cancelled','manual_recovery_required') THEN
    RETURN jsonb_build_object('success',false,'code',CASE WHEN v_req.state='cancelled' THEN 'WOMPI_REQUEST_CANCELLED' ELSE 'WOMPI_MANUAL_RECOVERY_REQUIRED' END);
  END IF;
  IF p_args IS NULL OR jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_STEP_INVALID');
  END IF;
  CASE p_step
    WHEN 'retry_lock' THEN
      IF v_req.state IN ('lock_active','prepared','claimed','order_created','attempt_issued','published') THEN
        RETURN jsonb_build_object('success',true,'idempotent',true,'request_state',v_req.state,'expires_at',v_req.expires_at);
      END IF;
      v_result:=public.prepare_storefront_wompi_retry_lock(v_req.reference,p_args->>'p_customer_phone',
        p_args->>'p_cart_hash',coalesce((p_args->>'p_minutes')::integer,10));
      v_success:=coalesce((v_result->>'success')::boolean,false);
      v_new_state:=CASE WHEN v_success THEN 'lock_active' ELSE v_req.state END;
    WHEN 'reserve_lock' THEN
      IF v_req.state IN ('lock_active','prepared','claimed','order_created','attempt_issued','published') THEN
        RETURN jsonb_build_object('success',true,'idempotent',true,'request_state',v_req.state,'expires_at',v_req.expires_at);
      END IF;
      v_result:=public.reserve_storefront_wompi_checkout_lock(v_req.reference,p_args->>'p_customer_phone',
        p_args->>'p_cart_hash',coalesce((p_args->>'p_minutes')::integer,10));
      v_success:=coalesce((v_result->>'success')::boolean,false);
      v_new_state:=CASE WHEN v_success THEN 'lock_active' ELSE v_req.state END;
    WHEN 'prepare' THEN
      IF v_req.state IN ('claimed','attempt_issued','published') THEN
        RETURN jsonb_build_object('success',true,'idempotent',true,'request_state',v_req.state,'expires_at',v_req.expires_at);
      END IF;
      v_result:=public.prepare_storefront_wompi_checkout(v_req.reference,p_args->'p_items',p_args->>'p_city',
        p_args->>'p_coupon_code',p_args->>'p_customer_email',p_args->>'p_customer_phone',p_args->'p_expected_quote');
      v_success:=coalesce((v_result->>'success')::boolean,false);
      v_new_state:=CASE WHEN v_success THEN 'prepared' ELSE v_req.state END;
    WHEN 'claim' THEN
      IF v_req.state IN ('claimed','order_created','attempt_issued','published') THEN
        RETURN jsonb_build_object('success',true,'idempotent',true,'request_state',v_req.state,'expires_at',v_req.expires_at);
      END IF;
      v_result:=public.claim_storefront_wompi_checkout(v_req.reference);
      v_success:=coalesce((v_result->>'success')::boolean,false);
      v_new_state:=CASE WHEN v_success THEN 'claimed' ELSE v_req.state END;
    WHEN 'create_order' THEN
      IF v_req.state IN ('order_created','attempt_issued','published') THEN
        RETURN jsonb_build_object('success',true,'idempotent',true,'request_state',v_req.state,'expires_at',v_req.expires_at);
      END IF;
      v_result:=public.create_storefront_wompi_pending_order(v_req.reference,p_args->>'p_customer_name',p_args->>'p_phone',
        p_args->>'p_city',p_args->>'p_address',p_args->>'p_neighborhood',p_args->'p_items',
        (p_args->>'p_subtotal')::bigint,(p_args->>'p_shipping')::bigint,(p_args->>'p_total')::bigint,
        nullif(p_args->>'p_coupon_id','')::uuid,nullif(p_args->>'p_coupon_code',''),(p_args->>'p_coupon_discount_total')::bigint);
      v_success:=coalesce((v_result->>'success')::boolean,false);
      v_new_state:=CASE WHEN v_success THEN 'order_created' ELSE v_req.state END;
    WHEN 'mark_existing_order' THEN
      IF v_req.state IN ('order_created','attempt_issued','published') THEN
        RETURN jsonb_build_object('success',true,'idempotent',true,'request_state',v_req.state,'expires_at',v_req.expires_at);
      END IF;
      SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_req.reference FOR UPDATE;
      IF FOUND AND lower(v_order.payment_method)='wompi' AND upper(v_order.payment_status)='PENDING'
         AND v_order.transaction_id IS NULL AND NOT coalesce(v_order.wompi_reconciliation_required,false)
         AND NOT coalesce(v_order.coupon_reconciliation_required,false) THEN
        v_result:=jsonb_build_object('success',true,'reference',v_req.reference);
        v_success:=true; v_new_state:='order_created';
      ELSIF FOUND AND coalesce((p_args->>'p_terminal_retry_verified')::boolean,false)
         AND lower(v_order.payment_method)='wompi' AND upper(v_order.payment_status) IN ('ERROR','DECLINED','VOIDED')
         AND v_order.transaction_id IS NOT NULL AND NOT coalesce(v_order.wompi_reconciliation_required,false)
         AND NOT coalesce(v_order.coupon_reconciliation_required,false) THEN
        SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l WHERE l.reference=v_req.reference FOR UPDATE;
        v_lock_found:=FOUND;
        SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a
         WHERE a.order_reference=v_req.reference ORDER BY a.attempt_number DESC LIMIT 1 FOR UPDATE;
        v_attempt_found:=FOUND;
        SELECT max(a.attempt_number) INTO v_latest FROM public.storefront_wompi_payment_attempts a WHERE a.order_reference=v_req.reference;
        IF v_lock_found AND v_attempt_found AND v_lock.status='active' AND v_lock.transaction_id IS NULL AND NOT v_lock.reconciliation_required
           AND v_lock.customer_phone_hash=v_req.customer_phone_hash AND v_lock.cart_hash=v_req.cart_hash
           AND v_attempt.transaction_id=v_order.transaction_id AND v_attempt.status=upper(v_order.payment_status)
           AND v_attempt.environment='prod' AND v_attempt.currency='COP'
           AND v_attempt.customer_phone_hash=v_req.customer_phone_hash AND v_attempt.cart_hash=v_req.cart_hash
           AND v_attempt.amount_in_cents=round(v_order.total::numeric*100)::bigint
           AND v_attempt.terminal_at IS NOT NULL AND v_attempt.terminal_at+interval '15 minutes'<=now()
           AND v_attempt.attempt_number=v_latest AND v_attempt.manual_disposition IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.storefront_wompi_payment_attempts a WHERE a.order_reference=v_req.reference
             AND a.status IN ('INITIATED','PENDING') AND a.manual_disposition IS NULL) THEN
          v_result:=jsonb_build_object('success',true,'reference',v_req.reference,'terminal_retry_verified',true);
          v_success:=true; v_new_state:='order_created';
        ELSE
          RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_HISTORY_REQUIRED');
        END IF;
      ELSE
        RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_STATE_CONFLICT');
      END IF;
    WHEN 'begin_attempt' THEN
      IF v_req.state IN ('attempt_issued','published') THEN
        RETURN jsonb_build_object('success',true,'idempotent',true,'request_state',v_req.state,
          'attempt_reference',v_req.attempt_reference,'amount_in_cents',v_req.amount_in_cents,'expires_at',v_req.expires_at,
          'currency','COP','environment','prod');
      END IF;
      IF v_req.state<>'order_created' THEN RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_STEP_ORDER_INVALID'); END IF;
      v_result:=public.begin_storefront_wompi_payment_attempt(v_req.reference,p_args->>'p_customer_name',p_args->>'p_customer_phone',
        p_args->>'p_city',p_args->>'p_address',p_args->>'p_neighborhood',p_args->'p_expected_quote',
        p_args->>'p_cart_hash',coalesce((p_args->>'p_is_new_order')::boolean,false));
      v_success:=coalesce((v_result->>'success')::boolean,false);
      v_attempt_reference:=v_result->>'attempt_reference';
      IF v_success THEN
        UPDATE public.storefront_wompi_payment_attempts SET checkout_request_id=p_request_id
         WHERE attempt_reference=v_attempt_reference AND order_reference=v_req.reference AND checkout_request_id IS NULL;
        IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_ATTEMPT_LINK_CONFLICT'); END IF;
        v_new_state:='attempt_issued';
      ELSE v_new_state:=v_req.state; END IF;
    ELSE
      RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_STEP_INVALID');
  END CASE;
  IF v_success THEN
    UPDATE public.storefront_wompi_checkout_locks SET checkout_request_id=p_request_id,updated_at=now()
     WHERE reference=v_req.reference AND status IN ('active','terminal_grace','released') AND transaction_id IS NULL;
    UPDATE public.storefront_wompi_checkout_requests SET state=v_new_state,
      order_created_by_request=CASE WHEN p_step='create_order' THEN true ELSE order_created_by_request END,
      expires_at=coalesce(nullif(p_args->>'p_expiration_time','')::timestamptz,nullif(v_result->>'expires_at','')::timestamptz,expires_at),
      amount_in_cents=coalesce(nullif(p_args->>'p_amount_in_cents','')::bigint,nullif(v_result->>'amount_in_cents','')::bigint,amount_in_cents),
      attempt_reference=coalesce(v_attempt_reference,attempt_reference),updated_at=now()
     WHERE request_id=p_request_id;
    RETURN v_result||jsonb_build_object('request_state',v_new_state);
  END IF;
  RETURN coalesce(v_result,jsonb_build_object('success',false,'code','WOMPI_REQUEST_STEP_FAILED'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_storefront_wompi_checkout_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE v_req public.storefront_wompi_checkout_requests%ROWTYPE; v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_has_order boolean; v_has_attempt boolean:=false; v_released boolean:=false;
  v_attempt public.storefront_wompi_payment_attempts%ROWTYPE;
BEGIN
  IF p_request_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_ID_REQUIRED'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-request:'||p_request_id::text));
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r WHERE r.request_id=p_request_id;
  IF NOT FOUND THEN
    INSERT INTO public.storefront_wompi_checkout_cancel_tombstones(request_id) VALUES(p_request_id)
    ON CONFLICT(request_id) DO NOTHING;
    RETURN jsonb_build_object('success',true,'state','cancelled','released',false,'tombstone',true,'idempotent',true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_req.reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_req.customer_phone_hash));
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r WHERE r.request_id=p_request_id FOR UPDATE;
  IF v_req.state='cancelled' THEN RETURN jsonb_build_object('success',true,'state','cancelled','idempotent',true); END IF;
  SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a
   WHERE a.checkout_request_id=p_request_id AND a.attempt_reference=v_req.attempt_reference FOR UPDATE;
  v_has_attempt:=FOUND;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_req.reference FOR UPDATE;
  v_has_order:=FOUND;
  IF v_has_attempt AND v_attempt.status IN ('ERROR','DECLINED','VOIDED')
     AND v_attempt.transaction_id IS NOT NULL AND v_attempt.environment='prod' AND v_attempt.currency='COP'
     AND v_attempt.verified_at IS NOT NULL AND v_attempt.terminal_at IS NOT NULL
     AND v_has_order AND v_attempt.amount_in_cents=round(v_order.total::numeric*100)::bigint
     AND v_order.transaction_id=v_attempt.transaction_id AND upper(coalesce(v_order.payment_status,''))=v_attempt.status
     AND NOT coalesce(v_order.wompi_reconciliation_required,false)
     AND NOT coalesce(v_order.coupon_reconciliation_required,false) THEN
    UPDATE public.storefront_wompi_checkout_requests SET state='terminal',cancel_requested_at=coalesce(cancel_requested_at,now()),updated_at=now()
     WHERE request_id=p_request_id;
    RETURN jsonb_build_object('success',true,'state','terminal','released',false,'manual_recovery_required',false,
      'reason','Verified terminal attempt retained; any retry must pass the terminal ledger and 15-minute gate.');
  END IF;
  IF v_req.state='published' THEN
    RETURN jsonb_build_object('success',true,'state','published','released',false,'manual_recovery_required',true,
      'reason','A checkout signature may already have been exposed; preserve the order and require reconciliation before any retry.');
  END IF;
  IF v_has_attempt OR v_has_order OR v_req.published_at IS NOT NULL OR v_req.state IN ('attempt_issued','published') THEN
    UPDATE public.storefront_wompi_checkout_requests SET state='manual_recovery_required',cancel_requested_at=coalesce(cancel_requested_at,now()),updated_at=now()
     WHERE request_id=p_request_id;
    RETURN jsonb_build_object('success',true,'state','manual_recovery_required','released',false,
      'reason','An order, payment attempt, or possibly exposed session exists; order and reservations were preserved.');
  END IF;
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l WHERE l.reference=v_req.reference FOR UPDATE;
  IF FOUND THEN
    IF v_lock.checkout_request_id IS DISTINCT FROM p_request_id OR v_lock.transaction_id IS NOT NULL
       OR v_lock.reconciliation_required OR v_lock.status NOT IN ('active','expired') THEN
      UPDATE public.storefront_wompi_checkout_requests SET state='manual_recovery_required',cancel_requested_at=coalesce(cancel_requested_at,now()),updated_at=now()
       WHERE request_id=p_request_id;
      RETURN jsonb_build_object('success',true,'state','manual_recovery_required','released',false,'reason','Lock ownership or state could not be proven.');
    END IF;
    PERFORM public.release_inventory_reservation(v_req.reference);
    UPDATE public.storefront_coupon_redemptions r SET status='released',updated_at=now()
     WHERE r.channel='wompi' AND r.reference=v_req.reference AND r.status='reserved';
    UPDATE public.storefront_wompi_checkout_locks SET status='released',expires_at=now(),checkout_claimed_at=NULL,updated_at=now()
     WHERE reference=v_req.reference AND checkout_request_id=p_request_id AND status IN ('active','expired') AND transaction_id IS NULL;
    v_released:=FOUND;
  END IF;
  UPDATE public.storefront_wompi_checkout_requests SET state='cancelled',cancel_requested_at=coalesce(cancel_requested_at,now()),updated_at=now()
   WHERE request_id=p_request_id;
  RETURN jsonb_build_object('success',true,'state','cancelled','released',v_released,'idempotent',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_storefront_wompi_checkout_request(
  p_request_id uuid,p_snapshot_hash text,p_attempt_reference text,p_amount_in_cents bigint,p_expiration_time timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE v_req public.storefront_wompi_checkout_requests%ROWTYPE; v_attempt public.storefront_wompi_payment_attempts%ROWTYPE;
  v_order public.orders%ROWTYPE; v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-request:'||p_request_id::text));
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r WHERE r.request_id=p_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_NOT_FOUND'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_req.reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_req.customer_phone_hash));
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r WHERE r.request_id=p_request_id FOR UPDATE;
  IF v_req.state='published' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_ALREADY_PUBLISHED');
  END IF;
  IF v_req.snapshot_hash<>p_snapshot_hash OR v_req.attempt_reference IS DISTINCT FROM p_attempt_reference
     OR v_req.amount_in_cents IS DISTINCT FROM p_amount_in_cents OR v_req.expires_at IS DISTINCT FROM p_expiration_time
     OR v_req.expires_at<=now() OR v_req.state<>'attempt_issued' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_PUBLISH_DENIED');
  END IF;
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l WHERE l.reference=v_req.reference FOR UPDATE;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_req.reference FOR UPDATE;
  SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a
   WHERE a.checkout_request_id=p_request_id AND a.attempt_reference=p_attempt_reference FOR UPDATE;
  IF NOT FOUND OR v_lock.reference IS NULL OR v_order.reference IS NULL OR v_attempt.status<>'INITIATED' OR v_attempt.transaction_id IS NOT NULL
     OR v_attempt.manual_disposition IS NOT NULL OR v_attempt.amount_in_cents<>p_amount_in_cents
     OR v_attempt.environment<>'prod' OR v_attempt.currency<>'COP'
     OR v_lock.checkout_request_id<>p_request_id OR v_lock.status<>'active' OR v_lock.transaction_id IS NOT NULL
     OR v_lock.reconciliation_required OR upper(coalesce(v_order.payment_status,''))<>'PENDING'
     OR v_order.transaction_id IS NOT NULL OR v_order.wompi_reconciliation_required OR v_order.coupon_reconciliation_required
     OR NOT EXISTS (SELECT 1 FROM public.inventory_reservations ir WHERE ir.reference=v_req.reference
       AND lower(coalesce(ir.status,''))='active' AND ir.expires_at>now()) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_PUBLISH_DENIED');
  END IF;
  UPDATE public.storefront_wompi_checkout_requests SET state='published',published_at=coalesce(published_at,now()),updated_at=now()
   WHERE request_id=p_request_id;
  RETURN jsonb_build_object('success',true,'state','published','reference',v_req.reference,
    'attempt_reference',p_attempt_reference,'expires_at',v_req.expires_at,'amount_in_cents',v_req.amount_in_cents);
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_storefront_wompi_no_transaction(
  p_attempt_reference text,p_admin_user_id uuid,p_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE v_attempt public.storefront_wompi_payment_attempts%ROWTYPE; v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_order public.orders%ROWTYPE; v_request public.storefront_wompi_checkout_requests%ROWTYPE;
  v_order_reference text; v_phone_hash text; v_latest integer; v_safe_after timestamptz;
BEGIN
  IF coalesce(p_attempt_reference,'') !~ '^SW-[A-F0-9]{32}$' OR p_admin_user_id IS NULL OR p_confirmed IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_ATTESTATION_REQUIRED');
  END IF;
  SELECT a.order_reference,a.customer_phone_hash INTO v_order_reference,v_phone_hash
    FROM public.storefront_wompi_payment_attempts a WHERE a.attempt_reference=p_attempt_reference;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_NOT_FOUND'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_order_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l WHERE l.reference=v_order_reference FOR UPDATE;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_order_reference FOR UPDATE;
  SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a WHERE a.attempt_reference=p_attempt_reference FOR UPDATE;
  IF NOT FOUND OR v_attempt.order_reference<>v_order_reference OR v_attempt.customer_phone_hash<>v_phone_hash
     OR v_attempt.environment<>'prod' OR v_attempt.currency<>'COP' OR v_attempt.status<>'INITIATED'
     OR v_attempt.transaction_id IS NOT NULL OR v_attempt.amount_in_cents<>round(v_order.total::numeric*100)::bigint
     OR lower(coalesce(v_order.payment_method,''))<>'wompi' OR upper(coalesce(v_order.payment_status,''))<>'PENDING'
     OR v_order.transaction_id IS NOT NULL OR coalesce(v_order.wompi_reconciliation_required,false)
     OR coalesce(v_order.coupon_reconciliation_required,false)
     OR v_lock.reference IS NULL OR v_lock.customer_phone_hash<>v_phone_hash
     OR v_lock.transaction_id IS NOT NULL OR v_lock.reconciliation_required
     OR v_lock.status NOT IN ('active','expired','terminal_grace','released') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_RECOVERY_STATE_CONFLICT');
  END IF;
  SELECT max(a.attempt_number) INTO v_latest FROM public.storefront_wompi_payment_attempts a WHERE a.order_reference=v_order_reference;
  IF v_latest IS DISTINCT FROM v_attempt.attempt_number THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_NOT_CURRENT');
  END IF;
  IF v_attempt.manual_disposition='NO_TRANSACTION_VERIFIED'
     AND EXISTS (SELECT 1 FROM public.storefront_wompi_recovery_audit x
       WHERE x.attempt_reference=p_attempt_reference AND x.action='NO_TRANSACTION_VERIFIED') THEN
    RETURN jsonb_build_object('success',true,'idempotent',true,'state','no_transaction_verified',
      'retry_after',v_attempt.manual_verified_at+interval '15 minutes');
  END IF;
  IF v_attempt.manual_disposition IS NOT NULL OR v_attempt.created_at+interval '25 minutes'>now() THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_RECOVERY_WAIT',
      'retry_after',v_attempt.created_at+interval '25 minutes');
  END IF;
  IF v_attempt.checkout_request_id IS NOT NULL THEN
    SELECT r.* INTO v_request FROM public.storefront_wompi_checkout_requests r
     WHERE r.request_id=v_attempt.checkout_request_id FOR UPDATE;
    IF NOT FOUND OR v_request.reference<>v_order_reference
       OR v_request.state NOT IN ('attempt_issued','published','manual_recovery_required') THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_STATE_CONFLICT');
    END IF;
    v_safe_after:=greatest(v_attempt.created_at+interval '25 minutes',coalesce(v_request.expires_at+interval '15 minutes',v_attempt.created_at+interval '25 minutes'));
    IF v_safe_after>now() THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_RECOVERY_WAIT','retry_after',v_safe_after);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_locks l
      WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_order_reference
        AND l.status IN ('active','pending','terminal_grace')) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART');
  END IF;
  UPDATE public.storefront_wompi_payment_attempts SET manual_disposition='NO_TRANSACTION_VERIFIED',
    manual_verified_at=now(),updated_at=now()
   WHERE attempt_reference=p_attempt_reference AND status='INITIATED' AND transaction_id IS NULL AND manual_disposition IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_RECOVERY_STATE_CONFLICT'); END IF;
  UPDATE public.storefront_wompi_checkout_locks SET status='terminal_grace',expires_at=now(),terminal_at=now(),
    checkout_claimed_at=NULL,updated_at=now()
   WHERE reference=v_order_reference AND transaction_id IS NULL AND reconciliation_required=false;
  IF v_attempt.checkout_request_id IS NOT NULL THEN
    UPDATE public.storefront_wompi_checkout_requests SET state='no_transaction_verified',manual_verified_at=now(),updated_at=now()
     WHERE request_id=v_attempt.checkout_request_id;
  END IF;
  INSERT INTO public.storefront_wompi_recovery_audit(
    request_id,order_reference,attempt_reference,admin_user_id,action,attestation_source
  ) VALUES (v_attempt.checkout_request_id,v_order_reference,p_attempt_reference,p_admin_user_id,
    'NO_TRANSACTION_VERIFIED','WOMPI_PRODUCTION_MERCHANT_DASHBOARD')
  ON CONFLICT (attempt_reference,action) WHERE attempt_reference IS NOT NULL DO NOTHING;
  RETURN jsonb_build_object('success',true,'state','no_transaction_verified','idempotent',false,
    'retry_after',now()+interval '15 minutes','order_preserved',true,'reservation_released',false,'payment_started',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_storefront_wompi_manual_retry_lock(
  p_request_id uuid,p_snapshot_hash text,p_customer_name text,p_customer_phone text,p_city text,
  p_address text,p_neighborhood text,p_customer_email text,p_items jsonb,p_coupon_code text,
  p_expected_quote jsonb,p_cart_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE v_req public.storefront_wompi_checkout_requests%ROWTYPE; v_order public.orders%ROWTYPE;
  v_attempt public.storefront_wompi_payment_attempts%ROWTYPE; v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone); v_phone_hash text;
  v_latest integer; v_prepared jsonb; v_expires_at timestamptz;
  v_has_order boolean:=false; v_has_lock boolean:=false; v_has_attempt boolean:=false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-request:'||p_request_id::text));
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r WHERE r.request_id=p_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_NOT_FOUND'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_req.reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_req.customer_phone_hash));
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r WHERE r.request_id=p_request_id FOR UPDATE;
  IF v_req.snapshot_hash<>p_snapshot_hash OR v_req.reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR v_req.state NOT IN ('started','lock_active') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_SNAPSHOT_MISMATCH');
  END IF;
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  IF v_phone !~ '^[0-9]{10}$' OR v_phone_hash<>v_req.customer_phone_hash
     OR lower(coalesce(p_cart_hash,''))<>v_req.cart_hash THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_SNAPSHOT_MISMATCH');
  END IF;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_req.reference FOR UPDATE;
  v_has_order:=FOUND;
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l WHERE l.reference=v_req.reference FOR UPDATE;
  v_has_lock:=FOUND;
  SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=v_req.reference ORDER BY a.attempt_number DESC LIMIT 1 FOR UPDATE;
  v_has_attempt:=FOUND;
  IF NOT v_has_order OR NOT v_has_lock
     OR lower(coalesce(v_order.payment_method,''))<>'wompi' OR upper(coalesce(v_order.payment_status,''))<>'PENDING'
     OR v_order.transaction_id IS NOT NULL OR v_order.wompi_reconciliation_required OR v_order.coupon_reconciliation_required
     OR v_lock.customer_phone_hash<>v_phone_hash OR v_lock.transaction_id IS NOT NULL
     OR v_lock.reconciliation_required OR v_lock.status NOT IN ('terminal_grace','released','expired','active') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_RETRY_SNAPSHOT_MISMATCH');
  END IF;
  IF v_has_attempt THEN
    IF v_attempt.status<>'INITIATED' OR v_attempt.manual_disposition<>'NO_TRANSACTION_VERIFIED'
       OR v_attempt.transaction_id IS NOT NULL OR v_attempt.manual_verified_at IS NULL
       OR v_attempt.manual_verified_at+interval '15 minutes'>now()
       OR v_attempt.environment<>'prod' OR v_attempt.currency<>'COP'
       OR v_attempt.customer_phone_hash<>v_phone_hash OR v_attempt.cart_hash<>v_req.cart_hash
       OR NOT EXISTS (SELECT 1 FROM public.storefront_wompi_recovery_audit a
         WHERE a.attempt_reference=v_attempt.attempt_reference AND a.action='NO_TRANSACTION_VERIFIED') THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_RECOVERY_WAIT');
    END IF;
  ELSE
    IF NOT v_req.order_created_by_request OR v_req.manual_verified_at IS NULL
       OR v_req.manual_verified_at+interval '15 minutes'>now()
       OR EXISTS (SELECT 1 FROM public.storefront_wompi_payment_attempts a WHERE a.order_reference=v_req.reference)
       OR NOT EXISTS (SELECT 1 FROM public.storefront_wompi_recovery_audit a
         WHERE a.request_id=p_request_id AND a.action='NO_ATTEMPT_ISSUED_VERIFIED') THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_RECOVERY_WAIT');
    END IF;
  END IF;
  IF lower(btrim(coalesce(v_order.customer_name,'')))<>lower(btrim(coalesce(p_customer_name,'')))
     OR public._storefront_coupon_normalized_phone(v_order.phone)<>v_phone
     OR lower(btrim(coalesce(v_order.city,'')))<>lower(btrim(coalesce(p_city,'')))
     OR btrim(coalesce(v_order.address,''))<>btrim(coalesce(p_address,''))
     OR btrim(coalesce(v_order.neighborhood,''))<>btrim(coalesce(p_neighborhood,''))
     OR v_order.items IS DISTINCT FROM p_expected_quote->'items'
     OR v_order.total::numeric IS DISTINCT FROM (p_expected_quote->>'total')::numeric
     OR v_order.subtotal::numeric IS DISTINCT FROM (p_expected_quote->>'original_subtotal')::numeric
     OR v_order.shipping::numeric IS DISTINCT FROM (p_expected_quote->>'shipping')::numeric
     OR coalesce(v_order.coupon_discount_total,0)::numeric IS DISTINCT FROM coalesce((p_expected_quote->>'coupon_discount_total')::numeric,0)
     OR upper(coalesce(v_order.coupon_code,''))<>upper(coalesce(p_expected_quote->>'coupon_code',''))
     OR coalesce(v_order.coupon_id::text,'')<>coalesce(p_expected_quote->>'coupon_id','') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_RETRY_SNAPSHOT_MISMATCH');
  END IF;
  SELECT max(a.attempt_number) INTO v_latest FROM public.storefront_wompi_payment_attempts a WHERE a.order_reference=v_req.reference;
  IF v_has_attempt AND v_latest IS DISTINCT FROM v_attempt.attempt_number THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_NOT_CURRENT');
  END IF;
  IF EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_locks l WHERE l.customer_phone_hash=v_phone_hash
      AND l.reference<>v_req.reference AND l.status IN ('active','pending','terminal_grace')) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART');
  END IF;
  v_prepared:=public.prepare_storefront_wompi_checkout(v_req.reference,p_items,p_city,p_coupon_code,
    p_customer_email,p_customer_phone,p_expected_quote);
  IF coalesce((v_prepared->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_prepared; END IF;
  v_expires_at:=nullif(v_prepared->>'expires_at','')::timestamptz;
  IF v_expires_at IS NULL OR v_expires_at<=now()+interval '5 seconds' OR v_expires_at>now()+interval '10 minutes' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_INVENTORY_EXPIRY_INVALID');
  END IF;
  UPDATE public.storefront_wompi_checkout_locks SET status='active',expires_at=v_expires_at,
    checkout_claimed_at=NULL,transaction_id=NULL,terminal_at=NULL,checkout_request_id=p_request_id,updated_at=now()
   WHERE reference=v_req.reference AND transaction_id IS NULL AND reconciliation_required=false;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_LOCK_NOT_ACTIVE'); END IF;
  UPDATE public.storefront_wompi_checkout_requests SET state='lock_active',expires_at=v_expires_at,updated_at=now()
   WHERE request_id=p_request_id;
  RETURN jsonb_build_object('success',true,'reference',v_req.reference,'expires_at',v_expires_at,
    'retry_after_manual_verification',true,'order_reused',true,'reservation_revalidated',true,
    'manual_attempt_recovered',v_has_attempt,'no_attempt_recovered',NOT v_has_attempt);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resume_storefront_wompi_unattempted_request(
  p_request_id uuid,p_snapshot_hash text,p_customer_name text,p_customer_phone text,p_city text,
  p_address text,p_neighborhood text,p_customer_email text,p_items jsonb,p_coupon_code text,
  p_expected_quote jsonb,p_cart_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE v_req public.storefront_wompi_checkout_requests%ROWTYPE; v_order public.orders%ROWTYPE;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE; v_prepared jsonb;
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_phone_hash text; v_expires_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-request:'||p_request_id::text));
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r WHERE r.request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.state<>'order_created' OR NOT v_req.order_created_by_request
     OR v_req.snapshot_hash<>p_snapshot_hash OR lower(v_req.cart_hash)<>lower(p_cart_hash)
     OR v_req.attempt_reference IS NOT NULL OR v_req.published_at IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_NOT_RESUMABLE');
  END IF;
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  IF v_phone !~ '^[0-9]{10}$' OR v_phone_hash<>v_req.customer_phone_hash THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_SNAPSHOT_MISMATCH');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_req.reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_req.customer_phone_hash));
  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_req.reference FOR UPDATE;
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l WHERE l.reference=v_req.reference FOR UPDATE;
  IF NOT FOUND OR lower(coalesce(v_order.payment_method,''))<>'wompi' OR upper(coalesce(v_order.payment_status,''))<>'PENDING'
     OR v_order.transaction_id IS NOT NULL OR coalesce(v_order.wompi_reconciliation_required,false)
     OR coalesce(v_order.coupon_reconciliation_required,false)
     OR EXISTS(SELECT 1 FROM public.storefront_wompi_payment_attempts a WHERE a.order_reference=v_req.reference)
     OR v_lock.checkout_request_id<>p_request_id OR v_lock.transaction_id IS NOT NULL
     OR v_lock.reconciliation_required OR v_lock.status NOT IN ('active','expired','released')
     OR lower(btrim(coalesce(v_order.customer_name,'')))<>lower(btrim(coalesce(p_customer_name,'')))
     OR public._storefront_coupon_normalized_phone(v_order.phone)<>v_phone
     OR lower(btrim(coalesce(v_order.city,'')))<>lower(btrim(coalesce(p_city,'')))
     OR btrim(coalesce(v_order.address,''))<>btrim(coalesce(p_address,''))
     OR btrim(coalesce(v_order.neighborhood,''))<>btrim(coalesce(p_neighborhood,''))
     OR v_order.items IS DISTINCT FROM p_expected_quote->'items'
     OR v_order.total::numeric IS DISTINCT FROM (p_expected_quote->>'total')::numeric
     OR v_order.subtotal::numeric IS DISTINCT FROM (p_expected_quote->>'original_subtotal')::numeric
     OR v_order.shipping::numeric IS DISTINCT FROM (p_expected_quote->>'shipping')::numeric
     OR coalesce(v_order.coupon_discount_total,0)::numeric IS DISTINCT FROM coalesce((p_expected_quote->>'coupon_discount_total')::numeric,0)
     OR upper(coalesce(v_order.coupon_code,''))<>upper(coalesce(p_expected_quote->>'coupon_code',''))
     OR coalesce(v_order.coupon_id::text,'')<>coalesce(p_expected_quote->>'coupon_id','') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REQUEST_ORDER_SNAPSHOT_MISMATCH');
  END IF;
  IF EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_locks l WHERE l.customer_phone_hash=v_phone_hash
      AND l.reference<>v_req.reference AND l.status IN ('active','pending','terminal_grace')) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART');
  END IF;
  BEGIN
    UPDATE public.storefront_wompi_checkout_locks SET status='active',checkout_claimed_at=NULL,
      expires_at=now()+interval '10 minutes',updated_at=now()
     WHERE reference=v_req.reference AND checkout_request_id=p_request_id AND transaction_id IS NULL AND NOT reconciliation_required;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LOCK_NOT_OWNED'; END IF;
    v_prepared:=public.prepare_storefront_wompi_checkout(v_req.reference,p_items,p_city,p_coupon_code,
      p_customer_email,p_customer_phone,p_expected_quote);
    IF coalesce((v_prepared->>'success')::boolean,false) IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PREPARE_REJECTED';
    END IF;
    v_expires_at:=nullif(v_prepared->>'expires_at','')::timestamptz;
    IF v_expires_at IS NULL OR v_expires_at<=now()+interval '5 seconds' OR v_expires_at>now()+interval '10 minutes' THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_EXPIRY';
    END IF;
    UPDATE public.storefront_wompi_checkout_locks SET status='active',expires_at=v_expires_at,
      checkout_claimed_at=NULL,updated_at=now()
     WHERE reference=v_req.reference AND checkout_request_id=p_request_id AND transaction_id IS NULL AND NOT reconciliation_required;
    UPDATE public.storefront_wompi_checkout_requests SET state='prepared',expires_at=v_expires_at,updated_at=now()
     WHERE request_id=p_request_id;
    RETURN jsonb_build_object('success',true,'reference',v_req.reference,'expires_at',v_expires_at,
      'order_reused',true,'reservation_revalidated',true,'attempt_issued',false);
  EXCEPTION WHEN OTHERS THEN
    RETURN coalesce(v_prepared,jsonb_build_object('success',false,'code','WOMPI_REQUEST_RESUME_FAILED'))
      ||jsonb_build_object('success',false,'code',coalesce(v_prepared->>'code','WOMPI_REQUEST_RESUME_FAILED'));
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_storefront_wompi_no_attempt(
  p_order_reference text,p_admin_user_id uuid,p_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE v_req public.storefront_wompi_checkout_requests%ROWTYPE; v_order public.orders%ROWTYPE;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
BEGIN
  IF coalesce(p_order_reference,'') !~ '^[A-Za-z0-9_-]{1,120}$' OR p_admin_user_id IS NULL OR p_confirmed IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_ATTESTATION_REQUIRED');
  END IF;
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r
   WHERE r.reference=p_order_reference AND r.state='manual_recovery_required'
     AND r.order_created_by_request AND r.attempt_reference IS NULL
   ORDER BY r.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_NO_UNATTEMPTED_REQUEST'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_req.reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_req.customer_phone_hash));
  SELECT r.* INTO v_req FROM public.storefront_wompi_checkout_requests r
   WHERE r.request_id=v_req.request_id FOR UPDATE;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_req.reference FOR UPDATE;
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l WHERE l.reference=v_req.reference FOR UPDATE;
  IF v_req.state<>'manual_recovery_required' OR NOT v_req.order_created_by_request
     OR v_req.attempt_reference IS NOT NULL OR v_req.published_at IS NOT NULL
     OR upper(coalesce(v_order.payment_status,''))<>'PENDING' OR v_order.transaction_id IS NOT NULL
     OR coalesce(v_order.wompi_reconciliation_required,false) OR coalesce(v_order.coupon_reconciliation_required,false)
     OR v_lock.checkout_request_id<>v_req.request_id OR v_lock.transaction_id IS NOT NULL OR v_lock.reconciliation_required
     OR v_lock.status NOT IN ('active','expired')
     OR EXISTS (SELECT 1 FROM public.storefront_wompi_payment_attempts a WHERE a.order_reference=v_req.reference) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_MANUAL_RECOVERY_STATE_CONFLICT');
  END IF;
  UPDATE public.storefront_wompi_checkout_requests SET state='no_transaction_verified',manual_verified_at=now(),updated_at=now()
   WHERE request_id=v_req.request_id;
  INSERT INTO public.storefront_wompi_recovery_audit(
    request_id,order_reference,attempt_reference,admin_user_id,action,attestation_source
  ) VALUES (v_req.request_id,v_req.reference,NULL,p_admin_user_id,'NO_ATTEMPT_ISSUED_VERIFIED',
    'WOMPI_PRODUCTION_MERCHANT_DASHBOARD')
  ON CONFLICT (request_id,action) WHERE request_id IS NOT NULL DO NOTHING;
  RETURN jsonb_build_object('success',true,'state','no_transaction_verified','retry_after',now()+interval '15 minutes',
    'order_preserved',true,'reservation_released',false,'attempt_issued',false,'payment_started',false);
END;
$function$;


-- RPC de recovery/retry con un tombstone local; status de Wompi no se falsifica.
CREATE OR REPLACE FUNCTION public.create_storefront_wompi_pending_order(
  p_reference text,p_customer_name text,p_phone text,p_city text,p_address text,p_neighborhood text,p_items jsonb,
  p_subtotal bigint,p_shipping bigint,p_total bigint,p_coupon_id uuid,p_coupon_code text,p_coupon_discount_total bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF btrim(coalesce(p_reference,'')) !~ '^[A-Za-z0-9_-]{1,120}$'
     OR p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR p_subtotal IS NULL OR p_subtotal<0 OR p_shipping IS NULL OR p_shipping<0
     OR p_total IS NULL OR p_total<=0 OR p_coupon_discount_total IS NULL OR p_coupon_discount_total<0 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_INPUT_INVALID');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||btrim(p_reference)));
  IF EXISTS (SELECT 1 FROM public.orders WHERE reference=btrim(p_reference)) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT');
  END IF;
  INSERT INTO public.orders(reference,customer_name,phone,city,address,neighborhood,items,subtotal,shipping,total,
    coupon_id,coupon_code,coupon_discount_total,payment_method,payment_status)
  VALUES(btrim(p_reference),p_customer_name,p_phone,p_city,p_address,p_neighborhood,p_items,p_subtotal,p_shipping,p_total,
    p_coupon_id,p_coupon_code,p_coupon_discount_total,'wompi','PENDING') RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'order_id',v_id,'reference',btrim(p_reference));
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT');
END;
$function$;
REVOKE ALL ON FUNCTION public.create_storefront_wompi_pending_order(text,text,text,text,text,text,jsonb,bigint,bigint,bigint,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_storefront_wompi_pending_order(text,text,text,text,text,text,jsonb,bigint,bigint,bigint,uuid,text,bigint) TO service_role;


CREATE OR REPLACE FUNCTION public.begin_storefront_wompi_payment_attempt(
  p_order_reference text,
  p_customer_name text,
  p_customer_phone text,
  p_city text,
  p_address text,
  p_neighborhood text,
  p_expected_quote jsonb,
  p_cart_hash text,
  p_is_new_order boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_order_reference,''));
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_phone_hash text;
  v_order public.orders%ROWTYPE;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_last public.storefront_wompi_payment_attempts%ROWTYPE;
  v_found boolean;
  v_attempt_number integer;
  v_attempt_reference text;
  v_now timestamptz:=now();
  v_quote_total numeric;
  v_quote_subtotal numeric;
  v_quote_shipping numeric;
  v_quote_coupon_discount numeric;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$' OR v_phone !~ '^[0-9]{10}$'
     OR p_cart_hash IS NULL OR p_cart_hash !~ '^[0-9a-fA-F]{64}$'
     OR p_expected_quote IS NULL OR jsonb_typeof(p_expected_quote) IS DISTINCT FROM 'object'
     OR p_expected_quote->>'success' IS DISTINCT FROM 'true'
     OR jsonb_typeof(p_expected_quote->'items') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_INPUT_INVALID');
  END IF;
  IF coalesce(p_expected_quote->>'total','') !~ '^[0-9]+$'
     OR coalesce(p_expected_quote->>'original_subtotal','') !~ '^[0-9]+$'
     OR coalesce(p_expected_quote->>'shipping','') !~ '^[0-9]+$'
     OR coalesce(p_expected_quote->>'coupon_discount_total','0') !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID');
  END IF;
  v_quote_total:=(p_expected_quote->>'total')::numeric;
  v_quote_subtotal:=(p_expected_quote->>'original_subtotal')::numeric;
  v_quote_shipping:=(p_expected_quote->>'shipping')::numeric;
  v_quote_coupon_discount:=coalesce((p_expected_quote->>'coupon_discount_total')::numeric,0);
  IF v_quote_total<=0 OR v_quote_total<>trunc(v_quote_total) OR v_quote_subtotal<0 OR v_quote_subtotal<>trunc(v_quote_subtotal)
     OR v_quote_shipping<0 OR v_quote_shipping<>trunc(v_quote_shipping)
     OR v_quote_coupon_discount<0 OR v_quote_coupon_discount<>trunc(v_quote_coupon_discount)
     OR v_quote_total*100>9223372036854775807 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID');
  END IF;

  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l
   WHERE l.reference=v_reference FOR UPDATE;
  IF NOT FOUND OR ltrim(v_lock.status)<> 'active' OR v_lock.customer_phone_hash<>v_phone_hash
     OR v_lock.cart_hash<>lower(p_cart_hash) OR v_lock.transaction_id IS NOT NULL
     OR v_lock.expires_at<=v_now OR v_lock.checkout_claimed_at IS NULL
     OR v_lock.checkout_claimed_at<v_now-interval '10 minutes' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LOCK_NOT_ACTIVE');
  END IF;

  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_reference FOR UPDATE;
  IF FOUND AND (v_order.wompi_reconciliation_required=true OR v_order.coupon_reconciliation_required=true) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED');
  END IF;
  IF NOT FOUND OR lower(coalesce(v_order.payment_method,''))<>'wompi'
     OR lower(btrim(coalesce(v_order.customer_name,'')))<>lower(btrim(coalesce(p_customer_name,'')))
     OR public._storefront_coupon_normalized_phone(v_order.phone)<>v_phone
     OR lower(btrim(coalesce(v_order.city,'')))<>lower(btrim(coalesce(p_city,'')))
     OR btrim(coalesce(v_order.address,''))<>btrim(coalesce(p_address,''))
     OR btrim(coalesce(v_order.neighborhood,''))<>btrim(coalesce(p_neighborhood,''))
     OR v_order.items IS DISTINCT FROM p_expected_quote->'items'
     OR v_order.total::numeric<>v_quote_total
     OR v_order.subtotal::numeric<>v_quote_subtotal
     OR v_order.shipping::numeric<>v_quote_shipping
     OR coalesce(v_order.coupon_discount_total,0)::numeric<>v_quote_coupon_discount
     OR upper(coalesce(v_order.coupon_code,''))<>upper(coalesce(p_expected_quote->>'coupon_code',''))
     OR coalesce(v_order.coupon_id::text,'')<>coalesce(p_expected_quote->>'coupon_id','') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_MISMATCH',
      'message','Los datos del comprador, carrito, ciudad o importe no coinciden con el pedido original.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_reservations r
      WHERE r.reference=v_reference AND lower(coalesce(r.status,''))='active' AND r.expires_at>v_now) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_INVENTORY_RESERVATION_MISSING');
  END IF;
  IF upper(coalesce(p_expected_quote->>'coupon_code',''))<>'' AND NOT EXISTS (
      SELECT 1 FROM public.storefront_coupon_redemptions r
       WHERE r.channel='wompi' AND r.reference=v_reference AND r.status='reserved'
         AND r.expires_at>v_now AND r.code=upper(p_expected_quote->>'coupon_code')
         AND r.coupon_id=v_order.coupon_id AND r.discount_total=v_order.coupon_discount_total
  ) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_COUPON_RESERVATION_MISSING');
  END IF;

  SELECT a.* INTO v_last FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=v_reference ORDER BY a.attempt_number DESC LIMIT 1 FOR UPDATE;
  v_found:=FOUND;
  IF NOT v_found THEN
    IF NOT p_is_new_order OR upper(coalesce(v_order.payment_status,''))<>'PENDING'
       OR nullif(btrim(coalesce(v_order.transaction_id,'')),'') IS NOT NULL
       OR (v_order.created_at<v_now-interval '10 minutes' AND NOT EXISTS (
          SELECT 1 FROM public.storefront_wompi_checkout_requests r
          JOIN public.storefront_wompi_recovery_audit ra ON ra.request_id=r.request_id
          WHERE r.reference=v_reference AND r.order_created_by_request AND r.state='order_created'
            AND r.manual_verified_at+interval '15 minutes'<=v_now
            AND ra.action='NO_ATTEMPT_ISSUED_VERIFIED'
       )) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_HISTORY_REQUIRED',
        'message','No existe un intento verificado que permita reabrir esta orden.');
    END IF;
    v_attempt_number:=1;
  ELSE
    IF p_is_new_order THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT');
    END IF;
    IF v_last.status='INITIATED' AND v_last.manual_disposition='NO_TRANSACTION_VERIFIED' THEN
      IF v_last.transaction_id IS NOT NULL OR v_last.manual_verified_at IS NULL
         OR v_last.manual_verified_at+interval '15 minutes'>v_now
         OR v_last.environment<>'prod' OR v_last.currency<>'COP'
         OR v_last.amount_in_cents<>v_quote_total*100 OR v_last.cart_hash<>lower(p_cart_hash)
         OR v_last.customer_phone_hash<>v_phone_hash
         OR upper(coalesce(v_order.payment_status,''))<>'PENDING' OR v_order.transaction_id IS NOT NULL
         OR NOT EXISTS (SELECT 1 FROM public.storefront_wompi_recovery_audit ra
             WHERE ra.attempt_reference=v_last.attempt_reference AND ra.action='NO_TRANSACTION_VERIFIED') THEN
        RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_GRACE');
      END IF;
      v_attempt_number:=v_last.attempt_number+1;
    ELSIF v_last.status IN ('INITIATED','PENDING') THEN
      RETURN jsonb_build_object('success',false,'code',CASE WHEN v_last.status='PENDING' THEN 'WOMPI_TRANSACTION_PENDING' ELSE 'WOMPI_ATTEMPT_UNRESOLVED' END);
    ELSIF v_last.status IN ('APPROVED','APPROVED_LATE') THEN
      RETURN jsonb_build_object('success',false,'code',CASE WHEN v_last.status='APPROVED' THEN 'WOMPI_ALREADY_APPROVED' ELSE 'WOMPI_RECONCILIATION_REQUIRED' END);
    ELSIF v_last.status NOT IN ('ERROR','DECLINED','VOIDED') OR v_last.terminal_at IS NULL
       OR v_last.terminal_at+interval '15 minutes'>v_now
       OR v_last.transaction_id IS DISTINCT FROM v_order.transaction_id
       OR upper(coalesce(v_order.payment_status,'')) IS DISTINCT FROM v_last.status
       OR v_last.environment<>'prod' OR v_last.currency<>'COP'
       OR v_last.amount_in_cents<>v_quote_total*100
       OR v_last.cart_hash<>lower(p_cart_hash) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_GRACE');
    ELSE
      v_attempt_number:=v_last.attempt_number+1;
    END IF;
  END IF;

  v_attempt_reference:='SW-'||upper(replace(gen_random_uuid()::text,'-',''));
  IF v_found AND v_last.manual_disposition IS NULL THEN
    UPDATE public.orders SET payment_status='PENDING',transaction_id=NULL,updated_at=v_now
     WHERE reference=v_reference AND transaction_id=v_last.transaction_id
       AND upper(payment_status)=v_last.status;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_STATE_CONFLICT'); END IF;
  ELSIF v_found AND (upper(coalesce(v_order.payment_status,''))<>'PENDING' OR v_order.transaction_id IS NOT NULL) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_STATE_CONFLICT');
  END IF;
  INSERT INTO public.storefront_wompi_payment_attempts(
    attempt_reference,wompi_reference,is_legacy,order_reference,attempt_number,environment,amount_in_cents,currency,cart_hash,customer_phone_hash,status
  ) VALUES (
    v_attempt_reference,v_attempt_reference,false,v_reference,v_attempt_number,'prod',(v_quote_total*100)::bigint,'COP',lower(p_cart_hash),v_phone_hash,'INITIATED'
  );
  RETURN jsonb_build_object('success',true,'order_reference',v_reference,
    'attempt_reference',v_attempt_reference,'attempt_number',v_attempt_number,
    'environment','prod','currency','COP','amount_in_cents',(v_quote_total*100)::bigint,'status','INITIATED');
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_ALREADY_EXISTS');
END;
$function$;
REVOKE ALL ON FUNCTION public.begin_storefront_wompi_payment_attempt(text,text,text,text,text,text,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_storefront_wompi_payment_attempt(text,text,text,text,text,text,jsonb,text,boolean) TO service_role;

-- Todo evento de la transacción que contradiga una atestación manual queda aislado y requiere conciliación.
CREATE OR REPLACE FUNCTION public.transition_storefront_wompi_payment_attempt(
  p_attempt_reference text,
  p_transaction_id text,
  p_status text,
  p_amount_in_cents bigint,
  p_currency text,
  p_environment text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_attempt public.storefront_wompi_payment_attempts%ROWTYPE;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_order_reference text;
  v_phone_hash text;
  v_status text:=upper(btrim(coalesce(p_status,'')));
  v_final_status text;
  v_latest integer;
  v_is_current boolean;
  v_late_approval boolean:=false;
  v_idempotent boolean:=false;
BEGIN
  IF p_attempt_reference IS NULL OR p_attempt_reference !~ '^SW-[A-F0-9]{32}$'
     OR p_transaction_id IS NULL OR btrim(p_transaction_id) !~ '^[A-Za-z0-9_-]{1,120}$'
     OR v_status NOT IN ('PENDING','APPROVED','DECLINED','VOIDED','ERROR')
     OR p_amount_in_cents IS NULL OR p_amount_in_cents<=0 OR upper(coalesce(p_currency,''))<>'COP'
     OR lower(coalesce(p_environment,''))<>'prod' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_EVENT_INVALID');
  END IF;

  -- Stable identity is read first; follow the installed webhook lock order:
  -- reference -> phone -> lock row -> order row -> attempt row.
  SELECT a.order_reference,a.customer_phone_hash INTO v_order_reference,v_phone_hash
    FROM public.storefront_wompi_payment_attempts a WHERE a.attempt_reference=p_attempt_reference;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_NOT_FOUND'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_order_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l
   WHERE l.reference=v_order_reference FOR UPDATE;
  IF NOT FOUND OR v_lock.customer_phone_hash<>v_phone_hash THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_LOCK_NOT_FOUND');
  END IF;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_order_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_ORDER_NOT_FOUND'); END IF;
  SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a
   WHERE a.attempt_reference=p_attempt_reference FOR UPDATE;
  IF NOT FOUND OR v_attempt.order_reference<>v_order_reference OR v_attempt.customer_phone_hash<>v_phone_hash THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_IDENTITY_CONFLICT');
  END IF;
  IF v_attempt.environment<>'prod' OR v_attempt.currency<>'COP'
     OR v_attempt.amount_in_cents<>p_amount_in_cents THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_AMOUNT_OR_ENVIRONMENT_MISMATCH');
  END IF;
  IF v_attempt.transaction_id IS NOT NULL AND v_attempt.transaction_id<>btrim(p_transaction_id) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_TRANSACTION_CONFLICT');
  END IF;
  IF v_attempt.manual_disposition='NO_TRANSACTION_VERIFIED' THEN
    IF EXISTS (SELECT 1 FROM public.storefront_wompi_manual_recovery_events e
        WHERE e.attempt_reference=p_attempt_reference AND e.transaction_id<>btrim(p_transaction_id)) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_TRANSACTION_CONFLICT');
    END IF;
    INSERT INTO public.storefront_wompi_manual_recovery_events(
      attempt_reference,order_reference,transaction_id,provider_status,amount_in_cents,currency,environment
    ) VALUES (p_attempt_reference,v_order_reference,btrim(p_transaction_id),v_status,p_amount_in_cents,'COP','prod')
    ON CONFLICT (attempt_reference,transaction_id) DO NOTHING;
    UPDATE public.orders SET wompi_reconciliation_required=true,
      coupon_reconciliation_required=CASE WHEN coupon_id IS NOT NULL OR coalesce(coupon_code,'')<>''
        THEN true ELSE coupon_reconciliation_required END
     WHERE reference=v_order_reference;
    UPDATE public.storefront_wompi_checkout_locks SET reconciliation_required=true,updated_at=now()
     WHERE reference=v_order_reference;
    UPDATE public.storefront_wompi_checkout_locks l SET reconciliation_required=true,updated_at=now()
     WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_order_reference
       AND l.status IN ('active','pending','terminal_grace');
    UPDATE public.orders o SET wompi_reconciliation_required=true,
      coupon_reconciliation_required=CASE WHEN o.coupon_id IS NOT NULL OR coalesce(o.coupon_code,'')<>''
        THEN true ELSE o.coupon_reconciliation_required END
     FROM public.storefront_wompi_checkout_locks l
     WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_order_reference
       AND l.status IN ('active','pending','terminal_grace') AND o.reference=l.reference;
    v_late_approval:=v_status='APPROVED';
    v_final_status:=CASE WHEN v_late_approval THEN 'APPROVED_LATE' ELSE 'MANUAL_RECOVERY_CONFLICT' END;
    RETURN jsonb_build_object('success',true,'order_reference',v_order_reference,
      'attempt_reference',p_attempt_reference,'transaction_id',btrim(p_transaction_id),
      'status',v_final_status,'is_current',false,'late_approval',v_late_approval,
      'reconciliation_required',true,'manual_recovery_conflict',true,'idempotent',false);
  END IF;

  SELECT max(a.attempt_number) INTO v_latest FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=v_attempt.order_reference;
  v_is_current:=v_attempt.attempt_number=v_latest;
  v_final_status:=v_attempt.status;

  IF NOT v_is_current THEN
    IF v_status='APPROVED' THEN
      UPDATE public.storefront_wompi_payment_attempts SET status='APPROVED_LATE',
        transaction_id=btrim(p_transaction_id),verified_at=now(),updated_at=now()
       WHERE attempt_reference=p_attempt_reference AND status<>'APPROVED_LATE';
      UPDATE public.orders SET wompi_reconciliation_required=true,
        coupon_reconciliation_required=CASE WHEN coupon_id IS NOT NULL OR coalesce(coupon_code,'')<>''
          THEN true ELSE coupon_reconciliation_required END
       WHERE reference=v_order_reference;
      UPDATE public.storefront_wompi_checkout_locks SET reconciliation_required=true,updated_at=now()
       WHERE reference=v_order_reference;
      -- If another order for this phone already has a live lock, prevent its
      -- checkout/webhook from fulfilling while the old approval is reconciled.
      UPDATE public.storefront_wompi_checkout_locks l SET reconciliation_required=true,updated_at=now()
       WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_order_reference
         AND l.status IN ('active','pending','terminal_grace');
      UPDATE public.orders o SET wompi_reconciliation_required=true,
        coupon_reconciliation_required=CASE WHEN o.coupon_id IS NOT NULL OR coalesce(o.coupon_code,'')<>''
          THEN true ELSE o.coupon_reconciliation_required END
       FROM public.storefront_wompi_checkout_locks l
       WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_order_reference
         AND l.status IN ('active','pending','terminal_grace') AND o.reference=l.reference;
      v_final_status:='APPROVED_LATE';
      v_late_approval:=true;
    ELSE
      v_idempotent:=true;
    END IF;
  ELSIF v_attempt.status IN ('ERROR','DECLINED','VOIDED') AND v_status='APPROVED' THEN
    UPDATE public.storefront_wompi_payment_attempts SET status='APPROVED_LATE',
      transaction_id=btrim(p_transaction_id),verified_at=now(),updated_at=now()
     WHERE attempt_reference=p_attempt_reference;
    UPDATE public.orders SET wompi_reconciliation_required=true,
      coupon_reconciliation_required=CASE WHEN coupon_id IS NOT NULL OR coalesce(coupon_code,'')<>''
        THEN true ELSE coupon_reconciliation_required END
     WHERE reference=v_order_reference;
    UPDATE public.storefront_wompi_checkout_locks SET reconciliation_required=true,updated_at=now()
     WHERE reference=v_order_reference;
    UPDATE public.storefront_wompi_checkout_locks l SET reconciliation_required=true,updated_at=now()
     WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_order_reference
       AND l.status IN ('active','pending','terminal_grace');
    UPDATE public.orders o SET wompi_reconciliation_required=true,
      coupon_reconciliation_required=CASE WHEN o.coupon_id IS NOT NULL OR coalesce(o.coupon_code,'')<>''
        THEN true ELSE o.coupon_reconciliation_required END
     FROM public.storefront_wompi_checkout_locks l
     WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_order_reference
       AND l.status IN ('active','pending','terminal_grace') AND o.reference=l.reference;
    v_final_status:='APPROVED_LATE';
    v_late_approval:=true;
  ELSIF v_attempt.status='APPROVED' THEN
    v_final_status:='APPROVED';
    v_idempotent:=true;
  ELSIF v_attempt.status='APPROVED_LATE' THEN
    UPDATE public.orders SET wompi_reconciliation_required=true,
      coupon_reconciliation_required=CASE WHEN coupon_id IS NOT NULL OR coalesce(coupon_code,'')<>''
        THEN true ELSE coupon_reconciliation_required END
     WHERE reference=v_order_reference;
    UPDATE public.storefront_wompi_checkout_locks SET reconciliation_required=true,updated_at=now()
     WHERE reference=v_order_reference;
    v_final_status:='APPROVED_LATE';
    v_late_approval:=true;
    v_idempotent:=true;
  ELSIF v_attempt.status IN ('ERROR','DECLINED','VOIDED') AND v_status='PENDING' THEN
    v_idempotent:=true;
  ELSE
    v_idempotent:=v_attempt.status=v_status AND v_attempt.transaction_id=btrim(p_transaction_id);
    UPDATE public.storefront_wompi_payment_attempts SET
      status=v_status,
      transaction_id=btrim(p_transaction_id),
      verified_at=now(),
      terminal_at=CASE WHEN v_status IN ('ERROR','DECLINED','VOIDED') THEN coalesce(terminal_at,now()) ELSE terminal_at END,
      updated_at=now()
     WHERE attempt_reference=p_attempt_reference;
    v_final_status:=v_status;
  END IF;

  RETURN jsonb_build_object('success',true,'order_reference',v_attempt.order_reference,
    'attempt_reference',p_attempt_reference,'transaction_id',btrim(p_transaction_id),
    'status',v_final_status,'is_current',v_is_current,'late_approval',v_late_approval,
    'reconciliation_required',v_late_approval,'idempotent',v_idempotent);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_TRANSACTION_CONFLICT');
END;
$function$;
REVOKE ALL ON FUNCTION public.transition_storefront_wompi_payment_attempt(text,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transition_storefront_wompi_payment_attempt(text,text,text,bigint,text,text) TO service_role;

CREATE UNIQUE INDEX storefront_wompi_manual_event_transaction_uq
  ON public.storefront_wompi_manual_recovery_events(transaction_id);

REVOKE ALL ON FUNCTION public.start_storefront_wompi_checkout_request(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.advance_storefront_wompi_checkout_request(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_storefront_wompi_checkout_request(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.publish_storefront_wompi_checkout_request(uuid,text,text,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verify_storefront_wompi_no_transaction(text,uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verify_storefront_wompi_no_attempt(text,uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.prepare_storefront_wompi_manual_retry_lock(uuid,text,text,text,text,text,text,text,jsonb,text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.resume_storefront_wompi_unattempted_request(uuid,text,text,text,text,text,text,text,jsonb,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_storefront_wompi_checkout_request(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_storefront_wompi_checkout_request(uuid,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_storefront_wompi_checkout_request(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_storefront_wompi_checkout_request(uuid,text,text,bigint,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_storefront_wompi_no_transaction(text,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_storefront_wompi_no_attempt(text,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_storefront_wompi_manual_retry_lock(uuid,text,text,text,text,text,text,text,jsonb,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resume_storefront_wompi_unattempted_request(uuid,text,text,text,text,text,text,text,jsonb,text,jsonb,text) TO service_role;

COMMIT;
