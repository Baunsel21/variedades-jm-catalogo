-- Candidato local únicamente. No aplicar en producción sin autorización posterior.
-- Evita descontar dos veces variantes en reservas legacy ya descontadas.
CREATE OR REPLACE FUNCTION public.cleanup_inventory_reservations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_product public.products%ROWTYPE;
  v_variants jsonb;
  v_new_variants jsonb;
  v_total integer;
  v_found boolean;
BEGIN
  UPDATE public.inventory_reservations
  SET status = 'EXPIRED'
  WHERE lower(COALESCE(status, '')) = 'active'
    AND expires_at <= now();

  FOR r IN
    SELECT ir.id, ir.product_id, ir.quantity, ir.color, ir.size
    FROM public.inventory_reservations ir
    WHERE upper(COALESCE(ir.status, '')) IN ('PENDING', 'WHATSAPP_RESERVED')
      AND ir.expires_at <= now()
    ORDER BY ir.product_id, ir.id
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO v_product
    FROM public.products p
    WHERE p.id = r.product_id
    FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_variants := COALESCE(v_product.variants, '[]'::jsonb);
    v_found := false;
    IF jsonb_typeof(v_variants) = 'array'
       AND jsonb_array_length(v_variants) > 0
       AND (COALESCE(trim(r.color), '') <> '' OR COALESCE(trim(r.size), '') <> '') THEN
      SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_variants) x(value)
        WHERE lower(trim(COALESCE(x.value->>'color', ''))) = lower(trim(COALESCE(r.color, '')))
          AND lower(trim(COALESCE(x.value->>'size', ''))) = lower(trim(COALESCE(r.size, '')))
      ) INTO v_found;
      IF NOT v_found THEN
        CONTINUE;
      END IF;
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN lower(trim(COALESCE(x.value->>'color', ''))) = lower(trim(COALESCE(r.color, '')))
           AND lower(trim(COALESCE(x.value->>'size', ''))) = lower(trim(COALESCE(r.size, '')))
          THEN jsonb_set(x.value, '{stock}', to_jsonb(GREATEST(0, COALESCE((x.value->>'stock')::integer, 0) + r.quantity)), true)
          ELSE x.value
        END ORDER BY x.ordinality), '[]'::jsonb)
      INTO v_new_variants
      FROM jsonb_array_elements(v_variants) WITH ORDINALITY x(value, ordinality);
      SELECT COALESCE(SUM(GREATEST(0, COALESCE((x.value->>'stock')::integer, 0))), 0)::integer
      INTO v_total FROM jsonb_array_elements(v_new_variants) x(value);
      UPDATE public.products SET variants = v_new_variants, quantity = v_total WHERE id = r.product_id;
    ELSE
      UPDATE public.products
      SET quantity = GREATEST(0, COALESCE(quantity, 0)) + GREATEST(0, r.quantity)
      WHERE id = r.product_id;
    END IF;

    UPDATE public.inventory_reservations
    SET status = 'EXPIRED'
    WHERE id = r.id
      AND upper(COALESCE(status, '')) IN ('PENDING', 'WHATSAPP_RESERVED');
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_inventory_reservation(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_product public.products%ROWTYPE;
  v_variants jsonb;
  v_new_variants jsonb;
  v_total integer;
  v_stock integer;
  v_variant jsonb;
  v_legacy boolean;
  v_count integer := 0;
BEGIN
  IF COALESCE(trim(p_reference), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Referencia vacía');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sirevya-ref:' || p_reference));
  PERFORM public.cleanup_inventory_reservations();

  FOR r IN
    SELECT ir.*
    FROM public.inventory_reservations ir
    WHERE ir.reference = p_reference
      AND ((ir.status = 'active' AND ir.expires_at > now())
        OR (ir.status = 'PENDING' AND ir.expires_at > now())
        OR ir.status = 'WHATSAPP_CONFIRMED')
    ORDER BY ir.product_id, COALESCE(ir.color, ''), COALESCE(ir.size, '')
    FOR UPDATE
  LOOP
    SELECT * INTO v_product
    FROM public.products p
    WHERE p.id = r.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No existe el producto de la reserva %', r.id;
    END IF;

    v_legacy := upper(COALESCE(r.status, '')) IN ('PENDING', 'WHATSAPP_CONFIRMED');
    v_variants := COALESCE(v_product.variants, '[]'::jsonb);

    IF jsonb_typeof(v_variants) = 'array' AND jsonb_array_length(v_variants) > 0 THEN
      IF v_legacy THEN
        -- Las reservas legacy ya habían descontado el stock de la variante.
        -- Solo se convierte la reserva; no se vuelve a reducir el inventario.
        NULL;
      ELSE
        v_variant := NULL;
        SELECT GREATEST(0, COALESCE((x.value->>'stock')::integer, 0)), x.value
        INTO v_stock, v_variant
        FROM jsonb_array_elements(v_variants) AS x(value)
        WHERE lower(trim(COALESCE(x.value->>'color', ''))) = lower(trim(COALESCE(r.color, '')))
          AND lower(trim(COALESCE(x.value->>'size', ''))) = lower(trim(COALESCE(r.size, '')))
        LIMIT 1;

        IF v_variant IS NULL THEN
          RAISE EXCEPTION 'No se encontró la variante de color/talla del producto %', v_product.code;
        END IF;
        IF v_stock < r.quantity THEN
          RAISE EXCEPTION 'Stock insuficiente para finalizar %: disponibles %, solicitadas %', v_product.code, v_stock, r.quantity;
        END IF;

        SELECT COALESCE(jsonb_agg(
          CASE
            WHEN lower(trim(COALESCE(x.value->>'color', ''))) = lower(trim(COALESCE(r.color, '')))
             AND lower(trim(COALESCE(x.value->>'size', ''))) = lower(trim(COALESCE(r.size, '')))
            THEN jsonb_set(x.value, '{stock}', to_jsonb(GREATEST(0, COALESCE((x.value->>'stock')::integer, 0) - r.quantity)), true)
            ELSE x.value
          END ORDER BY x.ordinality), '[]'::jsonb)
        INTO v_new_variants
        FROM jsonb_array_elements(v_variants) WITH ORDINALITY AS x(value, ordinality);

        SELECT COALESCE(SUM(GREATEST(0, COALESCE((x.value->>'stock')::integer, 0))), 0)::integer
        INTO v_total
        FROM jsonb_array_elements(v_new_variants) AS x(value);

        UPDATE public.products
        SET variants = v_new_variants, quantity = v_total
        WHERE id = r.product_id;
      END IF;
    ELSIF NOT v_legacy THEN
      IF COALESCE(v_product.quantity, 0) < r.quantity THEN
        RAISE EXCEPTION 'Stock insuficiente para finalizar %', v_product.code;
      END IF;
      UPDATE public.products
      SET quantity = GREATEST(0, COALESCE(quantity, 0) - r.quantity)
      WHERE id = r.product_id;
    END IF;

    UPDATE public.inventory_reservations
    SET status = 'CONVERTED'
    WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    IF EXISTS (SELECT 1 FROM public.inventory_reservations WHERE reference = p_reference AND status = 'CONVERTED') THEN
      RETURN jsonb_build_object('success', true, 'already_finalized', true, 'reference', p_reference);
    END IF;
    RETURN jsonb_build_object('success', false, 'reference', p_reference, 'message', 'No hay una reserva vigente para finalizar; puede haber vencido o haberse liberado.');
  END IF;

  RETURN jsonb_build_object('success', true, 'reference', p_reference, 'items_finalized', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'reference', p_reference, 'message', SQLERRM);
END;
$$;
