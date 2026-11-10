-- Toggle global de cupones. Es aditivo; no modifica cupones, redenciones, pedidos ni pagos.
-- El valor inicial preserva el comportamiento vigente; solo cambia al guardar desde el admin.
DO $preflight_coupon_feature_toggle$
DECLARE
  v_type text;
BEGIN
  IF to_regclass('public.store_settings') IS NULL THEN
    RAISE EXCEPTION 'Toggle global requiere public.store_settings.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute AS a
    WHERE a.attrelid='public.store_settings'::regclass AND a.attname='admin_user_id'
      AND a.attnum>0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Toggle global requiere store_settings.admin_user_id.';
  END IF;
  IF to_regclass('public.storefront_coupons') IS NULL
     OR to_regclass('public.storefront_coupon_redemptions') IS NULL
     OR to_regprocedure('public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Toggle global requiere el backend de cupones ya instalado.';
  END IF;
  SELECT format_type(a.atttypid,a.atttypmod) INTO v_type
    FROM pg_attribute AS a
   WHERE a.attrelid='public.store_settings'::regclass
     AND a.attname='storefront_coupons_enabled' AND a.attnum>0 AND NOT a.attisdropped;
  IF v_type IS NOT NULL AND v_type IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'store_settings.storefront_coupons_enabled debe ser boolean, no %.',v_type;
  END IF;
END
$preflight_coupon_feature_toggle$;

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS storefront_coupons_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public._storefront_coupons_are_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
  SELECT coalesce((SELECT s.storefront_coupons_enabled
                     FROM public.store_settings AS s WHERE s.id=1),false);
$function$;
REVOKE ALL ON FUNCTION public._storefront_coupons_are_enabled()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_public_storefront_coupon_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT s.storefront_coupons_enabled INTO v_enabled
    FROM public.store_settings AS s WHERE s.id=1;
  IF NOT FOUND OR v_enabled IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_SETTINGS_UNAVAILABLE',
      'message','La configuración de cupones no está disponible.');
  END IF;
  RETURN jsonb_build_object('success',true,'coupons_enabled',v_enabled);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_public_storefront_coupon_settings()
  FROM PUBLIC,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_coupon_settings()
  TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_storefront_coupons_enabled(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth','pg_temp'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_enabled IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','INVALID_COUPON_SETTING',
      'message','Selecciona si los cupones deben estar activos o desactivados.');
  END IF;
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM (SELECT s.admin_user_id FROM public.store_settings AS s WHERE s.id=1) THEN
    RETURN jsonb_build_object('success',false,'code','ADMIN_AUTH_INVALID',
      'message','Este usuario no está autorizado para cambiar la configuración de cupones.');
  END IF;
  UPDATE public.store_settings AS s
     SET storefront_coupons_enabled=p_enabled
   WHERE s.id=1;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_SETTINGS_UNAVAILABLE',
      'message','No se encontró la configuración existente de la tienda.');
  END IF;
  RETURN jsonb_build_object('success',true,'coupons_enabled',p_enabled,
    'message',CASE WHEN p_enabled THEN 'Cupones habilitados para nuevas aplicaciones.'
                   ELSE 'Cupones deshabilitados para nuevas aplicaciones.' END);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_storefront_coupons_enabled(boolean)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_storefront_coupons_enabled(boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_storefront_cart_quote_with_coupon(
  p_items jsonb,
  p_city text,
  p_coupon_code text,
  p_customer_email text,
  p_customer_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_legacy_quote jsonb;
  v_items jsonb;
  v_discounts jsonb;
  v_coupon public.storefront_coupons%ROWTYPE;
  v_coupon_code text:=upper(btrim(coalesce(p_coupon_code,'')));
  v_normalized_city text;
  v_input jsonb;
  v_line jsonb;
  v_line_out jsonb;
  v_item_count integer;
  v_index integer:=0;
  v_combo_total numeric:=0;
  v_original_subtotal numeric:=0;
  v_subtotal numeric:=0;
  v_coupon_discount numeric:=0;
  v_total_discount numeric:=0;
  v_shipping numeric:=0;
  v_total numeric:=0;
  v_line_net_total numeric:=0;
  v_line_original numeric;
  v_line_combo numeric;
  v_line_net numeric;
  v_share numeric;
  v_remaining_coupon numeric;
  v_remaining_base numeric;
  v_last_positive_index integer:=0;
  v_rule_cost numeric;
  v_rule_threshold numeric;
  v_destination_status text;
  v_message text;
BEGIN
  IF v_coupon_code<>'' AND NOT public._storefront_coupons_are_enabled() THEN
    RETURN jsonb_build_object('success',false,'code','COUPONS_DISABLED','message','Los cupones están temporalmente desactivados.');
  END IF;

  IF v_coupon_code='' THEN
    v_legacy_quote:=public.get_storefront_cart_quote(p_items,p_city);
    IF coalesce((v_legacy_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN
      RETURN v_legacy_quote||jsonb_build_object('coupon_id',NULL,'coupon_code',NULL,'coupon_discount_total',0,'coupon',NULL);
    END IF;
    v_items:='[]'::jsonb;
    FOR v_input IN SELECT value FROM jsonb_array_elements(coalesce(v_legacy_quote->'items','[]'::jsonb)) AS x(value) LOOP
      v_items:=v_items||(v_input||jsonb_build_object('coupon_discount_total',0));
    END LOOP;
    RETURN v_legacy_quote||jsonb_build_object(
      'items',v_items,'coupon_id',NULL,'coupon_code',NULL,'coupon_discount_total',0,'coupon',NULL
    );
  END IF;

  IF v_coupon_code !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_INVALID','message','El código del cupón no es válido.');
  END IF;
  v_legacy_quote:=public.get_storefront_cart_quote(p_items,p_city);
  IF coalesce((v_legacy_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN
    RETURN v_legacy_quote||jsonb_build_object('code','QUOTE_INVALID');
  END IF;
  IF (v_legacy_quote->>'discount_total') IS NULL
     OR (v_legacy_quote->>'original_subtotal') IS NULL
     OR (v_legacy_quote->>'discounted_subtotal') IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización legacy está incompleta.');
  END IF;
  IF round((v_legacy_quote->>'discount_total')::numeric,0)>0 THEN
    RETURN jsonb_build_object(
      'success',false,'code','COUPON_COMBO_CONFLICT',
      'message','Este cupón no se puede combinar con descuentos de combo.'
    );
  END IF;

  SELECT c.* INTO v_coupon
    FROM public.storefront_coupons AS c
   WHERE c.code=v_coupon_code
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_INVALID','message','El cupón no existe.');
  END IF;
  IF NOT v_coupon.enabled THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_DISABLED','message','El cupón no está activo.');
  END IF;
  IF v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at>now() THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_NOT_STARTED','message','El cupón todavía no está vigente.');
  END IF;
  IF v_coupon.end_at IS NOT NULL AND v_coupon.end_at<=now() THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_EXPIRED','message','El cupón ya no está vigente.');
  END IF;

  v_original_subtotal:=round((v_legacy_quote->>'original_subtotal')::numeric,0);
  v_subtotal:=round((v_legacy_quote->>'discounted_subtotal')::numeric,0);
  IF v_subtotal<v_coupon.minimum_subtotal THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_MINIMUM_NOT_MET','message','El subtotal no alcanza el mínimo requerido para este cupón.');
  END IF;
  IF lower(v_coupon.discount_type)='percent' THEN
    v_coupon_discount:=round(v_subtotal*v_coupon.discount_value/100,0);
  ELSE
    v_coupon_discount:=least(v_subtotal,v_coupon.discount_value);
  END IF;
  v_coupon_discount:=least(v_subtotal,greatest(0,v_coupon_discount));
  IF v_coupon_discount<=0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_ZERO_DISCOUNT','message','El cupón no produce un descuento sobre este subtotal.');
  END IF;

  v_items:='[]'::jsonb;
  v_item_count:=jsonb_array_length(coalesce(v_legacy_quote->'items','[]'::jsonb));
  IF v_item_count<1 THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización legacy no contiene líneas.');
  END IF;
  SELECT coalesce(max(x.ordinality),0)::integer INTO v_last_positive_index
    FROM jsonb_array_elements(coalesce(v_legacy_quote->'items','[]'::jsonb)) WITH ORDINALITY AS x(value,ordinality)
   WHERE greatest(0,round(coalesce((x.value->>'net_subtotal')::numeric,
     coalesce((x.value->>'original_subtotal')::numeric,0)-coalesce((x.value->>'discount_total')::numeric,0)),0))>0;
  IF v_last_positive_index=0 THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización no contiene una línea elegible para distribuir el cupón.');
  END IF;
  v_remaining_coupon:=v_coupon_discount;
  v_remaining_base:=v_subtotal;
  FOR v_input IN
    SELECT value FROM jsonb_array_elements(coalesce(v_legacy_quote->'items','[]'::jsonb)) WITH ORDINALITY AS x(value,ordinality)
    ORDER BY ordinality
  LOOP
    v_index:=v_index+1;
    v_line_original:=round(coalesce((v_input->>'original_subtotal')::numeric,0),0);
    v_line_combo:=round(coalesce((v_input->>'discount_total')::numeric,0),0);
    v_line_net:=greatest(0,round(coalesce((v_input->>'net_subtotal')::numeric,v_line_original-v_line_combo),0));
    v_combo_total:=v_combo_total+v_line_combo;
    v_line_net_total:=v_line_net_total+v_line_net;
    IF v_index=v_last_positive_index THEN
      v_share:=v_remaining_coupon;
    ELSIF v_remaining_coupon<=0 OR v_line_net<=0 OR v_remaining_base<=0 THEN
      v_share:=0;
    ELSE
      v_share:=least(v_line_net,greatest(0,round(v_remaining_coupon*v_line_net/v_remaining_base,0)));
    END IF;
    v_share:=least(v_line_net,greatest(0,v_share));
    v_remaining_coupon:=greatest(0,v_remaining_coupon-v_share);
    v_remaining_base:=greatest(0,v_remaining_base-v_line_net);
    v_line_out:=v_input||jsonb_build_object(
      'discount_total',v_line_combo+v_share,
      'coupon_discount_total',v_share,
      'net_subtotal',greatest(0,v_line_net-v_share)
    );
    v_items:=v_items||v_line_out;
  END LOOP;
  IF v_remaining_coupon<>0 THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','No se pudo distribuir exactamente el descuento del cupón.');
  END IF;
  IF round(v_combo_total,0)<>round((v_legacy_quote->>'discount_total')::numeric,0) THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La distribución de descuentos legacy no concilia.');
  END IF;
  IF round(v_line_net_total,0)<>round((v_legacy_quote->>'discounted_subtotal')::numeric,0) THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','Los subtotales por línea no concilian con el subtotal del servidor.');
  END IF;

  v_total_discount:=v_combo_total+v_coupon_discount;
  v_subtotal:=greatest(0,v_original_subtotal-v_total_discount);
  v_destination_status:=v_legacy_quote->>'destination_status';
  IF v_destination_status IS NULL
     OR v_destination_status NOT IN ('matched_city','matched_zone','cali_free','fallback')
     OR v_legacy_quote->>'shipping_rule_cost' IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','SHIPPING_UNAVAILABLE','message','La cotización de ciudad/zona no incluye una regla verificable.');
  END IF;
  v_normalized_city:=v_legacy_quote->>'normalized_city';
  v_rule_cost:=round((v_legacy_quote->>'shipping_rule_cost')::numeric,0);
  v_rule_threshold:=nullif(v_legacy_quote->>'shipping_rule_threshold','')::numeric;
  IF v_destination_status='cali_free' THEN
    -- Envío gratuito de Cali solo es fallback cuando el quote legacy no encontró regla.
    v_shipping:=0;
  ELSIF v_rule_threshold IS NOT NULL AND v_subtotal>=v_rule_threshold THEN
    v_shipping:=0;
  ELSE
    v_shipping:=v_rule_cost;
  END IF;
  v_total:=v_subtotal+v_shipping;
  v_discounts:=coalesce(v_legacy_quote->'discounts','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
    'id',v_coupon.id,'code',v_coupon.code,'discount_type',v_coupon.discount_type,
    'discount_value',v_coupon.discount_value,'minimum_subtotal',v_coupon.minimum_subtotal,
    'discount_total',v_coupon_discount,'coupon_discount_total',v_coupon_discount
  ));
  RETURN jsonb_build_object(
    'success',true,'original_subtotal',v_original_subtotal,'discount_total',v_total_discount,
    'discounted_subtotal',v_subtotal,'shipping',v_shipping,'total',v_total,
    'items',v_items,'discounts',v_discounts,'currency','COP',
    'coupon_id',v_coupon.id,'coupon_code',v_coupon.code,'coupon_discount_total',v_coupon_discount,
    'normalized_city',v_normalized_city,'destination_status',v_destination_status,
    'shipping_rule_id',v_legacy_quote->>'shipping_rule_id',
    'shipping_rule_scope',v_legacy_quote->>'shipping_rule_scope',
    'shipping_rule_name',v_legacy_quote->>'shipping_rule_name',
    'shipping_rule_cost',v_rule_cost,'shipping_rule_threshold',v_rule_threshold,
    'coupon',jsonb_build_object(
      'id',v_coupon.id,'code',v_coupon.code,'discount_type',v_coupon.discount_type,
      'discount_value',v_coupon.discount_value,'minimum_subtotal',v_coupon.minimum_subtotal,
      'global_limit',v_coupon.global_limit,'per_customer_limit',v_coupon.per_customer_limit,
      'starts_at',v_coupon.starts_at,'end_at',v_coupon.end_at,'enabled',v_coupon.enabled
    )
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','El carrito o el cupón contienen un valor no válido.');
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    RETURN jsonb_build_object('success',false,'code','COUPON_QUOTE_FAILED','message','No se pudo verificar el cupón y la cotización.');
END;
$function$;
REVOKE ALL ON FUNCTION public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text)
  TO anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';
