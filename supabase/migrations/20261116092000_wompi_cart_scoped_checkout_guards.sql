-- Candidate migration only. Scope Wompi ambiguity guards to the canonical cart,
-- not to the customer's phone alone. Same-cart PENDING/APPROVED/unverified states,
-- late events, terminal grace and inventory holds remain fail-closed.
BEGIN;
CREATE OR REPLACE FUNCTION public.reserve_storefront_wompi_checkout_lock(
  p_reference text,p_customer_phone text,p_cart_hash text,p_minutes integer DEFAULT 10
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_phone_hash text;
  v_row public.storefront_wompi_checkout_locks%ROWTYPE;
  v_expires_at timestamptz;
  v_blocking_reference text;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$' OR v_phone !~ '^[0-9]{10}$'
     OR p_cart_hash IS NULL OR p_cart_hash !~ '^[0-9a-fA-F]{64}$'
     OR p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LOCK_INPUT_INVALID','message','No se pudo validar el intento de checkout.');
  END IF;
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  v_expires_at:=now()+make_interval(mins=>p_minutes);
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));

  IF EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_locks l
      WHERE l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash) AND l.reconciliation_required)
     OR EXISTS (SELECT 1 FROM public.orders o
      WHERE lower(o.payment_method)='wompi'
        AND (o.wompi_reconciliation_required OR o.coupon_reconciliation_required)
        AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
        AND EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_locks l WHERE l.reference=o.reference
          AND l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash))) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED',
      'message','Existe un pago que requiere revisión manual antes de iniciar otro checkout.');
  END IF;

  -- Un pedido PENDING no se limpia por TTL ni se convierte en una orden nueva.
  SELECT o.reference INTO v_blocking_reference FROM public.orders o
   WHERE lower(o.payment_method)='wompi' AND upper(coalesce(o.payment_status,''))='PENDING'
     AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
     AND EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_locks l WHERE l.reference=o.reference
       AND l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash))
   ORDER BY o.created_at DESC,o.reference LIMIT 1;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.orders o WHERE o.reference=v_blocking_reference
        AND nullif(btrim(coalesce(o.transaction_id,'')),'') IS NOT NULL) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_PENDING',
        'existing_reference',v_blocking_reference);
    END IF;
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_UNVERIFIED',
      'existing_reference',v_blocking_reference);
  END IF;
  SELECT a.order_reference INTO v_blocking_reference FROM public.storefront_wompi_payment_attempts a
   WHERE a.customer_phone_hash=v_phone_hash AND a.cart_hash=lower(p_cart_hash)
     AND a.status IN ('INITIATED','PENDING','APPROVED_LATE')
   ORDER BY a.created_at DESC,a.order_reference LIMIT 1;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.storefront_wompi_payment_attempts a
        WHERE a.order_reference=v_blocking_reference AND a.status='APPROVED_LATE') THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED',
        'existing_reference',v_blocking_reference);
    ELSIF EXISTS (SELECT 1 FROM public.storefront_wompi_payment_attempts a
        WHERE a.order_reference=v_blocking_reference AND a.status='PENDING') THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_PENDING',
        'existing_reference',v_blocking_reference);
    END IF;
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_UNVERIFIED',
      'existing_reference',v_blocking_reference);
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders o
      WHERE lower(o.payment_method)='wompi'
        AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
        AND upper(coalesce(o.payment_status,'')) NOT IN ('PENDING','APPROVED','ERROR','DECLINED','VOIDED')
        AND EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_locks l WHERE l.reference=o.reference
          AND l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash))) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_UNVERIFIED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders o
      JOIN public.storefront_wompi_checkout_locks l ON l.reference=o.reference
      WHERE lower(o.payment_method)='wompi'
        AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
        AND l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash)
        AND upper(coalesce(o.payment_status,''))='APPROVED') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ALREADY_APPROVED');
  END IF;

  -- Una terminal visible sin historial de proveedor completo tampoco autoriza
  -- una referencia nueva. APPROVED solo bloquea el mismo carrito en el edge.
  SELECT o.reference INTO v_blocking_reference FROM public.orders o
   WHERE lower(o.payment_method)='wompi'
     AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
     AND upper(coalesce(o.payment_status,'')) IN ('ERROR','DECLINED','VOIDED')
     AND EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_locks l0 WHERE l0.reference=o.reference
       AND l0.customer_phone_hash=v_phone_hash AND l0.cart_hash=lower(p_cart_hash))
     AND NOT EXISTS (
       SELECT 1 FROM public.storefront_wompi_checkout_locks l
        WHERE l.reference=o.reference AND public.storefront_wompi_has_verified_terminal_checkout(
          o.reference,v_phone_hash,l.cart_hash)
     )
   ORDER BY o.created_at DESC,o.reference LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_UNVERIFIED',
      'existing_reference',v_blocking_reference);
  END IF;

  -- Otro reference del mismo carrito sigue bloqueado mientras exista una reserva,
  -- transacción ambigua o cadena terminal no verificable. No se altera otra reserva.
  SELECT l.reference INTO v_blocking_reference FROM public.storefront_wompi_checkout_locks l
   WHERE l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash)
     AND l.reference<>v_reference AND l.status='pending'
   ORDER BY l.updated_at DESC,l.reference LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_PENDING',
      'existing_reference',v_blocking_reference);
  END IF;
  SELECT l.reference INTO v_blocking_reference FROM public.storefront_wompi_checkout_locks l
   WHERE l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash)
     AND l.reference<>v_reference AND l.status='terminal_grace'
     AND (l.terminal_at IS NULL OR l.terminal_at+interval '15 minutes'>now())
   ORDER BY l.updated_at DESC,l.reference LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    SELECT l.terminal_at+interval '15 minutes' INTO v_expires_at
      FROM public.storefront_wompi_checkout_locks l WHERE l.reference=v_blocking_reference;
    RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_GRACE',
      'existing_reference',v_blocking_reference,'expires_at',v_expires_at);
  END IF;
  SELECT l.reference INTO v_blocking_reference FROM public.storefront_wompi_checkout_locks l
   WHERE l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash)
     AND l.reference<>v_reference AND l.status='terminal_grace'
     AND NOT public.storefront_wompi_has_verified_terminal_checkout(l.reference,v_phone_hash,l.cart_hash)
   ORDER BY l.updated_at DESC,l.reference LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_UNVERIFIED',
      'existing_reference',v_blocking_reference);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.storefront_wompi_checkout_locks l
     WHERE l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash)
       AND l.reference<>v_reference AND l.status='active'
       AND (
         (l.expires_at>now() AND NOT public.storefront_wompi_has_verified_terminal_checkout(l.reference,v_phone_hash,l.cart_hash))
         OR EXISTS (SELECT 1 FROM public.inventory_reservations ir WHERE ir.reference=l.reference
           AND lower(coalesce(ir.status,'')) IN ('active','reserved','pending') AND ir.expires_at>now())
       )
  ) THEN
    SELECT l.reference INTO v_blocking_reference FROM public.storefront_wompi_checkout_locks l
     WHERE l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash)
       AND l.reference<>v_reference AND l.status='active'
       AND ((l.expires_at>now() AND NOT public.storefront_wompi_has_verified_terminal_checkout(l.reference,v_phone_hash,l.cart_hash))
         OR EXISTS (SELECT 1 FROM public.inventory_reservations ir WHERE ir.reference=l.reference
           AND lower(coalesce(ir.status,'')) IN ('active','reserved','pending') AND ir.expires_at>now()))
     ORDER BY l.updated_at DESC,l.reference LIMIT 1;
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART',
      'existing_reference',v_blocking_reference);
  END IF;

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks l
   WHERE l.reference=v_reference FOR UPDATE;
  IF FOUND THEN
    IF v_row.customer_phone_hash<>v_phone_hash OR v_row.cart_hash<>lower(p_cart_hash) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT',
        'message','La referencia ya está asociada a otro teléfono o carrito.');
    END IF;
    IF v_row.reconciliation_required THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED');
    END IF;
    IF v_row.status='pending' OR v_row.transaction_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.orders o WHERE o.reference=v_reference
          AND upper(coalesce(o.payment_status,''))='APPROVED') THEN
        RETURN jsonb_build_object('success',false,'code','WOMPI_ALREADY_APPROVED');
      END IF;
      RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_PENDING');
    END IF;
    IF v_row.status='completed' THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_ALREADY_APPROVED');
    END IF;
    IF v_row.status='active' AND v_row.expires_at>now()
       AND v_row.checkout_claimed_at IS NOT NULL
       AND v_row.checkout_claimed_at>now()-make_interval(mins=>p_minutes) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_ALREADY_PREPARED',
        'existing_reference',v_reference,'expires_at',v_row.expires_at);
    END IF;
    UPDATE public.storefront_wompi_checkout_locks l SET status='active',expires_at=v_expires_at,
      checkout_claimed_at=NULL,terminal_at=NULL,updated_at=now()
     WHERE l.reference=v_reference AND l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash)
       AND l.transaction_id IS NULL AND NOT l.reconciliation_required;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT'); END IF;
    RETURN jsonb_build_object('success',true,'reference',v_reference,'expires_at',v_expires_at,'renewed',true);
  END IF;

  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at)
  VALUES(v_reference,v_phone_hash,lower(p_cart_hash),'active',v_expires_at);
  RETURN jsonb_build_object('success',true,'reference',v_reference,'expires_at',v_expires_at,'idempotent',false);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT',
    'message','No se pudo reservar una referencia única para el checkout.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_storefront_wompi_retry_lock(
  p_reference text,
  p_customer_phone text,
  p_cart_hash text,
  p_minutes integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_phone_hash text;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_attempt public.storefront_wompi_payment_attempts%ROWTYPE;
  v_other_reference text;
  v_expires_at timestamptz;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$' OR v_phone !~ '^[0-9]{10}$'
     OR p_cart_hash IS NULL OR p_cart_hash !~ '^[0-9a-fA-F]{64}$'
     OR p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RETRY_INPUT_INVALID');
  END IF;
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  v_expires_at:=now()+make_interval(mins=>p_minutes);
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));

  IF EXISTS (
    SELECT 1 FROM public.storefront_wompi_checkout_locks l
     WHERE l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash) AND l.reconciliation_required=true
  ) OR EXISTS (
    SELECT 1 FROM public.orders o
     WHERE lower(o.payment_method)='wompi'
       AND (o.wompi_reconciliation_required=true OR o.coupon_reconciliation_required=true)
       AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
       AND EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_locks l WHERE l.reference=o.reference
         AND l.customer_phone_hash=v_phone_hash AND l.cart_hash=lower(p_cart_hash))
  ) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED');
  END IF;

  SELECT l.* INTO v_lock
    FROM public.storefront_wompi_checkout_locks l
   WHERE l.customer_phone_hash=v_phone_hash
     AND l.cart_hash=lower(p_cart_hash)
     AND l.status IN ('terminal_grace','released')
     AND l.transaction_id IS NOT NULL
   ORDER BY l.terminal_at DESC NULLS LAST,l.updated_at DESC
   LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_NO_RETRYABLE_ORDER');
  END IF;
  IF v_lock.reconciliation_required THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED');
  END IF;
  IF v_lock.terminal_at IS NULL OR v_lock.terminal_at+interval '15 minutes'>now() THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_GRACE',
      'existing_reference',v_lock.reference,'expires_at',v_lock.terminal_at+interval '15 minutes');
  END IF;

  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.reference=v_lock.reference AND lower(o.payment_method)='wompi'
   FOR UPDATE;
  IF NOT FOUND OR v_order.transaction_id IS DISTINCT FROM v_lock.transaction_id
     OR upper(coalesce(v_order.payment_status,'')) NOT IN ('ERROR','DECLINED','VOIDED')
     OR v_order.wompi_reconciliation_required=true OR v_order.coupon_reconciliation_required=true THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED');
  END IF;

  SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=v_lock.reference
   ORDER BY a.attempt_number DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_attempt.transaction_id IS DISTINCT FROM v_order.transaction_id
     OR v_attempt.status IS DISTINCT FROM upper(v_order.payment_status)
     OR v_attempt.status NOT IN ('ERROR','DECLINED','VOIDED')
     OR v_attempt.environment<>'prod' OR v_attempt.currency<>'COP'
     OR v_attempt.customer_phone_hash<>v_phone_hash
     OR v_attempt.amount_in_cents<>round(v_order.total::numeric*100)::bigint
     OR v_attempt.terminal_at IS NULL OR v_attempt.terminal_at+interval '15 minutes'>now() THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_HISTORY_REQUIRED');
  END IF;

  SELECT l.reference INTO v_other_reference
    FROM public.storefront_wompi_checkout_locks l
   WHERE l.customer_phone_hash=v_phone_hash AND l.cart_hash=v_lock.cart_hash
     AND l.reference<>v_lock.reference AND l.status IN ('active','pending','terminal_grace')
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART','existing_reference',v_other_reference);
  END IF;

  IF v_reference<>v_lock.reference THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REUSE_EXISTING_ORDER',
      'existing_reference',v_lock.reference,'message','Se reutilizará el pedido anterior; no se creará otro pedido para este carrito.');
  END IF;

  UPDATE public.storefront_wompi_checkout_locks l
     SET status='active',expires_at=v_expires_at,checkout_claimed_at=NULL,
         transaction_id=NULL,terminal_at=NULL,updated_at=now()
   WHERE l.reference=v_lock.reference;
  RETURN jsonb_build_object('success',true,'reference',v_lock.reference,'expires_at',v_expires_at,
    'retry_after_terminal',true,'attempt_number',v_attempt.attempt_number+1);
END;
$function$;
REVOKE ALL ON FUNCTION public.reserve_storefront_wompi_checkout_lock(text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_wompi_checkout_lock(text,text,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_storefront_wompi_retry_lock(text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_storefront_wompi_retry_lock(text,text,text,integer) TO service_role;

COMMIT;
