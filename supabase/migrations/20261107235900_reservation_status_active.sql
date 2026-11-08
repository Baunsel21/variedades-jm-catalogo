-- Development migration: new logical inventory holds are ACTIVE.
-- Existing PENDING/WHATSAPP_RESERVED rows remain legacy-protected.
-- No data rows are changed by this migration.

CREATE OR REPLACE FUNCTION public.reserve_inventory(p_reference text, p_items jsonb, p_minutes integer DEFAULT 10)
 RETURNS TABLE(success boolean, message text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exp timestamptz := now() + make_interval(mins => GREATEST(1, LEAST(COALESCE(p_minutes, 10), 10)));
  v_existing_exp timestamptz;
  r record;
  v_product public.products%ROWTYPE;
  v_reserved integer := 0;
  v_qty integer := 0;
  v_total_stock integer := 0;
  v_variant_count integer := 0;
  v_variant_stock integer := 0;
  v_variant_available integer := 0;
  v_color_key text;
  v_size_key text;
BEGIN
  IF COALESCE(trim(p_reference), '') = '' OR length(p_reference) > 200 THEN
    RETURN QUERY SELECT false, 'Falta una referencia de reserva válida.', NULL::timestamptz;
    RETURN;
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RETURN QUERY SELECT false, 'El carrito debe ser una lista de productos.', NULL::timestamptz;
    RETURN;
  END IF;
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50 THEN
    RETURN QUERY SELECT false, 'El carrito debe contener entre 1 y 50 líneas de productos.', NULL::timestamptz;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS j(value)
     WHERE COALESCE(trim(j.value->>'id'), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR COALESCE(j.value->>'qty', '') !~ '^[0-9]+$'
        OR length(COALESCE(j.value->>'qty', '')) > 3
  ) THEN
    RETURN QUERY SELECT false, 'Una línea del carrito tiene un producto o una cantidad no válidos.', NULL::timestamptz;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS j(value)
     WHERE (j.value->>'qty')::integer < 1 OR (j.value->>'qty')::integer > 100
  ) THEN
    RETURN QUERY SELECT false, 'Cada cantidad debe estar entre 1 y 100 unidades.', NULL::timestamptz;
    RETURN;
  END IF;

  PERFORM public.cleanup_inventory_reservations();
  -- Dos intentos con la misma referencia no pueden reservar dos veces en paralelo.
  PERFORM pg_advisory_xact_lock(hashtext('jm_inventory_reservation:' || p_reference));
  SELECT MAX(ir.expires_at) INTO v_existing_exp
    FROM public.inventory_reservations AS ir
   WHERE ir.reference = p_reference
     AND ((ir.expires_at > now() AND (lower(COALESCE(ir.status, '')) = 'active' OR upper(COALESCE(ir.status, '')) IN ('PENDING','WHATSAPP_RESERVED'))) OR upper(COALESCE(ir.status, '')) = 'WHATSAPP_CONFIRMED');
  IF v_existing_exp IS NOT NULL THEN
    -- No reutilizar una referencia para un carrito distinto. Comparar la suma por
    -- producto/color/talla; si no coincide, devolver error sin insertar reservas.
    IF EXISTS (
      WITH wanted AS (
        SELECT (j.value->>'id')::uuid AS product_id,
               CASE WHEN lower(trim(COALESCE(j.value->>'color',''))) IN ('','sin color') THEN '' ELSE lower(trim(j.value->>'color')) END AS color_key,
               CASE WHEN lower(trim(COALESCE(j.value->>'size',''))) IN ('','unica','única') THEN '' ELSE lower(trim(j.value->>'size')) END AS size_key,
               SUM((j.value->>'qty')::integer)::integer AS qty
          FROM jsonb_array_elements(p_items) AS j(value)
         GROUP BY (j.value->>'id')::uuid,
                  CASE WHEN lower(trim(COALESCE(j.value->>'color',''))) IN ('','sin color') THEN '' ELSE lower(trim(j.value->>'color')) END,
                  CASE WHEN lower(trim(COALESCE(j.value->>'size',''))) IN ('','unica','única') THEN '' ELSE lower(trim(j.value->>'size')) END
      ), held AS (
        SELECT ir.product_id,
               CASE WHEN lower(trim(COALESCE(ir.color,''))) IN ('','sin color') THEN '' ELSE lower(trim(ir.color)) END AS color_key,
               CASE WHEN lower(trim(COALESCE(ir.size,''))) IN ('','unica','única') THEN '' ELSE lower(trim(ir.size)) END AS size_key,
               SUM(ir.quantity)::integer AS qty
          FROM public.inventory_reservations AS ir
         WHERE ir.reference = p_reference
           AND ir.expires_at > now()
           AND lower(COALESCE(ir.status,'')) = 'active'
         GROUP BY ir.product_id,
                  CASE WHEN lower(trim(COALESCE(ir.color,''))) IN ('','sin color') THEN '' ELSE lower(trim(ir.color)) END,
                  CASE WHEN lower(trim(COALESCE(ir.size,''))) IN ('','unica','única') THEN '' ELSE lower(trim(ir.size)) END
      )
      SELECT 1
        FROM wanted AS w
        FULL JOIN held AS h
          ON h.product_id = w.product_id
         AND h.color_key = w.color_key
         AND h.size_key = w.size_key
       WHERE w.product_id IS NULL
          OR h.product_id IS NULL
          OR w.qty <> h.qty
    ) THEN
      RETURN QUERY SELECT false, 'Esta referencia ya tiene una reserva activa para otro carrito. Inicia una nueva reserva.', NULL::timestamptz;
      RETURN;
    END IF;

    -- Si solo existe una reserva heredada para la referencia, nunca crear otra encima.
    IF EXISTS (
      SELECT 1 FROM public.inventory_reservations AS ir
       WHERE ir.reference = p_reference
         AND ir.expires_at > now()
         AND upper(COALESCE(ir.status,'')) IN ('PENDING','WHATSAPP_RESERVED','WHATSAPP_CONFIRMED')
    ) THEN
      RETURN QUERY SELECT false, 'Esta referencia pertenece a una reserva anterior. Inicia un nuevo intento de compra.', NULL::timestamptz;
      RETURN;
    END IF;

    RETURN QUERY SELECT true, 'La reserva existente sigue activa; no se duplicó.', v_existing_exp;
    RETURN;
  END IF;

  -- No crear una reserva nueva encima de una reserva heredada de la misma referencia.
  IF EXISTS (
    SELECT 1 FROM public.inventory_reservations AS ir
     WHERE ir.reference = p_reference
       AND ir.expires_at > now()
       AND upper(COALESCE(ir.status,'')) IN ('PENDING','WHATSAPP_RESERVED','WHATSAPP_CONFIRMED')
  ) THEN
    RETURN QUERY SELECT false, 'Esta referencia pertenece a una reserva anterior. Inicia un nuevo intento de compra.', NULL::timestamptz;
    RETURN;
  END IF;

  -- Bloquear productos siempre en orden de UUID para reducir interbloqueos.
  FOR r IN
    SELECT DISTINCT (j.value->>'id')::uuid AS product_id
      FROM jsonb_array_elements(p_items) AS j(value)
     ORDER BY product_id
  LOOP
    SELECT p.* INTO v_product
      FROM public.products AS p
     WHERE p.id = r.product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'Uno de los productos ya no existe.', NULL::timestamptz;
      RETURN;
    END IF;
  END LOOP;

  -- Primero se valida el agregado total del producto, considerando todas sus variantes
  -- y todas las reservas activas, para que las reservas antiguas/genéricas tampoco permitan sobreventa.
  FOR r IN
    SELECT (j.value->>'id')::uuid AS product_id,
           SUM((j.value->>'qty')::integer)::integer AS requested_qty
      FROM jsonb_array_elements(p_items) AS j(value)
     GROUP BY (j.value->>'id')::uuid
     ORDER BY product_id
  LOOP
    SELECT p.* INTO v_product FROM public.products AS p WHERE p.id = r.product_id;
    SELECT COALESCE(SUM(ir.quantity), 0)::integer INTO v_reserved
      FROM public.inventory_reservations AS ir
     WHERE ir.product_id = r.product_id AND ((ir.expires_at > now() AND (lower(COALESCE(ir.status, '')) = 'active' OR upper(COALESCE(ir.status, '')) IN ('PENDING','WHATSAPP_RESERVED'))) OR upper(COALESCE(ir.status, '')) = 'WHATSAPP_CONFIRMED');

    IF jsonb_typeof(COALESCE(v_product.variants, '[]'::jsonb)) = 'array'
       AND jsonb_array_length(COALESCE(v_product.variants, '[]'::jsonb)) > 0 THEN
      SELECT COALESCE(SUM(GREATEST(0, COALESCE((v.value->>'stock')::integer, 0))), 0)::integer
        INTO v_total_stock
        FROM jsonb_array_elements(v_product.variants) AS v(value);
    ELSE
      v_total_stock := GREATEST(0, COALESCE(v_product.quantity, 0));
    END IF;

    IF GREATEST(0, v_total_stock - v_reserved) < r.requested_qty THEN
      RETURN QUERY SELECT false, 'No hay suficientes unidades disponibles; una parte del producto está reservada por otro pedido.', NULL::timestamptz;
      RETURN;
    END IF;
  END LOOP;

  -- Validar cada combinación por separado. Las reservas ambiguas antiguas (color/talla vacíos)
  -- se asignan de forma determinista al stock visible, sin descontar todos los colores a la vez.
  FOR r IN
    SELECT (j.value->>'id')::uuid AS product_id,
           MAX(trim(COALESCE(j.value->>'color', ''))) AS color,
           MAX(trim(COALESCE(j.value->>'size', ''))) AS size,
           CASE WHEN lower(trim(COALESCE(j.value->>'color', ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(j.value->>'color')) END AS color_key,
           CASE WHEN lower(trim(COALESCE(j.value->>'size', ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(j.value->>'size')) END AS size_key,
           SUM((j.value->>'qty')::integer)::integer AS requested_qty
      FROM jsonb_array_elements(p_items) AS j(value)
     GROUP BY (j.value->>'id')::uuid,
              CASE WHEN lower(trim(COALESCE(j.value->>'color', ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(j.value->>'color')) END,
              CASE WHEN lower(trim(COALESCE(j.value->>'size', ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(j.value->>'size')) END
     ORDER BY product_id, color_key, size_key
  LOOP
    SELECT p.* INTO v_product FROM public.products AS p WHERE p.id = r.product_id;
    IF jsonb_typeof(COALESCE(v_product.variants, '[]'::jsonb)) = 'array'
       AND jsonb_array_length(COALESCE(v_product.variants, '[]'::jsonb)) > 0 THEN
      WITH variant_base AS (
        SELECT v.value AS variant, v.ordinality,
               CASE WHEN lower(trim(COALESCE(v.value->>'color', ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(v.value->>'color')) END AS color_key,
               CASE WHEN lower(trim(COALESCE(v.value->>'size', ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(v.value->>'size')) END AS size_key,
               GREATEST(0, COALESCE((v.value->>'stock')::integer, 0) - COALESCE(sr.reserved_qty, 0))::integer AS stock_after_specific
          FROM jsonb_array_elements(v_product.variants) WITH ORDINALITY AS v(value, ordinality)
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
              FROM public.inventory_reservations AS ir
             WHERE ir.product_id = r.product_id AND ((ir.expires_at > now() AND (lower(COALESCE(ir.status, '')) = 'active' OR upper(COALESCE(ir.status, '')) IN ('PENDING','WHATSAPP_RESERVED'))) OR upper(COALESCE(ir.status, '')) = 'WHATSAPP_CONFIRMED')
               AND NOT (COALESCE(trim(ir.color), '') = '' AND COALESCE(trim(ir.size), '') = '')
               AND (CASE WHEN lower(trim(COALESCE(ir.color, ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(ir.color)) END) =
                   (CASE WHEN lower(trim(COALESCE(v.value->>'color', ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(v.value->>'color')) END)
               AND (CASE WHEN lower(trim(COALESCE(ir.size, ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(ir.size)) END) =
                   (CASE WHEN lower(trim(COALESCE(v.value->>'size', ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(v.value->>'size')) END)
          ) AS sr ON true
      ), variant_available AS (
        SELECT vb.*,
               GREATEST(0, vb.stock_after_specific - LEAST(
                 vb.stock_after_specific,
                 GREATEST(0, COALESCE(gr.reserved_qty, 0) - COALESCE(SUM(vb.stock_after_specific) OVER (
                   ORDER BY vb.ordinality ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                 ), 0))
               ))::integer AS available_stock
          FROM variant_base AS vb
          CROSS JOIN LATERAL (
            SELECT COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
              FROM public.inventory_reservations AS ir
             WHERE ir.product_id = r.product_id AND ((ir.expires_at > now() AND (lower(COALESCE(ir.status, '')) = 'active' OR upper(COALESCE(ir.status, '')) IN ('PENDING','WHATSAPP_RESERVED'))) OR upper(COALESCE(ir.status, '')) = 'WHATSAPP_CONFIRMED')
               AND COALESCE(trim(ir.color), '') = '' AND COALESCE(trim(ir.size), '') = ''
          ) AS gr
      )
      SELECT COUNT(*)::integer, COALESCE(MAX(va.available_stock), 0)::integer
        INTO v_variant_count, v_variant_available
        FROM variant_available AS va
       WHERE va.color_key = r.color_key AND va.size_key = r.size_key;

      IF v_variant_count = 0 THEN
        RETURN QUERY SELECT false, 'La combinación de color/talla ya no existe. Recarga el catálogo y vuelve a intentarlo.', NULL::timestamptz;
        RETURN;
      ELSIF v_variant_count > 1 THEN
        RETURN QUERY SELECT false, 'Hay variantes duplicadas con el mismo color/talla. Revisa el inventario antes de vender.', NULL::timestamptz;
        RETURN;
      ELSIF v_variant_available < r.requested_qty THEN
        RETURN QUERY SELECT false, 'Esa talla/color está agotada o reservada por otro cliente.', NULL::timestamptz;
        RETURN;
      END IF;
    END IF;
  END LOOP;

  -- Una fila por combinación seleccionada, no una reserva general por producto.
  INSERT INTO public.inventory_reservations(reference, product_id, quantity, color, size, expires_at, status)
  SELECT p_reference,
         (j.value->>'id')::uuid,
         SUM((j.value->>'qty')::integer)::integer,
         MAX(trim(COALESCE(j.value->>'color', ''))),
         MAX(trim(COALESCE(j.value->>'size', ''))),
         v_exp,
         'active'
    FROM jsonb_array_elements(p_items) AS j(value)
   GROUP BY (j.value->>'id')::uuid,
            CASE WHEN lower(trim(COALESCE(j.value->>'color', ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(j.value->>'color')) END,
            CASE WHEN lower(trim(COALESCE(j.value->>'size', ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(j.value->>'size')) END;

  RETURN QUERY SELECT true, 'Inventario reservado durante 10 minutos por color/talla.', v_exp;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'No se pudo reservar el inventario: ' || SQLERRM, NULL::timestamptz;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.release_inventory_reservation(p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.inventory_reservations
     set status = 'RELEASED'
   where reference = p_reference
     and lower(coalesce(status,'')) = 'active';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_inventory_reservations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
begin
  -- Las reservas lógicas vencidas se cierran sin alterar el stock físico.
  update public.inventory_reservations ir
     set status = 'EXPIRED'
   where lower(coalesce(ir.status, '')) = 'active'
     and ir.expires_at <= now();

  -- Las reservas heredadas que descontaban quantity se restituyen una vez.
  -- Bloqueamos las filas para evitar que dos llamadas de limpieza las restituyan dos veces.
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
$function$
;
