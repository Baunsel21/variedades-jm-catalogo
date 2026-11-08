# Fase 6-S1 — Filtros y paginación visual de pedidos

**Estado:** [PR #15](https://github.com/Baunsel21/variedades-jm-catalogo/pull/15) en borrador, rama `feature/admin-orders-filters-pagination`, apilada sobre `feature/checkout-coupons` (PR #14). No se ha fusionado ni desplegado. No requiere ni añade migraciones.

## Alcance

La vista de pedidos de `web_orders` conserva búsqueda libre y estado, y añade filtros combinables de fecha desde/hasta en `America/Bogota`, ciudad y método de pago, con acción para limpiar todos. La ciudad y los métodos se derivan de la carga actual; las comparaciones normalizan espacios y acentos sin reescribir los valores de la base. La lista se divide visualmente en 20, 50 o 100 filas por página, mantiene los conteos globales sobre el snapshot cargado y anuncia resultados/página con regiones accesibles.

El estado de página, tamaño y filtros permanece solo en memoria: no escribe PII, búsquedas ni filtros en `localStorage`, `sessionStorage` o URL. Un error de lectura muestra una alerta distinta de “sin pedidos” y conserva el último snapshot exitoso. La transición comercial continúa exclusivamente mediante `admin_update_web_order_status_secure`.

## Límites explícitos

La lectura actual sigue trayendo `web_orders` en páginas técnicas de 1.000 filas antes de aplicar la paginación visual; este slice no es paginación server-side y conserva el límite de seguridad existente. No añade órdenes de `orders`/Wompi a esta lista, no relaciona ventas ni movimientos, no cambia pago/inventario, no crea estados logísticos y no ofrece acciones de reparación. Los contratos entre `orders`, `web_orders`, reservas, ventas y movimientos no están completos/versionados; Fase 5 sigue pendiente de ese preflight. También quedan pendientes dashboard por periodo, clientes, logística separada, notificaciones y reportes adicionales.

## Pruebas y entrega

`node scripts/validate.mjs` incluye pruebas VM puras para frontera de fecha de Bogotá, normalización de acentos, filtros combinados, fechas inválidas, resultados vacíos, tramos/clamp de páginas y tamaño permitido. El mismo validador comprueba la presencia de controles accesibles, el aviso de error y el uso de la RPC segura. El validador y `git diff --check` pasan en esta rama.

No se consultan tablas ni filas reales durante las pruebas locales, no se ejecuta SQL, no se altera Supabase, no se hacen pagos y no se cambia un estado de pedido. El PR debe permanecer en borrador hasta revisar visualmente con datos sintéticos y completar su smoke test de error/carga en un entorno autorizado.
