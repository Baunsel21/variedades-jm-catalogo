# Sirevya — cierre de estado actual

**Actualizado:** 2026-11-10, después de PR #125–#127
**Main revisado:** `4c08bf4161c3e4a6a26042e7bfd278cfa0497b41`
**Producción:** sin DDL, cambios de datos, cambios de precios/tarifas, pagos, importaciones ni alteraciones de sesión.

Este anexo actualiza la evidencia del handoff #124. La PR #124 sigue abierta en draft y este anexo no solicita su merge. Las migraciones de producción permanecen pendientes del gate de respaldo/restauración.

## Evidencia más reciente

- PR #125: paginación local para ventas POS, gastos y movimientos; merge `1480bfa`. PR #126: candidata least-privilege ACL P0; merge `91ff597`, solo código versionado. PR #127: harness hermético de las Edge Functions Wompi; merge `4c08bf4`.
- Pages del SHA `4c08bf4` terminó en éxito (run `42937952674`). La tienda y `admin.html` respondieron HTTP 200 en GET con cache-buster.
- Inspección pública del storefront: `document.readyState=complete`; 58 imágenes en el documento, ninguna imagen visible rota y las primeras 8 imágenes de catálogo tenían `naturalWidth>0`. Consola del navegador: sin salida/error.
- Admin: se cargó la pantalla pública de inicio de sesión; consola sin salida/error. No se inició sesión ni se modificó una sesión existente.
- El validador central y el harness Wompi pasaron tras #127. No se repitieron aquí.
- Por solicitud del usuario, seis pruebas PostgreSQL aisladas pasaron en PostgreSQL 17.11 sobre el SHA de main: cupones/cédula, campañas, Telegram/outbox, CSV v2, seguimiento/auditoría y ACL least-privilege. Todos los runners usaron fixtures sintéticos y eliminaron su base temporal; no probaron la copia restaurada real.

## Avance por fase

**Cómo se calcula el porcentaje:** criterios principales completamente marcados `[x]` sobre criterios principales del `docs/roadmap/TODO-mejoras.md` presente en main, redondeado. Los criterios parciales cuentan como no terminados; el resultado mide cierre de aceptación documentado, no esfuerzo ni cantidad de código. Los avances nuevos de #125–#127 se indican aparte si aún no están representados por un criterio del TODO.

| Fase | Progreso del checklist | Ya está listo o publicado | Falta para cerrar la fase |
|---|---:|---|---|
| 1. Envíos editables | **50% (3/6)** | Tarifas nacionales/Cali, regla base, guard COD y validaciones de cotización tienen código y pruebas sintéticas; la tienda publica el texto/configuración de envío observada. | Matriz completa de importes tras descuento ($129.999/$130.000/arriba del umbral) entre UI, COD y Wompi; eliminar mensajes hardcodeados; validar cambios Wompi contra cotización server-side y preservación de pedidos históricos. |
| 2. Tarifas por ciudad/zona | **0% (0/3)** | UI/RPC ciudad-zona publicadas; runner PostgreSQL sintético cubre alta/edición/fallback, Cali/alias y permisos. No se alteraron tarifas reales. | CRUD real desde sesión admin; precedencia zona/ciudad, ciudad desconocida/vacía, checkout y COD completos; confirmar que editar/eliminar reglas no altera órdenes o reservas existentes. |
| 3. Catálogo y conversión | **25% (2/8)** | Filtros/categorías, favoritos y URL, imágenes alternativas persistentes con transición, carrusel relacionado y entrada suave de ficha están publicados y cubiertos por regresiones. | Contrato guardado para etiquetas nuevo/destacado/oferta/últimas unidades; completar y verificar galería/zoom/guía de tallas/disponibilidad/stock; Comprar/WhatsApp preservando variante; restauración de carrito sin duplicar reservas ni prolongar TTL. No se inventará un esquema de etiquetas. |
| 4. Descuentos y campañas | **0% (0/3)** | Backend base de cupones existe; UI de toggle/campañas falla cerrada. Código y candidatas tienen pruebas aisladas PASS. | Aplicar candidatas solo tras gate; demostrar CRUD, límites globales/por cliente, vigencia Bogotá, productos/categorías, mínimo, redención atómica y combinación cupón/combos/envío en un clon restaurado. |
| 5. Pedidos, Wompi/PSE y conciliación | **0% (0/6)** | Cédula/validaciones y rutas de backend ya están versionadas; #127 prueba rechazo y fallos controlados de los handlers Wompi sin red externa. | Pruebas sandbox de éxito/error/replay y webhook fuera de orden; PSE sandbox; COD idempotente y reintentos con reserva; confirmar cédula en flujo completo y ausencia de PII en logs; conciliación y relaciones entre `orders` y `web_orders` solo con constraints verificados. |
| 6. Dashboard, clientes y logística | **17% (1/6)** | Filtros/paginación de pedidos publicados; #125 añade paginación local a ventas, gastos y movimientos. La automatización Telegram base ya se observó activa anteriormente; el código enriquecido está versionado y desplegado. | Métricas integrales por periodo/fuente; historial de clientes con acceso autorizado; paginación server-side; estados logísticos y guías con auditoría persistente; demostrar formato profesional de Telegram con sus triggers candidatos activos, sin enviar mensajes de prueba a clientes. |
| 7. Trazabilidad, importación y exportación | **20% (1/5)** | CSV export ampliado publicado (#122). Importador transaccional base y CSV v2 tienen contrato, preview y pruebas scratch PASS; seguimiento/auditoría está versionado y probado en scratch. | Activar v2 y tracking tras gate; validar schema/restauración, errores/rollback de imágenes/variantes contra clon restaurado; completar auditoría append-only y conciliación de reportes; verificar respaldo de assets R2. No se importaron productos reales. |
| 8. Confianza, SEO y rendimiento | **36% (5/14)** | Privacidad/FAQ/cambios-devoluciones estáticos, PWA, ticker, accesibilidad móvil y mejoras visuales publicados; Pages y recursos públicos responden. | Confirmar política comercial e identidad legal; páginas de producto indexables con contenido inicial/404 y datos estructurados; HTTP 503 real requiere hosting/CDN compatible; miniaturas/medición repetible de Core Web Vitals requieren origen/transforms disponibles. |

## Qué no necesita el computador y queda cerrado

Los cambios seguros ya implementados y publicados incluyen PR #125–#127. Las pruebas del nuevo trabajo no productivo descritas arriba pasaron. No se encontró un error nuevo en la carga pública ni en consola; por ello no se hicieron modificaciones nuevas de frontend ni se generó una PR funcional duplicada. Las cinco migraciones pendientes y la candidata ACL ya están versionadas en el repositorio; no se ejecutaron en Supabase.

## Qué sigue bloqueado

1. **Copia restaurada real:** los archivos `01_estructura.sql` y `02_datos.sql` están en `C:\SIREVYA_BACKUPS`, fuera del Sandbox. No existe en este entorno ni un manifiesto original coincidente. Por eso no se pueden confirmar aquí el SHA del respaldo ni la comparación contra el origen de tablas, columnas, índices, funciones, triggers, grants y RLS. El usuario reportó 24 tablas, 57 productos y 114 imágenes; ese reporte no equivale a una comparación independiente.
2. **Activación de producción:** toggle persistente de cupones, campaña flotante, CSV v2, payload/triggers Telegram profesional, tracking/auditoría y ACL P0 no están activados por estas candidatas. Requieren validar el backup restaurado, reconciliar el destino, ensayar en esa copia y tener rollback; no se debe marcar `schema_migrations` a mano.
3. **Validación con permisos reales:** CRUD de tarifas y admin autenticado no se probó en la cuenta del usuario. La sesión admin no fue abierta ni alterada.
4. **Servicios externos/comerciales:** no hay cobros reales de prueba; Wompi/PSE full success requiere credenciales sandbox del comercio; páginas de producto indexables y 503 requieren arquitectura/hosting apropiados. No cambiar DNS ni hosting como parte de este anexo.

**Estado:** ningún criterio de fase se certifica al 100%. PR #124 continúa en draft; no se fusionó nada en este cierre y no se aplicaron migraciones productivas.
