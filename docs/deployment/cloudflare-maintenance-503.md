# Mantenimiento HTTP 503 con Cloudflare Worker

Este incremento deja preparado un Worker reversible para una capa CDN delante de la tienda: cuando `MAINTENANCE_MODE` está apagado, pasa la solicitud original al origen existente; cuando está encendido, devuelve HTML estático con HTTP `503`, `Retry-After` y `Cache-Control: no-store`. `/robots.txt` siempre se reenvía al origen para mantener su respuesta normal. El código del Worker y la prueba local están en `infra/cloudflare/maintenance-worker.mjs` y `tests/cloudflare/maintenance_worker_regression.mjs`.

El Worker **no está desplegado** y no se configuró ninguna ruta, DNS, dominio, zona, cuenta ni recurso de Cloudflare. Cloudflare Routes exige una zona activa y un registro DNS proxied; su `fetch(request)` reenvía al origen definido en esa zona. Por eso el paso seguro solo es posible si Sirevya ya usa Cloudflare para la zona y el origen de GitHub Pages funciona mediante ese proxy. Si no, primero habría que decidir y preparar el proveedor/DNS; este PR no cambia el dominio ni el tráfico oficial.

Para activar más adelante, confirmar el estado de la zona y del registro `sirevya.com.co` en el panel Cloudflare, desplegar el Worker con `MAINTENANCE_MODE=off`, validar pass-through de portada, `/admin.html`, assets, rutas y `robots.txt`, y solo entonces asociar la ruta `sirevya.com.co/*`. La activación de mantenimiento se hace después cambiando la variable del Worker; este candidato no agrega un interruptor de Admin ni un nuevo almacenamiento. Los webhooks Wompi configurados directamente contra Supabase quedan fuera de la zona `sirevya.com.co`.

La respuesta estática mantiene la recomendación de Google para una interrupción corta: `503` con `Retry-After`, recursos mínimos y `robots.txt` disponible. Un cierre prolongado no es aconsejable para la visibilidad de búsqueda.

Validación local, sin cuenta de Cloudflare ni red:

```sh
node tests/cloudflare/maintenance_worker_regression.mjs
```

Referencias oficiales:
- [Cloudflare Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Cloudflare Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)
- [Google: pause or disable a website](https://developers.google.com/search/docs/crawling-indexing/pause-online-business)
