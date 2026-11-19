-- Restore the original 10-minute Sandbox inventory reservation window.
-- This restores only prepare_storefront_wompi_checkout timing; webhook and
-- reconciler functions remain unchanged.
CREATE OR REPLACE FUNCTION public.prepare_storefront_wompi_checkout(
  p_reference text,
  p_items jsonb,
  p_city text,
  p_coupon_code text,
  p_customer_email text,
  p_customer_phone text,
  p_expected_quote jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reference text := btrim(coalesce(p_reference,''));
  v_code text := upper(btrim(coalesce(p_coupon_code,'')));
  v_quote jsonb;
  v_inventory jsonb;
  v_coupon_reservation jsonb;
  v_expires_at timestamptz;
  v_total numeric;
  v_expected_total numeric;
  v_discount_total numeric;
  v_expected_discount_total numeric;
  v_coupon_discount_total numeric;
  v_expected_coupon_discount_total numeric;
  v_shipping numeric;
  v_expected_shipping numeric;
  v_original_subtotal numeric;
  v_expected_original_subtotal numeric;
  v_discounted_subtotal numeric;
  v_expected_discounted_subtotal numeric;
  v_product_lock_id public.products.id%TYPE;
  v_phone text := public._storefront_coupon_normalized_phone(p_customer_phone);
  v_phone_hash text;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR v_code !~ '^(|[A-Z0-9][A-Z0-9_-]{0,63})$'
     OR v_phone !~ '^[0-9]{10}$' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_INPUT_INVALID','message','No se pudo validar la referencia, carrito o cupón.');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_INPUT_INVALID','message','El carrito está vacío o no es válido.');
  END IF;
  IF p_expected_quote IS NULL OR jsonb_typeof(p_expected_quote) IS DISTINCT FROM 'object'
     OR p_expected_quote->>'success' IS DISTINCT FROM 'true'
     OR p_expected_quote->>'original_subtotal' IS NULL
     OR p_expected_quote->>'discounted_subtotal' IS NULL
     OR p_expected_quote->>'discount_total' IS NULL
     OR p_expected_quote->>'coupon_discount_total' IS NULL
     OR p_expected_quote->>'shipping' IS NULL
     OR p_expected_quote->>'total' IS NULL
     OR jsonb_typeof(p_expected_quote->'items') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_expected_quote->'items')=0 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID','message','La cotización inicial está incompleta.');
  END IF;

  v_phone_hash := encode(extensions.digest(v_phone,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  IF EXISTS (
    SELECT 1 FROM public.orders AS o
    WHERE lower(o.payment_method)='wompi'
      AND (o.wompi_reconciliation_required=true OR o.coupon_reconciliation_required=true)
      AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
  ) OR EXISTS (
    SELECT 1 FROM public.storefront_wompi_checkout_locks AS l
    WHERE l.customer_phone_hash=v_phone_hash AND l.reconciliation_required=true
  ) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED','message','Existe un pago que requiere revisión manual antes de iniciar otro checkout.');
  END IF;

  PERFORM 1 FROM public.storefront_shipping_settings AS s WHERE s.id=1 FOR SHARE;
  LOCK TABLE public.storefront_product_combos IN SHARE MODE;
  LOCK TABLE public.storefront_shipping_rules IN SHARE MODE;
  LOCK TABLE public.storefront_shipping_rule_destinations IN SHARE MODE;
  FOR v_product_lock_id IN
    SELECT DISTINCT p.id
    FROM public.products AS p
    JOIN jsonb_array_elements(p_items) AS requested(item) ON p.id::text=requested.item->>'id'
    ORDER BY p.id
  LOOP
    PERFORM 1 FROM public.products AS p WHERE p.id=v_product_lock_id FOR NO KEY UPDATE OF p;
  END LOOP;
  IF v_code<>'' THEN
    PERFORM 1 FROM public.storefront_coupons AS c WHERE c.code=v_code FOR UPDATE;
  END IF;

  v_quote := public.get_storefront_cart_quote_with_coupon(p_items,p_city,v_code,'','');
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true
     OR v_quote->'items' IS NULL OR jsonb_typeof(v_quote->'items') IS DISTINCT FROM 'array'
     OR v_quote->>'original_subtotal' IS NULL OR v_quote->>'discounted_subtotal' IS NULL
     OR v_quote->>'discount_total' IS NULL OR v_quote->>'coupon_discount_total' IS NULL
     OR v_quote->>'shipping' IS NULL OR v_quote->>'total' IS NULL THEN
    RETURN jsonb_build_object('success',false,'code',coalesce(v_quote->>'code','WOMPI_QUOTE_INVALID'),'message',coalesce(v_quote->>'message','No se pudo validar el total vigente del carrito.'),'quote',v_quote);
  END IF;

  v_original_subtotal := round((v_quote->>'original_subtotal')::numeric,0);
  v_discounted_subtotal := round((v_quote->>'discounted_subtotal')::numeric,0);
  v_discount_total := round((v_quote->>'discount_total')::numeric,0);
  v_coupon_discount_total := round((v_quote->>'coupon_discount_total')::numeric,0);
  v_shipping := round((v_quote->>'shipping')::numeric,0);
  v_total := round((v_quote->>'total')::numeric,0);
  v_expected_original_subtotal := round((p_expected_quote->>'original_subtotal')::numeric,0);
  v_expected_discounted_subtotal := round((p_expected_quote->>'discounted_subtotal')::numeric,0);
  v_expected_discount_total := round((p_expected_quote->>'discount_total')::numeric,0);
  v_expected_coupon_discount_total := round((p_expected_quote->>'coupon_discount_total')::numeric,0);
  v_expected_shipping := round((p_expected_quote->>'shipping')::numeric,0);
  v_expected_total := round((p_expected_quote->>'total')::numeric,0);

  IF v_original_subtotal<>v_expected_original_subtotal
     OR v_discounted_subtotal<>v_expected_discounted_subtotal
     OR v_discount_total<>v_expected_discount_total
     OR v_coupon_discount_total<>v_expected_coupon_discount_total
     OR v_shipping<>v_expected_shipping
     OR v_total<>v_expected_total
     OR v_quote->'items' IS DISTINCT FROM p_expected_quote->'items'
     OR v_quote->'discounts' IS DISTINCT FROM p_expected_quote->'discounts'
     OR v_quote->'coupon_id' IS DISTINCT FROM p_expected_quote->'coupon_id'
     OR v_quote->'coupon_code' IS DISTINCT FROM p_expected_quote->'coupon_code'
     OR coalesce(v_quote->>'currency','COP') IS DISTINCT FROM coalesce(p_expected_quote->>'currency','COP') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_CHANGED','message','El precio, descuento, cupón o envío cambió durante la preparación. Revisa el nuevo total antes de confirmar.','quote',v_quote,'total',v_total,'shipping',v_shipping,'discount_total',v_discount_total,'coupon_discount_total',v_coupon_discount_total);
  END IF;
  IF v_total<=0 OR v_total<>v_discounted_subtotal+v_shipping
     OR v_discounted_subtotal<>v_original_subtotal-v_discount_total
     OR v_discount_total<0 OR v_discount_total>v_original_subtotal
     OR v_coupon_discount_total<0 OR v_coupon_discount_total>v_discount_total THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID','message','La cotización vigente no concilia sus importes. No se reservó inventario ni cupón.');
  END IF;
  IF v_code<>'' AND v_coupon_discount_total<=0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_NO_DISCOUNT','message','El cupón no genera un descuento aplicable a este carrito.');
  END IF;

  v_inventory := public.reserve_order_inventory(v_reference,p_items,10);
  IF coalesce((v_inventory->>'success')::boolean,false) IS DISTINCT FROM true THEN
    PERFORM public.release_inventory_reservation(v_reference);
    RETURN jsonb_build_object('success',false,'code',coalesce(v_inventory->>'code','WOMPI_INVENTORY_RESERVATION_FAILED'),'message',coalesce(v_inventory->>'message','No hay suficientes unidades disponibles.'));
  END IF;
  v_expires_at := nullif(v_inventory->>'expires_at','')::timestamptz;
  IF v_expires_at IS NULL OR v_expires_at<=now()+interval '5 seconds' OR v_expires_at>now()+interval '10 minutes' THEN
    PERFORM public.release_inventory_reservation(v_reference);
    RETURN jsonb_build_object('success',false,'code','WOMPI_INVENTORY_EXPIRY_INVALID','message','La reserva de inventario no tiene una expiración válida.');
  END IF;

  IF v_code<>'' THEN
    v_coupon_reservation := public.reserve_storefront_coupon_redemption(v_code,'wompi',v_reference,p_customer_email,p_customer_phone,v_coupon_discount_total::bigint,v_expires_at);
    IF coalesce((v_coupon_reservation->>'success')::boolean,false) IS DISTINCT FROM true
       OR v_coupon_reservation->>'status' IS DISTINCT FROM 'reserved'
       OR coalesce((v_coupon_reservation->>'discount_total')::numeric,-1)<>v_coupon_discount_total THEN
      PERFORM public.release_inventory_reservation(v_reference);
      RETURN coalesce(v_coupon_reservation,'{}'::jsonb)||jsonb_build_object('success',false);
    END IF;
  END IF;

  RETURN jsonb_build_object('success',true,'reference',v_reference,'quote',v_quote,'expires_at',v_expires_at,'coupon_reserved',v_code<>'');
END;
$function$;
