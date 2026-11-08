# TODO — mejoras completas de Sirevya

Cada criterio se conserva hasta que exista evidencia en código, Supabase y pruebas. Las tareas se ejecutan en el orden de dependencias definido en [`plan-integral.md`](plan-integral.md).

> Incremento local del 8 de noviembre de 2026: seguridad de cuenta/recuperación/MFA, disponibilidad fail-closed y estados COD protegidos; tarifas visuales pendientes hasta verificación; integración del slice de descubrimiento/favoritos; dashboard por periodo con fuentes separadas; dry-run CSV sin escrituras. Los avances no equivalen a despliegue ni cierran fases completas. Ver [`incremento-integracion-local.md`](incremento-integracion-local.md).

## Fase 1: Envíos editables desde el administrador

- [x] En `Admin → Configuración → Envíos`, el administrador puede cargar/editar/guardar la tarifa nacional y el mínimo de envío gratis sin modificar HTML. Valores iniciales: Cali gratis; otras ciudades $15.000; envío gratis desde $130.000 después de descuentos. El guardado requiere administrador y rechaza importes inválidos. Si no carga la configuración, no se muestra un guardado falso. (PR #9 y regresión sintética con rollback.)
- [ ] El catálogo muestra la política cargada desde Supabase; la cotización server-side es la fuente de verdad. Cali (incluidos los alias actuales), ciudad no Cali con subtotal descontado $129.999, exactamente $130.000 y subtotal superior producen los mismos valores en frontend, COD y Wompi. Los pedidos históricos conservan su tarifa guardada.
- [ ] La barra de progreso, notas de envío y total del checkout usan el valor actualizado y no dejan textos hardcodeados de $15.000/$130.000 cuando se haya editado la configuración. Cualquier discrepancia de cotización bloquea la orden/el pago y conserva el carrito.
- [ ] La Edge Function Wompi compara `expected_total` y `expected_discount_total` enteros COP contra Supabase antes de reservar/insertar el pedido; no redondea silenciosamente datos fraccionarios ni acepta valores booleanos. Un cambio devuelve `WOMPI_QUOTE_CHANGED` sin dejar pedidos `PENDING` huérfanos. El cliente actualiza el importe y no libera una reserva previa con la misma referencia.
- [x] El guard COD exige el total y descuento COP que vio el cliente, falla cerrado si la cotización o el resultado interno omiten total/descuento/envío, conserva la idempotencia y fija la configuración mientras crea la orden. `web_orders.total`, `discount_total` y `shipping` conservan `NOT NULL`; un duplicado con otro total no devuelve falso éxito. (Migración aplicada y regresión sintética con rollback.)
- [x] Después de comprobar el checkout publicado, revocar el RPC COD anterior a `anon`/`authenticated` y conservar `service_role`; `cod_legacy_acl.sql` confirma que el wrapper COD sigue disponible y el acceso interno se conserva. (Autorizado y aplicado el 8 de noviembre de 2026.)

## Fase 2: Tarifas por ciudad y reglas de entrega

> Estado al 7 de noviembre de 2026: implementación en borrador en [`PR #11`](https://github.com/Baunsel21/variedades-jm-catalogo/pull/11), rama `feature/roadmap-city-shipping`, con SQL, UI y regresión sintética. No se aplicó a producción y los criterios siguientes siguen abiertos hasta validar en un proyecto aislado. Ver [`fase-2-tarifas-por-destino.md`](fase-2-tarifas-por-destino.md).

- [ ] El administrador puede crear/editar/desactivar una tarifa por ciudad o zona, una tarifa general alternativa y umbral de envío gratis; se muestran ciudades sin regla con la tarifa de respaldo. Ciudad/Cali se normaliza con acentos, mayúsculas, espacios y alias documentados.
- [ ] La disponibilidad de contraentrega sigue bajo sus controles actuales por ciudad; tarifas y medios de pago no se contradicen. Cambiar una regla de entrega no altera pedidos ya creados ni reservas activas.
- [ ] La cotización rechaza o maneja explícitamente ciudad vacía/no reconocida y nunca confía en el importe enviado por el navegador.

## Fase 3: Catálogo, búsqueda y conversión

> El slice existente de PR #12 se integró localmente preservando city/zone, combos y cupones. Incluye filtros, favoritos ID-only, código, WhatsApp contextual y fallback de imagen. Se agregó regresión de color+talla de la misma variante y previews de combos fail-closed cuando falta precio, sin tarjeta de categoría/pareja si no hay candidatos válidos ni ahorro/toast de $0 (`tests/combo_preview_regression.mjs`); también una guarda contra referencias locales con timestamp futuro anómalo y TTL histórico de 10 minutos. Etiquetas/ofertas y recuperación avanzada del carrito siguen abiertas; ver [`fase-3-descubrimiento-catalogo.md`](fase-3-descubrimiento-catalogo.md).

- [ ] El administrador puede marcar producto como destacado, nuevo, oferta o últimas unidades; las etiquetas del catálogo solo aparecen según datos guardados y stock vigente.
- [ ] El catálogo ofrece filtros accesibles por categoría, rango de precio, color, talla, disponibilidad y ofertas; ordena por precio, novedad y destacados; refleja filtros compartibles en URL cuando no exponga datos personales.
- [ ] La ficha permite ver galería/zoom, variantes, guía de tallas, stock, relacionados, disponibilidad, código y tiempo estimado si está configurado. Fallos de imagen muestran un fallback útil.
- [ ] CTA “Comprar ahora” y WhatsApp contextual preservan la variante elegida, reutilizan la validación actual y nunca saltan la cotización, la reserva ni el checkout seguros.
- [ ] La lista de deseos funciona para visitantes y persiste localmente con una clave nueva namespaced; no cambia, borra ni reutiliza ninguna clave de carrito/reserva Wompi/COD.
- [ ] El carrito se recupera después de cerrar/recargar, informa cambios de precio/stock y no genera una segunda reserva para el mismo carrito ni extiende por sí solo la reserva de 10 minutos. La guarda local de timestamps inválidos, los avisos de precio/producto no verificable, la conservación de líneas reservadas ausentes (sin total/tarifa/beneficio/descuento parcial o progreso, y bloqueadas antes del payload/RPC), y la recotización antes de COD/Wompi están cubiertos por `tests/cart_recovery_regression.mjs`; destino vacío tampoco se presenta como GRATIS. Siguen pendientes cambios de stock con fuente autorizada y reutilización concurrente demostrada en staging.

## Fase 4: Descuentos y campañas

> Avance parcial: tarifas city/zone, calendario y cupones están en ramas apiladas de borrador ([PR #11](https://github.com/Baunsel21/variedades-jm-catalogo/pull/11), [PR #13](https://github.com/Baunsel21/variedades-jm-catalogo/pull/13) y [PR #14](https://github.com/Baunsel21/variedades-jm-catalogo/pull/14)); Fase 4 sigue sin desplegar ni aplicarse en Supabase. Falta ejecutar migraciones/regresiones y concurrencia en staging aislado, y validar el flujo operativo para resolver conciliaciones; las tres casillas de esta fase permanecen abiertas.

- [ ] Cupones pueden activarse por código, porcentaje o valor fijo, vigencia, compra mínima, límite global y límite de uso; el servidor valida/redime atómicamente y el panel muestra uso/expiración.
- [ ] Calendario de promociones incluye fechas, zona horaria, prioridad, productos/categorías elegibles y copy veraz; popup, combos, cupones y envío no aplican beneficios duplicados a la misma unidad.
- [ ] El subtotal con combo/cupón, descuento, envío y total coinciden entre navegador, quote SQL, pedido COD y amount-in-cents de Wompi; falla cerrada ante diferencias.

### Mensaje informativo COD — requerimiento adicional del módulo 4

> Implementación local del editor, preview, singleton/RPC protegidas y aviso checkout en [`modulo-4-mensaje-contraentrega.md`](modulo-4-mensaje-contraentrega.md). No aplicado en Supabase ni publicado; las casillas siguen abiertas hasta staging. Plantillas WhatsApp y snapshot histórico no están implementados.

- [ ] El administrador escribe título/contenido, párrafos, saltos y listas; puede incluir símbolos/emojis, transportadora, plazo, condiciones y restricciones reales sin modificar HTML/JavaScript. Revisa una vista previa antes de guardar.
- [ ] La configuración se guarda segura en Supabase y solo los administradores autorizados pueden modificarla. El mensaje activado se actualiza en la tienda desde la configuración guardada.
- [ ] El cliente ve el cuadro debajo de contraentrega cuando la selecciona; es accesible y responsive. Desactivar la información o fallar su carga no desactiva ni evita las validaciones del medio de pago.
- [ ] Los mensajes de confirmación por WhatsApp son editables con contrato de envío/canal validado; las condiciones vigentes quedan relacionadas con el pedido cuando haga falta consulta histórica, sin alterar Wompi ni reservar dos veces.

## Fase 5: Pedidos, Wompi/PSE y conciliación

> Se incorpora el documento de contratos ya preparado en PR #16: [`fase-5-modelo-pedidos.md`](fase-5-modelo-pedidos.md). No establece una FK nueva ni une canales por teléfono, monto o fecha. La migración local de estados COD no sustituye conciliación ni prueba de concurrencia Wompi.

- [ ] Antes de unir datos, documentar contratos/relaciones `orders` y `web_orders`; el panel muestra una sola vista coherente sin duplicar filas, pagos, ventas ni movimientos.
- [ ] Repetir/concurrir el mismo webhook APPROVED no vuelve a descontar inventario ni crear reservas; estados fuera de orden no degradan un pago aprobado y cada referencia/transacción tiene integridad única.
- [ ] Conciliación muestra importe, referencia, transacción, estado de pago, inventario, logística y causa. Las acciones de reparación requieren RPC transaccional y guardia admin, confirman el resultado, registran bitácora y nunca inician reembolso sin una política aprobada.
- [ ] El cliente recibe una confirmación clara al regresar de Wompi; PSE se prueba en sandbox, no se hace un cobro real de validación.
- [ ] Reintentos conservan referencia/reserva existente, carrito y vencimiento original de 10 minutos; no se permite doble reserva para una persona/carrito ni se libera inventario ajeno.

## Fase 6: Dashboard, clientes y logística

> Avance parcial: filtros/paginación visual de pedidos `web_orders` en [PR #15](https://github.com/Baunsel21/variedades-jm-catalogo/pull/15), borrador apilado sobre PR #14. El dashboard incluye métricas con fuentes separadas y Clientes tiene PII bajo demanda más ventas activas por `sales.client_id`; no se presentan filas como pedidos ni se infiere recurrencia. F6-S2 agrega localmente RPC y cliente con paginación server-side en `feature/admin-dashboard-critical-fixes`, con fallback visual si la RPC no está instalada; sigue pendiente staging/smoke y medir costo con volumen representativo. Continúan pendientes historial canónico de pedidos, logística/notificaciones y revisión visual. No integra Wompi/`orders`.

> El incremento local añade Hoy/últimos siete días/mes calendario hasta hoy en Colombia, ingresos y promedio por registro no archivado de `sales`, stock bajo/agotado verificado, y consulta explícita de pendientes COD/revisión Wompi. El modo mensual tiene una prueba independiente de medianoche, cambio de año y febrero bisiesto. Muestra fecha/fuente, carga/error/no consultado y límites de consulta. No suma canales ni muestra pagos como conciliados; exportación Excel y reportes canónicos por método siguen abiertos.
>
> Seguimiento de Clientes: el listado consulta solo `id,name`; teléfono/nota requieren revelado y revalidación de usuario/admin, y la caché se descarta al ocultar, salir, refrescar o cerrar sesión. Una acción independiente muestra hasta diez registros activos de `sales` asociados estrictamente por `client_id`; los etiqueta como registros, nunca como pedidos/recurrencia, y no une COD/Wompi. Siguen abiertas la historia canónica de pedidos y una métrica de recurrencia con identificadores de transacción.

- [ ] Dashboard muestra ventas por día/semana, pedidos pendientes, ventas/valor promedio, alertas de inventario bajo, agotados y pagos con revisión pendiente, indicando fecha/fuente y estados de carga/error.
- [ ] Los filtros de pedido incluyen periodo, estado, ciudad y pago; listas usan paginación, conservan conteos correctos y nunca presentan error de consulta como “sin pedidos”.
- [ ] El historial de clientes muestra órdenes relacionadas, recurrencia y notas bajo autorización del administrador; PII se obtiene bajo demanda, no se guarda en logs/URL/localStorage ni queda expuesta a público.
- [ ] Estado logístico (preparando, transportadora, número de guía, fecha estimada, entregado y evidencia) es distinto del estado de pago; cada transición queda registrada y validada server-side.
- [ ] Notificaciones del admin avisan nuevos pedidos, stock bajo, pagos aprobados con conciliación pendiente y reservas próximas a vencer; pueden silenciarse/configurarse y no contienen PII innecesaria.

## Fase 7: Trazabilidad, importación y exportación

> Se implementó helper puro y UI local de previsualización CSV con límites, duplicados, errores y escape de contenido. No sube archivos, no importa datos y limpia la vista al navegar/cerrar sesión. RPC transaccional, bitácora, backup minimizado y manifest/restauración siguen abiertos; ver [`fase-7-trazabilidad-importacion-backup.md`](fase-7-trazabilidad-importacion-backup.md).

- [ ] Bitácora inmutable registra actor autorizado, entidad, acción, valores antes/después permitidos, hora y resultado para inventario, productos, pedidos, envíos y configuración; usuarios comunes no la leen ni modifican.
- [ ] La importación CSV tiene vista previa sin escrituras, límite de filas/bytes, validación por fila, detección de código duplicado, copia previa y commit transaccional o rollback; el operador ve errores sin datos sensibles.
- [ ] Los reportes filtran por rango, ciudad, categoría y método; ventas/ganancia/envíos/descuentos concilian con tablas canónicas y se indica cuándo los datos están incompletos.
- [ ] Backup documenta qué incluye, excluye o no restaura, minimiza PII y verifica archivos R2/manifest; la exportación CSV continúa neutralizando fórmulas. Archivado de ventas sigue reversible.

## Fase 8: Confianza, SEO y rendimiento

- [ ] Publicar políticas de privacidad/datos personales, compras, cambios, devoluciones, envíos y preguntas frecuentes enlazadas desde catálogo/checkout.
- [ ] Cada producto tiene URL indexable con title, description, canonical, OG/Twitter e información estructurada coherente de precio/disponibilidad; el contenido de la ruta puede leerlo el crawler sin depender solo de abrir un modal.
- [ ] PWA permite instalación, icono y carga del shell; no presenta stock/precios cacheados como actuales y no altera el checkout.
- [ ] Optimizar fotos con miniaturas y carga bajo demanda, medir LCP/solicitudes/bytes y usar paginación/virtualización si el catálogo lo exige; el refresco de stock sigue activo y sin concurrencia solapada.

## Reglas de regresión aplicables a cada fase

- [ ] Mantener intactos el plazo de reserva de 10 minutos, la idempotencia de contraentrega, recuperación de la misma reserva, forma de cambiar foto, envío gratis en Cali y seguridad de Wompi/PSE.
- [ ] Ejecutar `node scripts/validate.mjs`, revisión del diff, pruebas específicas, revisión de RLS/RPC y comprobación del dominio publicado antes de dar una etapa por terminada.
- [ ] Ninguna prueba inserta o borra pedidos/reservas/inventario de producción fuera de un mecanismo sintético con rollback verificado; ningún pago real se usa como prueba.
- [ ] Una etapa se fusiona/publica solo cuando su diff no incluye cambios ajenos ni ramas viejas completas, y el resultado publicado se verifica por HTTP y comportamiento del navegador.
