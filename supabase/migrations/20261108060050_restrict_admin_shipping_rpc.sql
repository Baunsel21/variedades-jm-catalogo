-- Corrige los grants efectivos del RPC administrativo de envíos.
-- No cambia datos ni la comprobación is_store_admin(); el panel usa authenticated.
REVOKE ALL ON FUNCTION public.admin_save_storefront_shipping_settings(bigint,bigint)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_storefront_shipping_settings(bigint,bigint)
  TO authenticated;
