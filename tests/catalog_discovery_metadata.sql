-- Regresión de solo lectura para la RPC de metadata de novedad.
-- No crea productos, reservas, pedidos ni modifica configuración.
DO $test$
DECLARE
  metadata_rows bigint;
  product_rows bigint;
BEGIN
  IF has_function_privilege('public','public.get_public_catalog_created_at()','EXECUTE') THEN
    RAISE EXCEPTION 'La RPC de metadata conserva ejecución para PUBLIC';
  END IF;
  IF NOT has_function_privilege('anon','public.get_public_catalog_created_at()','EXECUTE') THEN
    RAISE EXCEPTION 'anon no puede leer metadata pública del catálogo';
  END IF;
  IF NOT has_function_privilege('authenticated','public.get_public_catalog_created_at()','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated no puede leer metadata pública del catálogo';
  END IF;
  IF NOT has_function_privilege('service_role','public.get_public_catalog_created_at()','EXECUTE') THEN
    RAISE EXCEPTION 'service_role no puede leer metadata del catálogo';
  END IF;

  SELECT count(*) INTO metadata_rows
    FROM public.get_public_catalog_created_at()
    LIMIT 1;
  SELECT count(*) INTO product_rows
    FROM public.products
    LIMIT 1;
  IF metadata_rows IS DISTINCT FROM product_rows THEN
    RAISE EXCEPTION 'La RPC de ordenación no cubre exactamente las filas públicas de productos';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.get_public_catalog_created_at()
    WHERE id IS NULL
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'La RPC devolvió un ID nulo';
  END IF;
END;
$test$;
