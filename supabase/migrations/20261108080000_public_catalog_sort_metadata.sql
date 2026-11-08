-- Metadata mínima y no sensible para ordenar el catálogo por fecha de creación.
-- No cambia la cotización, el stock, las variantes ni el catálogo base.
CREATE OR REPLACE FUNCTION public.get_public_catalog_created_at()
RETURNS TABLE(id uuid, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p.id, p.created_at
  FROM public.products AS p
  ORDER BY p.created_at DESC NULLS LAST, p.id;
$function$;

REVOKE ALL ON FUNCTION public.get_public_catalog_created_at()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_catalog_created_at()
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_public_catalog_created_at() IS
  'Returns only public product IDs and creation timestamps for catalog sorting.';
