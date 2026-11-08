# Fase 5 — Contratos de pedidos y relaciones conocidas

**Estado:** documento de análisis en la rama `feature/orders-model-contracts`, apilada sobre el PR #14. No crea vistas, RPCs ni uniones de datos; no se ejecutó SQL ni se leyeron filas de pedidos/clientes.

## Conclusión para el panel

No se debe unir `orders` y `web_orders` por un valor coincidente sin calificar por canal. Una proyección futura debe identificar cada fila por `(source, source_key)`: Wompi usa `source='wompi'` y `orders.reference`; COD usa `source='cod'` y `web_orders.id`. `web_orders.client_reference` se conserva como referencia externa/idempotente de COD, no como clave global compartida. Un mismo teléfono, email, nombre, dirección, ciudad, monto, carrito o timestamp **no prueba** que dos filas sean el mismo pedido.

Tampoco se debe unir pedidos con `sales` o `inventory_movements`: el repositorio no versiona una FK/columna puente que identifique con seguridad la venta o movimiento originado por cada pedido. Esas colecciones deben aparecer separadas hasta que el esquema instalado y las reglas de negocio documenten una relación y su cardinalidad. El panel actual consulta `web_orders` en la lista de pedidos; Wompi mantiene `orders` y su cola separada de conciliación.

## Identidades y contratos visibles en el repositorio

| Canal/entidad | Clave o vínculo utilizable | Alcance y evidencia |
|---|---|---|
| Pedido Wompi | `orders.reference` | Es la referencia de creación/consulta del checkout y webhook. La migración F4 exige como preflight un índice único de una sola columna sobre `orders.reference`; el webhook exige una orden identificable por la referencia. No hay DDL base versionado para definir todos sus campos. |
| Pago Wompi | `orders.reference` + `orders.transaction_id` | La transacción verificada se vincula con la referencia del pedido; un `transaction_id` aislado no identifica de forma suficiente un pedido ni la DDL local garantiza su unicidad. Los eventos repetidos/conflictivos se procesan por la Edge Function, no por un join a ciegas. |
| Pedido contraentrega | `web_orders.id` | El wrapper administrativo/seguro recibe `p_order_id`; el ID interno identifica el pedido COD en las operaciones administrativas. |
| Idempotencia COD | `web_orders.client_reference` | El wrapper bloquea/busca esa referencia para retornar el mismo pedido ante reintentos. Se debe conservar su semántica local de COD, no compararla como identidad global con `orders.reference`. |
| Reserva Wompi | `inventory_reservations.reference = orders.reference` | Relación lógica del contrato de reserva, confirmación y liberación Wompi. No hay FK local que pruebe cardinalidad. |
| Reserva COD | `inventory_reservations.reference = web_orders.inventory_reference` | El wrapper/test de COD usa la referencia de inventario almacenada en el pedido. No sustituirla por `client_reference` sin un contrato explícito. |
| Ledger de cupón | `(channel, reference)` | La migración F4 define unicidad por canal+referencia; es una fila de uso, no un segundo pedido ni otro pago. |
| Lock Wompi | `storefront_wompi_checkout_locks.reference` | Estado/tombstone del checkout y conciliación; es side record, no pedido. |
| Cola de conciliación | referencia y transacción Wompi | La Edge la escribe por conflicto; la tabla base y su constraint de unicidad no están creadas/versionadas en este repositorio. No afirmar cardinalidad hasta verificar el DDL instalado. |

## Lo que no está versionado ni debe suponerse

El repositorio no crea las tablas base `orders`, `web_orders`, `inventory_reservations`, `inventory_movements`, `sales` ni `sirevya_wompi_inventory_reconciliation`. Por ello no es fuente autoritativa local para todas sus columnas, tipos, constraints, RLS, triggers, relaciones ni estados. Los wrappers COD y el finalizador de inventario contienen dependencias legacy; su cuerpo efectivo debe comprobarse en un staging, no inferirse de una firma.

En consultas de solo lectura anteriores se observó metadata del proyecto conectado: `orders.reference` único; `web_orders.client_reference` con unicidad parcial; tipos de moneda distintos (`bigint` COP en `orders` y `numeric` en `web_orders`); y `orders.transaction_id` nullable. Esta es **evidencia histórica del remoto, no DDL versionado**. No se consultaron filas personales ni se hicieron escrituras. No existe staging aislado en esta sesión, así que la observación no habilita nuevas uniones ni pruebas de escritura.

## Proyección administrativa futura

Si un staging aislado confirma el modelo, la primera vista unificada debería ser solo de lectura, con RPC administrativa/paginación estable y columnas explícitas: `source`, `source_key`, referencia externa, creado, estado comercial, pago, logística/inventario, total y banderas de conciliación. Debe asociar side records solo con claves exactas y calificadas por canal. Debe excluir por ahora `sales` y `inventory_movements`, o presentarlos como colecciones no vinculadas, hasta que sus relaciones sean demostrables.

Si una referencia tiene más de una reserva/ledger/conciliación cuando el contrato espera a lo sumo una, el panel debe indicar conflicto/`needs_review`; nunca debe elegir `LIMIT 1` arbitrariamente. La RPC no debe exponer datos a `anon` y debe seleccionar la PII mínima necesaria bajo autorización de administrador.

## Preflight previo a la vista y acciones

En staging aislado se debe inspeccionar `information_schema.columns`, constraints/índices, triggers y RLS; validar unicidad de `orders.reference`, predicado exacto de unicidad de `web_orders.client_reference`, unicidad de `transaction_id` donde se use, cardinalidad y estados de reservas, y existencia/ausencia explícita de vínculos a pedido en ventas/movimientos. También se deben leer los cuerpos legacy que cambian estado/stock.

Después, crear fixtures sintéticos con rollback y pruebas concurrentes reales para webhook APPROVED repetido y fuera de orden, altas COD idempotentes, dos checkouts del mismo teléfono y cardinalidades por referencia. Ninguna acción de reintento, estado, inventario, redención o reembolso entra en una vista de lectura: requiere RPC transaccional separada, guardia admin, resultado confirmado y bitácora aprobada.

## Referencias versionadas

- `supabase/migrations/20261108100000_storefront_coupons.sql`: preflight de referencia única Wompi, ledger/lock por canal y referencias, guards y RPCs.
- `supabase/migrations/20261108060100_cod_checkout_quote_guard.sql`: contrato del wrapper COD con `web_orders.id` y `client_reference`.
- `supabase/functions/wompi-create-checkout/index.ts` y `supabase/functions/wompi-webhook/index.ts`: creación y vínculo de transacciones Wompi.
- `tests/cod_regression.sql` y `tests/coupons_regression.sql`: idempotencia COD, reservas y estados en pruebas sintéticas.
- `admin.html`: carga actual de `web_orders` y consulta separada de la cola Wompi `NEEDS_REVIEW`.

**No marcar Fase 5 completa:** todavía no existe la proyección unificada, la metadata legacy requiere confirmación en staging y la operación de conciliación reparable no está definida ni probada.