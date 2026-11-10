-- Candidate only. Do not apply to the shared production project before a verified restore rehearsal
-- and an explicit migration-history reconciliation. This adds a versioned RPC; v1 remains untouched.
DO $$
BEGIN
  IF to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION 'CSV_V2_PREFLIGHT_PRODUCTS_TABLE_MISSING';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('public.is_store_admin()') IS NULL THEN
    RAISE EXCEPTION 'CSV_V2_PREFLIGHT_AUTH_HELPER_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.products'::regclass AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'CSV_V2_PREFLIGHT_PRODUCTS_RLS_DISABLED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='user_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='code' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='name' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='category' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='cost_price' AND data_type='numeric'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='sale_price' AND data_type='numeric'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='quantity' AND data_type='integer'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='image_url' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='variants' AND data_type='jsonb'
  ) THEN
    RAISE EXCEPTION 'CSV_V2_PREFLIGHT_PRODUCTS_COLUMN_CONTRACT_MISMATCH';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_import_products_csv_v2(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_errors jsonb := '[]'::jsonb;
  v_duplicates jsonb;
  v_normalized_rows jsonb := '[]'::jsonb;
  v_row record;
  v_value jsonb;
  v_variant record;
  v_variant_value jsonb;
  v_variant_color text;
  v_variant_size text;
  v_variant_stock_text text;
  v_variant_stock numeric;
  v_variant_total numeric;
  v_variant_key text;
  v_seen_variants text[];
  v_clean_variant jsonb;
  v_clean_variants jsonb;
  v_row_object jsonb;
  v_row_invalid boolean;
  v_code text;
  v_name text;
  v_category text;
  v_image_url text;
  -- Validación sintáctica local; no resuelve hosts ni realiza solicitudes de red.
  v_https_url_pattern CONSTANT text := '^https://([^:/?#@[:space:]]+|\[[0-9A-Fa-f:.]+\])(:0*([1-9]|[1-9][0-9]|[1-9][0-9]{2}|[1-9][0-9]{3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?(/[^[:space:]]*)?(\?[^[:space:]]*)?(#[^[:space:]]*)?$';
  v_cost_text text;
  v_sale_text text;
  v_quantity_text text;
  v_count integer;
  v_inserted integer := 0;
BEGIN
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CSV_V2_AUTHENTICATED_ROLE_REQUIRED';
  END IF;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CSV_V2_AUTH_REQUIRED';
  END IF;
  IF public.is_store_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CSV_V2_ADMIN_REQUIRED';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object(
      'row', 0, 'field', 'archivo', 'code', 'INVALID_PAYLOAD',
      'message', 'El contenido de importación no tiene el formato esperado.'
    )));
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count < 1 OR v_count > 250 OR pg_column_size(p_rows) > 1048576 THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object(
      'row', 0, 'field', 'archivo', 'code', 'IMPORT_LIMIT_EXCEEDED',
      'message', 'La importación admite de 1 a 250 filas y hasta 1 MiB de datos validados.'
    )));
  END IF;

  -- Validate every row and variant before any write; errors contain only row/field/code.
  FOR v_row IN
    SELECT e.value, e.ordinality
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(value, ordinality)
  LOOP
    v_value := v_row.value;
    IF jsonb_typeof(v_value) IS DISTINCT FROM 'object' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row.ordinality + 1, 'field', 'fila', 'code', 'INVALID_ROW',
        'message', 'La fila no es un objeto válido.'
      ));
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_value) AS k(key_name)
      WHERE key_name NOT IN ('row', 'code', 'name', 'category', 'cost', 'sale_price', 'quantity', 'image_url', 'variants')
    ) OR NOT (v_value ?& ARRAY['row', 'code', 'name', 'category', 'cost', 'sale_price', 'quantity', 'image_url', 'variants']) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row.ordinality + 1, 'field', 'fila', 'code', 'CSV_FIELDS_NOT_ALLOWED',
        'message', 'La fila contiene columnas ausentes o campos no permitidos.'
      ));
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_value->'row') IS DISTINCT FROM 'number'
       OR (v_value->>'row') !~ '^[1-9][0-9]{0,5}$'
       OR jsonb_typeof(v_value->'code') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_value->'name') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_value->'category') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_value->'cost') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_value->'sale_price') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_value->'quantity') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_value->'image_url') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_value->'variants') IS DISTINCT FROM 'array' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row.ordinality + 1, 'field', 'fila', 'code', 'CSV_TYPES_INVALID',
        'message', 'Una fila contiene tipos de datos no válidos.'
      ));
      CONTINUE;
    END IF;

    v_code := v_value->>'code';
    v_name := v_value->>'name';
    v_category := v_value->>'category';
    v_image_url := btrim(v_value->>'image_url');
    v_cost_text := v_value->>'cost';
    v_sale_text := v_value->>'sale_price';
    v_quantity_text := v_value->>'quantity';
    v_row_invalid := false;

    IF regexp_replace(normalize(v_code, NFKC), '^[[:space:]]+|[[:space:]]+$', '', 'g') = ''
       OR regexp_replace(normalize(v_name, NFKC), '^[[:space:]]+|[[:space:]]+$', '', 'g') = ''
       OR regexp_replace(normalize(v_category, NFKC), '^[[:space:]]+|[[:space:]]+$', '', 'g') = ''
       OR octet_length(v_code) > 4096 OR octet_length(v_name) > 4096 OR octet_length(v_category) > 4096
       OR normalize(v_code, NFKC) ~ '^[[:space:]]*[=+@]'
       OR normalize(v_name, NFKC) ~ '^[[:space:]]*[=+@]'
       OR normalize(v_category, NFKC) ~ '^[[:space:]]*[=+@]'
       OR (normalize(v_code, NFKC) ~ '^[[:space:]]*-' AND normalize(v_code, NFKC) !~ '^[[:space:]]*-[0-9]+$')
       OR (normalize(v_name, NFKC) ~ '^[[:space:]]*-' AND normalize(v_name, NFKC) !~ '^[[:space:]]*-[0-9]+$')
       OR (normalize(v_category, NFKC) ~ '^[[:space:]]*-' AND normalize(v_category, NFKC) !~ '^[[:space:]]*-[0-9]+$') THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row.ordinality + 1, 'field', 'code/name/category', 'code', 'CSV_TEXT_INVALID',
        'message', 'Código, nombre y categoría deben ser texto válido y no pueden iniciar con una fórmula.'
      ));
      v_row_invalid := true;
    END IF;

    IF v_cost_text !~ '^(0|[1-9][0-9]*)$' OR v_sale_text !~ '^(0|[1-9][0-9]*)$'
       OR v_quantity_text !~ '^(0|[1-9][0-9]*)$' OR length(v_cost_text) > 16
       OR length(v_sale_text) > 16 OR length(v_quantity_text) > 10 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row.ordinality + 1, 'field', 'cost/sale_price/quantity', 'code', 'CSV_INTEGER_INVALID',
        'message', 'Costo, precio y cantidad deben ser enteros no negativos dentro de rango.'
      ));
      v_row_invalid := true;
    ELSIF v_cost_text::numeric > 9007199254740991 OR v_sale_text::numeric > 9007199254740991
       OR v_quantity_text::numeric > 2147483647 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row.ordinality + 1, 'field', 'cost/sale_price/quantity', 'code', 'CSV_INTEGER_INVALID',
        'message', 'Costo, precio y cantidad deben ser enteros no negativos dentro de rango.'
      ));
      v_row_invalid := true;
    END IF;

    IF octet_length(v_image_url) > 2048 OR v_image_url ~ '[[:cntrl:][:space:]]'
       OR (v_image_url <> '' AND v_image_url !~* v_https_url_pattern) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row.ordinality + 1, 'field', 'image_url', 'code', 'IMAGE_URL_INVALID',
        'message', 'image_url debe estar vacío o ser una URL HTTPS sin credenciales.'
      ));
      v_row_invalid := true;
    END IF;

    IF jsonb_array_length(v_value->'variants') > 100 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_INVALID',
        'message', 'Las variantes admiten hasta 100 combinaciones.'
      ));
      v_row_invalid := true;
    END IF;

    v_clean_variants := '[]'::jsonb;
    v_seen_variants := ARRAY[]::text[];
    v_variant_total := 0;
    FOR v_variant IN SELECT e.value AS item FROM jsonb_array_elements(v_value->'variants') AS e(value)
    LOOP
      v_variant_value := v_variant.item;
      IF jsonb_typeof(v_variant_value) IS DISTINCT FROM 'object' THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_INVALID',
          'message', 'Cada variante debe ser un objeto JSON.'
        ));
        v_row_invalid := true;
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_variant_value) AS k(key_name)
                   WHERE key_name NOT IN ('color', 'size', 'stock', 'color_hex', 'image_path'))
         OR NOT (v_variant_value ?& ARRAY['color', 'size', 'stock']) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_INVALID',
          'message', 'La variante contiene campos ausentes o no permitidos.'
        ));
        v_row_invalid := true;
        CONTINUE;
      END IF;
      IF jsonb_typeof(v_variant_value->'color') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_variant_value->'size') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_variant_value->'stock') IS DISTINCT FROM 'number' THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_INVALID',
          'message', 'Cada variante requiere color/talla de texto y stock numérico; incluye solo campos permitidos.'
        ));
        v_row_invalid := true;
        CONTINUE;
      END IF;

      v_variant_color := btrim(v_variant_value->>'color');
      v_variant_size := btrim(v_variant_value->>'size');
      v_variant_stock_text := v_variant_value->>'stock';
      IF v_variant_stock_text !~ '^(0|[1-9][0-9]*)$' OR length(v_variant_stock_text) > 10 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_INVALID',
          'message', 'Stock de variante debe ser un entero no negativo.'
        ));
        v_row_invalid := true;
        CONTINUE;
      END IF;
      IF v_variant_stock_text::numeric > 2147483647 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_INVALID',
          'message', 'Stock de variante supera el máximo permitido.'
        ));
        v_row_invalid := true;
        CONTINUE;
      END IF;
      IF (v_variant_color = '' AND v_variant_size = '')
         OR octet_length(v_variant_color) > 4096 OR octet_length(v_variant_size) > 4096
         OR normalize(v_variant_color, NFKC) ~ '^[[:space:]]*[=+@]'
         OR normalize(v_variant_size, NFKC) ~ '^[[:space:]]*[=+@]'
         OR (normalize(v_variant_color, NFKC) ~ '^[[:space:]]*-' AND normalize(v_variant_color, NFKC) !~ '^[[:space:]]*-[0-9]+$')
         OR (normalize(v_variant_size, NFKC) ~ '^[[:space:]]*-' AND normalize(v_variant_size, NFKC) !~ '^[[:space:]]*-[0-9]+$') THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_INVALID',
          'message', 'Color, talla y stock de variante no cumplen el formato seguro.'
        ));
        v_row_invalid := true;
        CONTINUE;
      END IF;

      IF v_variant_value ? 'color_hex' AND (jsonb_typeof(v_variant_value->'color_hex') IS DISTINCT FROM 'string'
          OR (v_variant_value->>'color_hex') !~ '^#[0-9A-Fa-f]{6}$') THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_INVALID',
          'message', 'color_hex debe tener formato #RRGGBB.'
        ));
        v_row_invalid := true;
        CONTINUE;
      END IF;

      IF v_variant_value ? 'image_path' AND jsonb_typeof(v_variant_value->'image_path') IS DISTINCT FROM 'string' THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_INVALID',
          'message', 'image_path debe ser texto o quedar omitido.'
        ));
        v_row_invalid := true;
        CONTINUE;
      END IF;
      IF coalesce(v_variant_value->>'image_path', '') <> '' AND
         (octet_length(v_variant_value->>'image_path') > 2048 OR (v_variant_value->>'image_path') ~ '[[:cntrl:][:space:]]'
          OR (v_variant_value->>'image_path') !~* v_https_url_pattern) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_INVALID',
          'message', 'image_path solo admite una URL HTTPS sin credenciales.'
        ));
        v_row_invalid := true;
        CONTINUE;
      END IF;

      v_variant_key := lower(normalize(v_variant_color, NFKC)) || chr(31) || lower(normalize(v_variant_size, NFKC));
      IF v_variant_key = ANY(v_seen_variants) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_INVALID',
          'message', 'La fila repite una combinación de color y talla.'
        ));
        v_row_invalid := true;
        CONTINUE;
      END IF;
      v_seen_variants := array_append(v_seen_variants, v_variant_key);
      v_variant_stock := v_variant_stock_text::numeric;
      v_variant_total := v_variant_total + v_variant_stock;
      v_clean_variant := jsonb_build_object('color', v_variant_color, 'size', v_variant_size, 'stock', v_variant_stock::integer);
      IF v_variant_value ? 'color_hex' THEN
        v_clean_variant := v_clean_variant || jsonb_build_object('color_hex', lower(v_variant_value->>'color_hex'));
      END IF;
      IF coalesce(v_variant_value->>'image_path', '') <> '' THEN
        v_clean_variant := v_clean_variant || jsonb_build_object('image_path', btrim(v_variant_value->>'image_path'));
      END IF;
      v_clean_variants := v_clean_variants || jsonb_build_array(v_clean_variant);
    END LOOP;

    IF jsonb_array_length(v_value->'variants') > 0 AND NOT v_row_invalid THEN
      IF v_variant_total <> v_quantity_text::numeric THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row.ordinality + 1, 'field', 'variants', 'code', 'VARIANTS_STOCK_MISMATCH',
          'message', 'La suma del stock de variantes debe coincidir con quantity.'
        ));
        v_row_invalid := true;
      END IF;
    END IF;

    IF v_row_invalid THEN CONTINUE; END IF;
    v_row_object := jsonb_build_object(
      'row', (v_value->>'row')::integer, 'code', v_code, 'name', v_name, 'category', v_category,
      'cost', v_cost_text::numeric, 'sale_price', v_sale_text::numeric, 'quantity', v_quantity_text::integer,
      'image_url', v_image_url, 'variants', v_clean_variants
    );
    v_normalized_rows := v_normalized_rows || jsonb_build_array(v_row_object);
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errors);
  END IF;

  LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;
  WITH payload AS (
    SELECT (value->>'row')::integer AS source_row,
           lower(regexp_replace(normalize(value->>'code', NFKC), '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS normalized_code
    FROM jsonb_array_elements(v_normalized_rows) AS e(value)
  ), duplicates AS (
    SELECT normalized_code FROM payload GROUP BY normalized_code HAVING count(*) > 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'row', payload.source_row, 'field', 'code', 'code', 'DUPLICATE_CODE_IN_FILE',
    'message', 'El código se repite dentro del archivo.'
  ) ORDER BY payload.source_row), '[]'::jsonb)
  INTO v_duplicates
  FROM payload JOIN duplicates USING (normalized_code);
  IF jsonb_array_length(v_duplicates) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_duplicates);
  END IF;

  WITH payload AS (
    SELECT (value->>'row')::integer AS source_row,
           lower(regexp_replace(normalize(value->>'code', NFKC), '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS normalized_code
    FROM jsonb_array_elements(v_normalized_rows) AS e(value)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'row', payload.source_row, 'field', 'code', 'code', 'EXISTING_CODE',
    'message', 'El código ya existe; no se modificó ningún producto.'
  ) ORDER BY payload.source_row), '[]'::jsonb)
  INTO v_duplicates
  FROM payload
  WHERE EXISTS (
    SELECT 1 FROM public.products existing
    WHERE existing.user_id = v_user_id
      AND lower(regexp_replace(normalize(existing.code, NFKC), '^[[:space:]]+|[[:space:]]+$', '', 'g')) = payload.normalized_code
  );
  IF jsonb_array_length(v_duplicates) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_duplicates);
  END IF;

  INSERT INTO public.products (user_id, code, name, category, cost_price, sale_price, quantity, image_url, variants)
  SELECT v_user_id, value->>'code', value->>'name', value->>'category',
         (value->>'cost')::numeric, (value->>'sale_price')::numeric, (value->>'quantity')::integer,
         NULLIF(value->>'image_url', ''), value->'variants'
  FROM jsonb_array_elements(v_normalized_rows) AS e(value);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_import_products_csv_v2(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_import_products_csv_v2(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.admin_import_products_csv_v2(jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_import_products_csv_v2(jsonb) TO authenticated;
COMMENT ON FUNCTION public.admin_import_products_csv_v2(jsonb) IS
  'Atomic insert-only CSV v2 for authenticated store admins. Validates HTTPS image links and bounded variants; respects RLS; no updates or uploads.';
NOTIFY pgrst, 'reload schema';
