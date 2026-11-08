-- Fase 8: permisos mínimos para una tienda de un solo administrador.
-- No modifica filas, funciones de inventario, TTL, tarifas, ciudades ni flags.
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.store_settings WHERE id=1 AND admin_user_id IS NOT NULL LIMIT 1) THEN
    RAISE EXCEPTION 'Se requiere un administrador configurado antes de endurecer las políticas';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.user_id IS DISTINCT FROM (SELECT admin_user_id FROM public.store_settings WHERE id=1 LIMIT 1)
    LIMIT 1
  ) OR EXISTS (
    SELECT 1 FROM public.product_images pi
    LEFT JOIN public.products p ON p.id=pi.product_id
    WHERE p.id IS NULL OR pi.user_id IS DISTINCT FROM p.user_id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Hay propietarios o relaciones de imágenes inconsistentes; revisar antes de aplicar';
  END IF;
END;
$guard$;

-- Solo las Edge Functions/funciones servidoras deben crear holds internos o
-- finalizar stock. SECURITY DEFINER conserva el acceso interno como postgres.
REVOKE EXECUTE ON FUNCTION public.reserve_inventory(text,jsonb,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_inventory_reservation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_inventory(text,jsonb,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_inventory_reservation(text) TO service_role;

-- El navegador crea COD mediante create_contra_delivery_order, no DML directo.
DROP POLICY IF EXISTS web_orders_public_insert ON public.web_orders;
REVOKE INSERT ON TABLE public.web_orders FROM PUBLIC, anon, authenticated;

ALTER POLICY "products own" ON public.products TO authenticated
  USING ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1))
  WITH CHECK ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1));
ALTER POLICY "sales own" ON public.sales TO authenticated
  USING ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1))
  WITH CHECK ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1));
ALTER POLICY "clients own" ON public.clients TO authenticated
  USING ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1))
  WITH CHECK ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1));
ALTER POLICY inventory_movements_select_own ON public.inventory_movements TO authenticated
  USING ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1));

ALTER POLICY product_images_select_own ON public.product_images TO authenticated
  USING ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1));
ALTER POLICY product_images_delete_own ON public.product_images TO authenticated
  USING ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1));
ALTER POLICY product_images_insert_own ON public.product_images TO authenticated
  WITH CHECK ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1)
    AND EXISTS (SELECT 1 FROM public.products p WHERE p.id=product_id AND p.user_id=(SELECT auth.uid() LIMIT 1) LIMIT 1));
ALTER POLICY product_images_update_own ON public.product_images TO authenticated
  USING ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1))
  WITH CHECK ((SELECT public.is_store_admin() LIMIT 1) AND user_id=(SELECT auth.uid() LIMIT 1)
    AND EXISTS (SELECT 1 FROM public.products p WHERE p.id=product_id AND p.user_id=(SELECT auth.uid() LIMIT 1) LIMIT 1));

-- Evita la lectura directa de store_settings desde políticas de categorías.
ALTER POLICY categories_select_authenticated ON public.categories TO authenticated
  USING ((SELECT public.is_store_admin() LIMIT 1));
ALTER POLICY categories_insert_authenticated ON public.categories TO authenticated
  WITH CHECK ((SELECT public.is_store_admin() LIMIT 1));
ALTER POLICY categories_update_authenticated ON public.categories TO authenticated
  USING ((SELECT public.is_store_admin() LIMIT 1)) WITH CHECK ((SELECT public.is_store_admin() LIMIT 1));
ALTER POLICY categories_delete_authenticated ON public.categories TO authenticated
  USING ((SELECT public.is_store_admin() LIMIT 1));

CREATE OR REPLACE FUNCTION public.get_public_category_order()
RETURNS TABLE(name text, sort_order integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
  SELECT c.name,c.sort_order FROM public.categories c
  WHERE EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.user_id=(SELECT s.admin_user_id FROM public.store_settings s WHERE s.id=1 LIMIT 1)
      AND p.category=c.name
    LIMIT 1
  )
  ORDER BY c.sort_order NULLS LAST,c.name
  LIMIT 1000;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_public_category_order() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_category_order() TO anon,authenticated,service_role;

-- Mantener lectura pública de fotografías; mutaciones solo del administrador.
ALTER POLICY "product images upload" ON storage.objects TO authenticated
  WITH CHECK (bucket_id='product-images' AND (SELECT public.is_store_admin() LIMIT 1));
ALTER POLICY "product images update" ON storage.objects TO authenticated
  USING (bucket_id='product-images' AND (SELECT public.is_store_admin() LIMIT 1))
  WITH CHECK (bucket_id='product-images' AND (SELECT public.is_store_admin() LIMIT 1));
ALTER POLICY "product images delete" ON storage.objects TO authenticated
  USING (bucket_id='product-images' AND (SELECT public.is_store_admin() LIMIT 1));
