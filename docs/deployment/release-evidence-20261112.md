# Evidencia de release Sirevya — 2026-11-12

## Backup validado

Se recibió el archivo privado `sirevya-preflight-20261111T041802Z.rar` y se extrajo fuera del checkout, con permisos restringidos.

Contenido esperado encontrado:

- `roles.sql`
- `schema.sql`
- `data.sql`
- `SHA256SUMS`

Verificación SHA-256:

```text
roles.sql: OK
schema.sql: OK
data.sql: OK
```

El esquema contiene los objetos estructurales de Sirevya, incluyendo `products`, `orders`, `web_orders`, `inventory_reservations`, `inventory_movements`, `store_settings`, `sirevya_telegram_outbox` y `sirevya_telegram_notification_settings`. No se copiaron filas ni PII en este informe. El RAR no incluía un manifiesto separado de restauración; la restauración PostgreSQL 17 previa se conserva como evidencia histórica y no se repitió.

## Estado Git

- Commit publicado: `2d8a3e7e536d5c4f5a7ed5b939ea59e7c2a5e3bb`.
- Rama: `main`.
- `origin/main` sincronizado antes de este release.
- El código de CSV ZIP, formatter Telegram, pruebas y runbook están publicados en GitHub.

## Migraciones aplicadas

Las tres migraciones se aplicaron mediante Supabase MCP después de verificar el backup y que no aparecían en el historial remoto:

1. `20261113010000_admin_csv_product_import_images_variants_v2` — aplicada correctamente.
2. `20261114010000_web_order_tracking_and_change_log` — aplicada correctamente.
3. `20261111010000_telegram_notifications_professional_payload` — aplicada correctamente.

La API oficial de Supabase confirmó después las tres versiones registradas.

No se hizo backfill ni se modificaron pedidos, productos, inventario o reservas existentes.

## Worker Telegram

- Función: `telegram-dispatch`.
- Versión activa: `8`.
- Estado: `ACTIVE`.
- `verify_jwt`: `false`, porque la autenticación es server-to-server mediante secreto de Vault.
- El código desplegado incluye `index.ts` y `core.mjs` del formatter profesional.

## Scheduler y controles

Estado agregado posterior al release:

- `scheduler_ready`: `true`.
- `enabled`: `true`.
- `dispatcher_ready`: `true`.
- Cola pendiente: `0`.
- Cola en procesamiento: `0`.
- Eventos enviados registrados: `21`.
- Eventos fallidos terminales: `0`.

No se invocó el worker manualmente y no se envió un mensaje de prueba para evitar una comunicación externa no necesaria.

## Seguridad verificada

- `web_order_tracking` y `storefront_change_log` tienen RLS activa.
- `anon` no puede leer esas tablas.
- `service_role` no tiene lectura directa concedida por estas migraciones.
- Solo `authenticated` recibe `SELECT` y `EXECUTE` para las RPC nuevas.
- Las RPC administrativas exigen sesión y `is_store_admin()`.
- `admin_import_products_csv_v2` no concede ejecución a `anon` ni `service_role`.
- El formatter elimina UUID/SKU innecesarios del mensaje profesional y limita/normaliza los campos enviados.

## Pendiente de prueba externa

Queda pendiente únicamente una prueba operativa controlada, no necesaria para aplicar el release:

- Confirmar visualmente en el chat privado que un evento de prueba llega con el formato profesional.
- Esa prueba requiere autorización explícita porque envía una comunicación real a Telegram. No se realizó automáticamente.
