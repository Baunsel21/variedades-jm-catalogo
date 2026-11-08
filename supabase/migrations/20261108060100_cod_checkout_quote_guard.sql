-- Verifica que la cotización mostrada al cliente siga vigente al crear un pedido COD.
-- El wrapper COD existente conserva su idempotencia y reglas de inventario.
CREATE OR REPLACE FUNCTION public.create_contra_delivery_order_with_quote(
  p_client_reference text,
  p_customer_name text,
  p_customer_cedula text,
  p_customer_phone text,
  p_customer_email text,
  p_customer_city text,
  p_customer_address text,
  p_customer_neighborhood text,
  p_items jsonb,
  p_expected_total numeric,
  p_expected_discount_total numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_quote jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_existing_total numeric;
  v_existing_discount_total numeric;
  v_existing_shipping numeric;
BEGIN
  IF p_expected_total IS NULL OR p_expected_total<0 OR p_expected_total<>round(p_expected_total,0)
     OR p_expected_discount_total IS NULL OR p_expected_discount_total<0
     OR p_expected_discount_total<>round(p_expected_discount_total,0) THEN
    RETURN jsonb_build_object('success',false,'message','La cotización enviada no es válida. Vuelve a revisar el total.');
  END IF;

  -- Evita que la tarifa cambie mientras el pedido transaccional vuelve a cotizar.
  PERFORM 1 FROM public.storefront_shipping_settings WHERE id=1 FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','La configuración de envíos no está disponible.');
  END IF;

  v_quote:=public.get_storefront_cart_quote(p_items,p_customer_city);
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'message',coalesce(v_quote->>'message','No se pudo verificar el pedido.'));
  END IF;
  IF v_quote->>'total' IS NULL OR v_quote->>'discount_total' IS NULL OR v_quote->>'shipping' IS NULL THEN
    RETURN jsonb_build_object('success',false,'message','La cotización está incompleta. Vuelve a cargar el catálogo antes de confirmar.');
  END IF;
  IF round((v_quote->>'total')::numeric,0)<>round(p_expected_total,0)
     OR round((v_quote->>'discount_total')::numeric,0)<>round(p_expected_discount_total,0) THEN
    RETURN jsonb_build_object(
      'success',false,'quote_changed',true,
      'message','El envío o el descuento cambió. Revisa el total actualizado y vuelve a confirmar; no se creó ningún pedido.',
      'shipping',v_quote->'shipping','total',v_quote->'total',
      'discount_total',v_quote->'discount_total'
    );
  END IF;

  v_result:=public.create_contra_delivery_order(
    p_client_reference,p_customer_name,p_customer_cedula,p_customer_phone,p_customer_email,
    p_customer_city,p_customer_address,p_customer_neighborhood,p_items
  );
  IF v_result IS NULL OR jsonb_typeof(v_result) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_result->'success') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'La respuesta COD es nula o incompleta; la transacción fue revertida. Vuelve a intentar más tarde.';
  END IF;
  IF (v_result->>'success')::boolean IS NOT TRUE THEN
    RETURN v_result;
  END IF;
  IF coalesce((v_result->>'duplicate')::boolean,false) THEN
    v_order_id:=nullif(v_result->>'order_id','')::uuid;
    IF v_order_id IS NULL THEN
      RETURN jsonb_build_object('success',false,'message','Ya existe un pedido previo, pero no se pudo verificar su total. Contacta a la tienda antes de volver a confirmar.');
    END IF;
    SELECT w.total,w.discount_total,w.shipping
      INTO v_existing_total,v_existing_discount_total,v_existing_shipping
      FROM public.web_orders AS w
     WHERE w.id=v_order_id AND w.client_reference=btrim(p_client_reference)
       AND w.payment_method='Contra entrega'
     FOR SHARE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'message','Ya existe un pedido previo, pero no se pudo verificarlo. Contacta a la tienda antes de volver a confirmar.');
    END IF;
    IF v_existing_total IS NULL OR v_existing_discount_total IS NULL OR v_existing_shipping IS NULL
       OR round(v_existing_total,0)<>round(p_expected_total,0)
       OR round(v_existing_discount_total,0)<>round(p_expected_discount_total,0)
       OR round(v_existing_shipping,0)<>round((v_quote->>'shipping')::numeric,0) THEN
      RETURN jsonb_build_object(
        'success',false,'duplicate',true,'quote_changed',true,'existing_order_id',v_order_id,
        'existing_total',v_existing_total,'existing_discount_total',v_existing_discount_total,
        'shipping',v_quote->'shipping','total',v_quote->'total','discount_total',v_quote->'discount_total',
        'message','Ya existe un pedido anterior con otro total. No se creó otro pedido; contacta a la tienda para revisar el pedido previo.'
      );
    END IF;
    IF (v_result->>'total' IS NOT NULL
        AND round((v_result->>'total')::numeric,0)<>round(v_existing_total,0))
       OR (v_result->>'discount_total' IS NOT NULL
        AND round((v_result->>'discount_total')::numeric,0)<>round(v_existing_discount_total,0))
       OR (v_result->>'shipping' IS NOT NULL
        AND round((v_result->>'shipping')::numeric,0)<>round(v_existing_shipping,0)) THEN
      RETURN jsonb_build_object(
        'success',false,'duplicate',true,'quote_changed',true,'existing_order_id',v_order_id,
        'existing_total',v_existing_total,'existing_discount_total',v_existing_discount_total,
        'shipping',v_quote->'shipping','total',v_quote->'total','discount_total',v_quote->'discount_total',
        'message','La respuesta del pedido anterior no coincide con sus importes guardados. No se creó otro pedido; contacta a la tienda.'
      );
    END IF;
    RETURN v_result||jsonb_build_object(
      'success',true,'duplicate',true,'order_id',v_order_id,
      'total',v_existing_total,'discount_total',v_existing_discount_total,'shipping',v_existing_shipping,
      'message',coalesce(v_result->>'message','El pedido ya estaba registrado; no se volvió a reservar inventario.')
    );
  END IF;

  -- Si cambió precio/promoción durante la transacción, la excepción revierte el
  -- pedido y la reserva creados por la función COD existente.
  v_order_id:=nullif(v_result->>'order_id','')::uuid;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'La respuesta COD no contiene un identificador de pedido; la transacción fue revertida.';
  END IF;
  IF v_result->>'total' IS NULL OR v_result->>'discount_total' IS NULL OR v_result->>'shipping' IS NULL THEN
    RAISE EXCEPTION 'La respuesta COD no contiene todos los importes; la transacción fue revertida. Vuelve a revisar el pedido.';
  END IF;
  IF round((v_result->>'total')::numeric,0)<>round(p_expected_total,0)
     OR round((v_result->>'discount_total')::numeric,0)<>round(p_expected_discount_total,0)
     OR round((v_result->>'shipping')::numeric,0)<>round((v_quote->>'shipping')::numeric,0) THEN
    RAISE EXCEPTION 'La cotización cambió durante la creación del pedido; la transacción fue revertida. Vuelve a revisar el total.';
  END IF;
  RETURN v_result;
END $function$;
REVOKE ALL ON FUNCTION public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric) TO anon,authenticated;
