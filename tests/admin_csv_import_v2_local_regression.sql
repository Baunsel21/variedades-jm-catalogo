BEGIN;
CREATE FUNCTION public.test_csv_v2_abort_trigger() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code = 'SKU-V2-ROLLBACK-FAIL' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SYNTHETIC_V2_INSERT_ABORT';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_csv_v2_abort_trigger
BEFORE INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.test_csv_v2_abort_trigger();

SET LOCAL request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
SET LOCAL request.jwt.claim.is_admin = 'true';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  result jsonb;
  row_count integer;
  stored_image text;
  stored_variants jsonb;
  insert_failure_seen boolean := false;
BEGIN
  IF has_function_privilege('anon', 'public.admin_import_products_csv_v2(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute CSV v2';
  END IF;
  IF has_function_privilege('service_role', 'public.admin_import_products_csv_v2(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must not be browser CSV v2 caller';
  END IF;

  result := public.admin_import_products_csv_v2(jsonb_build_array(jsonb_build_object(
    'row', 2, 'code', 'SKU-V2-001', 'name', 'Producto v2 sintético', 'category', 'Ropa',
    'cost', 100, 'sale_price', 200, 'quantity', 3,
    'image_url', 'https://cdn.example.test/main.jpg',
    'variants', jsonb_build_array(
      jsonb_build_object('color', 'Rojo', 'size', 'S', 'stock', 2, 'color_hex', '#aa0022', 'image_path', 'https://cdn.example.test/red-s.jpg'),
      jsonb_build_object('color', 'Rojo', 'size', 'M', 'stock', 1)
    )
  )));
  IF result->>'ok' IS DISTINCT FROM 'true' OR (result->>'inserted')::integer <> 1 THEN
    RAISE EXCEPTION 'expected one CSV v2 row, got %', result;
  END IF;
  SELECT image_url, variants INTO stored_image, stored_variants
  FROM public.products WHERE user_id = auth.uid() AND code = 'SKU-V2-001';
  IF stored_image IS DISTINCT FROM 'https://cdn.example.test/main.jpg'
     OR jsonb_array_length(stored_variants) <> 2
     OR stored_variants->0->>'image_path' IS DISTINCT FROM 'https://cdn.example.test/red-s.jpg'
     OR stored_variants->0->>'color_hex' IS DISTINCT FROM '#aa0022' THEN
    RAISE EXCEPTION 'CSV v2 image/variant payload did not persist in the scratch schema';
  END IF;

  result := public.admin_import_products_csv_v2(jsonb_build_array(
    jsonb_build_object('row', 2, 'code', 'SKU-NEW', 'name', 'Nuevo', 'category', 'Ropa', 'cost', 1, 'sale_price', 2, 'quantity', 1, 'image_url', '', 'variants', '[]'::jsonb),
    jsonb_build_object('row', 3, 'code', ' sku-v2-001 ', 'name', 'Duplicado', 'category', 'Ropa', 'cost', 1, 'sale_price', 2, 'quantity', 1, 'image_url', '', 'variants', '[]'::jsonb)
  ));
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"EXISTING_CODE"}]'::jsonb) THEN
    RAISE EXCEPTION 'existing code must reject entire v2 batch, got %', result;
  END IF;
  SELECT count(*) INTO row_count FROM public.products WHERE user_id = auth.uid();
  IF row_count <> 1 OR EXISTS (SELECT 1 FROM public.products WHERE code = 'SKU-NEW') THEN
    RAISE EXCEPTION 'duplicate batch partially inserted a row';
  END IF;

  result := public.admin_import_products_csv_v2(jsonb_build_array(jsonb_build_object(
    'row', 2, 'code', 'SKU-HTTP', 'name', 'No guardar', 'category', 'Ropa', 'cost', 1, 'sale_price', 2, 'quantity', 1,
    'image_url', 'http://example.test/photo.jpg', 'variants', '[]'::jsonb
  )));
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"IMAGE_URL_INVALID"}]'::jsonb) THEN
    RAISE EXCEPTION 'non-HTTPS image URL must be rejected, got %', result;
  END IF;

  result := public.admin_import_products_csv_v2(jsonb_build_array(jsonb_build_object(
    'row', 2, 'code', 'SKU-BAD-STOCK', 'name', 'No guardar', 'category', 'Ropa', 'cost', 1, 'sale_price', 2, 'quantity', 3,
    'image_url', '', 'variants', jsonb_build_array(jsonb_build_object('color', 'Rojo', 'size', 'S', 'stock', 2))
  )));
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"VARIANTS_STOCK_MISMATCH"}]'::jsonb) THEN
    RAISE EXCEPTION 'variant stock sum must equal product quantity, got %', result;
  END IF;

  result := public.admin_import_products_csv_v2(jsonb_build_array(jsonb_build_object(
    'row', 2, 'code', 'SKU-DUP-VARIANT', 'name', 'No guardar', 'category', 'Ropa', 'cost', 1, 'sale_price', 2, 'quantity', 2,
    'image_url', '', 'variants', jsonb_build_array(
      jsonb_build_object('color', 'Rojo', 'size', 'S', 'stock', 1),
      jsonb_build_object('color', 'rojo', 'size', 's', 'stock', 1)
    )
  )));
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"VARIANTS_INVALID"}]'::jsonb) THEN
    RAISE EXCEPTION 'duplicate normalized variant combination must be rejected, got %', result;
  END IF;

  result := public.admin_import_products_csv_v2(jsonb_build_array(jsonb_build_object(
    'row', 2, 'code', 'SKU-JS-IMAGE', 'name', 'No guardar', 'category', 'Ropa', 'cost', 1, 'sale_price', 2, 'quantity', 1,
    'image_url', '', 'variants', jsonb_build_array(jsonb_build_object('color', 'Rojo', 'size', 'S', 'stock', 1, 'image_path', 'javascript:alert(1)'))
  )));
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"VARIANTS_INVALID"}]'::jsonb) THEN
    RAISE EXCEPTION 'unsafe variant image path must be rejected, got %', result;
  END IF;

  result := public.admin_import_products_csv_v2('[]'::jsonb);
  IF result->>'ok' IS DISTINCT FROM 'false' OR NOT (result->'errors' @> '[{"code":"IMPORT_LIMIT_EXCEEDED"}]'::jsonb) THEN
    RAISE EXCEPTION 'empty readiness probe must not write, got %', result;
  END IF;

  BEGIN
    PERFORM public.admin_import_products_csv_v2(jsonb_build_array(
      jsonb_build_object('row', 2, 'code', 'SKU-V2-ROLLBACK-FIRST', 'name', 'Primero', 'category', 'Ropa', 'cost', 1, 'sale_price', 2, 'quantity', 1, 'image_url', '', 'variants', '[]'::jsonb),
      jsonb_build_object('row', 3, 'code', 'SKU-V2-ROLLBACK-FAIL', 'name', 'Segundo', 'category', 'Ropa', 'cost', 1, 'sale_price', 2, 'quantity', 1, 'image_url', '', 'variants', '[]'::jsonb)
    ));
  EXCEPTION WHEN OTHERS THEN
    insert_failure_seen := SQLERRM = 'SYNTHETIC_V2_INSERT_ABORT';
  END;
  IF NOT insert_failure_seen THEN RAISE EXCEPTION 'synthetic v2 INSERT trigger failure was not propagated'; END IF;
  SELECT count(*) INTO row_count FROM public.products WHERE user_id = auth.uid();
  IF row_count <> 1 OR EXISTS (SELECT 1 FROM public.products WHERE code LIKE 'SKU-V2-ROLLBACK-%') THEN
    RAISE EXCEPTION 'v2 INSERT exception partially committed the batch';
  END IF;
END;
$$;

SET LOCAL request.jwt.claim.is_admin = 'false';
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.admin_import_products_csv_v2('[]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'non-admin must not invoke CSV v2'; END IF;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.admin_import_products_csv_v2('[]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'service_role must not invoke browser CSV v2'; END IF;
END;
$$;
RESET ROLE;
ROLLBACK;
