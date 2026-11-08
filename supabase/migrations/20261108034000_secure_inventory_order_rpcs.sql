-- Capa de seguridad para las RPCs administrativas que modifican inventario,
-- productos, ventas o estados de pedidos. Las funciones originales se conservan
-- internamente para no alterar reservas, stock, contraentrega ni Wompi.

CREATE OR REPLACE FUNCTION public.admin_adjust_inventory_movement_secure(
  p_product_id uuid,
  p_type text,
  p_quantity integer,
  p_motive text DEFAULT '',
  p_color text DEFAULT '',
  p_size text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_store_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'No tienes autorización para modificar el inventario.');
  END IF;
  RETURN public.admin_adjust_inventory_movement(p_product_id, p_type, p_quantity, p_motive, p_color, p_size);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_product_secure(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_store_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'No tienes autorización para eliminar productos.');
  END IF;
  RETURN public.admin_delete_product(p_product_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_register_inventory_sale_secure(
  p_product_id uuid,
  p_quantity integer,
  p_sale_date date,
  p_color text DEFAULT '',
  p_size text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_store_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'No tienes autorización para registrar ventas de inventario.');
  END IF;
  RETURN public.admin_register_inventory_sale(p_product_id, p_quantity, p_sale_date, p_color, p_size);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_web_order_status_secure(
  p_order_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_store_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'No tienes autorización para actualizar pedidos.');
  END IF;
  RETURN public.admin_update_web_order_status(p_order_id, p_status);
END;
$function$;

-- Las funciones antiguas no deben poder invocarse directamente desde una sesión.
REVOKE EXECUTE ON FUNCTION public.admin_adjust_inventory_movement(uuid,text,integer,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_delete_product(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_register_inventory_sale(uuid,integer,date,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_web_order_status(uuid,text) FROM PUBLIC, anon, authenticated;

-- Solo el rol autenticado puede alcanzar los wrappers; cada wrapper verifica además
-- que auth.uid() sea el administrador configurado.
GRANT EXECUTE ON FUNCTION public.admin_adjust_inventory_movement_secure(uuid,text,integer,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_product_secure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_register_inventory_sale_secure(uuid,integer,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_web_order_status_secure(uuid,text) TO authenticated;
