# Auditoría de cierre y handoff para Manus — Sirevya

**Fecha de verificación:** 2026-11-10  
**Repositorio:** `Baunsel21/variedades-jm-catalogo`  
**Rama base revisada:** `main`  
**Último commit observado en main:** `93eee28699e508efcc78e38c5ee48e11fec511c1` — `feat(telegram): add professional order actions and tracking events (#123)`

> Este documento es un handoff operativo basado en metadatos de Supabase, catálogo de funciones/permisos, migraciones registradas, estado de Edge Functions y comparación de archivos desplegados. No es una certificación de tienda lista para producción ni autoriza DDL sin backup restaurable.
>
> **Nota de vigencia:** este contenido es una captura histórica de `main@93eee286`. Para el estado posterior a PR #125–#127, porcentajes por fase y límites de verificación del respaldo, consultar [`2026-11-10-cierre-estado-actual.md`](2026-11-10-cierre-estado-actual.md), que prevalece ante cualquier diferencia de estado.

## Instrucción principal para Manus

Continúa desde el estado real descrito aquí. No repitas las auditorías ya demostradas, no vuelvas a implementar funciones que ya están activas y no marques una fase completa solo porque el código o la migración existen. Primero reconcilia el estado real de Supabase con los documentos antiguos del repositorio: algunos runbooks están desactualizados frente al despliegue actual.

Conserva el funcionamiento existente y no cambies precios, tarifas, umbrales, ciudades COD, referencias, TTL de reservas de 10 minutos, claves de almacenamiento local, estados históricos, pedidos, inventario ni configuración de pagos. No hagas cargos reales. Wompi/PSE solo se valida con sandbox del comercio cuando esté disponible; COD y cupones se validan con fixtures sintéticas en una copia aislada.

## 1. Estado comprobado en Supabase

Proyecto: `hnlbbtnfmbnbkcgegufa`.

### Migraciones

Supabase devuelve **25 migraciones registradas**, incluidas:

- Seguridad/RLS y permisos mínimos del panel.
- Tarifas nacionales y guard COD.
- `20261108070000_storefront_city_shipping_rules`.
- Calendario/prioridad de combos.
- Restricción de RPC internas de reservas.
- Outbox y scheduler de Telegram.
- Importación CSV transaccional.
- Validación de cédula para COD.
- Backend de cupones `storefront_coupons`.

**Corrección de documentación:** los documentos `docs/roadmap/fase-2-tarifas-por-destino.md`, `docs/roadmap/fase-4-cupones.md` y `docs/deployment/telegram-automatic-outbox-runbook.md` conservan frases antiguas que dicen que ciertas migraciones/funciones no están aplicadas. La lista actual de migraciones y las RPC desplegadas contradicen esas frases. Actualizar esos documentos con la evidencia de esta auditoría, sin afirmar que el CRUD o el checkout completo ya pasaron pruebas reales.

### Tarifas por ciudad/zona — backend presente

Se encontraron las RPC:

- `admin_list_storefront_shipping_rules()`
- `admin_save_storefront_shipping_rule(...)`

Ambas son `SECURITY DEFINER`, con EXECUTE para `authenticated` y sin EXECUTE para `anon`. La migración de ciudad/zona aparece registrada. No se modificaron reglas o tarifas reales. Falta una prueba CRUD controlada desde una sesión de administrador y la regresión COD completa sobre una copia restaurada/aislada.

### Cupones — backend presente

Se encontraron las RPC:

- `admin_list_storefront_coupons()`
- `admin_save_storefront_coupon(...)`
- `get_storefront_cart_quote_with_coupon(...)`
- `create_contra_delivery_order_with_coupon(...)`
- `prepare_storefront_wompi_checkout(...)`

La migración `storefront_coupons` aparece registrada. ACL observadas:
- RPC admin de cupones: EXECUTE para `authenticated`, no para `anon`.
- Cotización pública con cupón y creación COD con cupón: EXECUTE para `anon` y `authenticated` (rutas públicas esperadas; validar sus guardas y cotización server-side).
- `prepare_storefront_wompi_checkout`: solo `service_role`.

La UI mantiene comportamiento fail-closed si faltan RPC. **La presencia de tablas/RPC no demuestra un ciclo completo de crear cupón, cotizar, reservar, pagar, confirmar/liberar y conciliar.** Ejecutar `tests/coupons_regression.sql` y pruebas de concurrencia/estados terminales solo en un clon aislado.

### Telegram automático — ACTIVO (no volver a instalar)

La lectura real contradice el runbook antiguo:

- `pg_cron` 1.6.4 instalado.
- `pg_net` 0.20.4 instalado.
- Job `sirevya-telegram-dispatch` activo, frecuencia `* * * * *`.
- `sirevya_telegram_notification_settings.enabled = true`.
- Secretos Vault requeridos presentes por nombre (no se consultaron valores).
- Edge Function `telegram-dispatch`: ACTIVE, versión 6, `verify_jwt=false`.
- Outbox: 18 registros con estado `sent` en el conteo observado.
- Triggers observadores presentes en `orders`, `web_orders`, `inventory_reservations`, `products` e `inventory_movements`.

No volver a aplicar migraciones ni desplegar de nuevo Telegram sin comparar primero el código y revisar el estado. El estado `sent` confirma que el worker completó filas según su contrato, pero no reemplaza una comprobación funcional controlada de que el teléfono/chat del administrador recibe los eventos esperados. No imprimir ni copiar tokens de Telegram ni secretos Vault.

### Edge Functions Wompi y Telegram — código desplegado coincide con GitHub

Funciones observadas como ACTIVE:

| Función | Versión activa | JWT |
|---|---:|---|
| `wompi-create-checkout` | 34 | `verify_jwt=false` |
| `wompi-webhook` | 27 | `verify_jwt=false` |
| `whatsapp-reserve-order` | 11 | `verify_jwt=false` |
| `telegram-test` | 1 | `verify_jwt=true` |
| `telegram-dispatch` | 6 | `verify_jwt=false` |

Comparación exacta realizada:
- `wompi-create-checkout/index.ts`: contenido desplegado idéntico al archivo de GitHub.
- `wompi-create-checkout/cedula.mjs`: idéntico.
- `wompi-webhook/index.ts`: idéntico.
- `telegram-dispatch/index.ts`: idéntico.
- `telegram-dispatch/core.mjs`: idéntico.

No desplegar otra vez estas funciones si no hay cambio de código necesario y validado. `verify_jwt=false` es intencional para Wompi/webhook y dispatcher; no cambiarlo sin revisar autenticación propia y el contrato del proveedor.

## 2. Hallazgos prioritarios de seguridad

### P0 — EXECUTE público innecesario en limpieza de reservas

El catálogo de privilegios confirma que estas dos funciones son `SECURITY DEFINER` y hoy permiten EXECUTE a `anon`, `authenticated` y `service_role`:

- `public.cleanup_inventory_reservations()`
- `public.release_expired_inventory_reservations()`

La primera cierra reservas vencidas y puede restituir stock para reservas heredadas `PENDING/WHATSAPP_RESERVED`; la segunda invoca la primera. No se encontró una llamada desde el frontend en el código buscado. Deben quedar accesibles solo por el proceso servidor autorizado (normalmente `service_role`/propietario/cron, según el caller real). Antes de cambiar ACL, revisar todas las llamadas, jobs y funciones dependientes, preparar migración reversible y regresión local de ACL/idempotencia.

**No ejecutar un REVOKE improvisado directamente en producción.** El cambio debe quedar versionado en una migración pequeña y validarse primero en una restauración aislada. No tocar `reserve_inventory` ni `confirm_inventory_reservation`: ya tienen permisos restringidos a `service_role` según el catálogo y migraciones anteriores.

### P0 — Privilegios directos de tablas con RLS como segunda barrera

La lectura de ACL/RLS encontró:

- `public.orders`: RLS habilitado, cero políticas; `anon` y `authenticated` conservan SELECT/INSERT/UPDATE/DELETE.
- `public.inventory_reservations`: RLS habilitado con política explícita `USING(false)` para anon/authenticated; ambos roles conservan privilegios directos CRUD.
- `public.product_images`: RLS habilitado con políticas para authenticated; anon conserva privilegios CRUD directos.
- `public.products`: anon SELECT permitido; no concede INSERT/UPDATE/DELETE (la lectura pública puede ser necesaria para el catálogo).
- `public.categories`: anon SELECT permitido; sin DML público.
- `public.web_orders`: políticas de lectura/actualización solo para authenticated; anon no tiene acceso directo CRUD.

RLS actualmente bloquea el acceso no autorizado en los tres primeros casos; no se observó evidencia de lectura de filas. Aun así, aplicar least privilege revocando grants directos innecesarios en una migración versionada, después de revisar dependencias y pruebas. No crear políticas amplias para tablas que usan RPC/Edge: “RLS habilitado sin políticas” puede ser una denegación intencional, no un permiso faltante.

### P1 — Funciones SECURITY DEFINER reportadas por Advisor

El Advisor reporta varias funciones por EXECUTE heredado. No hacer un revoke global. Clasificar una por una:
- Rutas públicas esperadas: catálogo público, cotización, configuración pública y creación COD validada.
- Rutas administrativas: deben verificar `is_store_admin()` dentro de la función y permitir authenticated solo si ese contrato está comprobado.
- Rutas internas: deben limitarse a service_role/propietario, incluyendo las dos funciones de limpieza indicadas arriba.

`is_store_admin()` también aparece ejecutable por anon; revisar si hace falta exponerla públicamente (no debería permitir leer datos ni mutar estado).

### P1 — Protección de contraseñas comprometidas

Supabase Security Advisor informa que la protección contra contraseñas comprometidas (HaveIBeenPwned) está desactivada. Activarla desde Auth → Security/Password Protection, comprobar impacto y documentar. Es un ajuste de Auth, no una migración SQL.

### P2 — Rendimiento

Advisor informa 5 claves foráneas sin índice de cobertura y 16 índices sin uso observado. No eliminar índices “unused” sin ventana de observación suficiente y sin revisar consultas reales. Añadir índices faltantes solo después de revisar cardinalidad/consultas y medir EXPLAIN en un clon. No ejecutar VACUUM/DDL ni cambiar índices a ciegas.

## 3. Restricción de backup y staging — bloqueo de cambios de producción

La documentación de preflight del repositorio registra que el proyecto está en plan Free, sin backup automático diario incluido, y que el ensayo local sintético de dump/restore no es un backup real de Sirevya.

Para un backup real se requiere una estación confiable con Supabase CLI v3, PostgreSQL 17/pg_dump, acceso privado a la URI de base de datos y destino cifrado. El runbook está en `docs/deployment/supabase-backup-restore-preflight.md`. No pegar URI, claves, dumps ni PII en chat, GitHub, Preview o logs.

**No se ha demostrado un backup real restaurable de este proyecto ni existe staging aislado verificado.** Por eso no ejecutar más DDL, migraciones, cambios de ACL, despliegues Edge ni pruebas SQL que inserten/actualicen filas en el proyecto de producción. Preparar el backup y una restauración aislada antes de la siguiente fase de cambios. Esta restricción no impide auditorías read-only, pruebas locales con fixtures ni cambios documentales.

## 4. Fases: estado real y siguiente trabajo

### Fase 1 — Envíos configurables
Código y configuración básica publicados. El guard COD y RPCs están presentes. Falta cerrar matriz end-to-end de checkout/COD/Wompi con configuración de envío, frontera $129.999/$130.000, alias Cali y reglas actualizadas, sin cargos reales. No cambiar los valores comerciales actuales.

### Fase 2 — Tarifas ciudad/zona
Migración y RPCs aparecen aplicadas/presentes. Falta validar CRUD desde admin, precedencia ciudad/zona, fallback, ciudad desconocida, Cali/alias, cambios con carrito abierto y regresión COD sobre esquema completo restaurado. Documento: `docs/roadmap/fase-2-tarifas-por-destino.md`.

### Fase 3 — Descubrimiento/conversión
El TODO muestra subfunciones completas y otras pendientes. Completar etiquetas de producto guardadas, filtros/orden restantes, galería/zoom, guía de tallas, relacionados, stock y fallback de imágenes, sin volver a introducir el filtro de rango de precio que fue retirado. Documento de criterios: `docs/roadmap/TODO-mejoras.md`.

### Fase 4 — Promociones y cupones
La migración de cupones aparece aplicada y las RPC principales existen. Corregir documentación obsoleta. Falta demostrar CRUD real de cupones, límites global/cliente, vigencia en America/Bogota, conflicto cupón/combos, cotización posterior al descuento, holds/TTL, COD idempotente, Wompi APPROVED/DECLINED/VOIDED/ERROR, aprobaciones tardías y conciliación. Ejecutar pruebas solo en clon aislado. Documento: `docs/roadmap/fase-4-cupones.md`.

### Fase 5 — Pedidos y pagos
Mantener separados `orders` (Wompi) y `web_orders` (COD) hasta que el backup restaurado permita verificar constraints, FK, cardinalidad, triggers y claves. No unir por teléfono, email, nombre, ciudad, importe o proximidad temporal. Diseñar proyección administrativa con identidad de canal y `needs_review`, primero read-only. Documento: `docs/roadmap/fase-5-modelo-pedidos.md`.

### Fase 6 — Panel operativo
Filtros/paginación visual de pedidos ya publicados; hoy la lectura técnica sigue limitada a páginas de 1.000 filas y no es paginación server-side. Completar dashboard por periodos, paginación real, clientes/historial autorizado, logística separada (transportadora, guía, estado) y conciliación. No duplicar filas ni datos personales. Documento: `docs/roadmap/fase-6-pedidos-filtros-paginacion.md`.

### Fase 7 — Trazabilidad/importación/datos
La migración `admin_csv_product_import_atomic` aparece aplicada. Verificar importación CSV end-to-end con preview/dry-run, duplicados, límites, rollback y permisos en clon; revisar bitácora append-only y backups de assets R2. No ejecutar importación real de catálogo sin aprobación explícita del lote y copia de seguridad.

### Fase 8 — Confianza, SEO y crecimiento
La migración de least privilege está aplicada y la mayoría de los checks de código están marcados como listos. Sigue pendiente confirmar el build de GitHub Pages y la versión servida. Revisar políticas/FAQ, metadatos y rutas indexables, PWA, imágenes, rendimiento y métricas. Mantener precios/stock fuera de cachés obsoletas.

## 5. Despliegue y verificación que faltan

El checklist `TODO-fase8-seguridad-produccion.md` mantiene sin marcar la verificación de GitHub Pages. En esta auditoría no se obtuvo evidencia concluyente de un build reciente de Pages para el último commit ni se completó un smoke test autenticado del sitio. No afirmar que el sitio público está 100% validado.

Después de cada merge/deploy:
1. Confirmar build/estado de Pages para el SHA esperado.
2. Verificar HTTP 200 de `/`, `/admin.html` y rutas SEO de productos/categorías.
3. Confirmar que el HTML servido corresponde al SHA publicado (no solo a main).
4. Probar móvil/desktop y una sesión admin válida.
5. Smoke test sin crear pedidos reales ni ejecutar pagos; para checkout usar sandbox o fixtures aisladas.
6. Revisar Advisor y ACL/RLS después de migraciones.

## 6. Entregables que Manus debe dejar al cerrar

- PRs pequeños y reversibles; no empujar directo a main cambios de seguridad/checkout/DB.
- Migraciones con preflight de prerequisitos, ACL explícitas y pruebas de rollback/local fixture.
- Resultado de `node scripts/validate.mjs`, regresiones relevantes, `git diff --check`, pruebas SQL sobre clon restaurado y evidencia del build Pages.
- Tabla de cada fase con estado: `terminada`, `parcial`, `bloqueada`; enlace a PR/commit y prueba que respalda el estado.
- Registro de cambios reales en Supabase separado de los cambios de código/documentación.
- Lista final de riesgos residuales y pasos operativos del comercio.

**Definición de 100%:** no es “todos los checkboxes marcados”. Es que el código publicado, migraciones aplicadas, ACL/RLS, Edge Functions, checkout, inventario, tarifas, COD, Wompi, cupones, combos, panel y despliegue hayan sido verificados con pruebas reproducibles y sin cambios no respaldados. Si falta backup/restauración o un sandbox de pagos, declarar el bloqueo explícitamente en vez de certificar producción.
