-- Cambiar pagos online es una operación administrativa global.
-- La función ya valida al administrador, pero anon no necesita poder invocarla.
REVOKE EXECUTE ON FUNCTION public.set_online_payment_status(boolean) FROM anon;
