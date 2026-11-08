-- Sirevya: endurece el acceso administrativo sin alterar pedidos ni inventario.
-- No modifica filas; solo reemplaza políticas y agrega índices.

-- Solo el administrador configurado puede leer/modificar pedidos desde el panel.
DROP POLICY IF EXISTS web_orders_authenticated_read ON public.web_orders;
CREATE POLICY web_orders_authenticated_read
  ON public.web_orders
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = (SELECT admin_user_id FROM public.store_settings WHERE id = 1)
  );

DROP POLICY IF EXISTS web_orders_authenticated_update ON public.web_orders;
CREATE POLICY web_orders_authenticated_update
  ON public.web_orders
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = (SELECT admin_user_id FROM public.store_settings WHERE id = 1)
  )
  WITH CHECK (
    auth.uid() = (SELECT admin_user_id FROM public.store_settings WHERE id = 1)
  );

-- Las categorías del negocio también quedan limitadas al administrador.
DROP POLICY IF EXISTS categories_select_authenticated ON public.categories;
CREATE POLICY categories_select_authenticated
  ON public.categories
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = (SELECT admin_user_id FROM public.store_settings WHERE id = 1)
  );

DROP POLICY IF EXISTS categories_insert_authenticated ON public.categories;
CREATE POLICY categories_insert_authenticated
  ON public.categories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = (SELECT admin_user_id FROM public.store_settings WHERE id = 1)
  );

DROP POLICY IF EXISTS categories_update_authenticated ON public.categories;
CREATE POLICY categories_update_authenticated
  ON public.categories
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = (SELECT admin_user_id FROM public.store_settings WHERE id = 1)
  )
  WITH CHECK (
    auth.uid() = (SELECT admin_user_id FROM public.store_settings WHERE id = 1)
  );

DROP POLICY IF EXISTS categories_delete_authenticated ON public.categories;
CREATE POLICY categories_delete_authenticated
  ON public.categories
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = (SELECT admin_user_id FROM public.store_settings WHERE id = 1)
  );

-- Índices para las claves foráneas señaladas por el asesor de rendimiento.
CREATE INDEX IF NOT EXISTS clients_user_id_idx ON public.clients (user_id);
CREATE INDEX IF NOT EXISTS sales_client_id_idx ON public.sales (client_id);
CREATE INDEX IF NOT EXISTS sales_product_id_idx ON public.sales (product_id);
CREATE INDEX IF NOT EXISTS sales_user_id_idx ON public.sales (user_id);
CREATE INDEX IF NOT EXISTS store_settings_admin_user_id_idx ON public.store_settings (admin_user_id);
CREATE INDEX IF NOT EXISTS store_settings_updated_by_idx ON public.store_settings (updated_by);
CREATE INDEX IF NOT EXISTS storefront_product_combos_product_b_idx ON public.storefront_product_combos (product_b_id);
CREATE INDEX IF NOT EXISTS storefront_product_combos_updated_by_idx ON public.storefront_product_combos (updated_by);
CREATE INDEX IF NOT EXISTS storefront_promotion_settings_updated_by_idx ON public.storefront_promotion_settings (updated_by);
