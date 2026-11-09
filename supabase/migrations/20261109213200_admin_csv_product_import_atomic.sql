-- Candidate only. Do not apply to the shared production project before a verified restore rehearsal.
-- Uses the existing products(user_id, code) unique index and RLS; inserts new products only.
CREATE FUNCTION public.admin_import_products_csv(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row record;
  v_value jsonb;
  v_code text;
  v_name text;
  v_category text;
  v_cost_text text;
  v_sale_text text;
  v_quantity_text text;
  v_errors jsonb := '[]'::jsonb;
  v_duplicates jsonb;
  v_inserted integer := 0;
  v_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CSV_IMPORT_AUTH_REQUIRED';
  END IF;
  IF public.is_store_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CSV_IMPORT_ADMIN_REQUIRED';
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

  -- Validate the complete payload before any write. Error payloads contain only row/field/code,
  -- never customer data or submitted product values.
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
      WHERE key_name NOT IN ('row', 'code', 'name', 'category', 'cost', 'sale_price', 'quantity')
    ) OR NOT (v_value ?& ARRAY['row', 'code', 'name', 'category', 'cost', 'sale_price', 'quantity']) THEN
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
       OR jsonb_typeof(v_value->'quantity') IS DISTINCT FROM 'number' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row.ordinality + 1, 'field', 'fila', 'code', 'CSV_TYPES_INVALID',
        'message', 'Una fila contiene tipos de datos no válidos.'
      ));
      CONTINUE;
    END IF;

    v_code := v_value->>'code';
    v_name := v_value->>'name';
    v_category := v_value->>'category';
    v_cost_text := v_value->>'cost';
    v_sale_text := v_value->>'sale_price';
    v_quantity_text := v_value->>'quantity';

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
      CONTINUE;
    END IF;

    IF v_cost_text !~ '^(0|[1-9][0-9]*)$'
       OR v_sale_text !~ '^(0|[1-9][0-9]*)$'
       OR v_quantity_text !~ '^(0|[1-9][0-9]*)$'
       OR length(v_cost_text) > 16
       OR length(v_sale_text) > 16
       OR length(v_quantity_text) > 10 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row.ordinality + 1, 'field', 'cost/sale_price/quantity', 'code', 'CSV_INTEGER_INVALID',
        'message', 'Costo, precio y cantidad deben ser enteros no negativos dentro de rango.'
      ));
      CONTINUE;
    END IF;
    IF v_cost_text::numeric > 9007199254740991
       OR v_sale_text::numeric > 9007199254740991
       OR v_quantity_text::numeric > 2147483647 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row.ordinality + 1, 'field', 'cost/sale_price/quantity', 'code', 'CSV_INTEGER_INVALID',
        'message', 'Costo, precio y cantidad deben ser enteros no negativos dentro de rango.'
      ));
      CONTINUE;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errors);
  END IF;

  -- Prevent a concurrent admin insert from racing the normalized-code check. The batch is
  -- bounded above and holds this writer lock only for validation and a single INSERT statement.
  LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;

  WITH payload AS (
    SELECT (value->>'row')::integer AS source_row,
           lower(regexp_replace(normalize(value->>'code', NFKC), '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS normalized_code
    FROM jsonb_array_elements(p_rows) AS e(value)
  ), duplicates AS (
    SELECT normalized_code
    FROM payload GROUP BY normalized_code HAVING count(*) > 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'row', payload.source_row, 'field', 'code', 'code', 'DUPLICATE_CODE_IN_FILE',
    'message', 'El código se repite dentro del archivo.'
  ) ORDER BY payload.source_row), '[]'::jsonb)
  INTO v_duplicates
  FROM payload
  JOIN duplicates USING (normalized_code);

  IF jsonb_array_length(v_duplicates) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_duplicates);
  END IF;

  WITH payload AS (
    SELECT (value->>'row')::integer AS source_row,
           lower(regexp_replace(normalize(value->>'code', NFKC), '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS normalized_code
    FROM jsonb_array_elements(p_rows) AS e(value)
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

  INSERT INTO public.products (user_id, code, name, category, cost_price, sale_price, quantity)
  SELECT v_user_id,
         value->>'code',
         value->>'name',
         value->>'category',
         (value->>'cost')::numeric,
         (value->>'sale_price')::numeric,
         (value->>'quantity')::integer
  FROM jsonb_array_elements(p_rows) AS e(value);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_import_products_csv(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_import_products_csv(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.admin_import_products_csv(jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_import_products_csv(jsonb) TO authenticated;

COMMENT ON FUNCTION public.admin_import_products_csv(jsonb) IS
  'Atomic insert-only CSV import for authenticated store admins. Respects products RLS; no updates or variants/images.';
