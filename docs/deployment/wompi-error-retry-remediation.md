# Wompi: recuperación legacy y reintentos seguros

**Estado de esta tarea:** cambios preparados únicamente en el repositorio local y validados en PostgreSQL scratch. No se aplicaron migraciones, no se desplegaron funciones, no se modificaron pedidos, pagos, reservas, inventario, secretos ni configuración de producción. No se inició ningún pago.

## Caso a resolver

La orden legacy conserva su referencia original y `orders.transaction_id` no quedó enlazado, aunque Wompi muestra dos transacciones terminales `ERROR` para esa misma referencia. El esquema antiguo no puede registrar dos transacciones distintas bajo un único campo de pedido; por eso no es seguro sobrescribir `transaction_id` ni permitir otro pago sin guardar primero ambas identidades.

## Cambios locales preparados

1. `20261116050000_wompi_verified_retry_attempts.sql` amplía el ledger por intento con dos identidades: una clave interna inmutable `attempt_reference` y la referencia externa `wompi_reference`. Los registros legacy permiten más de una transacción con la referencia externa original; cada checkout nuevo usa una referencia externa `SW-…` propia. También se alineó el orden de los advisory locks con las RPC instaladas de webhook.
2. `20261116060000_wompi_legacy_order_recovery.sql` añade la RPC `recover_storefront_wompi_legacy_order`, ejecutable solo por `service_role`. Registra, de forma idempotente, exactamente dos intentos legacy ya verificados; conserva la fila y referencia del pedido; y, en una sola transacción, vuelve a cotizar, compara el snapshot, renueva o crea la reserva de inventario para esa misma referencia y revalida/reabre el cupón solo si corresponde al segundo intento terminal exacto. Si falla una comprobación, la subtransacción revierte las escrituras de ledger, pedido, cupón, lock y reserva. La RPC no crea un pedido ni inicia un pago.
3. `admin-wompi-legacy-recovery` es una Edge Function local admin-only. Confirma sesión y `is_store_admin`, consulta por **GET** únicamente los dos IDs existentes en el endpoint de producción Wompi y exige: ID devuelto igual al consultado; referencia original exacta; importe en centavos igual al pedido; moneda COP; estado `ERROR`; y más de 15 minutos desde `finalized_at`. Solo entonces llama una vez a la RPC atómica. No hay POST a Wompi, creación de transacción ni logging del cuerpo, correo o credenciales.
4. `wompi-webhook` resuelve referencias `SW-…` por clave interna y las legacy por la combinación exacta de referencia externa y `transaction_id`. Si hay historial para esa referencia pero el evento no corresponde a uno de sus IDs, falla cerrado. Una aprobación tardía de un intento legacy queda aislada como `APPROVED_LATE`/conciliación y no consume ni libera la reserva del intento actual.
5. El checkout conserva la referencia estable del pedido en Sirevya y firma el identificador único del nuevo intento para Wompi. El intento siguiente reutiliza la misma fila de `orders`; el ledger conserva los dos intentos históricos.

La validación del correo para un cupón usa el correo devuelto por la consulta autenticada de Wompi solo de forma transitoria para calcular/verificar el hash de cliente. No se almacena en el ledger ni se devuelve en la respuesta. La Edge no emite logs con IDs de transacción, correo, payloads ni secretos.

## Pruebas ejecutadas

- **PostgreSQL 16 scratch efímero:** se aplicaron las dos migraciones candidatas sobre fixtures sintéticos; pasaron la regresión previa de reintentos y la nueva de recuperación. El runner elimina la base al terminar. Los escenarios cubiertos incluyen exactamente dos `ERROR`; reintento idempotente; misma orden y referencia; reserva vencida renovada; tercer intento con nueva referencia `SW-…`; webhook tardío antiguo; aprobación actual e idempotencia; importe/estado incorrectos; inventario insuficiente; reapertura de cupón válida; cupón con límite de cliente agotado y rollback completo; RLS/ACL y `SECURITY DEFINER`/`search_path`.
- **Edge de recuperación (mocks):** admin autorizado, dos GET a `production.wompi.co`, verificación de referencia/importe/COP/ERROR/15 minutos y una sola llamada a la RPC; rechazo de `PENDING`, `APPROVED`, importe, referencia, moneda y antigüedad no coincidentes; IDs repetidos; usuario no admin; cero pagos/transacciones y sin PII en la respuesta.
- **Webhook (mocks):** estados actuales, mapping legacy por referencia+ID, rechazo de intento desconocido con historial, aprobación tardía aislada y no duplicación de efectos de inventario/cupón.
- **Regresiones existentes:** contrato de ambiente/firma y `expiration-time`, integración de cotización/checkout y límites de reserva del cliente.

**Límite de evidencia:** el scratch es un esquema mínimo sintético; para ejercitar el wrapper SQL, `prepare_storefront_wompi_checkout` se sustituyó en scratch por un test double determinista que devuelve los mismos campos y simula cotización, reserva y cupón. Por tanto, las pruebas validan la transacción/rollback y los contratos de la RPC nueva, pero no son una prueba end-to-end contra el esquema o datos de producción.

## Requiere autorización aparte antes de operar

Nada de lo anterior está aplicado ni desplegado. Para recuperar realmente la orden se requeriría autorizar, en una etapa posterior, las dos migraciones candidatas, el despliegue coordinado de `wompi-create-checkout`, `wompi-webhook` y `admin-wompi-legacy-recovery`, y después una única invocación admin con la referencia del pedido y los dos IDs ya comprobados. La invocación solo leería Wompi y revalidaría la reserva; dejaría `paymentStarted=false`. El cliente tendría que iniciar manualmente el nuevo checkout después. `online_payments_enabled` no se tocó en esta tarea.
