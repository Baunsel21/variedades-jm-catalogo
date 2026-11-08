# Fase 2 — Tarifas por ciudad y zona

**Estado:** implementación preparada en la rama `feature/roadmap-city-shipping`; pendiente de validación en un proyecto Supabase aislado. No fusionada, publicada ni aplicada a la base activa. Fecha: 7 de noviembre de 2026.

## Cambios preparados

- Nueva migración `20261108070000_storefront_city_shipping_rules.sql`: reglas administrables por ciudad o zona, destinos y alias normalizados, tarifa y umbral opcional, prioridad de zona y desactivación reversible. La tarifa general existente queda como fallback.
- La resolución server-side mantiene este orden determinista: Cali y sus alias documentados conservan envío gratis; una regla `city` prevalece sobre cualquier zona; entre zonas coincidentes gana la prioridad mayor y luego el UUID estable; si no hay coincidencia se usa la tarifa general. Una ciudad vacía devuelve error; un destino no listado queda explícitamente marcado como `fallback`.
- El admin usa RPCs protegidas por `is_store_admin()`. Las tablas tienen RLS y no exponen lectura/escritura directa. La elegibilidad de contraentrega permanece separada y bajo su configuración actual.
- Catálogo, carrito y checkout consultan las reglas activas; la cotización de Supabase continúa siendo autoritativa. El resumen de carrito no promete un umbral general cuando hay reglas específicas. Cambios entre pestañas y Realtime actualizan también la configuración de destino.
- No se reescriben pedidos ni reservas existentes. El wrapper COD activo fue consultado en modo solo lectura y vuelve a cotizar/actualiza los importes mediante `get_storefront_cart_quote`; la regresión añadida cubre COD por ciudad, su reintento idempotente y una sola reserva, todo dentro de un subbloque con rollback.

## Validación local ejecutada

- `node scripts/validate.mjs`: pasó (sintaxis JavaScript, SRI/SDK, invariantes de seguridad, resolución local, fallback, Cali, Unicode, eventos, COD y contratos estáticos).
- `git diff --check`: pasó.
- `pglast`: parseó 22 sentencias de la migración, la sentencia DO de la regresión y la expresión SQL de normalización Unicode.

El parseo no ejecuta PL/pgSQL ni demuestra grants/RLS o concurrencia. La regresión `tests/storefront_city_shipping_regression.sql` **no se ejecutó** porque solo hay un proyecto Supabase disponible y es el de producción. Tampoco se aplicó ninguna migración, se modificó dato real ni se verificó un despliegue web.

## Puerta antes de fusionar o publicar

1. Preparar un proyecto Supabase aislado con el esquema base vigente (incluidas `storefront_cod_settings`, `reserve_inventory` y las funciones COD base), y aplicar las migraciones de las fases previas más `20261108070000_storefront_city_shipping_rules.sql`.
2. Ejecutar `tests/storefront_city_shipping_regression.sql`, además de `tests/shipping_config_regression.sql` y `tests/cod_regression.sql`; revisar grants de `public`, `anon`, `service_role` y `authenticated`, y comprobar que no queden productos, pedidos, reservas o reglas sintéticas. La prueba COD modifica `storefront_cod_settings` solo dentro de un subbloque que se revierte y verifica la restauración.
3. Probar visualmente las tarifas general, ciudad, zona, empate de zonas, Cali, “Otra ciudad”, cambio de regla con checkout abierto, COD elegible e importe Wompi en sandbox. No hacer un pago real.
4. Revisar la diff y solo después autorizar publicación. Los criterios de Fase 2 del backlog siguen sin marcarse como completados hasta que exista esa evidencia.
