# Preview de desarrollo conectado a GitHub

El desarrollo visible vive en la rama `preview/development`, separada de `main`. El servidor lee el `index.html` de ese worktree en cada solicitud y devuelve `no-store`; después del commit y push del incremento, al refrescar se ve el HTML actual. `/__version` muestra branch, commit y si hay cambios sin commit. El código y el historial se respaldan en GitHub.

Iniciar en el sandbox con `PORT=4173 node scripts/preview-server.mjs`. La URL reenviada de esta sesión es temporal: responde mientras el servidor del sandbox esté activo y puede dejar de hacerlo si el entorno hiberna. No es un segundo GitHub Pages ni un hosting permanente. Los cambios en `index.html` o `admin.html` aparecen en el refresh; cambios a fixtures o al servidor requieren reiniciar el proceso.

El hub `GET /` enlaza a `/storefront` y `/admin-preview`; ambos cargan los HTML actuales del mismo worktree de `preview/development` sin caché. El admin usa identidad `admin-preview@example.invalid` y registros ficticios para dashboard, productos, ventas y COD. Solo se permiten lecturas de tablas/RPC declaradas; Auth real, escrituras de productos/categorías/pedidos, operaciones R2, cambios de estado COD, pagos, Edge Functions y llamadas de red externas fallan cerradas. `/admin.html` no se sirve directamente. `GET /manus-routes.json` declara únicamente esas tres páginas.

La tienda corre el código real del storefront con fixtures sintéticas (`DEMO-001`, etc.); el admin corre el código de `admin.html` detrás de otro cliente mock que devuelve una identidad ficticia y filas sintéticas. El servidor transforma ambos HTML en memoria: sustituye las asignaciones conocidas de Supabase/Wompi por valores locales no secretos, elimina scripts/links/iframes remotos, reescribe URLs externas a rutas locales, rechaza asignaciones reconocibles de claves/tokens/secretos (incluidos nombres bare como `API_KEY`, valores en backticks y valores no-placeholder), y falla cerrado si detecta asignación directa o calculada de `location`, escrituras de propiedades calculadas en globals, navegación programática, recursos remotos o estructura inesperada. El cliente mock se inyecta como primer script de `<head>`; el storefront no recibe sesión Auth y el admin solo recibe el usuario `@example.invalid`; realtime/Edge Functions no operan, las lecturas permitidas devuelven fixtures y las escrituras/RPC/tablas desconocidas se bloquean. También se bloquean fetch/XHR/WebSocket/EventSource/sendBeacon externos, enlaces/esquemas externos, popups, formularios y métodos HTTP distintos de GET/HEAD. La CSP restringe conexiones y recursos al mismo origen; los namespaces SVG preservados son identificadores XML, no cargas de red.

Cotización, reservas, pedidos COD, Wompi/PSE, tracking y cambios de inventario real no se ejecutan. Tarifas/stock de muestra no son datos productivos. Checks: `node --check scripts/preview-server.mjs`, `node --check tests/preview_server_regression.mjs` y `node tests/preview_server_regression.mjs`; esta última cubre credenciales/URLs desconocidas, navegaciones bare/calculadas, orden de scripts, atributos sin comillas, `data:`/`blob:`, formularios, denegaciones y cambio de HTML entre refreshes. Los incrementos se guardan en este branch; no se fusiona a `main`.


## Avance de catálogo: disponibilidad

El filtro client-side ofrece `Disponibles` (predeterminado, conserva el comportamiento existente), `Todos` y `Agotados`. El fixture `DEMO-004` representa un producto con cantidad y stock por variante en cero para verificar la opción de agotados; sigue siendo imposible comprarlo y no representa inventario real. Este sub-slice de Fase 3 no completa el filtro combinado del backlog.


El botón `Compartir` crea un enlace limpio con el rango de precio y la disponibilidad pública elegida; omite búsqueda, favoritos, datos personales y parámetros de tracking. La disponibilidad predeterminada (`available`) no se agrega a la URL. Este avance no completa aún la compartición de color/talla ni ofertas del ítem de Fase 3.


## Avances progresivos visibles

El panel de preview incorpora recuperación de cuenta, cambio de contraseña y cierre de sesiones junto con guards para descartar resultados tardíos de otra sesión; la sección es solo visible, porque el mock bloquea Auth y escrituras reales. El cambio no valida configuración productiva de redirect/SMTP ni MFA/AAL2 real.

La ficha del catálogo expone el zoom de imágenes como dialog accesible: trigger por teclado, botones con nombres accesibles, contador anunciado, Escape/flechas, ciclo de foco y retorno al control que abrió la galería. Regresión: `node tests/catalog_gallery_accessibility_regression.mjs`. La galería conserva sus imágenes, swipe y navegación existentes; no consulta ni modifica backend.


## Fallback de imágenes fallidas

Cuando no carga una imagen, la ficha y el zoom sustituyen el icono de error por un mensaje accesible que identifica el producto; las tarjetas conservan sus controles de carrusel y muestran un placeholder local, y los thumbnails/guía también evitan el icono roto. La falla de red no cambia URLs ni datos de producto. Regresión: `node tests/catalog_image_fallback_regression.mjs`.


## Orden por precio con valores desconocidos

Los órdenes «Precio menor → mayor» y «Precio mayor → menor» clasifican solo valores numéricos no negativos como precios conocidos. Los precios ausentes, vacíos, inválidos o negativos quedan al final en ambos sentidos; los empates se ordenan por nombre. El comparador no muta productos ni consulta servicios. Regresión: `node tests/catalog_price_sort_regression.mjs`.


## Orden en enlaces públicos

El enlace limpio también conserva los órdenes permitidos del catálogo (`recent`, ventas, nombre, precio y stock), restaura el selector antes del render y omite el orden predeterminado. Sigue excluyendo búsqueda, favoritos, carrito, tracking y otros parámetros no permitidos; no contacta backend. Regresión: `node tests/catalog_price_share_url_regression.mjs`.


## Fase 7: previsualización local de CSV

El admin de preview ahora tiene una vista «Importación CSV · vista previa». `scripts/fase7_csv_preview.mjs` valida CSV UTF-8 (BOM, comillas, comas y saltos multilínea), las columnas exactas `code,name,category,cost,sale_price,quantity`, códigos duplicados contra productos ya cargados y dentro del archivo, fórmulas, COP/cantidades enteras no negativas, variantes no admitidas y límites de 5 MB/10.000 filas. `scripts/admin_csv_preview.mjs` lee el archivo exclusivamente en el navegador y presenta filas válidas y errores mediante `textContent`; renderiza como máximo 50 filas y 100 errores. La ruta de preview solo sirve estos dos módulos concretos con GET/HEAD; no abre una ruta de archivos general.

Esta vista es un dry-run: no sube archivos, no contacta Supabase, no modifica productos ni ofrece botón de aplicar; `canCommit` permanece siempre `false`. La importación transaccional, backup verificable, staging, autorización y bitácora siguen pendientes. Regresiones: `node tests/fase7_csv_preview.mjs`, `node tests/admin_csv_preview_ui_regression.mjs` y `node tests/preview_server_regression.mjs`.
