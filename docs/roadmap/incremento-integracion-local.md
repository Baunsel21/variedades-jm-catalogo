# Incremento de integración local — 8 de noviembre de 2026

## Estado y límites

Cambios preparados en la rama `feature/admin-dashboard-critical-fixes`, basada en el slice de filtros/paginación administrativa. El usuario autorizó commit/merge; tras superar la validación se guardan mediante commit local, sin push, merge a `main`, publicación ni cambios remotos de Supabase. No se han utilizado contraseñas, OTP, tokens ni claves privadas reales, realizado cobros, creado pedidos de prueba ni ejecutado migraciones en el proyecto compartido.

Este incremento integra piezas seguras del backlog, no termina las ocho fases. El único Supabase observado no tiene staging aislado. La instalación de SQL/Edge Functions y su paridad operativa no queda demostrada por el parser ni los fixtures locales.

## Correcciones e integración

### Cuenta y sesión administrativa

`admin.html` añade recuperación delegada a Supabase Auth, cambio de contraseña y cierre de otras/todas las sesiones. La verificación de contraseña actual usa un cliente Auth temporal con `persistSession:false`, `autoRefreshToken:false` y `detectSessionInUrl:false`, para no degradar la sesión principal AAL2. Se valida identidad y permiso antes de actualizar la contraseña. Recovery omite la contraseña actual solo después de confirmar la misma cuenta administradora.

MFA TOTP incluye alta, QR/secret temporal, challenge/verify y baja que requiere verificación. El gate de acceso ocurre después de `is_store_admin` y antes de mostrar el panel. Si la API MFA existe pero no confirma el nivel requerido, se bloquea la sesión; el fallback de SDK sin API se comunica sin afirmar que haya MFA activo. El antiguo step-up de contraseña incompleto fue retirado y sus referencias huérfanas eliminadas. Se limpian campos/QR al cerrar sesión.

La revisión independiente detectó una carrera: logout mientras esperaba MFA podía permitir que el arranque antiguo reabriera el panel. Se añadió validación de época después de los await del gate y antes de conceder acceso, con fixture diferido del arranque real. Assurance incompleto falla cerrado.

### Inventario y pedidos COD

La disponibilidad administrativa se verifica contra `get_public_catalog`; una consulta fallida, producto omitido o variantes incompletas no se sustituye por stock físico. La UI distingue disponibilidad no verificada de agotado y el registro final de venta vuelve a bloquearla. Una lista live vacía no revive variantes antiguas.

La migración local `20261108110000_guard_web_order_status_transitions.sql` conserva las RPC legacy, agrega guard privado con lock de fila y v2 con estado esperado. Permite pendiente→confirmado/rechazado; confirmado→enviado/rechazado/devuelto; enviado→entregado/devuelto; entregado→devuelto; terminales no avanzan. Revoca mutaciones directas de `web_orders`. El checkout COD usa su RPC autorizada, no INSERT directo. La UI trata carreras como conflictos y vuelve a consultar.

Limitación explícita de compatibilidad: el wrapper legacy de dos argumentos valida matriz/lock, pero no puede detectar el estado esperado que su firma no recibe. El frontend anterior todavía depende de él; no se revoca a ciegas. Se prepara `docs/deployment/restrict_legacy_admin_order_status_after_frontend.sql` para revocar ambas entradas legacy a los roles cliente solamente después de comprobar que todos los clientes/integraciones usan v2. Hasta ese corte no se afirma protección optimista de todas las rutas. Las funciones/firma internas se conservan.

### Tarifas y campañas

`index.html` no presenta valores de respaldo como tarifas vigentes antes de leer configuración ni después de un fallo de refresco. Barra/porcentaje e importe total quedan pendientes/no disponibles; la confirmación sigue forzando lectura y cotización server-side. El snapshot anterior permanece en memoria, pero no se muestra como actualizado tras un fallo. Se neutralizaron únicamente mensajes fallback de campañas que prometían envío gratis; la copia configurada en Supabase no se modifica.

### Descubrimiento del catálogo

Se reutilizó el slice `da8d811` de `feature/catalog-discovery-favorites`, no una copia completa de una rama antigua. Incluye filtros accesibles de categoría/color/talla/precio/disponibilidad, URL de filtros sin favoritos ni PII, lista de deseos local ID-only con clave propia, código de producto, WhatsApp contextual y fallback de imagen. El filtro color+talla exige una misma variante que cumpla ambos criterios; no puede combinar stock de variantes diferentes.

Las claves Wompi/COD/carrito y el TTL de 10 minutos permanecen intactos. Se incluyen localmente la migración mínima de `get_public_catalog_created_at` y su regresión SQL; si no está instalada o faltan fechas, el orden por novedad no se anuncia como disponible.

### Dashboard y datos

Inicio incorpora Hoy y últimos siete días incluidos hoy, en Colombia. Ingresos/promedio se calculan sobre registros no archivados de `sales`, no pedidos ni una contabilidad conciliada. Se excluyen fechas/importes inválidos indicando resumen parcial. Stock bajo y agotado incluyen solo disponibilidad verificada. Pendientes COD y casos Wompi se consultan explícitamente, separados, con fecha/fuente/estado y límite de hasta 50 casos Wompi (50 se expresa como “50 o más”).

Los loaders de panel, COD y conciliación descartan respuestas de una época de sesión anterior. Cerrar sesión borra snapshots/marcas y la previsualización CSV; un fallo no se interpreta como cero.

Seguimiento Fase 6 para Clientes: la consulta diferida del listado selecciona solo `id,name`. Teléfono/nota se consultan con una acción explícita, tras revalidar el mismo usuario y `is_store_admin`; los resultados solo viven en memoria mientras se muestran. Ocultar, salir de la sección, actualizar la lista o cerrar sesión descarta la caché volátil y limpia la búsqueda. No se escribe PII en URL, localStorage, sessionStorage ni logs. La historia de pedidos/recurrencia del cliente permanece pendiente.

La previsualización CSV es un dry-run puro y UI local: hasta 1 MiB/500 filas en el panel, esquema `code,name,category,cost,sale_price,quantity`, enteros COP/stock no negativos, cabeceras exactas y duplicados comparados con snapshot. No acepta variantes/PII, no evalúa fórmulas, no sube archivos ni habilita escritura. Se corrigió el cierre de la última celda entrecomillada que duplicaba una columna. El contenido se escapa y una lectura cancelada no revive la vista.

El documento de contratos de pedidos ya preparado en PR #16 se integra sin inventar relaciones entre `orders` y `web_orders`.

## Archivos afectados

Código: `admin.html`, `index.html`, `scripts/validate.mjs`, `scripts/fase7_csv_preview.mjs`.

SQL local: `supabase/migrations/20261108080000_public_catalog_sort_metadata.sql`, `supabase/migrations/20261108110000_guard_web_order_status_transitions.sql`, `tests/catalog_discovery_metadata.sql`, `tests/cod_regression.sql`.

Rollout manual pendiente: `docs/deployment/restrict_legacy_admin_order_status_after_frontend.sql` (no es migración automática ni se ejecutó).

Regresiones independientes: `tests/admin_account_security_regression.mjs`, `tests/admin_clients_privacy_regression.mjs`, `tests/dashboard_availability_regression.mjs`, `tests/dashboard_period_regression.mjs`, `tests/phase1_quote_parity_regression.mjs`, `tests/catalog_discovery_regression.mjs`, `tests/fase7_csv_preview.mjs`, `tests/admin_csv_preview_regression.mjs`.

Documentación: este informe, `TODO-mejoras.md`, `fase-3-descubrimiento-catalogo.md`, `fase-5-modelo-pedidos.md`, `fase-7-trazabilidad-importacion-backup.md`.

## Validación local

Las pruebas se mantienen separadas. Comandos de cierre:

```bash
node tests/admin_account_security_regression.mjs
node tests/admin_clients_privacy_regression.mjs
node tests/dashboard_availability_regression.mjs
node tests/dashboard_period_regression.mjs
node tests/phase1_quote_parity_regression.mjs
node tests/catalog_discovery_regression.mjs
node tests/fase7_csv_preview.mjs
node tests/admin_csv_preview_regression.mjs
node scripts/validate.mjs
git diff --check
```

Resultado del incremento anterior: sus siete regresiones independientes y `node scripts/validate.mjs` pasaron. En la continuación de privacidad también pasó `node tests/admin_clients_privacy_regression.mjs` (selección real `id,name`, reveal-on-demand `phone,note`, revalidación admin, escape HTML, limpieza y loaders stale), además de `admin_account_security_regression.mjs`, `dashboard_period_regression.mjs`, `node scripts/validate.mjs` y `git diff --check`. El test de catálogo compila JavaScript inline y el validador comprueba sintaxis del panel.

Una revisión independiente read-only de `fetchTablePage`, `renderClientes`, `toggleClientContact`, `clearClientContactDetails` y el loader diferido confirmó que no queda un problema crítico de privacidad en este slice.

`pglast` analizó sin ejecutar: metadata de novedad (4 sentencias SQL), guard de estados COD (12 sentencias/5 unidades PLpgSQL), regresión metadata (1/1), regresión COD (2/1) y corte manual legacy (6/2). La revisión independiente detectó la carrera MFA, ya corregida y probada, y el límite de expected-status de las firmas legacy, documentado con corte manual pendiente. Estos controles no ejecutan SQL ni verifican comportamiento publicado.

## Pendientes de lanzamiento y fases abiertas

1. Staging aislado con esquema real: aplicar migraciones en orden, revisar RLS/ACL, ejecutar regresiones SQL con rollback y pruebas concurrentes COD/cupones/reservas/webhooks. No sustituirlo por pruebas de escritura en el único proyecto compartido. Verificar todos los clientes v2 antes del corte manual de RPC legacy administrativas; sin ese corte la comprobación de estado esperado sigue limitada a v2.
2. Supabase Auth: configurar redirect URLs de recuperación hacia `admin.html`, correo/SMTP, política de contraseña y disponibilidad/configuración MFA. Probar recovery, AAL2 y cancelación en cuentas sintéticas, no en una cuenta real durante esta tarea.
3. Wompi: confirmar que `prepare_storefront_wompi_checkout` y demás contratos estén instalados donde se sirve la Edge Function, probar retorno/PSE en sandbox sin cobro real, y definir procedimiento autorizado de conciliación. La comparación COD legacy con `round` requiere revisión de política COP fraccionaria y regresión específica en otra migración, no cambio silencioso de historial.
4. Fase 3: etiquetas/ofertas con contrato autoritativo y recuperación avanzada de carrito sin duplicar/renovar reservas. Los ETA no se inventan.
5. Fase 5/6: contrato canónico de canales, paginación server-side, historial/recurrencia de clientes, logística separada con bitácora y notificaciones configurables. No unir pedidos por PII/monto/fecha.
6. Fase 7: importación real con RPC transaccional y rollback, bitácora append-only, allowlist/retención PII, manifest R2 y restauración verificada. El JSON de backup actual es parcial, no un restaurador ni un backup completo de fotos.
7. Fase 8: políticas comerciales/identidad legal aprobadas, SEO crawler-visible por producto, PWA sin datos de precio/stock persistentes y medición de rendimiento. No se inventan políticas ni se activa un service worker sin comprobar los riesgos de disponibilidad.

No se marca completa una fase por un commit, una PR en borrador, un PASS estático o un parseo SQL.
