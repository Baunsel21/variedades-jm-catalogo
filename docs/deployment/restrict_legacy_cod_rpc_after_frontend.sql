-- Aplicar SOLO después de publicar index.html usando create_contra_delivery_order_with_quote
-- y confirmar que la ruta nueva funciona. El RPC legacy no compara el total mostrado.
REVOKE ALL ON FUNCTION public.create_contra_delivery_order(text,text,text,text,text,text,text,text,jsonb)
  FROM PUBLIC,anon,authenticated;
-- Se conserva el acceso de servicio para procesos confiables del servidor.
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order(text,text,text,text,text,text,text,text,jsonb)
  TO service_role;
