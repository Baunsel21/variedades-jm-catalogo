# Contrato candidato: seguimiento de pedidos web y registro de cambios

**Estado:** código y DDL candidatos; no aplicado en Supabase de producción. La interfaz publicada no debe considerarse activa hasta reconciliar y aplicar la migración mediante el gate de backup/restauración. La implementación no añade una integración con API de transportadora ni actualiza el estado de entrega automáticamente.

## Alcance y relación de datos

El contrato se apoya únicamente en `public.web_orders.id` (UUID, clave primaria) y `public.web_orders.status` (texto), estructura confirmada por metadatos y fixtures del repositorio. No une pedidos con `clients` por teléfono, nombre o correo: no existe FK declarada para esa relación. El seguimiento se asocia al pedido web por una FK a `web_orders(id)`.

La bitácora guarda eventos de creación de nuevos pedidos web, cambios de `status` y altas/ediciones de guía. No contiene snapshots de nombre, teléfono, cédula, dirección, productos, importe, pagos ni URL de tracking; en la guía histórica registra solo un booleano que indica si cambió el enlace. La URL vigente existe únicamente en la fila de tracking. No hace backfill: los pedidos existentes no reciben eventos históricos ficticios. `inventory_movements` sigue siendo la bitácora existente de movimientos de inventario y no se duplica.

## Esquema candidato

- `web_order_tracking`: una fila actual por pedido, transportadora, número, URL HTTPS opcional y metadatos de creación/edición. FK `ON DELETE RESTRICT`, para no borrar trazabilidad accidentalmente.
- `storefront_change_log`: tabla append-only para eventos admitidos, valores anterior/nuevo de estado, transportadora/número de guía, booleano de cambio de enlace y actor UUID. Nunca almacena URL snapshots. Índice por pedido/fecha.

Ambas tablas habilitan RLS y solo conceden SELECT a `authenticated` bajo `public.is_store_admin()`. No se conceden escrituras directas a roles de cliente; las operaciones utilizan RPC controladas. Las funciones `SECURITY DEFINER` tienen `search_path` fijo, exigen `auth.uid()` y `is_store_admin()`, límites de filas y validación de texto/URL. `anon` y `service_role` no reciben EXECUTE. Funciones trigger internas registran solo los campos permitidos.

## RPCs

- `admin_list_web_order_tracking(p_order_ids uuid[])`: devuelve guías solo para IDs de pedidos web existentes enviados por el panel. Rechaza arrays nulos, multidimensionales, con elementos nulos o con más de 5.000 UUIDs; no trunca resultados silenciosamente.
- `admin_list_web_order_change_history(p_order_id uuid, p_limit integer default 50)`: lectura del historial de un pedido, limitada a 200.
- `admin_set_web_order_tracking(p_order_id uuid, p_carrier_name text, p_tracking_number text, p_tracking_url text default null)`: alta/edición idempotente de guía; solo HTTPS, sin espacios, credenciales o control characters. Un guardado idéntico no crea otro evento.

Dos triggers registran la creación y los cambios futuros de estado en `web_orders` y cambios en la guía. La actualización de estado sigue pasando por la RPC existente que sincroniza estado e inventario; esta migración no la sustituye ni cambia su contrato.

## Panel administrativo

Dentro de la vista existente Pedidos, cada tarjeta muestra una guía cuando está disponible. El diálogo reutilizable permite editarla y consultar el historial. El control permanece deshabilitado si la RPC no está disponible o la lista supera el límite seguro; el fallo se muestra sin afectar la lista ni la actualización normal de pedidos. Tras guardar, la UI espera la actualización del listado y luego del historial; cualquier fallo de recarga oculta el historial previo. También verifica la época de autenticación y descarta respuestas obsoletas al cerrar/cambiar sesión. Los enlaces de tracking se abren solo si se validan como HTTPS y con `noopener noreferrer`.

## Pruebas

`bash tests/run_order_tracking_audit_local.sh` aplica la migración en una base PostgreSQL 17 scratch descartable y ejecuta `tests/order_tracking_audit_local_regression.sql`. Prueba RLS, roles, alta/edición idempotente, URL inválida, orden inexistente, triggers de estado, scope y límites del UUID array, ausencia de backfill y cleanup. `node tests/order_tracking_admin_ui_regression.mjs` prueba en VM la secuencia list→history tras guardar, el descarte de auth epoch obsoleto y la limpieza de historial ante fallos; también cubre el contrato admin y se incluye en `scripts/validate.mjs`.

Estas pruebas no conectan con Supabase, una API de transportadora ni la tienda real. No prueban activación productiva, credenciales de transportadoras ni la restauración de una copia real.

## Activación futura

Migración candidata: `20261114010000_web_order_tracking_and_change_log.sql`. Antes de aplicarla se requiere una restauración verificable, reconcile metadata-only del historial DDL y aprobación explícita del lote de migraciones pendientes. No ejecutar el archivo mediante SQL Editor en producción durante esta fase.
