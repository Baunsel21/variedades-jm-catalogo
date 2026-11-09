-- Las Edge Functions de Wompi usan service_role para liberar reservas después de
-- comprobar el estado del pedido. La tienda ya no llama estos RPC desde el navegador.
-- Falla explícitamente si la base de destino no tiene los contratos esperados.
DO $migration$
BEGIN
  IF to_regprocedure('public.attach_inventory_reservation(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Falta el RPC prerequisite public.attach_inventory_reservation(text,text).';
  END IF;
  IF to_regprocedure('public.release_inventory_reservation(text)') IS NULL THEN
    RAISE EXCEPTION 'Falta el RPC prerequisite public.release_inventory_reservation(text).';
  END IF;
END;
$migration$;

-- SECURITY DEFINER no debe convertir un RPC de reserva en una mutación pública.
-- service_role se revoca y vuelve a conceder para dejar una ACL explícita mínima.
REVOKE ALL PRIVILEGES ON FUNCTION public.attach_inventory_reservation(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.release_inventory_reservation(text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.attach_inventory_reservation(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_inventory_reservation(text) TO service_role;
