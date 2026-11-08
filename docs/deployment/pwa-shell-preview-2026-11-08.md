# Shell PWA seguro de Sirevya

El storefront incluye `/manifest.webmanifest`, iconos cuadrados de 192 y 512 píxeles derivados del logo existente, y registro de `/sw.js`. El manifiesto del sitio productivo inicia en `/`; la ruta GitHub preview lo transforma únicamente en memoria para mostrar `Sirevya — Preview` y abrir `/storefront`.

El service worker guarda solamente `offline.html`, el manifiesto y los dos iconos. La navegación de tienda es network-first y no guarda el HTML de catálogo. Las solicitudes de Supabase, el mock API, imágenes, pagos, pedidos, reservas e inventario no son interceptadas ni cacheadas. El fallback offline informa que no hay conexión y se niega a presentar precios, stock o tarifas como actuales. Los métodos distintos de GET/HEAD continúan bloqueados por el servidor de preview.

En el navegador de preview, el service worker quedó registrado y `activated` bajo el origen temporal HTTPS, con el storefront controlado. Eso confirma el funcionamiento técnico del registro, no una prueba de instalación en todos los dispositivos o navegadores. La vista offline es informativa; no permite comprar, reservar ni consultar datos comerciales sin conexión. La migración a `main` queda separada de esta rama.

Regresiones ejecutadas: `node tests/pwa_shell_regression.mjs`, `node tests/preview_server_regression.mjs`, `node tests/prelaunch_shipping_copy_regression.mjs`, `node scripts/validate.mjs`, parseo de JavaScript inline y `git diff --check`.

## Fuentes técnicas

El manifiesto describe nombre, iconos, URL de inicio, alcance y modo de visualización; la guía recomienda iconos cuadrados y tamaños de 192/512 píxeles [1]. Los service workers requieren un contexto seguro como HTTPS y permiten responder a navegación offline mediante `fetch` [2]. Las estrategias de cache deben elegirse por frescura: el checkout y los pagos son casos de red solamente; los recursos estáticos son candidatos al cache [3]. Este incremento aplica una política más estricta para no conservar contenido comercial.

[1]: https://web.dev/learn/pwa/web-app-manifest "Web app manifest"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers "Using Service Workers"
[3]: https://web.dev/articles/service-worker-caching-and-http-caching "Service worker caching and HTTP caching"
