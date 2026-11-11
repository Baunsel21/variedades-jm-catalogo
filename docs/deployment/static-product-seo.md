# Páginas SEO estáticas por producto

## Qué genera

`scripts/generate_product_seo.mjs` consume la misma RPC pública `get_public_catalog` que usa el storefront, pagina la lectura sin usar service-role y proyecta únicamente los campos públicos permitidos. Construye `/productos/<uuid>/index.html` para cada fila devuelta y combina esas rutas con las páginas informativas presentes en el sitemap base. La salida incluye título y descripción por producto, canonical absoluto, Open Graph, Twitter metadata, JSON-LD `Product`, una imagen HTTPS cuando existe y un enlace de compra a `/?producto=<uuid>`, que conserva el mecanismo de ficha compartida actual.

Las rutas existentes —incluida `/?producto=<uuid>`— no se eliminan ni se redirigen. Las páginas generadas se prueban con fixture sintético; el generador no incorpora campos arbitrarios de la RPC, ni credenciales privadas, ni cambia `sitemap.xml` en la raíz del repositorio durante las pruebas.

## Estado de publicación y dependencia

El repositorio está publicado actualmente por GitHub Pages desde `main` en `/` (`build_type=legacy`). Esa fuente publica archivos ya existentes, pero no ejecuta un generador que consulte Supabase. Para que las páginas nuevas y el sitemap se actualicen con el catálogo, hace falta desplegar el artefacto construido por GitHub Actions. No es posible obtener páginas HTML individualizadas dinámicamente manteniendo el modo actual de publicación desde rama sin generar y versionar cada salida tras cada cambio de catálogo.

El workflow `.github/workflows/seo-pages.yml` está preparado, pero su despliegue queda cerrado hasta que se cumplan ambos gates: cambiar en GitHub `Settings → Pages → Build and deployment → Source` a `GitHub Actions`, y definir la variable de repositorio `SIREVYA_PAGES_ACTIONS_ENABLED=true`. Antes de habilitarlos se recomienda proteger el entorno `github-pages` para permitir deployments solo desde `main`. El workflow consulta únicamente la RPC pública del catálogo; no requiere service-role ni secretos nuevos. Actualiza las páginas a diario y también puede iniciarse manualmente.

No se modificó la configuración de Pages, DNS, Cloudflare, Supabase ni el sitio publicado. Sin esos dos gates y la fusión posterior de la PR, la producción seguirá sirviendo el sitemap estático actual y no se debe afirmar que las rutas individuales están publicadas.

## Pruebas

La regresión `tests/seo_prerender_regression.mjs` comprueba generación de páginas, canonical y metadatos, JSON-LD, escaping, imágenes HTTPS, exclusión de campos ajenos, sitemap y navegación HTTP local. Usa solo fixtures sintéticos. La compilación de JavaScript se valida con Node; no se prueban pagos, pedidos ni escrituras en Supabase.
