-- Contratos base sintéticos para el runner local. No sustituyen las RPC de producción.
CREATE OR REPLACE FUNCTION public.reserve_order_inventory(
  p_reference text,p_items jsonb,p_ttl_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_expires timestamptz:=now()+make_interval(mins=>greatest(1,coalesce(p_ttl_minutes,10)));
  v_rows integer;
BEGIN
  IF btrim(coalesce(p_reference,''))='' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items)=0 THEN
    RETURN jsonb_build_object('success',false,'code','FIXTURE_RESERVATION_INVALID');
  END IF;
  INSERT INTO public.inventory_reservations(reference,status,items,expires_at)
  VALUES(btrim(p_reference),'ACTIVE',p_items,v_expires)
  ON CONFLICT(reference) DO UPDATE
    SET items=EXCLUDED.items,expires_at=EXCLUDED.expires_at,updated_at=now()
    WHERE public.inventory_reservations.status IN ('RELEASED','EXPIRED');
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows=0 THEN
    RETURN jsonb_build_object('success',false,'code','FIXTURE_RESERVATION_CONFLICT');
  END IF;
  RETURN jsonb_build_object('success',true,'reference',btrim(p_reference),'expires_at',v_expires);
END;
$function$;
REVOKE ALL ON FUNCTION public.reserve_order_inventory(text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_order_inventory(text,jsonb,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_inventory_reservation(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_reservation public.inventory_reservations%ROWTYPE;
  v_line record;
  v_product_id uuid;
  v_quantity integer;
  v_stock integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('fixture-inventory:'||btrim(coalesce(p_reference,''))));
  SELECT r.* INTO v_reservation
    FROM public.inventory_reservations AS r
   WHERE r.reference=btrim(coalesce(p_reference,''))
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','FIXTURE_RESERVATION_NOT_FOUND');
  END IF;
  IF v_reservation.status='CONVERTED' THEN
    RETURN jsonb_build_object('success',true,'already_finalized',true,'status','CONVERTED');
  END IF;
  IF v_reservation.status<>'ACTIVE' OR v_reservation.expires_at<=now() THEN
    RETURN jsonb_build_object('success',false,'code','FIXTURE_RESERVATION_NOT_ACTIVE');
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_reservation.items) AS x(value) LOOP
    v_product_id:=nullif(v_line.value->>'id','')::uuid;
    v_quantity:=coalesce(nullif(v_line.value->>'qty','')::integer,0);
    SELECT p.quantity INTO v_stock FROM public.products AS p WHERE p.id=v_product_id FOR UPDATE;
    IF NOT FOUND OR v_quantity<1 OR v_stock<v_quantity THEN
      RETURN jsonb_build_object('success',false,'code','FIXTURE_INVENTORY_UNAVAILABLE');
    END IF;
  END LOOP;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_reservation.items) AS x(value) LOOP
    v_product_id:=nullif(v_line.value->>'id','')::uuid;
    v_quantity:=coalesce(nullif(v_line.value->>'qty','')::integer,0);
    UPDATE public.products AS p SET quantity=p.quantity-v_quantity WHERE p.id=v_product_id;
  END LOOP;
  UPDATE public.inventory_reservations AS r SET status='CONVERTED',updated_at=now()
   WHERE r.reference=v_reservation.reference;
  RETURN jsonb_build_object('success',true,'already_finalized',false,'status','CONVERTED');
END;
$function$;
REVOKE ALL ON FUNCTION public.finalize_inventory_reservation(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_inventory_reservation(text) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_inventory_reservation(p_reference text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
  SELECT public.finalize_inventory_reservation(p_reference);
$function$;
REVOKE ALL ON FUNCTION public.confirm_inventory_reservation(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_inventory_reservation(text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_inventory_reservation(p_reference text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
BEGIN
  UPDATE public.inventory_reservations AS r SET status='RELEASED',updated_at=now()
   WHERE r.reference=btrim(coalesce(p_reference,'')) AND r.status='ACTIVE';
END;
$function$;
REVOKE ALL ON FUNCTION public.release_inventory_reservation(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_inventory_reservation(text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_contra_delivery_order(
  p_client_reference text,p_customer_name text,p_customer_cedula text,p_customer_phone text,
  p_customer_email text,p_customer_city text,p_customer_address text,p_customer_neighborhood text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_quote jsonb;
  v_reservation jsonb;
  v_order_id uuid;
  v_existing public.web_orders%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('fixture-cod:'||btrim(coalesce(p_client_reference,''))));
  SELECT w.* INTO v_existing FROM public.web_orders AS w
   WHERE w.client_reference=btrim(coalesce(p_client_reference,''))
     AND w.payment_method='Contra entrega' FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('success',true,'duplicate',true,'order_id',v_existing.id,
      'total',v_existing.total,'discount_total',v_existing.discount_total,'shipping',v_existing.shipping);
  END IF;
  v_quote:=public.get_storefront_cart_quote(p_items,p_customer_city);
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_quote; END IF;
  v_reservation:=public.reserve_order_inventory(btrim(p_client_reference),p_items,10);
  IF coalesce((v_reservation->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_reservation; END IF;
  INSERT INTO public.web_orders(
    client_reference,payment_method,customer_name,customer_cedula,customer_phone,customer_email,
    customer_city,customer_address,customer_neighborhood,items,original_subtotal,discount_total,
    shipping,total,status
  ) VALUES (
    btrim(p_client_reference),'Contra entrega',coalesce(p_customer_name,''),coalesce(p_customer_cedula,''),
    coalesce(p_customer_phone,''),coalesce(p_customer_email,''),coalesce(p_customer_city,''),
    coalesce(p_customer_address,''),coalesce(p_customer_neighborhood,''),v_quote->'items',
    round((v_quote->>'original_subtotal')::numeric,0),round((v_quote->>'discount_total')::numeric,0),
    round((v_quote->>'shipping')::numeric,0),round((v_quote->>'total')::numeric,0),'pending'
  ) RETURNING id INTO v_order_id;
  RETURN jsonb_build_object('success',true,'duplicate',false,'order_id',v_order_id,
    'total',v_quote->'total','discount_total',v_quote->'discount_total','shipping',v_quote->'shipping');
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order(text,text,text,text,text,text,text,text,jsonb) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.create_contra_delivery_order_with_quote(
  p_client_reference text,p_customer_name text,p_customer_cedula text,p_customer_phone text,
  p_customer_email text,p_customer_city text,p_customer_address text,p_customer_neighborhood text,
  p_items jsonb,p_expected_total numeric,p_expected_discount_total numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result:=public.create_contra_delivery_order(p_client_reference,p_customer_name,p_customer_cedula,
    p_customer_phone,p_customer_email,p_customer_city,p_customer_address,p_customer_neighborhood,p_items);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_result; END IF;
  IF round((v_result->>'total')::numeric,0)<>round(p_expected_total,0)
     OR round((v_result->>'discount_total')::numeric,0)<>round(p_expected_discount_total,0) THEN
    RETURN jsonb_build_object('success',false,'quote_changed',true,'code','FIXTURE_QUOTE_CHANGED');
  END IF;
  RETURN v_result;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.fixture_cod_submit(p_reference text,p_cedula text)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_order public.web_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.web_orders AS w
   WHERE w.client_reference=p_reference AND w.payment_method='Contra entrega';
  IF FOUND THEN
    IF coalesce(v_order.customer_cedula,'')<>coalesce(p_cedula,'') THEN
      RETURN jsonb_build_object('success',false,'duplicate',true,'message','legacy_mismatch');
    END IF;
    RETURN jsonb_build_object('success',true,'duplicate',true,'order_id',v_order.id);
  END IF;
  INSERT INTO public.web_orders(client_reference,payment_method,customer_cedula)
  VALUES(p_reference,'Contra entrega',coalesce(p_cedula,''))
  RETURNING * INTO v_order;
  RETURN jsonb_build_object('success',true,'duplicate',false,'order_id',v_order.id);
END;
$function$;
