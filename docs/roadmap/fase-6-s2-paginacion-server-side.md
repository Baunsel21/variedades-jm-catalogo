# Fase 6-S2 — paginación server-side de pedidos COD

**Estado:** implementación local en `feature/admin-dashboard-critical-fixes`; migración y cliente aún no se han desplegado ni aplicado en Supabase. Debe permanecer en revisión hasta ejecutar la prueba SQL y un smoke test con datos sintéticos en staging autorizado.

## Alcance implementado

La vista COD consulta `web_orders` con `admin_list_web_orders_page_v1`, filtra búsqueda, estado, fecha en `America/Bogota`, ciudad y método de pago en el servidor, y solicita una página de 20, 50 o 100 filas. La búsqueda mantiene normalización de espacios y diacríticos españoles; el texto se trata como literal. El servidor devuelve conteo filtrado, conteos globales por estado y facetas limitadas de ciudad/método. Si las facetas superan sus topes, la UI informa que se puede buscar el valor omitido.

La RPC verifica `is_store_admin()` internamente, devuelve solo las columnas que usan las tarjetas, tiene `SECURITY DEFINER` con `search_path` fijado y solo recibe `EXECUTE` de `authenticated`; el helper de normalización no se expone. No modifica pedidos, reservas, inventario, ventas ni órdenes Wompi. El fallback se activa solo ante un error de función ausente que nombra `admin_list_web_orders_page_v1`, vuelve a validar el mismo usuario, `is_store_admin()` y assurance si el SDK lo ofrece antes y después de la lectura, y selecciona solo las columnas de las tarjetas. Errores `42883` de otra función no habilitan SELECT. RLS sigue protegiendo el SELECT legacy.

La búsqueda server-side concatena los mismos campos y orden que el fallback, y las tarjetas muestran las fechas explícitamente en `America/Bogota`.

**Evidencia read-only (2026-11-08):** la metadata del proyecto Supabase conectado muestra RLS habilitado en `web_orders`, `SELECT` concedido a `authenticated` y una policy `SELECT` únicamente para `authenticated` con `is_store_admin()`; no se consultaron filas de pedidos. La migración repite estas condiciones en preflight. Esta lectura no equivale a staging ni verifica el comportamiento runtime o cualquier otro entorno.

## Límites y pendientes

La paginación limita la respuesta/transferencia, no garantiza menos escaneo: la función materializa el conjunto base y recalcula conteo global y facetas en cada llamada. Los topes `LIMIT 200/50` acotan JSON, pero agrupar valores únicos aún lee el conjunto. El costo y plan (`EXPLAIN`, índices y frecuencia de requests) deben medirse en staging con volumen representativo; no se afirma mejora del costo de base de datos. El límite de resultados está sujeto a RLS y a `is_store_admin()`. Esta RPC no debe relacionar `web_orders` con `orders`, `sales` ni movimientos.

Pendiente: aplicar la migración solo en staging después de confirmar esquema y permisos; ejecutar `tests/orders_server_pagination_regression.sql` dentro de una transacción y rollback; comprobar búsquedas con acentos, límites de fecha Colombia, páginas fuera de rango, cambio concurrente de filtro/logout, error de RPC y fallback legacy con fixtures; medir consulta/facetas. No ejecutar este SQL en el proyecto compartido actual ni declarar producción lista antes de ese smoke test.
