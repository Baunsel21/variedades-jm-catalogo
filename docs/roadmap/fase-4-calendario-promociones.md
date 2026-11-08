# Fase 4 — Calendario y prioridad de promociones

**Estado:** incremento parcial en la rama `feature/promotion-calendar-priority`; no fusionado ni desplegado. El alcance no completa Fase 4: los cupones y sus límites atómicos siguen pendientes.

**Revisión:** [PR #13](https://github.com/Baunsel21/variedades-jm-catalogo/pull/13) está en borrador; la revisión independiente lo considera apto para revisión, no para merge/deploy mientras no exista un staging aislado.

## Alcance implementado

Se extiende el módulo existente de combos —sin crear un segundo editor— para que cada regla con productos/categorías elegibles pueda tener prioridad entre 0 y 1000 y una zona de calendario explícita `America/Bogota`. Las filas anteriores reciben prioridad 0, por lo que mantienen el desempate histórico `created_at ASC, id ASC`. Las fechas existentes siguen siendo instantes `timestamptz` y no se reescriben; el panel ahora las muestra/edita como hora de Colombia y convierte la hora local explícitamente, independiente de la zona del navegador.

La cotización SQL conserva `get_storefront_cart_quote(jsonb,text)` y su forma de salida. Las reglas se procesan por prioridad descendente y desempate estable; se conserva `v_remaining`, que consume las unidades atendidas por una pareja y evita apilar otro beneficio sobre esas mismas unidades. El envío continúa calculándose una sola vez después del descuento. Wompi y COD siguen usando la misma cotización y sus guardas de total/descuento; no se altera ninguna firma de pago ni pedido.

Se añaden RPC v2 públicas/administrativas con allowlist y guardia de administrador. Una lectura de metadata/definiciones confirmó que la base actual tiene overloads legacy de 15 y 17 argumentos; el de 17 incluye ubicación/categoría y devuelve columnas `id uuid` y `enabled boolean`. La migración comprueba con `to_regprocedure` que la firma exacta de 17 argumentos existe y que el retorno ofrece esas columnas; si el contrato no coincide, falla antes de crear el wrapper. El guardado v2 llama a esa RPC legacy para conservar sus validaciones y actualiza prioridad/zona dentro de la misma transacción. El catálogo usa la RPC pública v2 y cae a la legacy únicamente si la versión nueva no está instalada.

El editor del popup singleton existente conserva su superficie. Sus fechas también se interpretan como hora de Colombia, los textos sugeridos evitan promesas de envío gratis/descuento no vinculadas a reglas y el panel aclara que el popup no modifica precios.

## Validación local

`node scripts/validate.mjs` comprueba sintaxis de scripts, prioridad en el estimador local, conversión Colombia↔UTC, rechazo de fechas inválidas, fallback, RPC/grants, copy neutral y preservación de claves de carrito/reserva. `pglast` parsea la migración y `tests/promotion_priority_regression.sql`; `git diff --check` no reporta whitespace inválido.

La regresión SQL crea productos/combos sintéticos dentro de `BEGIN … ROLLBACK`, invoca el guardado admin v2 con el uid administrador obtenido del ajuste de la tienda solo dentro de esa transacción, y comprueba el JSON de retorno; además valida que una regla de mayor prioridad sea la única aplicada a una pareja, que la suma de descuentos por línea coincida y que los RPC públicos/admin tengan permisos esperados. **El SQL no se ejecutó:** el único proyecto Supabase conectado no tiene un staging aislado. No se modificó la base, no se crearon pedidos/reservas y no hubo pagos de prueba.

## Pendiente / orden seguro

- Cupones no se incluyen en este incremento. Requieren código, vigencia, mínimo y límites con un ledger de usos reservado/redimido/liberado, bloqueo atómico, idempotencia por referencia y coordinación del webhook Wompi y la ruta COD. No se debe introducir un descuento local-only.
- El mensaje actualmente guardado en el popup singleton no se actualiza automáticamente; los presets nuevos son neutrales, pero cualquier copia activa debe revisarse contra una regla real antes de anunciar un beneficio.
- La migración y el frontend deben validarse juntos en un entorno aislado. No aplicar la migración en la única base conectada ni tratar este branch como desplegado hasta probar la cotización, COD y Wompi sin cargos reales.
- Las tres cláusulas de Fase 4 en `TODO-mejoras.md` siguen abiertas hasta cubrir cupones, calendario completo, paridad entre navegador/SQL/COD/Wompi y staging.
