-- Permite al administrador revisar pagos aprobados que quedaron pendientes de conciliación.
-- No permite al catálogo público leer datos de pagos ni modificar conciliaciones.
DROP POLICY IF EXISTS sirevya_wompi_reconciliation_admin_read ON public.sirevya_wompi_inventory_reconciliation;
CREATE POLICY sirevya_wompi_reconciliation_admin_read
  ON public.sirevya_wompi_inventory_reconciliation
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = (SELECT admin_user_id FROM public.store_settings WHERE id = 1)
  );

CREATE INDEX IF NOT EXISTS sirevya_wompi_reconciliation_status_idx
  ON public.sirevya_wompi_inventory_reconciliation (reconciliation_status, last_seen_at DESC);
