-- Candidate only: fix the Wompi pending-order insert path without opening
-- direct INSERT privileges to anon/authenticated or changing RLS.
-- The RPC is intentionally narrow and is callable only by service_role.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_storefront_wompi_pending_order(
  p_reference text,
  p_customer_name text,
  p_phone text,
  p_city text,
  p_address text,
  p_neighborhood text,
  p_items jsonb,
  p_subtotal bigint,
  p_shipping bigint,
  p_total bigint,
  p_coupon_id uuid,
  p_coupon_code text,
  p_coupon_discount_total bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF btrim(coalesce(p_reference,'')) !~ '^[A-Za-z0-9_-]{1,120}$'
     OR p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR p_subtotal IS NULL OR p_subtotal < 0
     OR p_shipping IS NULL OR p_shipping < 0
     OR p_total IS NULL OR p_total <= 0
     OR p_coupon_discount_total IS NULL OR p_coupon_discount_total < 0 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_INPUT_INVALID');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wompi-order-reference:' || btrim(p_reference)));
  IF EXISTS (SELECT 1 FROM public.orders WHERE reference=btrim(p_reference)) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT');
  END IF;

  INSERT INTO public.orders(
    reference, customer_name, phone, city, address, neighborhood, items,
    subtotal, shipping, total, coupon_id, coupon_code, coupon_discount_total,
    payment_method, payment_status
  ) VALUES (
    btrim(p_reference), p_customer_name, p_phone, p_city, p_address, p_neighborhood, p_items,
    p_subtotal, p_shipping, p_total, p_coupon_id, p_coupon_code, p_coupon_discount_total,
    'wompi', 'PENDING'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'order_id',v_id,'reference',btrim(p_reference));
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT');
END;
$function$;

REVOKE ALL ON FUNCTION public.create_storefront_wompi_pending_order(
  text,text,text,text,text,text,jsonb,bigint,bigint,bigint,uuid,text,bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_storefront_wompi_pending_order(
  text,text,text,text,text,text,jsonb,bigint,bigint,bigint,uuid,text,bigint
) TO service_role;

COMMENT ON FUNCTION public.create_storefront_wompi_pending_order(text,text,text,text,text,text,jsonb,bigint,bigint,bigint,uuid,text,bigint)
IS 'Trusted Wompi pending-order insert. SECURITY DEFINER; service_role only; preserves public.orders RLS.';

-- The inventory reservation is exactly 10 minutes. Keep the Wompi lock aligned
-- with that server-side TTL; the separate 15-minute terminal grace remains intact.
CREATE OR REPLACE FUNCTION public.reserve_storefront_wompi_checkout_lock(
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
  v_row public.storefront_wompi_checkout_locks%ROWTYPE;
  v_expires_at timestamptz;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR v_phone !~ '^[0-9]{10}$'
     OR p_cart_hash IS NULL OR p_cart_hash !~ '^[0-9a-fA-F]{64}$'
     OR p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LOCK_INPUT_INVALID','message','No se pudo validar el intento de checkout.');
  END IF;
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  v_expires_at:=now()+make_interval(mins=>p_minutes);
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.reconciliation_required=true
   LIMIT 1 FOR UPDATE;
  IF FOUND OR EXISTS (
    SELECT 1 FROM public.orders AS o
     WHERE lower(o.payment_method)='wompi'
       AND (o.wompi_reconciliation_required=true OR o.coupon_reconciliation_required=true)
       AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
  ) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED','message','Existe un pago que requiere revisión manual antes de iniciar otro checkout.');
  END IF;

  UPDATE public.storefront_wompi_checkout_locks AS l
     SET status='pending',expires_at='infinity',updated_at=now()
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='active' AND l.transaction_id IS NOT NULL;
  UPDATE public.storefront_wompi_checkout_locks AS l
     SET status='expired',updated_at=now()
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='active' AND l.expires_at<=now() AND l.transaction_id IS NULL;
  UPDATE public.storefront_wompi_checkout_locks AS l
     SET status='released',expires_at=now(),updated_at=now()
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='terminal_grace' AND l.terminal_at+interval '15 minutes'<=now();

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='terminal_grace' LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_GRACE','existing_reference',v_row.reference,'expires_at',v_row.terminal_at+interval '15 minutes','message','El intento anterior terminó. Espera unos minutos antes de volver a iniciar un pago para evitar una aprobación tardía duplicada.');
  END IF;

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='pending' LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_PENDING','existing_reference',v_row.reference,'message','Hay una transacción Wompi pendiente para este teléfono; espera su confirmación antes de iniciar otro pago.');
  END IF;

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='active' AND l.expires_at>now() LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_row.reference<>v_reference THEN
      IF v_row.cart_hash=lower(p_cart_hash) THEN
        RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_RESERVATION','existing_reference',v_row.reference,'expires_at',v_row.expires_at,'message','Ya existe una reserva activa para este carrito.');
      END IF;
      RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART','existing_reference',v_row.reference,'expires_at',v_row.expires_at,'message','Ya hay un checkout activo para este teléfono con otro carrito.');
    END IF;
    IF v_row.checkout_claimed_at IS NOT NULL AND v_row.checkout_claimed_at>now()-make_interval(mins=>p_minutes) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_ALREADY_PREPARED','existing_reference',v_row.reference,'expires_at',v_row.expires_at,'message','Este intento ya preparó una sesión Wompi. Espera a que venza antes de volver a iniciarla.');
    END IF;
    UPDATE public.storefront_wompi_checkout_locks AS l SET expires_at=v_expires_at,checkout_claimed_at=NULL,updated_at=now() WHERE l.reference=v_reference;
    RETURN jsonb_build_object('success',true,'reference',v_reference,'expires_at',v_expires_at,'idempotent',true);
  END IF;

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l WHERE l.reference=v_reference FOR UPDATE;
  IF FOUND THEN
    IF v_row.customer_phone_hash<>v_phone_hash OR v_row.cart_hash<>lower(p_cart_hash) OR v_row.status IN ('pending','completed') OR v_row.transaction_id IS NOT NULL THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT','message','La referencia ya está asociada a otro intento o transacción.');
    END IF;
    UPDATE public.storefront_wompi_checkout_locks AS l SET customer_phone_hash=v_phone_hash,cart_hash=lower(p_cart_hash),status='active',expires_at=v_expires_at,checkout_claimed_at=NULL,transaction_id=NULL,updated_at=now() WHERE l.reference=v_reference;
    RETURN jsonb_build_object('success',true,'reference',v_reference,'expires_at',v_expires_at,'renewed',true);
  END IF;

  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at)
  VALUES(v_reference,v_phone_hash,lower(p_cart_hash),'active',v_expires_at);
  RETURN jsonb_build_object('success',true,'reference',v_reference,'expires_at',v_expires_at,'idempotent',false);
EXCEPTION WHEN unique_violation THEN
  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l WHERE l.customer_phone_hash=v_phone_hash AND l.status IN ('active','pending','terminal_grace') LIMIT 1;
  IF FOUND AND v_row.status='pending' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_PENDING','existing_reference',v_row.reference);
  ELSIF FOUND AND v_row.status='terminal_grace' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_GRACE','existing_reference',v_row.reference,'expires_at',v_row.terminal_at+interval '15 minutes');
  ELSIF FOUND AND v_row.status='active' AND v_row.cart_hash=lower(p_cart_hash) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_RESERVATION','existing_reference',v_row.reference,'expires_at',v_row.expires_at);
  ELSIF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART','existing_reference',v_row.reference,'expires_at',v_row.expires_at);
  END IF;
  RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT','message','No se pudo reservar una referencia única para el checkout.');
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_storefront_wompi_checkout_lock(text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_wompi_checkout_lock(text,text,text,integer) TO service_role;

COMMIT;
