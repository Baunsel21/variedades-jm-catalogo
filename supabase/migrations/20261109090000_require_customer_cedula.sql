-- Require a non-empty customer document on new COD web_orders without changing
-- historical rows or the public COD RPC signatures/idempotency behavior.
-- Wompi `orders` has no customer_cedula column; its Edge validates the value and
-- sends it to the hosted Wompi legal-id field without persisting it locally.

CREATE OR REPLACE FUNCTION public.enforce_cod_customer_cedula_20261109()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  v_method text := lower(btrim(coalesce(NEW.payment_method, '')));
  v_cedula text := btrim(coalesce(NEW.customer_cedula, ''));
BEGIN
  IF v_method = 'contra entrega' THEN
    IF v_cedula = '' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'CUSTOMER_CEDULA_REQUIRED';
    END IF;
    IF char_length(v_cedula) > 60 OR v_cedula ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'CUSTOMER_CEDULA_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_cod_customer_cedula_20261109() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_cod_customer_cedula_20261109 ON public.web_orders;
CREATE TRIGGER enforce_cod_customer_cedula_20261109
BEFORE INSERT OR UPDATE OF customer_cedula, payment_method
ON public.web_orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_cod_customer_cedula_20261109();
