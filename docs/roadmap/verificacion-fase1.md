# Evidencia de revisión — Fase 1

**Fecha:** 7 de noviembre de 2026, hora local de la sesión. **PR:** [#9](https://github.com/Baunsel21/variedades-jm-catalogo/pull/9). La rama está separada de `main`.

## Verificaciones previas

El HTML de [sirevya.com.co](https://sirevya.com.co/) y el archivo de [GitHub `main`](https://raw.githubusercontent.com/Baunsel21/variedades-jm-catalogo/main/index.html) ya enviaban `expected_total` y `expected_discount_total`. En lecturas agregadas de Supabase se encontraron 0 filas fraccionarias en `products.sale_price`, `storefront_product_combos.discount_value` y `storefront_product_combos.combo_price`; también se confirmó que `web_orders.total`, `discount_total` y `shipping` son `NOT NULL`.

## Acciones de producción realizadas con autorización

La Edge Function `wompi-create-checkout` está activa en la versión 31 y conserva `verify_jwt=false`, como estaba antes. Una solicitud de validación con un monto fraccionario recibió HTTP 400 antes de invocar cotización, reserva o creación de pedido; no se inició un pago.

Se aplicó la migración `configurable_storefront_shipping`. La fila inicial conserva los importes vigentes (tarifa nacional 15.000 COP y umbral 130.000 COP); RLS está activo y `anon` no puede leer la tabla directamente. No se actualizaron pedidos históricos ni tarifas existentes.

## Pausa de seguridad

La lectura posterior de privilegios encontró `EXECUTE` efectivo para `anon` en `admin_save_storefront_shipping_settings(bigint,bigint)`, aunque el cuerpo exige `is_store_admin()` y `anon` no puede cambiar tarifas sin esa autorización. No se produjo ningún cambio de configuración por ese hallazgo. Se detuvo el despliegue antes de aplicar la migración COD, ejecutar pruebas sintéticas o fusionar el PR.

Se añadió al PR una migración correctiva aditiva, `20261108060050_restrict_admin_shipping_rpc.sql`, para revocar el permiso a `PUBLIC`, `anon` y `service_role`, conservándolo solo para `authenticated`. Esa corrección aún **no** está aplicada y requiere aprobación actualizada. Después de verificar el ACL, se podrán aplicar el guard COD y las pruebas SQL con rollback; si cualquiera falla, no se fusionará el PR.

## Pruebas y límites

Antes del hallazgo de ACL, `node scripts/validate.mjs`, `git diff --check`, el parseo SQL con `pglast` y la transpilación TypeScript pasaron. Las pruebas de base de datos `tests/shipping_config_regression.sql` y `tests/cod_regression.sql` aún no se ejecutaron en Supabase. No se crearon pedidos/reservas de prueba, no se alteró stock, no se procesaron pagos y el PR #9 sigue sin fusionarse.

El PR #3 anterior permanece abierto y separado; su diff conserva datos de contacto y textos de envío obsoletos, y al combinarlo con esta rama hay conflicto en `index.html`. No se mezcló ni fusionó.
