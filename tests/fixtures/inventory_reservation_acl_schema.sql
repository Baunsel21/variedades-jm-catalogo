DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END;
$roles$;

GRANT USAGE ON LANGUAGE plpgsql TO anon, authenticated, service_role;

CREATE TABLE public.inventory_reservations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reference text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Stubs de contrato en una base efímera. La migración bajo prueba solo modifica ACL.
CREATE FUNCTION public.release_inventory_reservation(p_reference text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.inventory_reservations
     SET status='RELEASED'
   WHERE reference=p_reference
     AND lower(coalesce(status,''))='active';
END;
$function$;

CREATE FUNCTION public.attach_inventory_reservation(p_old_reference text,p_new_reference text)
RETURNS TABLE(success boolean,message text,expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows integer:=0;
  v_exp timestamptz;
BEGIN
  UPDATE public.inventory_reservations AS ir
     SET reference=p_new_reference
   WHERE ir.reference=p_old_reference
     AND lower(coalesce(ir.status,''))='active'
     AND ir.expires_at>now();
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  SELECT max(ir.expires_at) INTO v_exp
    FROM public.inventory_reservations AS ir
   WHERE ir.reference=p_new_reference
     AND lower(coalesce(ir.status,''))='active'
     AND ir.expires_at>now();
  RETURN QUERY SELECT v_rows>0,
    CASE WHEN v_rows>0 THEN 'Reserva asociada.' ELSE 'No existe reserva activa.' END,
    v_exp;
END;
$function$;

-- Emula el ACL inicial observado en producción antes de la migración.
GRANT EXECUTE ON FUNCTION public.attach_inventory_reservation(text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_inventory_reservation(text) TO anon, authenticated, service_role;

INSERT INTO public.inventory_reservations(reference,status,expires_at) VALUES
  ('JMRES-RELEASE-SYNTHETIC','active',now()+interval '10 minutes'),
  ('JMRES-ATTACH-OLD-SYNTHETIC','active',now()+interval '10 minutes');
