-- Restore admin order reads through a SECURITY DEFINER helper.
-- No rows are changed and anonymous/public access remains blocked.
CREATE OR REPLACE FUNCTION public.is_store_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND auth.uid() = (SELECT s.admin_user_id FROM public.store_settings AS s WHERE s.id = 1);
$$;

REVOKE ALL ON FUNCTION public.is_store_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_store_admin() TO authenticated;

DROP POLICY IF EXISTS web_orders_authenticated_read ON public.web_orders;
CREATE POLICY web_orders_authenticated_read
  ON public.web_orders
  FOR SELECT
  TO authenticated
  USING (public.is_store_admin());

DROP POLICY IF EXISTS web_orders_authenticated_update ON public.web_orders;
CREATE POLICY web_orders_authenticated_update
  ON public.web_orders
  FOR UPDATE
  TO authenticated
  USING (public.is_store_admin())
  WITH CHECK (public.is_store_admin());
