# Evidencia final — Fase 1 de envíos configurables

**Fecha:** 7–8 de noviembre de 2026, hora de la sesión. **PR:** [#9](https://github.com/Baunsel21/variedades-jm-catalogo/pull/9), fusionado en `main` como `e109d27370e66bab53b16549008d0497a4955920`.

## Producción

La Edge Function `wompi-create-checkout` está activa en la versión 31 y mantiene `verify_jwt=false`. El código remoto se comparó byte por byte con el archivo aprobado. Una solicitud de validación con un monto fraccionario recibió HTTP 400 antes de consultar Supabase; no llegó a cotizar, reservar inventario ni insertar un pedido.

Se aplicaron las migraciones `configurable_storefront_shipping`, `restrict_admin_shipping_rpc_20261108060050` y `cod_checkout_quote_guard_20261108060100`. La configuración conserva **15.000 COP** para otras ciudades, **130.000 COP** como umbral y **envío gratis en Cali**. RLS está activo; `anon` no puede leer la tabla ni ejecutar el RPC de guardado, `authenticated` sí puede invocarlo y el guard interno exige administrador. No se reescribieron pedidos históricos ni se cambiaron existencias.

Luego de publicar y probar el wrapper COD, se aplicó con autorización la revocación del RPC COD legacy. El test `cod_legacy_acl.sql` terminó sin error y una lectura posterior confirmó: RPC antiguo bloqueado para `anon` y `authenticated`, permitido para `service_role`; el wrapper `create_contra_delivery_order_with_quote` continúa disponible para checkout anónimo.

El dominio respondió HTTP 200 y el contenido de `index.html` y `admin.html` coincidió por SHA-256 con los archivos de `main`. En navegador, el catálogo cargó **56 productos**; la RPC pública respondió `success=true` con los valores actuales, y se vieron la regla de Cali y el envío gratis desde $130.000.

## Regresiones sintéticas

`tests/shipping_config_regression.sql` terminó sin error. El bloque valida tarifa por debajo y en el umbral después de descuentos, alias “Santiago de Cali”, umbral desactivado, grants mínimos, guard de administrador, rechazo COD de un total desactualizado y rollback sin dejar productos, combos ni pedidos de prueba.

`tests/cod_regression.sql` reportó `rolled_back=true`: creación COD, reintento con la misma referencia sin duplicar pedido, rechazo de un nuevo importe frente al pedido anterior, una sola reserva lógica, visibilidad/rechazo por admin y stock físico estable en 1 unidad. Al terminar verificó **0 productos, 0 pedidos y 0 reservas sintéticas**. No se ejecutó el pago de ningún cliente.

Las validaciones locales pasaron: `node scripts/validate.mjs`, `git diff --check`, parseo SQL con `pglast` y transpilación TypeScript. El validador también comprueba el orden `60000 → 60050 → 60100`.

## Límites y siguientes fases

No se hizo un pago real ni una transacción bancaria PSE de sandbox. Tampoco inicié sesión en el admin para cambiar una tarifa con una cuenta real; el RPC se probó con identidad administradora y con UID no autorizado en la regresión que hizo rollback. Las mejoras de fases posteriores —tarifas por ciudad, filtros/favoritos, campañas/cupones, dashboard, logística, bitácora, importación, reportes, políticas y rendimiento— siguen pendientes en el backlog.
