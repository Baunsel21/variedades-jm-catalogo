# Hotfix: estado inicial de tarifas de envío

- **Fecha:** 2026-11-08
- **Rama aislada:** `release/prelaunch-shipping-state`
- **Base:** `origin/main` en `88ff3d7`

## Alcance

Este cambio se limita a la presentación inicial de tarifas en `index.html`. El copy predeterminado ya no promete envío gratis en Cali ni muestra un monto de envío, progreso de beneficio o total de checkout como si la configuración estuviera confirmada. La tienda muestra estados de consulta, pendientes o no disponibles hasta validar la respuesta de `get_public_storefront_shipping_settings`. Después de una respuesta válida, solo muestra la tarifa y los beneficios respaldados por esa respuesta y por una ciudad completa; para «Otra» exige que se escriba la ciudad.

Se conservan los controles existentes de confirmación: `confirmCheckout` sigue refrescando la configuración de envíos y consultando la cotización del servidor antes de registrar un pedido o iniciar un pago. Este hotfix no altera payloads, reglas tarifarias, RPCs, migraciones, RLS, tablas, funciones Edge, Wompi, contraentrega ni la base de datos de Supabase.

## Validación local

La regresión `node tests/prelaunch_shipping_copy_regression.mjs` simula respuestas válidas y fallidas del RPC y verifica el copy inicial, el progreso, la restauración de `hidden`/`display`/`aria-hidden`, la ciudad incompleta y el total del checkout. También se ejecutó `node --check` sobre el JavaScript inline de la página y `git diff --check`. Estas pruebas usan mocks; no acceden a Supabase, no crean pedidos y no ejecutan pagos.

Limitación no bloqueante: la regresión no simula el wrapper DOM de `handleCityChange` ni su atributo `required` para «Otra». Esa ruta no se modificó; la prueba sí cubre que el cálculo y el total quedan pendientes cuando la ciudad está incompleta.

## Publicación y reversión

La nota acompaña únicamente este hotfix visual, aislado desde `main`. No instala migraciones ni publica funciones, y no equivale a desplegar los demás cambios de `feature/admin-dashboard-critical-fixes`. Si se decide no integrar el cambio, se puede cerrar su pull request o revertir su commit; no hay cambios de datos que restaurar.
