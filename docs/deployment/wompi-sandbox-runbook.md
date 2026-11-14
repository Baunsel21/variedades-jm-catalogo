# Entorno aislado de Wompi Sandbox para Sirevya

**Estado:** preparado; pruebas reales bloqueadas por falta de un proyecto Supabase Sandbox y credenciales de prueba separadas.

**Commit de referencia:** `71d65aa`

## Resultado del preflight

El conector Supabase autorizado solo muestra un proyecto, `hnlbbtnfmbnbkcgegufa`, que corresponde a la producción de Sirevya. No existe actualmente un proyecto Supabase Sandbox separado visible para esta sesión.

No se modificó la configuración de producción. `online_payments_enabled` permanece desactivado y no se cambiaron secretos, funciones ni credenciales de producción.

El código de las funciones ya separa el ambiente mediante `WOMPI_ENVIRONMENT`:

- `test` usa `https://sandbox.wompi.co/v1` en el webhook.
- Cualquier otro valor válido no permitido se rechaza; `prod` usa el endpoint de producción.
- La función de checkout selecciona `WOMPI_INTEGRITY_SECRET_TEST` cuando el ambiente es `test`.
- El webhook selecciona `WOMPI_EVENT_SECRET_TEST` y `WOMPI_PRIVATE_KEY_TEST` cuando el ambiente es `test`.

## Aislamiento requerido

El Sandbox no debe ser otra configuración temporal dentro del proyecto productivo. Debe utilizar:

1. Un proyecto Supabase separado, con su propia URL, anon/publishable key, base de datos, migraciones y Edge Functions.
2. Una URL de eventos Wompi distinta para Sandbox:
   `https://<sandbox-project-ref>.supabase.co/functions/v1/wompi-webhook`
3. Una publicación frontend de pruebas que use la llave pública `pub_test_...` y el endpoint de checkout del proyecto Sandbox.
4. Datos sintéticos y un catálogo de prueba. No debe leer ni escribir `orders`, inventario, reservas o clientes de producción.
5. Variables y secretos almacenados solo en el proyecto Sandbox. Nunca deben copiarse a Git, HTML público, registros o mensajes.

Wompi documenta que Sandbox y Producción son ambientes independientes, con llaves y URLs diferentes. Sandbox usa `https://sandbox.wompi.co/v1`; Producción usa `https://production.wompi.co/v1`.

## Variables necesarias en las Edge Functions Sandbox

Configurar únicamente en el proyecto Sandbox:

```text
SUPABASE_URL=<URL del proyecto Sandbox>
SUPABASE_SECRET_KEYS=<JSON secreto del proyecto Sandbox>
# Alternativa heredada solo si el proyecto no usa secret keys nuevas:
SUPABASE_SERVICE_ROLE_KEY=<service role de Sandbox>

WOMPI_ENVIRONMENT=test
WOMPI_INTEGRITY_SECRET_TEST=<secreto test_integrity_...>
WOMPI_EVENT_SECRET_TEST=<secreto test_events_...>
WOMPI_PRIVATE_KEY_TEST=<llave privada prv_test_...>
```

La función de checkout no necesita el secreto de eventos. El webhook no necesita el secreto de integridad. Separarlos reduce el alcance de cada función.

En el frontend Sandbox se configura solamente:

```text
SUPABASE_URL=<URL Sandbox>
SUPABASE_ANON_KEY=<clave pública de Supabase Sandbox>
WOMPI_PUBLIC_KEY=pub_test_...
```

No se debe colocar `WOMPI_PRIVATE_KEY_TEST`, `WOMPI_EVENT_SECRET_TEST` ni `WOMPI_INTEGRITY_SECRET_TEST` en HTML, JavaScript público, query strings o variables expuestas al navegador.

## Pruebas reales pendientes

Cuando el proyecto Sandbox y sus credenciales estén disponibles, ejecutar en este orden:

1. Tarjeta aprobada: `4242 4242 4242 4242`.
2. Tarjeta declinada: `4111 1111 1111 1111`.
3. Un checkout abandonado que permanezca `PENDING` y expire por TTL.
4. Reintento con la misma referencia y con una referencia nueva.
5. Reenvío del mismo evento `transaction.updated` para comprobar idempotencia.
6. Error de API o de reserva para comprobar liberación y conciliación.
7. Verificación de que una aprobación descuenta inventario una sola vez y guarda `transaction_id`.
8. Verificación de que `DECLINED`, `VOIDED` y `ERROR` no marcan el pedido como pagado y liberan las reservas.

Wompi también documenta datos de prueba para Nequi y PSE. Deben usarse solo dentro del comercio Sandbox y no deben mezclarse con producción.

## Evidencia que debe conservarse

Por cada caso registrar únicamente identificadores de prueba y estados, nunca nombres, teléfonos, documentos ni secretos:

- referencia sintética;
- identificador de transacción Sandbox;
- estado esperado y estado recibido;
- respuesta HTTP del webhook;
- `payment_status` antes y después;
- estado de reserva antes y después;
- cantidad de movimientos de inventario;
- resultado de la segunda notificación duplicada;
- timestamp y commit de la prueba.

## Bloqueos actuales

No es seguro ejecutar una prueba real todavía porque falta:

- proyecto Supabase Sandbox separado;
- migraciones y Edge Functions desplegadas en ese proyecto;
- URL de eventos Sandbox configurada en el comercio Wompi de pruebas;
- llaves `pub_test_`, `prv_test_`, `test_events_` y `test_integrity_` entregadas mediante el gestor de secretos, sin compartirlas en chat;
- frontend de pruebas apuntando al proyecto Sandbox.

No se debe habilitar `online_payments_enabled` en producción para resolver ninguno de estos bloqueos.

## Fuentes oficiales

- [Ambientes y llaves de Wompi](https://docs.wompi.co/docs/colombia/ambientes-y-llaves/)
- [Datos de prueba en Sandbox](https://docs.wompi.co/docs/colombia/datos-de-prueba-en-sandbox/)
- [Eventos y webhooks de Wompi](https://docs.wompi.co/docs/colombia/eventos/)
