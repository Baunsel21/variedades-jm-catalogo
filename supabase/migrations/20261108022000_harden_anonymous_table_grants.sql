-- Protección de datos del panel administrativo.
-- Conserva SELECT público en productos/categorías por compatibilidad con
-- despliegues antiguos; las políticas RLS siguen controlando qué filas salen.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.products, public.categories FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.clients, public.sales FROM anon;

-- Los visitantes solo pueden crear el pedido web; no pueden leerlo ni
-- modificarlo directamente desde PostgREST.
REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.web_orders FROM anon;
GRANT INSERT ON TABLE public.web_orders TO anon;

-- Estas tablas no deben ser consultables por visitantes. No se cambian los
-- privilegios autenticados del panel en esta migración, para no interrumpir
-- funciones o vistas administrativas existentes.
REVOKE ALL PRIVILEGES ON TABLE public.store_settings, public.storefront_cod_settings,
  public.storefront_promotion_settings, public.sirevya_wompi_inventory_reconciliation
  FROM anon;

-- No se modifican filas, reservas, pedidos ni funciones de inventario.
