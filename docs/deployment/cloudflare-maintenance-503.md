# Mantenimiento HTTP 503 con Cloudflare Worker

Este incremento deja preparado un Worker reversible para una capa CDN delante de la tienda: cuando `MAINTENANCE_MODE` está apagado, pasa la solicitud original al origen existente; cuando está encendido, devuelve HTML estático con HTTP `503`, `Retry-After` y `Cache-Control: no-store`. `/robots.txt` siempre se reenvía al origen para mantener su respuesta normal. El código del Worker y la prueba local están en `infra/cloudflare/maintenance-worker.mjs` y `tests/cloudflare/maintenance_worker_regression.mjs`.

El Worker **no está desplegado** y no se configuró ninguna ruta, DNS, dominio, zona, cuenta ni recurso de Cloudflare. Cloudflare Routes exige una zona activa y un registro DNS proxied; su `fetch(request)` reenvía al origen definido en esa zona. Por eso el paso seguro solo es posible si Sirevya ya usa Cloudflare para la zona y el origen de GitHub Pages funciona mediante ese proxy. Si no, primero habría que decidir y preparar el proveedor/DNS; este PR no cambia el dominio ni el tráfico oficial.

Para activar más adelante, confirmar el estado de la zona y del registro `sirevya.com.co` en el panel Cloudflare, desplegar el Worker con `MAINTENANCE_MODE=off`, validar pass-through de portada, `/admin.html`, assets, rutas y `robots.txt`, y solo entonces asociar la ruta `sirevya.com.co/*`. La activación de mantenimiento se hace después cambiando la variable del Worker; este candidato no agrega un interruptor de Admin ni un nuevo almacenamiento. Los webhooks Wompi configurados directamente contra Supabase quedan fuera de la zona `sirevya.com.co`.

La respuesta estática mantiene la recomendación de Google para una interrupción corta: `503` con `Retry-After`, recursos mínimos y `robots.txt` disponible. Un cierre prolongado no es aconsejable para la visibilidad de búsqueda.

## SEO individual por producto: prerequisitos aún no activos

La tienda oficial se publica como HTML/JavaScript estático. Un modal de producto, una URL de consulta o un cambio de `<title>` después de ejecutar JavaScript no entregan por sí solos a un crawler una página HTML inicial distinta por producto. GitHub Pages tampoco calcula una respuesta `404` por producto desconocido ni un `canonical`/Open Graph por solicitud. Por eso no se debe declarar SEO individual implementado únicamente porque el producto se ve en el navegador.

Una página indexable por producto debe tener una ruta pública estable y HTML inicial con nombre/descripción e imagen pública, `<title>`, description, Open Graph/Twitter, `canonical`, datos estructurados válidos, enlaces navegables y un `sitemap.xml` coherente. Un producto ausente debe responder HTTP `404` real y llevar `noindex`; solo datos públicos publicados pueden entrar en ese HTML.

Opciones compatibles, todavía no configuradas:

1. **Prerender estático:** generar `/productos/<slug>/index.html` para cada producto publicado desde una fuente pública/saneada durante un proceso de publicación controlado, y actualizar sitemap/404 junto con el catálogo. Requiere acordar un slug estable y cómo se publican cambios de productos; al ser estático, el HTML queda desactualizado hasta la siguiente generación. No almacenar una service-role key en GitHub Pages ni en el navegador.
2. **SSR/gateway en Cloudflare:** requiere una cuenta/zona activa de Cloudflare con el dominio en DNS proxied, una ruta de Worker para las páginas de producto, y una fuente de lectura limitada a catálogo público (por ejemplo, endpoint con permisos `anon`/RLS de productos publicados; nunca service-role en HTML). El Worker debe generar el HTML y el `404` antes de enviarlo, conservar pass-through a GitHub Pages para el resto del sitio y coexistir cuidadosamente con la futura ruta de mantenimiento. No desplegar ni asociar rutas hasta probar staging, caché, fallo de datos, canonical, robots y webhook Wompi; los webhooks Supabase directos no deben pasar por ese gateway.

**Pendiente externo:** decidir y configurar el proveedor/zona proxied (o aceptar el flujo de prerender y su frecuencia de publicación), además de definir la política de slugs y el origen público seguro del catálogo. Este repositorio no cambia DNS/hosting, no activa rutas de Worker y no afirma que el SEO individual esté listo.

Validación local, sin cuenta de Cloudflare ni red:

```sh
node tests/cloudflare/maintenance_worker_regression.mjs
```

Referencias oficiales:
- [Cloudflare Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Cloudflare Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)
- [Google: pause or disable a website](https://developers.google.com/search/docs/crawling-indexing/pause-online-business)
