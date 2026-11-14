-- Persiste interruptores independientes para Más vendido, Tendencia y Producto Top.
-- Reutiliza la columna JSONB existente y conserva compatibilidad: si enabled falta, se interpreta como true.

CREATE OR REPLACE FUNCTION public.admin_save_storefront_floating_promotions(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth','pg_temp'
AS $function$
DECLARE
  v_admin_user_id uuid;
  v_current jsonb;
  v_enabled boolean;
  v_interval_seconds integer;
  v_visible_seconds integer;
  v_version bigint;
  v_buttons jsonb;
  v_normalized_buttons jsonb := '[]'::jsonb;
  v_button jsonb;
  v_item jsonb;
  v_key text;
  v_label text;
  v_icon text;
  v_background text;
  v_text_color text;
  v_accent text;
  v_appearance text;
  v_category text;
  v_button_enabled boolean;
  v_sort_order integer;
  v_seen_keys text[] := ARRAY[]::text[];
  v_seen_orders integer[] := ARRAY[]::integer[];
BEGIN
  SELECT s.admin_user_id INTO v_admin_user_id
  FROM public.store_settings AS s
  WHERE s.id = 1;
  IF NOT FOUND OR v_admin_user_id IS NULL OR auth.uid() IS DISTINCT FROM v_admin_user_id THEN
    RAISE EXCEPTION 'Se requiere una sesión de administración autorizada.' USING ERRCODE = '42501';
  END IF;

  SELECT p.floating_buttons_config INTO v_current
  FROM public.storefront_promotion_settings AS p
  WHERE p.id = 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe la configuración singleton de promociones.' USING ERRCODE = 'P0002';
  END IF;

  IF p_config IS NULL OR jsonb_typeof(p_config) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'La configuración debe ser un objeto JSON.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_config->'enabled') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'El campo enabled debe ser booleano.' USING ERRCODE = '22023';
  END IF;
  v_enabled := (p_config->>'enabled')::boolean;

  IF jsonb_typeof(p_config->'interval_seconds') IS DISTINCT FROM 'number'
     OR coalesce(p_config->>'interval_seconds', '') !~ '^[0-9]{1,4}$' THEN
    RAISE EXCEPTION 'El intervalo debe ser un número entero entre 10 y 7200 segundos.' USING ERRCODE = '22023';
  END IF;
  v_interval_seconds := (p_config->>'interval_seconds')::integer;
  IF v_interval_seconds < 10 OR v_interval_seconds > 7200 THEN
    RAISE EXCEPTION 'El intervalo debe estar entre 10 y 7200 segundos.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_config->'visible_seconds') IS DISTINCT FROM 'number'
     OR coalesce(p_config->>'visible_seconds', '') !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'La duración visible debe ser un número entero entre 1 y 30 segundos.' USING ERRCODE = '22023';
  END IF;
  v_visible_seconds := (p_config->>'visible_seconds')::integer;
  IF v_visible_seconds < 1 OR v_visible_seconds > 30 THEN
    RAISE EXCEPTION 'La duración visible debe estar entre 1 y 30 segundos.' USING ERRCODE = '22023';
  END IF;

  v_buttons := p_config->'buttons';
  IF jsonb_typeof(v_buttons) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'La campaña debe contener una lista de botones.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_buttons) <> 3 THEN
    RAISE EXCEPTION 'La campaña debe contener exactamente tres botones.' USING ERRCODE = '22023';
  END IF;

  FOR v_button IN SELECT value FROM jsonb_array_elements(v_buttons)
  LOOP
    IF jsonb_typeof(v_button) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Cada botón debe ser un objeto JSON.' USING ERRCODE = '22023';
    END IF;

    v_key := coalesce(v_button->>'key', '');
    IF v_key NOT IN ('best_selling','trending','top_product') OR v_key = ANY(v_seen_keys) THEN
      RAISE EXCEPTION 'Los tres botones deben tener claves únicas y reconocidas.' USING ERRCODE = '22023';
    END IF;
    v_seen_keys := array_append(v_seen_keys, v_key);

    v_label := btrim(coalesce(v_button->>'label', ''));
    IF v_label = '' OR char_length(v_label) > 32 OR v_label ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Cada botón necesita una etiqueta de 1 a 32 caracteres.' USING ERRCODE = '22023';
    END IF;

    v_icon := btrim(coalesce(v_button->>'icon', ''));
    IF v_icon = '' OR char_length(v_icon) > 8 OR v_icon ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Cada botón necesita un icono corto.' USING ERRCODE = '22023';
    END IF;

    v_background := lower(btrim(coalesce(v_button->>'background_color', '')));
    v_text_color := lower(btrim(coalesce(v_button->>'text_color', '')));
    v_accent := lower(btrim(coalesce(v_button->>'accent_color', '')));
    IF v_background !~ '^#[0-9a-f]{6}$' OR v_text_color !~ '^#[0-9a-f]{6}$' OR v_accent !~ '^#[0-9a-f]{6}$' THEN
      RAISE EXCEPTION 'Los colores de cada botón deben usar formato HEX #RRGGBB.' USING ERRCODE = '22023';
    END IF;

    v_appearance := coalesce(v_button->>'appearance', '');
    IF v_appearance NOT IN ('gold','solid','outline') THEN
      RAISE EXCEPTION 'El estilo del botón no está permitido.' USING ERRCODE = '22023';
    END IF;

    IF v_button ? 'enabled' THEN
      IF jsonb_typeof(v_button->'enabled') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'El estado enabled de cada botón debe ser booleano.' USING ERRCODE = '22023';
      END IF;
      v_button_enabled := (v_button->>'enabled')::boolean;
    ELSE
      v_button_enabled := true;
    END IF;

    v_category := btrim(coalesce(v_button->>'target_category', ''));
    IF v_enabled AND v_button_enabled AND (v_category = '' OR NOT EXISTS (
      SELECT 1 FROM public.products AS p
      WHERE p.user_id = v_admin_user_id
        AND p.category = v_category
    )) THEN
      RAISE EXCEPTION 'Cada destino debe corresponder a una categoría existente con productos.' USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_button->'sort_order') IS DISTINCT FROM 'number'
       OR coalesce(v_button->>'sort_order', '') !~ '^[1-3]$' THEN
      RAISE EXCEPTION 'El orden de cada botón debe ser 1, 2 o 3.' USING ERRCODE = '22023';
    END IF;
    v_sort_order := (v_button->>'sort_order')::integer;
    IF v_sort_order = ANY(v_seen_orders) THEN
      RAISE EXCEPTION 'El orden de los tres botones debe ser único.' USING ERRCODE = '22023';
    END IF;
    v_seen_orders := array_append(v_seen_orders, v_sort_order);

    v_item := jsonb_build_object(
      'key', v_key,
      'enabled', v_button_enabled,
      'label', v_label,
      'icon', v_icon,
      'background_color', v_background,
      'text_color', v_text_color,
      'accent_color', v_accent,
      'appearance', v_appearance,
      'target_category', v_category,
      'sort_order', v_sort_order
    );
    v_normalized_buttons := v_normalized_buttons || jsonb_build_array(v_item);
  END LOOP;

  IF cardinality(v_seen_keys) <> 3
     OR NOT ('best_selling' = ANY(v_seen_keys))
     OR NOT ('trending' = ANY(v_seen_keys))
     OR NOT ('top_product' = ANY(v_seen_keys))
     OR cardinality(v_seen_orders) <> 3 THEN
    RAISE EXCEPTION 'La campaña requiere las claves y el orden 1–3 sin duplicados.' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(value ORDER BY (value->>'sort_order')::integer), '[]'::jsonb)
    INTO v_normalized_buttons
  FROM jsonb_array_elements(v_normalized_buttons);

  IF coalesce(v_current->>'campaign_version', '') ~ '^[0-9]{1,18}$' THEN
    v_version := (v_current->>'campaign_version')::bigint;
  ELSE
    v_version := 0;
  END IF;
  IF v_version >= 9223372036854775806 THEN
    RAISE EXCEPTION 'No se puede incrementar la versión de campaña.' USING ERRCODE = '22003';
  END IF;
  v_version := v_version + 1;

  v_current := jsonb_build_object(
    'enabled', v_enabled,
    'interval_seconds', v_interval_seconds,
    'visible_seconds', v_visible_seconds,
    'campaign_version', v_version,
    'buttons', v_normalized_buttons
  );

  -- No tocar updated_at/updated_by: pertenecen también al popup estacional existente.
  UPDATE public.storefront_promotion_settings
  SET floating_buttons_config = v_current
  WHERE id = 1;

  RETURN jsonb_build_object('success', true, 'campaign', v_current);
END;
$function$;

COMMENT ON FUNCTION public.admin_save_storefront_floating_promotions(jsonb) IS
  'Guarda la campaña flotante y el estado independiente de cada botón; preserva el popup estacional.';

NOTIFY pgrst, 'reload schema';
