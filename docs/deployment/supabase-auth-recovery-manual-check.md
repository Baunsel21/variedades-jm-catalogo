# Verificación manual de recuperación de contraseña en Supabase Auth

**Estado:** pendiente de confirmación en el Dashboard. No se intentó otro inicio de sesión del Dashboard, no se enviaron correos y no se cambió la configuración.

## Proyecto y valores esperados

Proyecto: `hnlbbtnfmbnbkcgegufa`.

Abre [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/hnlbbtnfmbnbkcgegufa/auth/url-configuration) con una sesión que ya esté iniciada en tu propio navegador y entra a **Authentication → URL Configuration**.

Comprueba estos valores literales:

- **Site URL:** `https://sirevya.com.co`
- **Redirect URLs / Additional Redirect URLs:** debe existir exactamente `https://sirevya.com.co/admin.html`

El código de administración solicita ese destino explícito al pedir la recuperación. La Site URL es el destino alternativo de Supabase; el destino esperado del enlace de recuperación de Sirevya es `/admin.html`.

Si falta la Redirect URL, agrega solo `https://sirevya.com.co/admin.html` y guarda. No agregues comodines (`*`), el dominio `www`, direcciones `http`, localhost ni hosts temporales de preview. Si la Site URL difiere, cámbiala a `https://sirevya.com.co`. La configuración de allowlist no modifica pedidos, inventario ni pagos, pero guardar cambia un ajuste de autenticación de producción.

## Prueba segura del flujo

No pruebes usando la cuenta administrativa real. Primero confirma que hay una cuenta de prueba **sin rol de administrador** y un buzón de correo controlado, preferiblemente en un proyecto de staging ya autorizado. No se ha creado un staging nuevo.

1. Abre `https://sirevya.com.co/admin.html` y usa el formulario de recuperación con el correo de la cuenta de prueba.
2. Confirma que el correo llega al buzón de prueba y que el enlace redirige al dominio exacto `https://sirevya.com.co/admin.html`.
3. Define una contraseña para esa cuenta de prueba. Al volver, la vista debe permanecer en el flujo de recuperación y el usuario no debe recibir acceso al panel administrativo.
4. Confirma que la sesión de prueba permite solo las acciones asignadas a ese usuario. No completes compras, pagos ni cambios de inventario durante esta comprobación.

Solicitar el correo es una acción externa: ejecuta este paso solo con el buzón de prueba controlado. Si no existe una cuenta de prueba apropiada, limita la comprobación a comparar los dos valores de configuración; no envíes el correo de recovery en producción.

## Evidencia disponible

Las regresiones locales de `admin.html` cubren el destino canónico, validación del estado de recovery, eventos Auth y cierre de sesiones mediante mocks. No demuestran que la Redirect URL real esté guardada en el proyecto ni que un email llegue. La configuración de producción sigue pendiente de la comprobación manual anterior.

Supabase documenta la allowlist y sus patrones en [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
