# Fase 5 — Contratos observables de pedidos

**Estado: documentación parcial; no implica una vista unificada ni una verificación completa del esquema desplegado.** Esta nota describe únicamente contratos observables en el código versionado en `main`. No documenta filas reales ni presupone que las definiciones locales cubran toda la instalación de Supabase.

## Contraentrega (`web_orders`)

La migración versionada `20261108060100_cod_checkout_quote_guard.sql` expone `create_contra_delivery_order_with_quote` con `p_client_reference`. El wrapper llama a la operación COD preexistente y, si ésta informa un duplicado, obtiene el `order_id`, lo interpreta como UUID y vuelve a localizar el pedido con `web_orders.id`, `web_orders.client_reference` y `payment_method='Contra entrega'`. Antes de devolver el duplicado comprueba los importes guardados; si no coinciden, falla cerrado en vez de crear un segundo pedido.

El panel consulta `web_orders` con una lista explícita de columnas que incluye `id`, `client_reference`, `inventory_reference` e `inventory_state`. El cambio de estado usa `admin_update_web_order_status_secure(p_order_id, p_status)`. Estos usos muestran claves del flujo COD en el cliente y el wrapper; **no prueban por sí solos** constraints, cardinalidad global, triggers o RLS del esquema desplegado.

## Separación de fuentes y claves

`orders` (flujo de pago Wompi) y `web_orders` (flujo COD visible en el panel) deben tratarse como colecciones distintas hasta verificar los contratos instalados. No unir filas por teléfono, email, nombre, dirección, ciudad, monto, carrito o proximidad temporal. `web_orders.client_reference` se usa en el camino de idempotencia COD; no debe tratarse como una clave global equivalente a una referencia Wompi.

El repositorio versiona migraciones y código que usan estas tablas, pero no define sus tablas base completas. Por ello este documento no afirma tipos, unicidad, relaciones, políticas RLS, estados, ni cardinalidad de reservas o transacciones que no estén demostrados por una migración versionada.

## Límites de la futura vista administrativa

No crear todavía un join entre pedidos Wompi, COD, ventas, movimientos de inventario y conciliación. Una futura proyección debe usar identidad calificada por canal, seleccionar columnas explícitas, indicar conflictos o duplicidades como `needs_review` y mantenerse de solo lectura hasta que el esquema restaurado y sus restricciones confirmen cada relación. No resolver ambigüedades con `LIMIT 1`.

Para una vista o acción que cambie estado, reserva, inventario o pago se requiere una operación separada, transaccional, autorizada y con resultado comprobable. La nota no introduce RPC, trigger, DDL, consulta de filas, datos personales ni cambios de comportamiento.

## Fuentes versionadas

- `supabase/migrations/20261108060100_cod_checkout_quote_guard.sql`: verificación de cotización e idempotencia de la ruta COD.
- `supabase/migrations/20261108034000_secure_inventory_order_rpcs.sql`: firma administrativa segura con `p_order_id`.
- `admin.html`: proyección actual de `web_orders` y actualización de estado.
- `tests/cod_regression.sql`: casos sintéticos del flujo COD.

## Siguiente evidencia necesaria

El backup/restore real de Sirevya en un destino local aislado debe preceder a la inspección de constraints, índices, triggers, grants y RLS. Después se podrán validar cardinalidades con fixtures sintéticas sobre el scratch restaurado. No se hizo ninguna lectura de filas ni escritura en Supabase durante la elaboración de esta nota.
