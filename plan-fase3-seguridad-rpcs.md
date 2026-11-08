# Fase 3 — Seguridad de funciones administrativas

## Objetivo

Asegurar que cada función `SECURITY DEFINER` tenga el nivel correcto de acceso y compruebe la identidad del administrador cuando modifica configuración global, categorías, pedidos, inventario o promociones.

## Hallazgos iniciales

La función `set_online_payment_status(boolean)` valida internamente al administrador, pero tenía permiso de ejecución para `anon`. Ese permiso no permite cambiar pagos por sí solo porque la función rechaza una sesión anónima, pero es innecesario y aumenta la superficie de ataque. Se cerrará de inmediato.

Las funciones `admin_add_category`, `admin_delete_category` y `admin_rename_category` comprueban sesión, pero no llaman a `is_store_admin()`. Como modifican categorías globales, deben recibir una guardia administrativa en una migración posterior, después de revisar los consumidores y conservar el comportamiento del usuario administrador.

Las funciones de inventario `admin_adjust_inventory_movement`, `admin_register_inventory_sale` y `admin_update_web_order_status` validan propiedad de productos o pedidos, pero no todas validan explícitamente el administrador global. Se revisarán antes de modificar cuerpos para no romper reservas, contraentrega o el control de stock.

Las funciones públicas de catálogo, cotización, reservas, contraentrega y eventos de marketing conservan permisos anónimos intencionalmente; no se deben bloquear sin comprobar antes cada flujo público.

## Implementación de esta etapa

Se revocará únicamente el permiso anónimo de `set_online_payment_status`. No se modifican filas, pagos, inventario, reservas ni categorías. El resto queda documentado para una migración específica y revisable.
