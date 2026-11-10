-- Extiende el singleton público storefront_promotion_settings con una campaña de tres botones.
-- No crea tablas ni modifica la campaña emergente existente. Esta migración solo se versiona
-- y se prueba en PostgreSQL local; no aplicar a producción hasta validar el gate de respaldo.

DO $preflight$
DECLARE
  v_store_settings regclass := to_regclass('public.store_settings');
  v_promotion_settings regclass := to_regclass('public.storefront_promotion_settings');
  v_products regclass := to_regclass('public.products');
  v_admin_type text;
  v_id_type text;
  v_updated_at_type text;
  v_updated_by_type text;
  v_category_type text;
  v_config_type text;
BEGIN
  IF v_store_settings IS NULL OR v_promotion_settings IS NULL OR v_products IS NULL THEN
    RAISE EXCEPTION 'Falta una tabla base requerida; migración cancelada sin cambios';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_admin_type
  FROM pg_attribute a
  WHERE a.attrelid = v_store_settings AND a.attname = 'admin_user_id'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_admin_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'public.store_settings.admin_user_id debe ser uuid; se encontró %', v_admin_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_settings WHERE id = 1 AND admin_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'No existe la fila admin singleton public.store_settings.id=1; migración cancelada';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_id_type
  FROM pg_attribute a
  WHERE a.attrelid = v_promotion_settings AND a.attname = 'id'
    AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_updated_at_type
  FROM pg_attribute a
  WHERE a.attrelid = v_promotion_settings AND a.attname = 'updated_at'
    AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_updated_by_type
  FROM pg_attribute a
  WHERE a.attrelid = v_promotion_settings AND a.attname = 'updated_by'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_id_type IS DISTINCT FROM 'smallint'
     OR v_updated_at_type IS DISTINCT FROM 'timestamp with time zone'
     OR v_updated_by_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'public.storefront_promotion_settings no coincide con el contrato singleton verificado (id %, updated_at %, updated_by %)', v_id_type, v_updated_at_type, v_updated_by_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.storefront_promotion_settings WHERE id = 1) THEN
    RAISE EXCEPTION 'No existe public.storefront_promotion_settings.id=1; migración cancelada sin crear una fila nueva';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = v_products AND a.attname = 'user_id'
      AND a.atttypid = 'uuid'::regtype AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'public.products.user_id debe ser uuid; migración cancelada';
  END IF;
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_category_type
  FROM pg_attribute a
  WHERE a.attrelid = v_products AND a.attname = 'category'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_category_type IS NULL OR v_category_type NOT IN ('text','character varying') THEN
    RAISE EXCEPTION 'public.products.category debe ser text/varchar; se encontró %', v_category_type;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_config_type
  FROM pg_attribute a
  WHERE a.attrelid = v_promotion_settings AND a.attname = 'floating_buttons_config'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_config_type IS NOT NULL AND v_config_type IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'floating_buttons_config ya existe con tipo %, no se modifica', v_config_type;
  END IF;
END;
$preflight$;

ALTER TABLE public.storefront_promotion_settings
  ADD COLUMN IF NOT EXISTS floating_buttons_config jsonb NOT NULL DEFAULT
  '{"enabled":false,"interval_seconds":20,"visible_seconds":3,"campaign_version":0,"buttons":[{"key":"best_selling","label":"Más vendido","icon":"👑","background_color":"#fff8e7","text_color":"#5d4012","accent_color":"#c6a15b","appearance":"gold","target_category":"","sort_order":1},{"key":"trending","label":"Tendencia","icon":"🔥","background_color":"#fff8e7","text_color":"#5d4012","accent_color":"#c6a15b","appearance":"gold","target_category":"","sort_order":2},{"key":"top_product","label":"Producto Top","icon":"⭐","background_color":"#fff8e7","text_color":"#5d4012","accent_color":"#c6a15b","appearance":"gold","target_category":"","sort_order":3}]}'::jsonb;

COMMENT ON COLUMN public.storefront_promotion_settings.floating_buttons_config IS
  'Configuración de una campaña flotante global de tres botones; reutiliza el singleton de promociones y no altera el popup estacional.';

CREATE OR REPLACE FUNCTION public.get_public_storefront_floating_promotions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth','pg_temp'
AS $function$
  SELECT coalesce(
    (
      SELECT jsonb_build_object('success', true, 'campaign', p.floating_buttons_config)
      FROM public.storefront_promotion_settings AS p
      WHERE p.id = 1
      LIMIT 1
    ),
    jsonb_build_object('success', false, 'message', 'La configuración de promociones no está disponible.')
  );
$function$;

COMMENT ON FUNCTION public.get_public_storefront_floating_promotions() IS
  'Devuelve únicamente la configuración pública de los tres botones flotantes del catálogo.';

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

    v_category := btrim(coalesce(v_button->>'target_category', ''));
    IF v_enabled AND (v_category = '' OR NOT EXISTS (
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
  'Guarda solo los tres botones flotantes del singleton de promociones; preserva el popup estacional.';

REVOKE ALL ON FUNCTION public.get_public_storefront_floating_promotions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_floating_promotions() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_save_storefront_floating_promotions(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_storefront_floating_promotions(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
