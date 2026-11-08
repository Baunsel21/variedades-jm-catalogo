-- Los wrappers administrativos no deben conservar el EXECUTE predeterminado
-- para PUBLIC. Solo una sesión autenticada puede llegar a su guardia de admin.
REVOKE EXECUTE ON FUNCTION public.admin_adjust_inventory_movement_secure(uuid,text,integer,text,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_product_secure(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_register_inventory_sale_secure(uuid,integer,date,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_web_order_status_secure(uuid,text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_adjust_inventory_movement_secure(uuid,text,integer,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_product_secure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_register_inventory_sale_secure(uuid,integer,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_web_order_status_secure(uuid,text) TO authenticated;
