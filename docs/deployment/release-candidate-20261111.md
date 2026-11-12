# Release candidate Sirevya — CSV ZIP, tracking y Telegram

## Estado

Este documento prepara un despliegue coordinado sobre `main`. No ejecuta migraciones, no despliega Edge Functions y no cambia datos reales.

Comprobación de cierre realizada el 2026-11-11: `HEAD` y `origin/main` coinciden en `2823d6a`; los cambios de esta sesión siguen sin commit pero están protegidos en `/home/ubuntu/sirevya-local-changes-20261112T013716Z`. El workspace no contiene `roles.sql`, `schema.sql`, `data.sql`, `SHA256SUMS`, un dump real ni un directorio de restore de Sirevya. La restauración PostgreSQL 17 anterior se conserva como evidencia histórica documentada, pero no existe un artefacto local para recalcular sus hashes o repetirla sin fundamento.

La consulta read-only al proyecto Supabase `hnlbbtnfmbnbkcgegufa` no devolvió versiones candidatas en `supabase_migrations.schema_migrations`; a nivel de objetos solo se observó `sirevya_telegram_notification_settings` y la función previa `set_sirevya_telegram_dispatcher_ready`. No se debe interpretar esto como autorización para aplicar DDL: la ausencia de una fila histórica requiere comparar objetos y DDL en el backup real antes de reconciliar.

La validación local completada es:

- `node scripts/validate.mjs`: PASS.
- `node tests/csv_zip_images_regression.mjs`: PASS.
- Regresiones de preview/importación CSV v1/v2: PASS.
- `tests/run_admin_csv_import_atomic_local.sh`: PASS.
- `tests/run_order_tracking_audit_local.sh`: PASS.
- `tests/run_telegram_outbox_local.sh`: PASS.

## Orden seguro de despliegue

### 1. Gate de respaldo real

Antes de tocar producción debe existir evidencia del respaldo real de Supabase, no solo del scratch local:

1. Tres artefactos del respaldo lógico y `SHA256SUMS`.
2. Verificación de hashes desde el ordenador Windows.
3. Restauración local PostgreSQL 17 ya demostrada; no repetirla.
4. Registro separado de componentes fuera del dump lógico: Storage/R2, Auth, Vault, secretos y Edge Functions.
5. URI privada nunca incluida en logs, historial de shell ni mensajes.

Si este gate no está cumplido, se puede revisar y preparar el release, pero no aplicar migraciones sensibles.

### 2. Verificación de estado remoto

Usar solo lectura para confirmar que las siguientes migraciones no están aplicadas ni parcialmente registradas:

- `20261111010000_telegram_notifications_professional_payload.sql`
- `20261113010000_admin_csv_product_import_images_variants_v2.sql`
- `20261114010000_web_order_tracking_and_change_log.sql`

No insertar manualmente filas en `schema_migrations`. Si una versión ya existe, se detiene el proceso y se reconcilia contra su DDL real.

### 3. Aplicación de base de datos

Aplicar mediante el mecanismo versionado oficial, en este orden:

1. `20261113010000_admin_csv_product_import_images_variants_v2.sql`.
2. `20261114010000_web_order_tracking_and_change_log.sql`.
3. `20261111010000_telegram_notifications_professional_payload.sql`.

La razón del orden es que CSV y tracking son contratos independientes, mientras Telegram debe quedar con sus objetos profesionales antes de activar el worker. Cada migración debe quedar registrada por la herramienta oficial y debe detenerse ante cualquier error.

Controles posteriores read-only:

- CSV v2: `SECURITY INVOKER`, ejecución solo para el administrador autenticado, sin `anon` ni acceso público.
- Tracking: RLS activa, RPC administrativa protegida, historial no editable por clientes.
- Telegram: outbox y deduplicación existentes, sin duplicar triggers ni bot, secretos fuera del repositorio.

### 4. Despliegue coordinado del worker Telegram

Desplegar `supabase/functions/telegram-dispatch` desde el mismo commit que contiene el formatter profesional (`core.mjs`, `index.ts` y sus pruebas). No activar el scheduler antes de comprobar que el worker responde con el contrato nuevo.

Secuencia:

1. Desplegar la función.
2. Verificar `verify_jwt` y permisos de invocación.
3. Ejecutar solo la prueba de conexión autorizada y revisar que no exponga secretos.
4. Confirmar que el worker consume el outbox sin duplicar eventos.
5. Confirmar que el panel admin reporta `scheduler_ready` y `dispatcher_ready`.
6. Activar el scheduler únicamente después de los puntos anteriores.

No se debe enviar una prueba a clientes reales. La prueba controlada debe usar un evento sintético o el procedimiento de prueba ya autorizado.

## CSV v2 con ZIP

El ZIP se valida localmente antes de subirlo:

- Máximo 50 MiB y 500 entradas.
- Solo JPG, JPEG, PNG, WEBP, GIF y AVIF.
- Sin rutas absolutas, `..`, caracteres de control ni archivos cifrados.
- Máximo 15 MiB por imagen.
- Verificación de CRC y tamaño descomprimido.
- Asociación por código/nombre y, cuando corresponde, por código + color + talla.

Las imágenes suben a un staging determinista `products/csv-import-<uuid>/`. El identificador queda temporalmente en un journal de sesión. Si la RPC rechaza el lote o falla la confirmación, el staging se elimina mediante el endpoint administrativo R2. Al abrir nuevamente el panel se intenta limpiar cualquier staging pendiente de una interrupción anterior. El lote no se confirma si no se puede ejecutar esta limpieza.

La importación no modifica productos existentes. El RPC sigue siendo la autoridad final sobre tipos, duplicados, variantes, cantidades y URLs HTTPS.

## Pruebas de producción autorizables

Estas pruebas deben ejecutarse después de backup y despliegue, preferiblemente con productos y contactos de prueba:

1. **Catálogo:** abrir producto con imagen principal, segunda imagen, variante, color, talla y stock.
2. **CSV:** validar un lote pequeño con ZIP; confirmar preview, asociación, subida y número insertado; repetir con código duplicado y comprobar rollback y limpieza R2.
3. **Contraentrega:** cotización, tarifa, reserva, creación del pedido y notificación; verificar idempotencia sin crear un segundo pedido.
4. **Pago:** checkout Wompi/PSE/Nequi en modo permitido, verificar cotización, referencia, estado e inventario; no usar pagos reales sin autorización financiera.
5. **Inventario:** reserva, liberación por expiración y bloqueo de stock insuficiente.
6. **Telegram:** evento controlado, exactamente un mensaje, formato profesional, sin SKU/UUID/token, error registrado y reintento controlado.
7. **Tracking:** crear transición administrativa de prueba, registrar actor/fecha/estado, rechazar URL no HTTPS y confirmar que el cliente no puede editar el historial.
8. **Recuperación:** provocar rechazo sintético del CSV y verificar que no quedan filas nuevas ni objetos R2 de staging.

## Autorizaciones pendientes

- Confirmar el respaldo real restaurable de Supabase y componentes externos documentados.
- Autorizar la aplicación de las tres migraciones si el estado remoto confirma que son nuevas.
- Autorizar el despliegue del Edge worker Telegram desde el commit verificado.
- Autorizar la activación del scheduler Telegram.
- Autorizar cualquier prueba que implique un pago real, un mensaje a un chat operativo o la creación de un pedido visible para clientes.

Hasta recibir esas autorizaciones y evidencias, el release permanece preparado pero no desplegado.
