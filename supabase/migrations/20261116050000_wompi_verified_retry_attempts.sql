-- Candidata local: reintentos Wompi verificables sobre la misma orden.
-- No ejecutar en producción sin preflight y autorización explícita.
-- No borra ni sobrescribe el historial de transacciones: cada checkout tiene una
-- referencia Wompi distinta, vinculada al reference estable de public.orders.
BEGIN;

CREATE TABLE public.storefront_wompi_payment_attempts (
  attempt_reference text PRIMARY KEY,
  wompi_reference text NOT NULL,
  is_legacy boolean NOT NULL DEFAULT false,
  order_reference text NOT NULL,
  attempt_number integer NOT NULL,
  environment text NOT NULL DEFAULT 'prod',
  amount_in_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'COP',
  cart_hash text NOT NULL,
  customer_phone_hash text NOT NULL,
  status text NOT NULL DEFAULT 'INITIATED',
  transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  terminal_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storefront_wompi_attempt_reference_ck CHECK (attempt_reference ~ '^SW-[A-F0-9]{32}$'),
  CONSTRAINT storefront_wompi_external_reference_ck CHECK (wompi_reference ~ '^[A-Za-z0-9_-]{1,120}$'),
  CONSTRAINT storefront_wompi_attempt_order_reference_ck CHECK (length(btrim(order_reference)) BETWEEN 1 AND 120),
  CONSTRAINT storefront_wompi_attempt_number_ck CHECK (attempt_number > 0),
  CONSTRAINT storefront_wompi_attempt_environment_ck CHECK (environment IN ('prod','test')),
  CONSTRAINT storefront_wompi_attempt_amount_ck CHECK (amount_in_cents > 0),
  CONSTRAINT storefront_wompi_attempt_currency_ck CHECK (currency = 'COP'),
  CONSTRAINT storefront_wompi_attempt_cart_hash_ck CHECK (cart_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT storefront_wompi_attempt_phone_hash_ck CHECK (customer_phone_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT storefront_wompi_attempt_status_ck CHECK (status IN ('INITIATED','PENDING','APPROVED','DECLINED','VOIDED','ERROR','APPROVED_LATE'))
);
CREATE UNIQUE INDEX storefront_wompi_attempt_order_number_uq
  ON public.storefront_wompi_payment_attempts(order_reference,attempt_number);
CREATE UNIQUE INDEX storefront_wompi_attempt_current_wompi_reference_uq
  ON public.storefront_wompi_payment_attempts(wompi_reference) WHERE is_legacy=false;
CREATE INDEX storefront_wompi_attempt_legacy_reference_tx_idx
  ON public.storefront_wompi_payment_attempts(wompi_reference,transaction_id) WHERE is_legacy=true;
CREATE UNIQUE INDEX storefront_wompi_attempt_transaction_uq
  ON public.storefront_wompi_payment_attempts(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX storefront_wompi_attempt_open_order_uq
  ON public.storefront_wompi_payment_attempts(order_reference) WHERE status IN ('INITIATED','PENDING');
CREATE INDEX storefront_wompi_attempt_latest_idx
  ON public.storefront_wompi_payment_attempts(order_reference,attempt_number DESC);

ALTER TABLE public.storefront_coupon_redemptions
  ADD COLUMN released_attempt_reference text;
COMMENT ON COLUMN public.storefront_coupon_redemptions.released_attempt_reference IS
  'Intento Wompi terminal verificado que liberó esta redención; NULL para expiraciones o liberaciones sin prueba de estado terminal.';

ALTER TABLE public.storefront_wompi_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storefront_wompi_payment_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.storefront_wompi_payment_attempts TO service_role;
COMMENT ON TABLE public.storefront_wompi_payment_attempts IS
  'Ledger por intento Wompi, sin PII. attempt_reference es la clave interna SW; wompi_reference conserva exactamente la referencia externa enviada al proveedor.';
COMMENT ON COLUMN public.storefront_wompi_payment_attempts.transaction_id IS
  'Identificador único devuelto por la consulta autenticada de Wompi; nunca se sobrescribe entre intentos.';

-- Reactiva únicamente el lock de una orden con un intento terminal verificado,
-- una vez vencidos 15 minutos. Si el cliente llegó con una referencia nueva, se
-- devuelve la referencia de la orden anterior en vez de abrir un pedido duplicado.
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
     WHERE l.customer_phone_hash=v_phone_hash AND l.reconciliation_required=true
  ) OR EXISTS (
    SELECT 1 FROM public.orders o
     WHERE lower(o.payment_method)='wompi'
       AND (o.wompi_reconciliation_required=true OR o.coupon_reconciliation_required=true)
       AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
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
   WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_lock.reference
     AND l.status IN ('active','pending','terminal_grace')
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
REVOKE ALL ON FUNCTION public.prepare_storefront_wompi_retry_lock(text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_storefront_wompi_retry_lock(text,text,text,integer) TO service_role;

-- Registra cada intento sin PII. Solo un intento INITIATED/PENDING puede existir
-- por orden. Una orden preexistente sin ledger no se rehabilita automáticamente.
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
       OR v_order.created_at<v_now-interval '10 minutes' THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_HISTORY_REQUIRED',
        'message','No existe un intento verificado que permita reabrir esta orden.');
    END IF;
    v_attempt_number:=1;
  ELSE
    IF p_is_new_order THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT');
    END IF;
    IF v_last.status IN ('INITIATED','PENDING') THEN
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
    END IF;
    v_attempt_number:=v_last.attempt_number+1;
  END IF;

  v_attempt_reference:='SW-'||upper(replace(gen_random_uuid()::text,'-',''));
  IF v_found THEN
    UPDATE public.orders SET payment_status='PENDING',transaction_id=NULL,updated_at=v_now
     WHERE reference=v_reference AND transaction_id=v_last.transaction_id
       AND upper(payment_status)=v_last.status;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_STATE_CONFLICT'); END IF;
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

-- Transición idempotente basada en la transacción que el webhook verificó contra
-- la API autenticada de Wompi. Un intento antiguo nunca se convierte en el actual.
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

-- La liberación registra qué intento terminal verificado liberó el cupón.
CREATE OR REPLACE FUNCTION public.release_storefront_wompi_coupon_redemption_for_attempt(
  p_order_reference text,
  p_attempt_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_order_reference text;
  v_phone_hash text;
  v_latest integer;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_attempt public.storefront_wompi_payment_attempts%ROWTYPE;
  v_updated integer;
BEGIN
  SELECT a.order_reference,a.customer_phone_hash INTO v_order_reference,v_phone_hash
    FROM public.storefront_wompi_payment_attempts a
   WHERE a.attempt_reference=p_attempt_reference AND a.order_reference=p_order_reference;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_ATTEMPT_REQUIRED'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_order_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l
   WHERE l.reference=v_order_reference FOR UPDATE;
  IF NOT FOUND OR v_lock.customer_phone_hash<>v_phone_hash
     OR v_lock.transaction_id IS DISTINCT FROM (SELECT a.transaction_id FROM public.storefront_wompi_payment_attempts a WHERE a.attempt_reference=p_attempt_reference) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_LOCK_NOT_FOUND');
  END IF;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_order_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_ORDER_NOT_FOUND'); END IF;
  SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a
   WHERE a.attempt_reference=p_attempt_reference AND a.order_reference=p_order_reference FOR UPDATE;
  IF NOT FOUND OR v_attempt.environment<>'prod' OR v_attempt.status NOT IN ('ERROR','DECLINED','VOIDED')
     OR v_attempt.transaction_id IS NULL OR v_attempt.terminal_at IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_ATTEMPT_REQUIRED');
  END IF;
  SELECT max(a.attempt_number) INTO v_latest FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=p_order_reference;
  IF v_latest IS DISTINCT FROM v_attempt.attempt_number THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_NOT_CURRENT');
  END IF;
  IF lower(v_order.payment_method)<>'wompi'
     OR upper(v_order.payment_status) NOT IN ('PENDING',v_attempt.status)
     OR v_order.transaction_id IS DISTINCT FROM v_attempt.transaction_id
     OR v_order.wompi_reconciliation_required=true OR v_order.coupon_reconciliation_required=true THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_STATE_CONFLICT');
  END IF;
  UPDATE public.storefront_coupon_redemptions r
     SET status='released',released_attempt_reference=p_attempt_reference,updated_at=now()
   WHERE r.channel='wompi' AND r.reference=p_order_reference AND r.status='reserved'
     AND r.coupon_id=v_order.coupon_id AND r.code=upper(coalesce(v_order.coupon_code,''))
     AND r.discount_total=coalesce(v_order.coupon_discount_total,0)
  RETURNING 1 INTO v_updated;
  IF v_updated IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.storefront_coupon_redemptions r
        WHERE r.channel='wompi' AND r.reference=p_order_reference AND r.status='released'
          AND r.released_attempt_reference=p_attempt_reference) THEN
      RETURN jsonb_build_object('success',true,'idempotent',true,'status','released');
    END IF;
    RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('success',true,'status','released','attempt_reference',p_attempt_reference);
END;
$function$;
REVOKE ALL ON FUNCTION public.release_storefront_wompi_coupon_redemption_for_attempt(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_storefront_wompi_coupon_redemption_for_attempt(text,text) TO service_role;

-- Reemplazo conservador de la RPC de cupón: las redenciones liberadas solo se
-- reabren para un intento Wompi terminal verificado, vencido y sin conciliación.
CREATE OR REPLACE FUNCTION public.reserve_storefront_coupon_redemption(
  p_coupon_code text,
  p_channel text,
  p_reference text,
  p_customer_email text,
  p_customer_phone text,
  p_discount_total bigint,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_code text:=upper(btrim(coalesce(p_coupon_code,'')));
  v_channel text:=lower(btrim(coalesce(p_channel,'')));
  v_reference text:=btrim(coalesce(p_reference,''));
  v_normalized_email text;
  v_normalized_phone text;
  v_customer_hash text;
  v_coupon public.storefront_coupons%ROWTYPE;
  v_existing public.storefront_coupon_redemptions%ROWTYPE;
  v_global_count bigint;
  v_customer_count bigint;
  v_id uuid;
  v_reopen_terminal boolean:=false;
  v_expires_at timestamptz:=now()+interval '10 minutes';
BEGIN
  IF v_channel NOT IN ('wompi','cod') OR v_reference='' OR length(v_reference)>200 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_INPUT_INVALID','message','La reserva del cupón no tiene un canal o referencia válidos.');
  END IF;
  IF v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' OR p_discount_total IS NULL OR p_discount_total<=0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_INPUT_INVALID','message','La reserva del cupón no tiene código o descuento válidos.');
  END IF;
  IF p_expires_at IS NOT NULL THEN
    IF p_expires_at<=now() OR p_expires_at>now()+interval '10 minutes' THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_EXPIRY_INVALID','message','La expiración del cupón no coincide con la reserva segura de inventario.');
    END IF;
    v_expires_at:=p_expires_at;
  END IF;
  v_normalized_email:=lower(btrim(coalesce(p_customer_email,'')));
  v_normalized_phone:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_customer_hash:=public._storefront_coupon_customer_hash(v_normalized_email,v_normalized_phone);
  PERFORM pg_advisory_xact_lock(hashtext('storefront-coupon-reference:'||v_channel||':'||v_reference));
  SELECT r.* INTO v_existing FROM public.storefront_coupon_redemptions r
   WHERE r.channel=v_channel AND r.reference=v_reference FOR UPDATE;
  IF FOUND THEN
    IF v_existing.code IS DISTINCT FROM v_code OR v_existing.customer_hash IS DISTINCT FROM v_customer_hash
       OR v_existing.discount_total IS DISTINCT FROM p_discount_total THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_CONFLICT','message','La referencia ya existe con otros datos de cupón.');
    END IF;
    IF v_existing.status='released' THEN
      SELECT EXISTS (
        SELECT 1
          FROM public.storefront_wompi_payment_attempts a
          JOIN public.orders o ON o.reference=a.order_reference
         WHERE a.order_reference=v_reference
           AND a.attempt_number=(SELECT max(ax.attempt_number) FROM public.storefront_wompi_payment_attempts ax WHERE ax.order_reference=v_reference)
           AND a.attempt_reference=v_existing.released_attempt_reference
           AND a.status IN ('ERROR','DECLINED','VOIDED') AND a.environment='prod' AND a.currency='COP'
           AND a.transaction_id=o.transaction_id AND a.transaction_id IS NOT NULL
           AND a.terminal_at IS NOT NULL AND a.terminal_at+interval '15 minutes'<=now()
           AND upper(coalesce(o.payment_status,''))=a.status AND lower(o.payment_method)='wompi'
           AND o.coupon_id=v_existing.coupon_id AND upper(coalesce(o.coupon_code,''))=v_code
           AND coalesce(o.coupon_discount_total,0)=p_discount_total
           AND o.wompi_reconciliation_required=false AND o.coupon_reconciliation_required=false
           AND v_existing.reconciliation_required=false
      ) INTO v_reopen_terminal;
      IF v_channel<>'wompi' OR NOT v_reopen_terminal THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_RELEASED','message','La referencia ya liberó su reserva y no puede reutilizarse.');
      END IF;
    END IF;

    IF (v_existing.status='reserved' AND v_existing.expires_at<=now()) OR v_reopen_terminal THEN
      IF v_channel='cod' AND EXISTS (SELECT 1 FROM public.web_orders w WHERE w.client_reference=v_reference) THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_ALREADY_USED','message','La referencia COD ya tiene un pedido y no puede renovar el cupón.');
      END IF;
      SELECT c.* INTO v_coupon FROM public.storefront_coupons c WHERE c.id=v_existing.coupon_id FOR UPDATE;
      IF NOT FOUND OR NOT v_coupon.enabled OR (v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at>now())
         OR (v_coupon.end_at IS NOT NULL AND v_coupon.end_at<=now()) THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_NOT_ACTIVE','message','El cupón ya no está vigente.');
      END IF;
      IF v_coupon.per_customer_limit IS NOT NULL
         AND (length(v_normalized_email)>254 OR v_normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
              OR v_normalized_phone !~ '^[0-9]{10}$') THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_REQUIRED','message','Este cupón requiere correo y teléfono para validar su límite por cliente.');
      END IF;
      SELECT count(*) INTO v_global_count FROM public.storefront_coupon_redemptions r
       WHERE r.coupon_id=v_coupon.id AND r.id<>v_existing.id
         AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
      IF v_coupon.global_limit IS NOT NULL AND v_global_count>=v_coupon.global_limit THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_GLOBAL_LIMIT','message','El cupón alcanzó su límite de usos.');
      END IF;
      SELECT count(*) INTO v_customer_count FROM public.storefront_coupon_redemptions r
       WHERE r.coupon_id=v_coupon.id AND r.id<>v_existing.id AND r.customer_hash=v_customer_hash
         AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
      IF v_coupon.per_customer_limit IS NOT NULL AND v_customer_count>=v_coupon.per_customer_limit THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_LIMIT','message','Ya alcanzaste el límite de uso de este cupón.');
      END IF;
      UPDATE public.storefront_coupon_redemptions r
         SET status='reserved',expires_at=v_expires_at,reconciliation_required=false,
             released_attempt_reference=NULL,updated_at=now()
       WHERE r.id=v_existing.id;
      RETURN jsonb_build_object('success',true,'id',v_existing.id,'coupon_id',v_existing.coupon_id,
        'coupon_code',v_existing.code,'channel',v_existing.channel,'reference',v_existing.reference,
        'discount_total',v_existing.discount_total,'status','reserved','expires_at',v_expires_at,
        'reconciliation_required',false,'idempotent',true,
        'renewed_after_expiry',v_existing.status='reserved' AND v_existing.expires_at<=now(),
        'reopened_after_terminal',v_reopen_terminal);
    END IF;
    IF v_existing.status='reserved' AND p_expires_at IS NOT NULL AND v_existing.expires_at IS DISTINCT FROM v_expires_at THEN
      UPDATE public.storefront_coupon_redemptions r SET expires_at=v_expires_at,updated_at=now() WHERE r.id=v_existing.id;
    END IF;
    RETURN jsonb_build_object('success',true,'id',v_existing.id,'coupon_id',v_existing.coupon_id,
      'coupon_code',v_existing.code,'channel',v_existing.channel,'reference',v_existing.reference,
      'discount_total',v_existing.discount_total,'status',v_existing.status,
      'expires_at',CASE WHEN v_existing.status='reserved' AND p_expires_at IS NOT NULL THEN v_expires_at ELSE v_existing.expires_at END,
      'reconciliation_required',v_existing.reconciliation_required,'idempotent',true);
  END IF;

  SELECT c.* INTO v_coupon FROM public.storefront_coupons c WHERE c.code=v_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','COUPON_INVALID','message','El cupón no existe.'); END IF;
  IF NOT v_coupon.enabled OR (v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at>now())
     OR (v_coupon.end_at IS NOT NULL AND v_coupon.end_at<=now()) THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_NOT_ACTIVE','message','El cupón no está vigente.');
  END IF;
  IF v_coupon.per_customer_limit IS NOT NULL
     AND (length(v_normalized_email)>254 OR v_normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          OR v_normalized_phone !~ '^[0-9]{10}$') THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_REQUIRED','message','Este cupón requiere correo y teléfono para validar su límite por cliente.');
  END IF;
  SELECT count(*) INTO v_global_count FROM public.storefront_coupon_redemptions r
   WHERE r.coupon_id=v_coupon.id AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
  IF v_coupon.global_limit IS NOT NULL AND v_global_count>=v_coupon.global_limit THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_GLOBAL_LIMIT','message','El cupón alcanzó su límite de usos.');
  END IF;
  SELECT count(*) INTO v_customer_count FROM public.storefront_coupon_redemptions r
   WHERE r.coupon_id=v_coupon.id AND r.customer_hash=v_customer_hash
     AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
  IF v_coupon.per_customer_limit IS NOT NULL AND v_customer_count>=v_coupon.per_customer_limit THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_LIMIT','message','Ya alcanzaste el límite de uso de este cupón.');
  END IF;
  INSERT INTO public.storefront_coupon_redemptions(coupon_id,code,channel,reference,customer_hash,discount_total,status,expires_at,
    reconciliation_required,created_at,updated_at)
  VALUES(v_coupon.id,v_coupon.code,v_channel,v_reference,v_customer_hash,p_discount_total,'reserved',v_expires_at,false,now(),now())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id,'coupon_id',v_coupon.id,'coupon_code',v_coupon.code,
    'channel',v_channel,'reference',v_reference,'discount_total',p_discount_total,'status','reserved',
    'expires_at',v_expires_at,'reconciliation_required',false,'idempotent',false);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_CONFLICT','message','La referencia ya fue reservada en otra transacción.');
END;
$function$;
REVOKE ALL ON FUNCTION public.reserve_storefront_coupon_redemption(text,text,text,text,text,bigint,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_coupon_redemption(text,text,text,text,text,bigint,timestamptz)
  TO service_role;

COMMIT;
