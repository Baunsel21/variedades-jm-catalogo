-- Solo PostgreSQL scratch temporal. Reutiliza el esquema mínimo de retry y añade fixtures deterministas.
\ir wompi_attempt_retry_scratch_setup.sql

CREATE TABLE public.products(id uuid PRIMARY KEY, stock integer NOT NULL);
CREATE TABLE public.storefront_shipping_settings(id integer PRIMARY KEY DEFAULT 1);
INSERT INTO public.storefront_shipping_settings(id) VALUES (1);
CREATE TABLE public.storefront_product_combos(id integer PRIMARY KEY DEFAULT 1);
CREATE TABLE public.storefront_shipping_rules(id integer PRIMARY KEY DEFAULT 1);
CREATE TABLE public.storefront_shipping_rule_destinations(id integer PRIMARY KEY DEFAULT 1);
INSERT INTO public.products(id,stock) VALUES ('11111111-1111-4111-8111-111111111111',5);
CREATE TABLE public.scratch_recovery_control(allow_reserve boolean NOT NULL DEFAULT true,fail_coupon boolean NOT NULL DEFAULT false);
INSERT INTO public.scratch_recovery_control VALUES (true,false);

CREATE OR REPLACE FUNCTION public.get_storefront_cart_quote_with_coupon(
  p_items jsonb,p_city text,p_coupon_code text,p_customer_email text,p_customer_phone text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp' AS $$
DECLARE
  v_original numeric;
  v_discount numeric;
  v_coupon_discount numeric;
  v_coupon_id uuid;
  v_code text:=upper(btrim(coalesce(p_coupon_code,'')));
BEGIN
  SELECT coalesce(sum(coalesce((item->>'original_subtotal')::numeric,
      (item->>'price')::numeric*coalesce((item->>'qty')::numeric,1))),0),
      coalesce(sum(coalesce((item->>'discount_total')::numeric,0)),0),
      coalesce(sum(coalesce((item->>'coupon_discount_total')::numeric,0)),0)
    INTO v_original,v_discount,v_coupon_discount
    FROM jsonb_array_elements(p_items) AS x(item);
  IF v_code<>'' THEN
    SELECT c.id INTO v_coupon_id FROM public.storefront_coupons c WHERE c.code=v_code AND c.enabled;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','COUPON_INVALID'); END IF;
  ELSIF v_coupon_discount<>0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_SNAPSHOT_INVALID');
  END IF;
  RETURN jsonb_build_object('success',true,'items',p_items,'original_subtotal',v_original,
    'discounted_subtotal',v_original-v_discount,'discount_total',v_discount,
    'coupon_discount_total',v_coupon_discount,'shipping',5000,
    'total',v_original-v_discount+5000,'coupon_id',v_coupon_id,'coupon_code',nullif(v_code,''),'currency','COP');
END $$;

CREATE OR REPLACE FUNCTION public.reserve_order_inventory(p_reference text,p_items jsonb,p_minutes integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp' AS $$
DECLARE v_item jsonb; v_product uuid; v_qty integer; v_color text; v_size text; v_stock integer; v_reserved integer; v_expiry timestamptz:=now()+make_interval(mins=>p_minutes);
BEGIN
  IF NOT (SELECT allow_reserve FROM public.scratch_recovery_control) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_INVENTORY_INSUFFICIENT');
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_product:=(v_item->>'id')::uuid; v_qty:=coalesce((v_item->>'qty')::integer,0);
    v_color:=coalesce(v_item->>'color',''); v_size:=coalesce(v_item->>'size','');
    SELECT p.stock INTO v_stock FROM public.products p WHERE p.id=v_product FOR UPDATE;
    IF NOT FOUND OR v_qty<1 THEN RETURN jsonb_build_object('success',false,'code','WOMPI_INVENTORY_INSUFFICIENT'); END IF;
    SELECT coalesce(sum(r.quantity),0) INTO v_reserved FROM public.inventory_reservations r
      WHERE r.product_id=v_product AND r.reference<>p_reference AND lower(r.status)='active' AND r.expires_at>now();
    IF v_stock-v_reserved<v_qty THEN RETURN jsonb_build_object('success',false,'code','WOMPI_INVENTORY_INSUFFICIENT'); END IF;
    UPDATE public.inventory_reservations SET quantity=v_qty,expires_at=v_expiry,status='active'
      WHERE reference=p_reference AND product_id=v_product AND coalesce(color,'')=v_color
        AND coalesce(size,'')=v_size AND lower(status)='active' AND expires_at>now();
    IF NOT FOUND THEN
      INSERT INTO public.inventory_reservations(reference,product_id,quantity,color,size,expires_at,status)
        VALUES(p_reference,v_product,v_qty,v_color,v_size,v_expiry,'active');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('success',true,'expires_at',v_expiry);
END $$;

CREATE OR REPLACE FUNCTION public.release_inventory_reservation(p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp' AS $$
BEGIN
  UPDATE public.inventory_reservations SET status='RELEASED',expires_at=now() WHERE reference=p_reference AND lower(status)='active';
  RETURN jsonb_build_object('success',true);
END $$;

CREATE OR REPLACE FUNCTION public.reserve_storefront_coupon_redemption(
  p_coupon_code text,p_channel text,p_reference text,p_customer_email text,p_customer_phone text,p_discount_total bigint,p_expires_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp' AS $$
DECLARE v_coupon public.storefront_coupons%ROWTYPE; v_row public.storefront_coupon_redemptions%ROWTYPE; v_hash text; v_verified_terminal boolean;
BEGIN
  IF (SELECT fail_coupon FROM public.scratch_recovery_control) THEN RETURN jsonb_build_object('success',false,'code','COUPON_SCRATCH_FAILURE'); END IF;
  SELECT * INTO v_coupon FROM public.storefront_coupons WHERE code=upper(p_coupon_code) AND enabled;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','COUPON_INVALID'); END IF;
  v_hash:=public._storefront_coupon_customer_hash(p_customer_email,p_customer_phone);
  SELECT * INTO v_row FROM public.storefront_coupon_redemptions WHERE channel=p_channel AND reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.storefront_coupon_redemptions(coupon_id,code,channel,reference,customer_hash,discount_total,status,expires_at)
      VALUES(v_coupon.id,upper(p_coupon_code),p_channel,p_reference,v_hash,p_discount_total,'reserved',p_expires_at);
    RETURN jsonb_build_object('success',true,'status','reserved','discount_total',p_discount_total);
  END IF;
  IF v_row.coupon_id<>v_coupon.id OR v_row.code<>upper(p_coupon_code) OR v_row.customer_hash<>v_hash OR v_row.discount_total<>p_discount_total THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_CONFLICT');
  END IF;
  IF v_row.status='released' THEN
    SELECT EXISTS(SELECT 1 FROM public.storefront_wompi_payment_attempts a
      WHERE a.attempt_reference=v_row.released_attempt_reference AND a.order_reference=p_reference
        AND a.is_legacy=true AND a.status IN ('ERROR','DECLINED','VOIDED') AND a.terminal_at<=now()-interval '15 minutes')
      INTO v_verified_terminal;
    IF NOT v_verified_terminal THEN RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_RELEASED'); END IF;
    UPDATE public.storefront_coupon_redemptions SET status='reserved',expires_at=p_expires_at,
      released_attempt_reference=NULL,updated_at=now() WHERE id=v_row.id;
    RETURN jsonb_build_object('success',true,'status','reserved','discount_total',p_discount_total,'reopened_after_terminal',true);
  END IF;
  IF v_row.status='reserved' THEN
    UPDATE public.storefront_coupon_redemptions SET expires_at=p_expires_at,updated_at=now() WHERE id=v_row.id;
    RETURN jsonb_build_object('success',true,'status','reserved','discount_total',p_discount_total);
  END IF;
  RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_FINAL');
END $$;

-- Test double of the already-deployed preparation RPC. The recovery wrapper and its
-- transaction/rollback contract are real; this scratch double supplies deterministic
-- quote/reserve/coupon outcomes without copying production data or relying on secrets.
CREATE OR REPLACE FUNCTION public.prepare_storefront_wompi_checkout(
  p_reference text,p_items jsonb,p_city text,p_coupon_code text,p_customer_email text,p_customer_phone text,p_expected_quote jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp' AS $$
DECLARE v_quote jsonb; v_inventory jsonb; v_coupon jsonb; v_expiry timestamptz;
BEGIN
  v_quote:=public.get_storefront_cart_quote_with_coupon(p_items,p_city,p_coupon_code,'','');
  IF v_quote->'items' IS DISTINCT FROM p_expected_quote->'items' OR v_quote->>'total' IS DISTINCT FROM p_expected_quote->>'total' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_CHANGED');
  END IF;
  v_inventory:=public.reserve_order_inventory(p_reference,p_items,10);
  IF coalesce((v_inventory->>'success')::boolean,false) IS DISTINCT FROM true THEN
    PERFORM public.release_inventory_reservation(p_reference);
    RETURN v_inventory;
  END IF;
  v_expiry:=(v_inventory->>'expires_at')::timestamptz;
  IF coalesce(p_coupon_code,'')<>'' THEN
    v_coupon:=public.reserve_storefront_coupon_redemption(p_coupon_code,'wompi',p_reference,p_customer_email,
      p_customer_phone,coalesce((p_expected_quote->>'coupon_discount_total')::bigint,0),v_expiry);
    IF coalesce((v_coupon->>'success')::boolean,false) IS DISTINCT FROM true THEN
      PERFORM public.release_inventory_reservation(p_reference);
      RETURN v_coupon;
    END IF;
  END IF;
  RETURN jsonb_build_object('success',true,'reference',p_reference,'expires_at',v_expiry);
END $$;
