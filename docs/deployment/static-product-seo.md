# Páginas SEO estáticas por producto

## Qué genera

`scripts/generate_product_seo.mjs` consume la misma RPC pública `get_public_catalog` que usa el storefront, pagina la lectura sin usar service-role y proyecta únicamente los campos públicos permitidos. Construye `/productos/<uuid>/index.html` para cada fila devuelta y combina esas rutas con las páginas informativas presentes en el sitemap base. La salida incluye título y descripción por producto, canonical absoluto, Open Graph, Twitter metadata, JSON-LD `Product`, una imagen HTTPS cuando existe y un enlace de compra a `/?producto=<uuid>`, que conserva el mecanismo de ficha compartida actual.

Las rutas existentes —incluida `/?producto=<uuid>`— no se eliminan ni se redirigen. Las páginas generadas se prueban con fixture sintético; el generador no incorpora campos arbitrarios de la RPC, ni credenciales privadas, ni cambia `sitemap.xml` en la raíz del repositorio durante las pruebas.

## Estado de publicación y dependencia

El repositorio está publicado actualmente por GitHub Pages desde `main` en `/` (`build_type=legacy`). Esa fuente publica archivos ya existentes, pero no ejecuta un generador que consulte Supabase. Para que las páginas nuevas y el sitemap se actualicen con el catálogo, hace falta desplegar el artefacto construido por GitHub Actions. No es posible obtener páginas HTML individualizadas dinámicamente manteniendo el modo actual de publicación desde rama sin generar y versionar cada salida tras cada cambio de catálogo.

El workflow `.github/workflows/seo-pages.yml` está preparado, pero su despliegue queda cerrado hasta que se cumplan ambos gates: cambiar en GitHub `Settings → Pages → Build and deployment → Source` a `GitHub Actions`, y definir la variable de repositorio `SIREVYA_PAGES_ACTIONS_ENABLED=true`. Consulta únicamente la RPC pública del catálogo; no requiere service-role ni secretos nuevos. Actualiza las páginas a diario y también puede iniciarse manualmente.

No se modificó la configuración de Pages, DNS, Cloudflare, Supabase ni el sitio publicado. Sin esos dos gates y la fusión posterior de la PR, la producción seguirá sirviendo el sitemap estático actual y no se debe afirmar que las rutas individuales están publicadas.

## Revisión previa del workflow y artifact

La PR #129 se ejecutó en modo `pull_request`: el job `build` terminó `success` y `deploy` quedó `skipped`. El artifact `github-pages` se subió correctamente; se descargó y verificó sin desplegarlo. Contiene dos páginas sintéticas de prueba, `.nojekyll`, `CNAME` y los recursos raíz incluidos en la lista allowlist. Los archivos existentes (incluidos `index.html`, `admin.html`, PWA y páginas informativas) son byte-idénticos a `main`; el sitemap conserva sus cuatro URLs existentes y agrega las de los fixtures. La ruta actual `/?producto=<id>` continúa en el `index.html` original.

El workflow tiene permiso global `contents: read`; solo el job de despliegue solicita `pages: write` e `id-token: write`. El job requiere `main`, variable habilitada y que la API de Pages confirme `build_type=workflow`. El environment `github-pages` existente restringe ramas a `main`, pero permite bypass de administradores y no muestra aprobación obligatoria de un revisor. No se modificó esa protección; si se desea un gate humano adicional, debe configurarse antes de habilitar la variable.

La fuente actual, leída del API de Pages, sigue siendo `build_type=legacy`, rama `main`, ruta `/`. Por ello el artifact de la PR no está publicado ni cambia rutas actuales.

## Reversión

Antes de activar Actions, registrar la fuente actual (`Deploy from a branch → main → /(root)`) y confirmar que el dominio personalizado continúa asociado al `CNAME` del repositorio. Para revertir una activación: primero cambiar `SIREVYA_PAGES_ACTIONS_ENABLED` a `false` o eliminar la variable; si hay un deploy en curso, cancelarlo desde Actions; luego volver a `Settings → Pages → Build and deployment → Source → Deploy from a branch`, con `main` y `/(root)`. Esto vuelve a servir los archivos existentes de la raíz del repositorio; no requiere cambiar DNS, Cloudflare ni borrar el workflow o el `CNAME`. Verificar `GET`/`HEAD` de `/`, `/admin.html`, `/robots.txt`, `/sitemap.xml` y una URL existente `/?producto=<id>`. Las rutas SEO nuevas `/productos/<uuid>/` dejarían de publicarse al revertir, pero las URL actuales con `?producto=` permanecen.

## Pruebas

La regresión `tests/seo_prerender_regression.mjs` comprueba generación de páginas, canonical y metadatos, JSON-LD, escaping, imágenes HTTPS, exclusión de campos ajenos, sitemap y navegación HTTP local. Usa solo fixtures sintéticos. La compilación de JavaScript se valida con Node; no se prueban pagos, pedidos ni escrituras en Supabase.
