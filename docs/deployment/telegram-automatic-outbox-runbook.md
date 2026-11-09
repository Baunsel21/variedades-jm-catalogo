# Telegram automático: outbox y despliegue seguro

## Estado de esta implementación

El esquema, el worker Edge y la interfaz admin están preparados en una rama aislada y pasan pruebas locales sintéticas. No se han aplicado migraciones en Supabase, instalado extensiones, desplegado el worker automático, activado el toggle ni enviado pedidos/pagos de prueba reales. El botón `telegram-test` y su función fija/manual permanecen separados.

## Componentes

- `sirevya_telegram_outbox` conserva cada evento con clave única de deduplicación, estado, contador de intentos, lease y token de propiedad por claim, fecha del último error y código de error allowlisted. `complete`/`retry` exigen el token vigente y un lease no vencido. No concede acceso directo a roles de cliente.
- Antes de encolar, el scheduler adquiere atómicamente un lock global de 180 s. El body lleva un UUID de lock (no es un secreto); el worker compara la URL guardada en Vault con su `SUPABASE_URL`, y libera solo el lock con su UUID. Ticks solapados no lanzan otro lote; si el worker cae, el lock vence. El lease de cada fila (600 s) sigue protegiendo `claim`/`complete`/`retry`.
- Triggers observadores en `orders`, `web_orders`, `inventory_reservations`, `products` e `inventory_movements` capturan creación/cancelación, cambios de pago Wompi, cambios importantes de stock y transiciones de reservas. No sustituyen ni modifican las rutas existentes de pedidos, inventario o Wompi.
- Los valores numéricos entrantes se convierten fail-open; si un dato inesperado no se puede parsear, el payload omite el importe/cantidad en lugar de abortar la transacción de pedidos o inventario.
- El payload aplica allowlists, normaliza los métodos de pago y excluye nombres, teléfonos, correos, direcciones, cédulas, notas y líneas de compra.
- `telegram-dispatch` reclama como máximo 5 filas secuenciales con lease de 600 s; su timeout de request pg_net es 120 s y el tiempo límite de cada RPC/envío es 8 s. Completa o programa el reintento con el `claim_token`. Las claves nuevas `sb_secret_*` se envían solamente mediante `apikey`; el JWT `service_role` legacy usa también `Authorization: Bearer`.
- La consola admin consulta estado/contadores y permite cambiar el toggle solo en `https://sirevya.com.co`, después de validar la sesión admin. La activación exige confirmación, scheduler listo y `dispatcher_ready=true`. Ese último marcador solo lo puede cambiar `service_role` mediante `set_sirevya_telegram_dispatcher_ready`; el usuario admin no puede saltarse el gate desde el navegador. `claim` y el tick revalidan en cada llamada `pg_cron`, `pg_net` y Vault, no solo el booleano guardado.

La entrega es at-least-once, no exactly-once: si Telegram acepta un mensaje y se pierde la confirmación de base de datos, una recuperación podría reenviarlo. La deduplicación evita duplicados al crear eventos; no puede eliminar esa ventana externa de confirmación.

Apagar el toggle impide nuevos claims; no cancela una llamada que ya reclamó un lote ni una petición pg_net que ya quedó encolada. Marcar el worker como no listo también apaga el toggle, pero una petición en curso puede terminar.

## Scheduler elegido y alternativa

La lectura de solo metadatos del proyecto (`hnlbbtnfmbnbkcgegufa`) confirmó `pg_cron` 1.6.4 y Vault 0.3.1 instalados. `pg_net` 0.20.4 está disponible pero no instalado. Por eso la migración scheduler candidata ejecuta `CREATE EXTENSION pg_net WITH SCHEMA extensions` y verifica que el cron job y ambos secretos Vault existan antes de permitir activar el toggle. `scheduler_ready` se vuelve a comprobar en cada claim/tick para detener procesamiento si después se pierde el cron job, la extensión o los secretos.

`pg_net` no es la única posibilidad. Supabase también ofrece la extensión `http` (versión 1.6 disponible en el catálogo del proyecto, no instalada). Se puede invocar Edge desde `pg_cron` con `http_request` y un timeout corto, pero la llamada es síncrona: el job mantiene una conexión hasta recibir respuesta y los timeouts elevan un error SQL. No se eligió como ruta predeterminada porque `pg_net` es el patrón asíncrono documentado para invocar Edge Functions y evita retener la conexión cron durante todo el despacho. Usar `http` también requeriría instalar una extensión y pasar una validación de respaldo; no elimina ese gate.

La ruta candidata mantiene el secreto del dispatcher en Vault y nunca envía el service-role key dentro del header de `pg_net`. La petición pendiente se guarda temporalmente en `net.http_request_queue`; la migración revoca a `PUBLIC`, `anon` y `authenticated` el `USAGE` de schema `net`, las tablas/secuencias y el `EXECUTE` de todas las funciones del schema. Un usuario con login privilegiado directo a la base sigue pudiendo inspeccionar datos mientras están en cola; por ello el header contiene únicamente un secreto aleatorio y limitado a disparar el dispatcher. El payload no contiene PII.

## Gate de producción y secuencia

Antes de aplicar DDL o desplegar Edge en producción se requiere un respaldo restaurable validado y un entorno de validación aislado compatible con la restricción del proyecto. Esta condición aún no se ha satisfecho; por tanto, esta guía no autoriza ni implica aplicar cambios.

Cuando ese gate esté verificado, la secuencia prevista es:

1. Revisar en el proyecto real el esquema/extensiones, permisos y contratos de columnas inmediatamente antes de aplicar. No sustituir ni editar la función `wompi-webhook`.
2. Aplicar primero `20261109055000_telegram_notification_outbox.sql` y luego `20261109055100_telegram_notification_scheduler.sql` mediante el flujo de migración aprobado. La segunda instala `pg_net` si falta y programa un tick por minuto; el ajuste queda desactivado inicialmente.
3. Desplegar `telegram-dispatch` con `verify_jwt=false`, porque la función valida el secreto server-to-server recuperado desde Vault antes de reclamar eventos. Mantener `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` solo en secretos Edge. Nunca copiar secretos a Git, SQL de la migración, HTML ni logs.
   El worker exige el body exacto `{ action: "dispatch", lock_token: "<uuid>" }` y compara la URL de Vault con `SUPABASE_URL` antes de reclamar. Tras procesar el lote intenta liberar el lock global usando ese UUID; si cae o falla, el lease vence por sí solo. No reemplazar el token de dispatch por la service-role key.
4. Consultar estado como admin. `scheduler_ready` comprueba cron, pg_net y Vault. Confirmar por herramientas de despliegue que `telegram-dispatch` está `ACTIVE` en el SHA esperado, `verify_jwt=false`, y que reutiliza los secretos Telegram ya probados en el proyecto. Solo después, mediante el canal de release con `service_role`, ejecutar `set_sirevya_telegram_dispatcher_ready(true)`. El procedimiento no debe imprimir ni exportar valores secretos. Este booleano es una atestación operativa de release, no un health-check continuo del Edge Function; el RPC no verifica por sí solo SHA, configuración ni secretos del worker. Si se pausa/retira el worker o se rotan sus secretos, el release operator debe borrar la marca con `set_sirevya_telegram_dispatcher_ready(false)`, que apaga además el toggle. Sin el marcador, o si `scheduler_ready` deja de ser cierto, admin, cron y claim bloquean activación/envío.
5. Activar solo después del marcador y de la revisión del estado como admin. Si se desactiva, puede completarse el lote ya reclamado; comprobar que nuevas solicitudes cron cesan. Validar eventos con mecanismo sintético autorizado; no crear pedidos, pagos ni movimientos de inventario reales. La suite incluida crea una base PostgreSQL desechable con mocks que no hacen red y revierte los datos de negocio de prueba.

## Pruebas locales disponibles

Ejecutar `tests/run_telegram_outbox_local.sh` en un entorno Linux con PostgreSQL local y `sudo`. Crea una base efímera, instala temporalmente mocks SQL de `pg_cron`/`pg_net`, aplica cada migración dos veces, verifica eventos, privacidad, grants/RLS, token stale, lote/lease, gate de readiness, reintentos, dead-letter, ACL de esquema/funciones net y llamada scheduler mock; no contacta Supabase, Telegram ni otros destinos de red. El script elimina la base y los archivos de extensión falsos al terminar.
La cobertura actual añade: bloqueo de URL Supabase equivocada antes del claim, exclusión de ticks solapados, rechazo de token de lock antiguo, recuperación por vencimiento y parseo seguro de números inválidos. Los mocks no validan la instalación real de `pg_net` ni una ejecución Edge de producción.

También ejecutar `node tests/telegram_dispatch_worker_regression.mjs`, `node tests/telegram_admin_ui_regression.mjs`, `node tests/telegram_test_edge_regression.mjs` y `node scripts/validate.mjs` antes de revisión/publicación.

## Referencias oficiales

- Supabase, pg_net: https://supabase.com/docs/guides/database/extensions/pg_net
- Supabase, scheduled Edge Functions: https://supabase.com/docs/guides/functions/schedule-functions
- Supabase, extensión http: https://supabase.com/docs/guides/database/extensions/http
- pgsql-http upstream: https://github.com/pramsey/pgsql-http
