# Fase 8 — Seguridad y optimización compatible

La tienda conserva GitHub Pages y Supabase; no se cambia el proveedor, el diseño visual ni el esquema de reservas/pagos.

## Implementación

- Cerrar la ejecución directa de funciones internas de reserva y confirmación a visitantes y cuentas autenticadas, manteniendo el rol de servicio y las llamadas internas desde RPCs SECURITY DEFINER.
- Exigir autorización administrativa además de propiedad en las políticas de productos, fotografías, clientes, ventas y movimientos. Comprobar pertenencia producto-fotografía. No modificar filas.
- Reparar políticas de categorías dependientes de la lectura directa de store_settings y añadir una RPC pública limitada a nombre y orden de categorías utilizadas por la tienda.
- Impedir inserción directa de pedidos web y conservar su creación transaccional por la RPC existente.
- Restringir mutaciones del bucket product-images al administrador; conservar lectura pública de fotos.
- Añadir reacción de sesión a cierre/cambio de usuario, manejo de errores de logout local y revalidación periódica de autorización. Conservar la cadencia de refresco de inventario y Realtime para sesiones válidas.
- Neutralizar fórmulas de CSV y escapar etiquetas de categorías de promociones.
- Fijar la dependencia Supabase en catálogo y panel con integridad verificada; completar metadatos sociales compatibles sin reintroducir datos de contacto antiguos ni un banner pesado.
- Añadir validaciones estáticas reproducibles antes de publicar. Integrar solo cambios compatibles del PR anterior de optimización.

## Estructura

`admin.html` contiene acceso, gestión y exportaciones; `index.html` contiene el catálogo. `supabase/migrations/` versiona políticas y privilegios. `scripts/` y `tests/` contienen comprobaciones sin cargos. Las Edge Functions Wompi conservan su código y rol de servicio.

## Límites

No cambiar claves localStorage, referencias, TTL de 10 minutos, precios, tarifas de envío, ciudades COD, estados de pedidos existentes ni flags de pago. No cambiar todavía el modelo orders/web_orders, liberación/asociación por referencias, antibots o retención de datos: requieren una fase funcional propia.
