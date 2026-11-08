# Fase 3 — Descubrimiento y conversión del catálogo

**Estado:** implementación parcial en la rama `feature/catalog-discovery-favorites`; no está desplegada ni completa. Los ítems de Fase 3 en el backlog se mantienen abiertos.

## Incluido en este incremento

El toolbar de búsqueda y filtros vuelve a estar visible en escritorio y móvil, con navegación accesible al panel. Se agregan rango de precio, talla, disponibilidad y favoritos a los filtros existentes de categoría/color. El orden cronológico usa `created_at` solo cuando están disponibles los metadatos; los órdenes por precio y nombre también quedan en la URL. Se conserva la búsqueda compartible solo si corresponde a un código, nombre o categoría real del catálogo; los colores/tallas se restauran desde facetas conocidas. La lista local de favoritos persiste únicamente IDs en `sirevya_catalog_favorites_v1`, no se incorpora al URL y no modifica claves de carrito, COD o Wompi.

La ficha tiene botones de favorito y actualiza el enlace de WhatsApp con producto, código, precio, variante elegida y URL directa. Cuando falla una foto, la tarjeta o la ficha presenta un placeholder accesible; al cambiar a una imagen válida, el placeholder desaparece. “Comprar ahora”, la selección de variantes, el checkout, la cotización y las reservas existentes no se sustituyen.

La función instalada `get_public_catalog()` no devuelve `created_at`, aunque la tabla `products` sí lo tiene. Por eso se añade una migración independiente con `get_public_catalog_created_at()`, que expone solamente `(id, created_at)` para ordenar por novedad. Si la función aún no está instalada o no devuelve fechas utilizables, el orden por novedad se deshabilita y el selector cambia a un orden disponible.

## Pendiente para completar la fase

Siguen pendientes las etiquetas administrables de destacado/nuevo/oferta/últimas unidades, el filtro de ofertas y su relación con datos y stock del servidor. La inspección de metadatos no encontró esos atributos en la RPC pública actual; no se infieren ofertas desde precios o costos. La recuperación del carrito también permanece pendiente para no alterar reservas vigentes ni crear referencias duplicadas. La galería, la guía y el contenido relacionado existentes se conservan, pero no se consideran una nueva verificación de despliegue.

## Validación y despliegue

Se ejecutaron `node scripts/validate.mjs`, `git diff --check` y el parseo local con pglast de la migración y su prueba SQL; pasaron. La validación dinámica cubre la incorporación de un ID nuevo después de la carga inicial, evita otra consulta cuando el conjunto no cambia, rechaza fechas incompletas y descarta respuestas obsoletas si dos refrescos se resuelven fuera de orden. La regresión SQL `tests/catalog_discovery_metadata.sql` es de solo lectura y comprueba grants/forma mínima. No se ejecutó contra Supabase, no se aplicó la migración ni se editaron datos; el sitio no está desplegado y la rama no está fusionada. Antes de habilitar “Más recientes”, aplicar y verificar la migración en un entorno aislado; mantener la prueba SQL fuera de producción.
