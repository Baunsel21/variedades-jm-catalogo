# Prueba controlada del bot de Telegram

## Alcance de esta entrega

`telegram-test` es una prueba de conexión, no el dispatcher de pedidos. Solo admite `POST {"action":"test"}` y envía un texto fijo al `TELEGRAM_CHAT_ID` configurado en Supabase Edge Function Secrets. No acepta texto ni destinatario desde el navegador, no lee pedidos o clientes, y no escribe en tablas.

El endpoint requiere un JWT válido de Supabase y vuelve a comprobar `is_store_admin` con el token de usuario. CORS solo permite `https://sirevya.com.co`; la preview queda bloqueada. El botón del admin solicita confirmación antes de invocar la función. El resultado “aceptado” confirma la respuesta positiva de Telegram, no prueba por sí solo que una persona haya abierto/recibido el chat.

## Requisitos de despliegue

- Secrets ya configurados por el propietario, sin copiar sus valores a GitHub, logs o este documento: `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`.
- Desplegar el slug `telegram-test` con `verify_jwt=true`. No desplegarlo como anónimo ni desactivar la verificación JWT.
- Incluir ambos archivos de la función: `supabase/functions/telegram-test/index.ts` y `supabase/functions/telegram-test/core.mjs`.
- Requiere que el RPC `is_store_admin` existente continúe disponible para usuarios autenticados; esta entrega no altera su definición ni privilegios.

## Verificación

1. Ejecutar localmente `node tests/telegram_test_edge_regression.mjs` y `node tests/telegram_admin_ui_regression.mjs`.
2. Solo después de autorizar el despliegue, abrir `https://sirevya.com.co/admin.html` con una sesión admin verificada.
3. En Configuración, elegir “Enviar mensaje de prueba” y confirmar el diálogo. Debe enviarse un único mensaje fijo al chat ya configurado.
4. Comprobar manualmente el chat. No usar esta prueba para crear pedidos, pagos ni reservas reales.

El endpoint aplica un enfriamiento de 60 segundos por instancia para evitar repeticiones inmediatas. Supabase/Telegram pueden escalar a distintas instancias; este límite no sustituye una deduplicación durable.

## Pendiente para notificaciones de negocio

No se conectan todavía nuevos pedidos, estados de pago, eventos Wompi, problemas de inventario o reservas/liberaciones. El webhook Wompi puede reintentarse y las operaciones de inventario tienen efectos propios; llamar a Telegram desde esos puntos sin outbox e idempotencia durable podría duplicar o retrasar notificaciones. El dispatcher, reintentos durables, registro de fallos, configuración persistente de activar/desactivar y sus migraciones requieren un entorno aislado y contrato de datos validados. No se debe marcar Telegram completo hasta probar el mensaje en el chat y validar cada evento.
