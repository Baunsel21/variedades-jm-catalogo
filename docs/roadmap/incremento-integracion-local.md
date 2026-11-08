# Incremento de integración local — 8 de noviembre de 2026

## Estado y límites

Cambios preparados en la rama `feature/admin-dashboard-critical-fixes`, basada en el slice de filtros/paginación administrativa. El usuario autorizó commit y push de la rama; este incremento se mantiene fuera de `main`, sin merge ni despliegue. No se aplicaron migraciones ni DML remoto de Supabase. No se han utilizado contraseñas, OTP, tokens ni claves privadas reales, realizado cobros ni creado pedidos de prueba.

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

### Carrito y reservas — endurecimiento acotado

`index.html` unifica la vigencia local de las referencias con helper que mantiene inclusivo el límite exacto de diez minutos, admite hasta 60 segundos de desfase futuro de reloj y descarta punteros pendientes/activos más allá de ese margen. La lectura/restauración no cambia el `startedAt`; `savePendingWompiReference` conserva la hora de inicio al reintentar. Se mantienen las claves históricas `jm_wompi_*` y `jm_cod_order_draft_v1`. `tests/cart_recovery_regression.mjs` ejecuta las funciones reales con reloj y almacenamiento sintéticos, y comprueba además que el resumen usa el precio de catálogo actual y que COD/Wompi cotizan antes de crear pedido/reserva o abrir el checkout del proveedor.

Carrito y checkout muestran en una región `aria-live` un aviso en texto plano cuando el precio del snapshot cambió o falta un producto/precio del catálogo. Al restaurar una reserva, las líneas sin producto actual se conservan; se muestran como “Por verificar”, se ocultan subtotal/envío/total, tarifa/beneficio superior y resúmenes/ahorros combo parciales, y guards detienen payload, checkout, reserva Wompi y RPC COD antes de efectos. Sin ciudad o con “Otra” vacía tampoco se muestra envío “GRATIS” ni total. La re-cotización revalida estado tras los `await`. Las previews/selectores/toast de combos exigen precio verificado y no exponen ahorros ni agregan ítems con `sale_price` nulo/negativo. Las cotizaciones SQL locales fallan cerrado si `sale_price` es `NULL`; el Edge Wompi local exige quote válida y equivalencia canónica de ítems. Es revisión estática del código versionado, no confirmación de despliegue. Esto no termina la recuperación avanzada: faltan aviso de stock con fuente autorizada, coordinación entre dispositivos y prueba concurrente de reutilización en staging. No se cambió TTL ni esquema de reservas.

### Dashboard y datos

Inicio incorpora Hoy, últimos siete días incluidos hoy y mes calendario hasta hoy, en Colombia. El mes comienza el día 1 local, no es un rango móvil de 30 días. Ingresos/promedio se calculan sobre registros no archivados de `sales`, no pedidos ni una contabilidad conciliada. Se excluyen fechas/importes inválidos indicando resumen parcial. Stock bajo y agotado incluyen solo disponibilidad verificada. Pendientes COD y casos Wompi se consultan explícitamente, separados, con fecha/fuente/estado y límite de hasta 50 casos Wompi (50 se expresa como “50 o más”).

Los loaders de panel, COD y conciliación descartan respuestas de una época de sesión anterior. Cerrar sesión borra snapshots/marcas y la previsualización CSV; un fallo no se interpreta como cero.

Seguimiento Fase 6 para Clientes: la consulta diferida del listado selecciona solo `id,name`. Teléfono/nota se consultan con una acción explícita, tras revalidar el mismo usuario y `is_store_admin`; los resultados solo viven en memoria mientras se muestran. Ocultar, salir de la sección, actualizar la lista o cerrar sesión descarta la caché volátil y limpia la búsqueda. No se escribe PII en URL, localStorage, sessionStorage ni logs. La historia de pedidos/recurrencia del cliente permanece pendiente.

La continuación añade una expansión explícita que consulta como máximo diez ventas activas por `sales.client_id`, vínculo real de la tabla canónica de ventas, y solicita conteo exacto. Muestra carga/error/resultado, pero advierte que las filas no representan pedidos ni recurrencia; no une COD/Wompi. La consulta minimiza columnas y se ejecuta solo tras revalidar la misma sesión y `is_store_admin`. La revisión independiente read-only no encontró issues críticos.

La previsualización CSV es un dry-run puro y UI local: hasta 1 MiB/500 filas en el panel, esquema `code,name,category,cost,sale_price,quantity`, enteros COP/stock no negativos, cabeceras exactas y duplicados comparados con snapshot. No acepta variantes/PII, no evalúa fórmulas, no sube archivos ni habilita escritura. Se corrigió el cierre de la última celda entrecomillada que duplicaba una columna. El contenido se escapa y una lectura cancelada no revive la vista.

El documento de contratos de pedidos ya preparado en PR #16 se integra sin inventar relaciones entre `orders` y `web_orders`.

### Fase 6-S2 — paginación server-side de pedidos

Se añade la migración local `20261108120000_admin_web_orders_server_pagination.sql` y una consulta `admin_list_web_orders_page_v1` que valida `is_store_admin()`, limita filas a 20/50/100 y devuelve solo los campos de las tarjetas, total filtrado, conteos globales y facetas acotadas. Búsqueda literal/acentos y fechas Colombia se procesan en servidor; la UI identifica facetas truncadas. El fallback solo se activa cuando el error de ausencia nombra exactamente la RPC, revalida mismo usuario/admin/AAL cuando el SDK lo ofrece y usa una proyección mínima protegida también por RLS; no convierte errores internos 42883 en SELECT legacy. Búsqueda conserva semántica entre modo server-side y fallback, y las horas se muestran en Bogotá. No hay join con Wompi, `sales` o inventario ni escrituras en el servidor.

El parser de SQL pasó localmente, y `tests/orders_server_pagination_regression.sql` valida firma/search_path/ACL con rollback. `tests/admin_orders_server_pagination_regression.mjs` prueba request, fechas, búsqueda entre campos, conteos globales, topes de página/facetas, fallos internos, fallback revalidado, cambio de filtro durante vuelo y respuesta tardía tras logout. No se ejecutó el SQL contra el único proyecto Supabase compartido. La RPC materializa base, cuenta y agrega facetas en cada request: falta staging, smoke con datos sintéticos, `EXPLAIN` y medición con volumen real antes de declarar comportamiento/costo validados.

## Archivos afectados

### Continuación — mensaje COD configurable

Se añade editor y preview de título/contenido COD en Configuración y aviso accesible bajo contraentrega en checkout. El helper `scripts/cod_notice.js` comparte validación Unicode (120/3.000 caracteres), párrafos/listas y escape de HTML. La migración `20261108130000_storefront_cod_notice.sql` comienza con el mensaje desactivado, sin promesas inventadas; tabla privada con RLS y RPCs admin protegidas. La lectura pública oculta borradores desactivados. Fallos/payload inválido solo ocultan copy y no alteran pagos, cotización, ciudades o reservas. El editor descarta respuestas tardías y exige recarga si no puede confirmar un guardado. Ver [`modulo-4-mensaje-contraentrega.md`](modulo-4-mensaje-contraentrega.md).

Archivos propios de la continuación: `admin.html`, `index.html`, `scripts/cod_notice.js`, `scripts/validate.mjs`, la migración anterior, `tests/cod_notice_regression.mjs`, `tests/admin_cod_notice_regression.mjs`, `tests/cod_notice_regression.sql`, este informe, el backlog y la nota del módulo 4. No implementa envío/plantillas de WhatsApp, snapshots históricos ni logística.

Código: `admin.html`, `index.html`, `scripts/validate.mjs`, `scripts/fase7_csv_preview.mjs`.

SQL local: `supabase/migrations/20261108070000_storefront_city_shipping_rules.sql`, `supabase/migrations/20261108080000_public_catalog_sort_metadata.sql`, `supabase/migrations/20261108090000_storefront_combo_calendar_priority.sql`, `supabase/migrations/20261108110000_guard_web_order_status_transitions.sql`, `supabase/migrations/20261108120000_admin_web_orders_server_pagination.sql`, `tests/catalog_discovery_metadata.sql`, `tests/promotion_priority_regression.sql`, `tests/cod_regression.sql`, `tests/orders_server_pagination_regression.sql`.

Rollout manual pendiente: `docs/deployment/restrict_legacy_admin_order_status_after_frontend.sql` (no es migración automática ni se ejecutó).

Regresiones independientes: `tests/admin_account_security_regression.mjs`, `tests/admin_clients_privacy_regression.mjs`, `tests/admin_client_history_regression.mjs`, `tests/admin_orders_server_pagination_regression.mjs`, `tests/dashboard_availability_regression.mjs`, `tests/dashboard_period_regression.mjs`, `tests/admin_dashboard_month_regression.mjs`, `tests/phase1_quote_parity_regression.mjs`, `tests/catalog_discovery_regression.mjs`, `tests/combo_preview_regression.mjs`, `tests/catalog_price_integrity_regression.mjs`, `tests/cart_recovery_regression.mjs`, `tests/fase7_csv_preview.mjs`, `tests/admin_csv_preview_regression.mjs`, `tests/cod_notice_regression.mjs`, `tests/admin_cod_notice_regression.mjs`.

Documentación: este informe, `TODO-mejoras.md`, `fase-3-descubrimiento-catalogo.md`, `fase-5-modelo-pedidos.md`, `fase-6-pedidos-filtros-paginacion.md`, `fase-6-s2-paginacion-server-side.md` y `fase-7-trazabilidad-importacion-backup.md`.

## Validación local

Las pruebas se mantienen separadas. Comandos de cierre:

```bash
node tests/admin_account_security_regression.mjs
node tests/admin_clients_privacy_regression.mjs
node tests/admin_client_history_regression.mjs
node tests/admin_orders_server_pagination_regression.mjs
node tests/dashboard_availability_regression.mjs
node tests/dashboard_period_regression.mjs
node tests/admin_dashboard_month_regression.mjs
node tests/phase1_quote_parity_regression.mjs
node tests/catalog_discovery_regression.mjs
node tests/combo_preview_regression.mjs
node tests/catalog_price_integrity_regression.mjs
node tests/cart_recovery_regression.mjs
node tests/fase7_csv_preview.mjs
node tests/admin_csv_preview_regression.mjs
node tests/cod_notice_regression.mjs
node tests/admin_cod_notice_regression.mjs
node scripts/validate.mjs
python3 -c "from pathlib import Path; from pglast import parse_sql,parse_plpgsql; [print(p, len(parse_sql(Path(p).read_text())), len(parse_plpgsql(Path(p).read_text()))) for p in ['supabase/migrations/20261108120000_admin_web_orders_server_pagination.sql','tests/orders_server_pagination_regression.sql']]"
python3 -c "from pathlib import Path; from pglast import parse_sql,parse_plpgsql; [print(p, len(parse_sql(Path(p).read_text())), len(parse_plpgsql(Path(p).read_text()))) for p in ['supabase/migrations/20261108070000_storefront_city_shipping_rules.sql','supabase/migrations/20261108090000_storefront_combo_calendar_priority.sql','tests/promotion_priority_regression.sql']]"
git diff --check
```

Resultado del incremento anterior: sus siete regresiones independientes y `node scripts/validate.mjs` pasaron. En la continuación de privacidad pasaron `node tests/admin_clients_privacy_regression.mjs` (selección real `id,name`, reveal-on-demand `phone,note`, revalidación admin, escape HTML, limpieza y loaders stale) y `node tests/admin_client_history_regression.mjs` (venta por `client_id`, no pedidos, corte de filas, orden/escape y fuente con error separada), además de `admin_account_security_regression.mjs`, `dashboard_period_regression.mjs`, `node scripts/validate.mjs` y `git diff --check`. El test de catálogo compila JavaScript inline y el validador comprueba sintaxis del panel.

Una revisión independiente read-only de `fetchTablePage`, `renderClientes`, `toggleClientContact`, `clearClientContactDetails` y el loader diferido confirmó que no queda un problema crítico de privacidad en este slice.

`pglast` analizó sin ejecutar: metadata de novedad (4 sentencias SQL), guard de estados COD (12 sentencias/5 unidades PLpgSQL), regresión metadata (1/1), regresión COD (2/1) y corte manual legacy (6/2). La revisión independiente detectó la carrera MFA, ya corregida y probada, y el límite de expected-status de las firmas legacy, documentado con corte manual pendiente. Estos controles no ejecutan SQL ni verifican comportamiento publicado.

**F6-S2 — pruebas ejecutadas en esta continuación:** PASÓ `node tests/admin_orders_server_pagination_regression.mjs`, `node tests/dashboard_period_regression.mjs`, `node tests/admin_account_security_regression.mjs`, `node scripts/validate.mjs`, `node --check` para las pruebas editadas, parseo local de la nueva migración (7 sentencias/3 cuerpos PL/pgSQL) y su prueba (3/1), `node --check` de ambos scripts inline de `admin.html` y `git diff --check`. No se ejecutó la prueba SQL en Supabase. La única consulta remota fue metadata read-only (`relrowsecurity`, grants y policies de `web_orders`), sin filas de negocio.

**Mensaje COD — cierre local:** PASARON `cod_notice_regression.mjs`, `admin_cod_notice_regression.mjs`, `admin_account_security_regression.mjs`, `admin_orders_server_pagination_regression.mjs`, `dashboard_period_regression.mjs`, `phase1_quote_parity_regression.mjs`, `scripts/validate.mjs` y whitespace. El helper y tests pasaron `node --check`; JavaScript inline se comprobó como JavaScript y JSON-LD como JSON. `pglast` aceptó migración 16/4 y test 3/1. La revisión independiente encontró trim Unicode diferente en SQL y una carrera de frescura del aviso: ambos quedaron corregidos con fixtures específicos. ACL PUBLIC en la nueva regresión se verifica como grantee=0, no nombre de rol. No hubo autenticación real, lecturas de negocio, escritura remota ni ejecución del test SQL en esta continuación.

**Resumen mensual — incremento separado:** añade solo la opción del selector y el inicio del mes en `summarizeDashboardPeriod`, sin consultas ni escrituras nuevas. Archivos: `admin.html`, `tests/admin_dashboard_month_regression.mjs`, backlog y este informe. PASARON el test mensual (medianoche Colombia, cambio de año, febrero bisiesto, futuro/mes anterior excluidos, importes inválidos y paridad día/semana), `dashboard_period_regression.mjs`, `scripts/validate.mjs` y whitespace. La cifra conserva la etiqueta de registros de `sales` y no equivale a ventas cobradas/conciliadas por medio de pago. No implementa aún exportación XLSX ni reportes canónicos entre canales.

**Carrito — endurecimiento separado:** PASÓ `node tests/cart_recovery_regression.mjs`. La prueba cubre 10 minutos exactos y expiración posterior, timestamps futuros (incluido el borde +60 s), limpieza de punteros vencidos, reintento sin renovar el reloj, precio actual, aviso accesible de precio cambiado/producto no verificable y cotización antes de side effects COD/Wompi. No se llamó a Supabase ni se tocaron referencias/reservas reales; notificación de cambio de stock y recuperación avanzada siguen abiertas.

**Cotización/previews de combo — correcciones críticas adicionales:** las revisiones independientes detectaron un total parcial de envío, descuentos de combo por línea y previews que convertían precio NULL en cero; también tarjetas por categoría que aún mostraban etiqueta promo sin candidatos con precio válido. Se corrigieron: selector, preview, tarjeta de catálogo, ficha, toast y agregado fallan cerrado; combos sin candidatos se ocultan. Se añadió `tests/combo_preview_regression.mjs`; `tests/cart_recovery_regression.mjs` cubre preview de checkout, tarifa/beneficio, descuentos por línea y destinos vacíos. `20261108070000` y `20261108090000` rechazan `sale_price IS NULL` antes de acumular precio; `tests/promotion_priority_regression.sql` comprueba la definición instalada y, si el esquema admite NULL, fixture sintético en transacción con rollback. PASARON `node tests/combo_preview_regression.mjs`, `node tests/cart_recovery_regression.mjs`, `node tests/catalog_discovery_regression.mjs`, `node tests/phase1_quote_parity_regression.mjs`, `node scripts/validate.mjs`, `git diff --check`, y `pglast` sobre las dos migraciones y el test SQL. SQL no fue ejecutado; el fixture es para staging aislado.

**Precio general del catálogo — guard adicional:** tarjeta, ficha, relacionados y WhatsApp usan etiqueta “Por verificar”; la ficha deshabilita CTA y `addToCart`/`detailBuyNow` vuelven a validar antes de cualquier side effect. El filtro por precio excluye precio desconocido y ordenar por precio coloca esos productos al final. `tests/catalog_price_integrity_regression.mjs` ejecuta los helpers reales de etiqueta, filtros, orden y estado de botones y simula handlers directos; `tests/catalog_discovery_regression.mjs` ahora carga el verificador real. PASARON ambos tests, combo, carrito, tarifas, `scripts/validate.mjs` y `git diff --check`. No hubo llamadas a Supabase ni cambios de esquema en este slice.

## Pendientes de lanzamiento y fases abiertas

1. Staging aislado con esquema real: aplicar migraciones en orden, revisar RLS/ACL, ejecutar regresiones SQL con rollback y pruebas concurrentes COD/cupones/reservas/webhooks. No sustituirlo por pruebas de escritura en el único proyecto compartido. Verificar todos los clientes v2 antes del corte manual de RPC legacy administrativas; sin ese corte la comprobación de estado esperado sigue limitada a v2.
2. Supabase Auth: configurar redirect URLs de recuperación hacia `admin.html`, correo/SMTP, política de contraseña y disponibilidad/configuración MFA. Probar recovery, AAL2 y cancelación en cuentas sintéticas, no en una cuenta real durante esta tarea.
3. Wompi: confirmar que `prepare_storefront_wompi_checkout` y demás contratos estén instalados donde se sirve la Edge Function, probar retorno/PSE en sandbox sin cobro real, y definir procedimiento autorizado de conciliación. La comparación COD legacy con `round` requiere revisión de política COP fraccionaria y regresión específica en otra migración, no cambio silencioso de historial.
4. Fase 3: etiquetas/ofertas con contrato autoritativo y recuperación avanzada de carrito sin duplicar/renovar reservas. Los ETA no se inventan.
5. Fase 5/6: contrato canónico de canales y pedidos relacionados, identificadores para calcular recurrencia, smoke/staging y medición de F6-S2, logística separada con bitácora y notificaciones configurables. No unir pedidos por PII/monto/fecha.
6. Fase 7: importación real con RPC transaccional y rollback, bitácora append-only, allowlist/retención PII, manifest R2 y restauración verificada. El JSON de backup actual es parcial, no un restaurador ni un backup completo de fotos.
7. Fase 8: políticas comerciales/identidad legal aprobadas, SEO crawler-visible por producto, PWA sin datos de precio/stock persistentes y medición de rendimiento. No se inventan políticas ni se activa un service worker sin comprobar los riesgos de disponibilidad.

No se marca completa una fase por un commit, una PR en borrador, un PASS estático o un parseo SQL.
