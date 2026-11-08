# Evidencia de revisión — Fase 1

**Fecha:** 7 de noviembre de 2026, hora local de la sesión. **Rama:** `roadmap-mejoras-tienda-etapa1-envios`. **Commit de implementación:** `d2e2e7a`.

## Verificaciones de solo lectura

- El HTML servido por [sirevya.com.co](https://sirevya.com.co/) y el archivo de [GitHub `main`](https://raw.githubusercontent.com/Baunsel21/variedades-jm-catalogo/main/index.html) contienen `expected_total` y `expected_discount_total` en la solicitud a Wompi. Esto permite que la futura Edge Function estricta acepte el contrato que ya envía la página vigente.
- En una consulta agregada de solo lectura al proyecto Supabase de la tienda se encontraron **0 filas fraccionarias** en `products.sale_price`, `storefront_product_combos.discount_value` y `storefront_product_combos.combo_price`. Por eso exigir importes enteros COP en la Edge Function no cambia los datos actuales.
- Una consulta a `information_schema.columns` confirmó que `web_orders.total`, `web_orders.discount_total` y `web_orders.shipping` están definidos como `NOT NULL`. El wrapper COD, además, falla cerrado si una respuesta o fila no contiene importes verificables.
- El [PR #3 de GitHub](https://github.com/Baunsel21/variedades-jm-catalogo/pull/3) sigue abierto sobre una base anterior. Su diff reintroduce los datos de contacto anteriores y mensajes de envío fijos, y `git merge-tree` detectó conflicto en `index.html` al combinarlo con esta rama. No se mezcló ni se fusionó.

## Pruebas locales

- `node scripts/validate.mjs`: PASS. Incluye pruebas aisladas del cálculo de tarifa, Cali/alias, límites de umbral, transición del ticker y barra de progreso, campos inválidos, contrato Wompi/COD, claves de `localStorage` y rollback.
- `git diff --check`: PASS.
- Las migraciones y regresiones SQL se analizaron con `pglast`; todos los archivos parsearon.
- `wompi-create-checkout/index.ts` se transpila con TypeScript 5.9 y la salida pasa `node --check`.
- Dos revisiones independientes de solo lectura no dejaron hallazgos reproducibles pendientes después de las correcciones.

## Límites y despliegue

Las consultas SQL anteriores fueron solo lecturas. **No se aplicaron migraciones, no se desplegó la Edge Function, no se crearon pedidos ni reservas de prueba y no se ejecutaron pagos.** Las regresiones SQL `tests/shipping_config_regression.sql` y `tests/cod_regression.sql` están preparadas para una ejecución autorizada con datos sintéticos y rollback; su gramática se validó localmente, pero aún no se han ejecutado contra Supabase.

La secuencia propuesta se documenta en [`plan-integral.md`](plan-integral.md): desplegar primero la guardia Wompi, aplicar las migraciones de tarifas y protección COD solo después de autorización, publicar la interfaz y comprobar COD; el cierre manual del RPC COD antiguo queda para después de verificar el nuevo flujo en el dominio publicado.
