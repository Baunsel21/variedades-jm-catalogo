-- La vista administrativa usa PostgREST directamente sobre esta tabla.
-- Se permite SELECT solo a sesiones autenticadas y RLS limita las filas al administrador.
DROP POLICY IF EXISTS sirevya_wompi_reconciliation_admin_read
  ON public.sirevya_wompi_inventory_reconciliation;

CREATE POLICY sirevya_wompi_reconciliation_admin_read
  ON public.sirevya_wompi_inventory_reconciliation
  FOR SELECT
  TO authenticated
  USING (public.is_store_admin());

REVOKE SELECT ON TABLE public.sirevya_wompi_inventory_reconciliation FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.sirevya_wompi_inventory_reconciliation TO authenticated;
