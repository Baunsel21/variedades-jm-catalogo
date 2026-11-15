# Preflight de WhatsApp Cloud API y recuperación de carritos

## Estado actual de Sirevya

El número configurado actualmente es `+57 302 546 9983`. Aparece en:

- `https://wa.me/573025469983` en la tienda.
- Datos estructurados de la organización.
- Botones de contacto y asesoría.
- Acciones administrativas que abren WhatsApp Web mediante `wa.me`.

Esto confirma únicamente un canal de enlace. No confirma una conexión con WhatsApp Business Platform.

La revisión del repositorio no encontró:

- `phone_number_id` de Meta.
- `WABA_ID` o identificador de cuenta de WhatsApp Business.
- Access token de Meta en secretos de Supabase.
- Webhook de Meta con verificación `hub.challenge`.
- Edge Function de envío o recepción de WhatsApp.
- Tablas de conversaciones, consentimientos, carritos abandonados o mensajes.
- Scheduler de recuperación de carritos.

Por lo tanto, el bot y la recuperación automática **no están implementados ni activos**.

## Lo que sí puede reutilizarse

La infraestructura existente aporta:

- Supabase Edge Functions para endpoints seguros.
- RLS y autenticación administrativa.
- Scheduler basado en `pg_cron` y outbox para Telegram.
- Flujos de aceptación y estados de pedidos.
- Cotización server-side de carrito e inventario.
- Enlace de WhatsApp existente, que no será reemplazado.

El nuevo canal debe ser aditivo. No se deben cambiar los enlaces `wa.me` ni convertirlos automáticamente en envíos API.

## Requisitos que solo puede completar el propietario

Dentro de Meta for Developers se necesita:

1. Crear o seleccionar una aplicación Meta con el caso de uso WhatsApp.
2. Asociar un WhatsApp Business Account.
3. Confirmar si `+57 302 546 9983` puede registrarse en Cloud API o si requiere Embedded Signup/migración desde WhatsApp Business App.
4. Obtener el `phone_number_id` y el `WABA_ID`.
5. Crear un System User y generar un token permanente con los permisos apropiados.
6. Configurar el webhook de Meta y completar la verificación.
7. Crear y enviar a aprobación las plantillas de utilidad para aceptación y estados de pedidos.
8. Crear una plantilla de marketing separada para recuperación de carritos, solo si se desea enviar recordatorios fuera de una ventana de atención activa.

No se deben enviar tokens, secretos ni capturas con credenciales por este chat.

## Secretos previstos en Supabase Edge Functions

Estos nombres se configurarían exclusivamente en el proyecto Supabase autorizado, nunca en JavaScript público:

```text
META_WHATSAPP_ACCESS_TOKEN
META_WHATSAPP_PHONE_NUMBER_ID
META_WHATSAPP_BUSINESS_ACCOUNT_ID
META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
META_WHATSAPP_APP_SECRET
META_WHATSAPP_API_VERSION
```

El token permanente debe almacenarse en Supabase Secrets. El App Secret se usaría para validar la firma del webhook. El `phone_number_id` no es un secreto de alto impacto, pero se mantiene en servidor para evitar configuraciones divergentes.

## Reglas de mensajería

Antes de enviar mensajes se debe conservar evidencia de consentimiento. Meta exige que el negocio obtenga opt-in antes de contactar a una persona y que comunique claramente el nombre del negocio y el propósito del contacto.

Dentro de una ventana de atención de 24 horas después de un mensaje del cliente se pueden enviar mensajes de servicio. Fuera de esa ventana se necesitan plantillas aprobadas. La aceptación de un pedido y los estados logísticos deben utilizar plantillas de utilidad cuando no exista una ventana abierta. La recuperación de carritos requiere consentimiento y, normalmente, una plantilla adecuada cuando se envíe fuera de la ventana.

No se deben enviar mensajes desde el navegador, usar WhatsApp Web automatizado ni instalar librerías no oficiales.

## Arquitectura preparada después de la conexión

La implementación segura debe añadir, mediante migraciones probadas en scratch:

- `whatsapp_conversations` con estado `bot`, `human`, `paused` y `closed`.
- `whatsapp_consents` con categoría, versión del texto, fecha, origen y baja.
- `abandoned_carts` sin reservas de inventario.
- `whatsapp_message_outbox` con deduplicación, reintentos y estado de entrega.
- `whatsapp_events` para webhooks y auditoría técnica sin registrar secretos.
- RPC administrativas protegidas por `is_store_admin()` y `user_id`.
- Edge Function `whatsapp-webhook`.
- Edge Function `whatsapp-dispatch`.
- Scheduler que solo procese mensajes con consentimiento válido y que cancele la secuencia al completarse una compra, darse de baja o pasar a atención humana.

El checkout deberá guardar consentimiento desmarcado por defecto. Si WhatsApp falla, el checkout no debe bloquearse.

## Costos

Meta cobra por mensajes empresariales entregados, según la categoría y el país del número destinatario. Los mensajes del usuario al negocio no generan cobro de Meta. Los mensajes no basados en plantilla solo se pueden enviar durante la ventana de atención de 24 horas; fuera de ella se usan plantillas. La tarifa exacta para Colombia debe tomarse de la tarjeta vigente de la cuenta de Meta, porque puede cambiar por calendario de precios y categoría.

No se contratará un proveedor intermediario ni se activará facturación sin autorización del propietario.

## Bloqueo actual

No es posible declarar operativo el bot ni la recuperación de carritos porque falta la conexión oficial de Meta y sus identificadores. Tampoco es seguro crear migraciones de producción que dependan de secretos todavía inexistentes.

La acción necesaria del propietario es conectar en Meta el número actual o confirmar que autoriza una migración/Embedded Signup. Después se deberán proporcionar únicamente los identificadores no secretos y configurar los secretos directamente en Supabase:

- `phone_number_id`;
- `WABA_ID`;
- versión Graph API;
- URL de webhook autorizada para registrar en Meta;
- confirmación de que el token y App Secret fueron guardados en Supabase Secrets.

No se requiere compartir el token ni el App Secret con el asistente.

## Fuentes oficiales

- [Meta Cloud API: inicio](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- [Meta: consentimiento para WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)
- [Meta: envío de mensajes y ventana de atención](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)
- [Meta: precios de WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
