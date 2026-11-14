-- Respaldo previo a 20261115020000_fix_inventory_finalization_idempotency
-- Obtenido mediante inspección SQL read-only del proyecto hnlbbtnfmbnbkcgegufa.
-- No ejecutar como rollback sin revisión.

CREATE OR REPLACE FUNCTION public.cleanup_inventory_reservations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
begin
  update public.inventory_reservations ir
     set status = 'EXPIRED'
   where lower(coalesce(ir.status, '')) = 'active'
     and ir.expires_at <= now();

  for r in
    select ir.id, ir.product_id, ir.quantity
      from public.inventory_reservations ir
     where upper(coalesce(ir.status, '')) in ('PENDING', 'WHATSAPP_RESERVED')
       and ir.expires_at <= now()
     order by ir.product_id, ir.id
     for update skip locked
  loop
    update public.products p
       set quantity = greatest(0, coalesce(p.quantity, 0)) + greatest(0, coalesce(r.quantity, 0))
     where p.id = r.product_id;

    update public.inventory_reservations ir
       set status = 'EXPIRED'
     where ir.id = r.id
       and upper(coalesce(ir.status, '')) in ('PENDING', 'WHATSAPP_RESERVED');
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_inventory_reservation(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        SELECT * INTO v_product FROM public.products p WHERE p.id = r.product_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'No existe el producto de la reserva %', r.id; END IF;
        v_legacy := r.status IN ('PENDING', 'WHATSAPP_CONFIRMED');
        v_variants := COALESCE(v_product.variants, '[]'::jsonb);

        IF jsonb_typeof(v_variants) = 'array' AND jsonb_array_length(v_variants) > 0 THEN
            v_variant := NULL;
            SELECT GREATEST(0, COALESCE((x.value->>'stock')::integer, 0)), x.value
              INTO v_stock, v_variant
              FROM jsonb_array_elements(v_variants) AS x(value)
             WHERE lower(trim(COALESCE(x.value->>'color', ''))) = lower(trim(COALESCE(r.color, '')))
               AND lower(trim(COALESCE(x.value->>'size', ''))) = lower(trim(COALESCE(r.size, '')))
             LIMIT 1;
            IF v_variant IS NULL THEN RAISE EXCEPTION 'No se encontró la variante de color/talla del producto %', v_product.code; END IF;
            IF v_stock < r.quantity THEN RAISE EXCEPTION 'Stock insuficiente para finalizar %: disponibles %, solicitadas %', v_product.code, v_stock, r.quantity; END IF;

            SELECT COALESCE(jsonb_agg(CASE
                WHEN lower(trim(COALESCE(x.value->>'color', ''))) = lower(trim(COALESCE(r.color, '')))
                 AND lower(trim(COALESCE(x.value->>'size', ''))) = lower(trim(COALESCE(r.size, '')))
                THEN jsonb_set(x.value, '{stock}', to_jsonb(GREATEST(0, COALESCE((x.value->>'stock')::integer, 0) - r.quantity)), true)
                ELSE x.value END ORDER BY x.ordinality), '[]'::jsonb)
              INTO v_new_variants
              FROM jsonb_array_elements(v_variants) WITH ORDINALITY AS x(value, ordinality);
            SELECT COALESCE(SUM(GREATEST(0, COALESCE((x.value->>'stock')::integer, 0))), 0)::integer INTO v_total FROM jsonb_array_elements(v_new_variants) AS x(value);
            UPDATE public.products SET variants = v_new_variants, quantity = v_total WHERE id = r.product_id;
        ELSIF NOT v_legacy THEN
            IF COALESCE(v_product.quantity, 0) < r.quantity THEN RAISE EXCEPTION 'Stock insuficiente para finalizar %', v_product.code; END IF;
            UPDATE public.products SET quantity = GREATEST(0, COALESCE(quantity, 0) - r.quantity) WHERE id = r.product_id;
        END IF;

        UPDATE public.inventory_reservations SET status = 'CONVERTED' WHERE id = r.id;
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
$function$;
