BEGIN;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
SET LOCAL request.jwt.claim.is_admin = 'true';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  result jsonb;
  row_count integer;
  large_payload jsonb;
BEGIN
  IF has_function_privilege('anon', 'public.admin_import_products_csv(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute the import RPC';
  END IF;
  IF has_function_privilege('service_role', 'public.admin_import_products_csv(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role is not a browser import caller';
  END IF;

  result := public.admin_import_products_csv('[
    {"row":2,"code":"SKU-001","name":"Vestido Uno","category":"Vestidos","cost":12000,"sale_price":25000,"quantity":2},
    {"row":3,"code":"SKU-002","name":"Vestido Dos","category":"Vestidos","cost":15000,"sale_price":31000,"quantity":1}
  ]'::jsonb);
  IF result->>'ok' IS DISTINCT FROM 'true' OR (result->>'inserted')::integer <> 2 THEN
    RAISE EXCEPTION 'expected two inserted rows, got %', result;
  END IF;

  SELECT count(*) INTO row_count FROM public.products WHERE user_id = auth.uid();
  IF row_count <> 2 THEN RAISE EXCEPTION 'expected two rows after commit, got %', row_count; END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE code='SKU-001' AND (variants <> '[]'::jsonb OR colors <> '{}' OR sizes <> '{}')) THEN
    RAISE EXCEPTION 'default variant/color/size payload changed';
  END IF;

  result := public.admin_import_products_csv('[
    {"row":2,"code":"SKU-NEW","name":"Nuevo","category":"Otros","cost":100,"sale_price":200,"quantity":1},
    {"row":3,"code":" sku-001 ","name":"Duplicado","category":"Otros","cost":100,"sale_price":200,"quantity":1}
  ]'::jsonb);
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"EXISTING_CODE"}]'::jsonb) THEN
    RAISE EXCEPTION 'existing-code batch should fail atomically, got %', result;
  END IF;
  SELECT count(*) INTO row_count FROM public.products WHERE user_id = auth.uid();
  IF row_count <> 2 OR EXISTS (SELECT 1 FROM public.products WHERE code='SKU-NEW') THEN
    RAISE EXCEPTION 'invalid batch partially inserted a row';
  END IF;

  result := public.admin_import_products_csv('[
    {"row":2,"code":"\u00a0SKU-X\u00a0","name":"Primero","category":"Otros","cost":1,"sale_price":2,"quantity":1},
    {"row":3,"code":"sku-x","name":"Segundo","category":"Otros","cost":1,"sale_price":2,"quantity":1}
  ]'::jsonb);
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"DUPLICATE_CODE_IN_FILE"}]'::jsonb) THEN
    RAISE EXCEPTION 'normalized in-file duplicate should fail, got %', result;
  END IF;
  SELECT count(*) INTO row_count FROM public.products WHERE user_id = auth.uid();
  IF row_count <> 2 THEN RAISE EXCEPTION 'duplicate batch changed the table'; END IF;

  result := public.admin_import_products_csv('[
    {"row":2,"code":"SKU-BAD","name":"\u00a0=HYPERLINK(1)","category":"Otros","cost":1,"sale_price":2,"quantity":1}
  ]'::jsonb);
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"CSV_TEXT_INVALID"}]'::jsonb) THEN
    RAISE EXCEPTION 'formula text should be rejected, got %', result;
  END IF;
  SELECT count(*) INTO row_count FROM public.products WHERE user_id = auth.uid();
  IF row_count <> 2 THEN RAISE EXCEPTION 'formula row changed the table'; END IF;

  result := public.admin_import_products_csv('[
    {"row":2,"code":"SKU-BAD","name":"Nombre","category":"Otros","cost":100000000000000000000,"sale_price":2,"quantity":2147483648}
  ]'::jsonb);
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"CSV_INTEGER_INVALID"}]'::jsonb) THEN
    RAISE EXCEPTION 'out-of-range numeric values should return validation errors, got %', result;
  END IF;

  result := public.admin_import_products_csv('[
    {"row":2,"code":"SKU-BAD","name":"Nombre","category":"Otros","cost":1,"sale_price":2,"quantity":1,"variants":[{"color":"x"}]}
  ]'::jsonb);
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"CSV_FIELDS_NOT_ALLOWED"}]'::jsonb) THEN
    RAISE EXCEPTION 'unapproved variant data should be rejected, got %', result;
  END IF;

  result := public.admin_import_products_csv('[]'::jsonb);
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"IMPORT_LIMIT_EXCEEDED"}]'::jsonb) THEN
    RAISE EXCEPTION 'empty import should fail closed, got %', result;
  END IF;
  SELECT count(*) INTO row_count FROM public.products WHERE user_id = auth.uid();
  IF row_count <> 2 THEN RAISE EXCEPTION 'empty RPC readiness probe changed the table'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'row', n + 1, 'code', 'LIMIT-' || n, 'name', 'Producto', 'category', 'Otros',
    'cost', 1, 'sale_price', 2, 'quantity', 1
  )) INTO large_payload FROM generate_series(1, 251) AS n;
  result := public.admin_import_products_csv(large_payload);
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"IMPORT_LIMIT_EXCEEDED"}]'::jsonb) THEN
    RAISE EXCEPTION 'oversized row count should fail closed, got %', result;
  END IF;

  SELECT jsonb_build_array(jsonb_build_object(
    'row', 2, 'code', 'LARGE', 'name', string_agg(md5(g::text), ''), 'category', 'Otros',
    'cost', 1, 'sale_price', 2, 'quantity', 1
  )) INTO large_payload FROM generate_series(1, 33000) AS g;
  result := public.admin_import_products_csv(large_payload);
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"IMPORT_LIMIT_EXCEEDED"}]'::jsonb) THEN
    RAISE EXCEPTION 'oversized payload should fail closed, got %', result;
  END IF;
END;
$$;

SET LOCAL request.jwt.claim.is_admin = 'false';
DO $$
DECLARE
  denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.admin_import_products_csv('[
      {"row":2,"code":"SKU-NON-ADMIN","name":"No autorizado","category":"Otros","cost":1,"sale_price":2,"quantity":1}
    ]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'RLS should reject non-admin import'; END IF;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.admin_import_products_csv('[]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'service_role must not invoke the browser import RPC'; END IF;
END;
$$;
RESET ROLE;
ROLLBACK;
