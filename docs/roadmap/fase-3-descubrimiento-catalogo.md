# Fase 3 — Descubrimiento y conversión del catálogo

**Estado:** implementación parcial integrada desde `da8d811` de la rama `feature/catalog-discovery-favorites` sobre `feature/admin-dashboard-critical-fixes`; no está desplegada ni completa. Los ítems de Fase 3 permanecen abiertos.

## Incluido en este incremento

- El toolbar de búsqueda y filtros queda visible en escritorio y móvil, con acceso al panel de filtros. Se agregan rango de precio, talla y disponibilidad a los filtros existentes de categoría/color.
- Se incorpora favoritos locales en `sirevya_catalog_favorites_v1`, persistiendo únicamente IDs de producto y sin escribir en las claves de carrito, COD, Wompi o reservas. El filtro de favoritos no se serializa en el URL.
- Los filtros de categoría, búsqueda segura, precio, color, talla, disponibilidad y orden se sincronizan con el URL. La búsqueda sólo se comparte cuando corresponde a un código, nombre o categoría real del catálogo; color y talla se restauran desde facetas conocidas.
- El orden cronológico usa `created_at` sólo cuando la metadata pública está disponible y es completa. Si la RPC no existe, falla o devuelve fechas incompletas, «Más recientes» se deshabilita y se conserva un orden disponible. Los órdenes por nombre/precio también son compartibles.
- La ficha tiene control de favorito y actualiza el enlace contextual de WhatsApp con producto, código, precio, variante seleccionada y URL directa.
- Si falla una imagen, la tarjeta o la ficha presenta un fallback accesible; al seleccionar una imagen válida el fallback desaparece.
- Se conservan «Comprar ahora», selección de variantes, catálogo de combos, cupones, checkout, cotización, reservas, city/zone shipping y sus contratos existentes. También se preservan el TTL de reservas de 10 minutos y las claves `WOMPI_*`, `COD_ORDER_DRAFT_KEY` y `WOMPI_CART_KEY`.

La función instalada `get_public_catalog()` no devuelve `created_at`, aunque la tabla `products` sí lo tiene. La implementación espera la RPC independiente `get_public_catalog_created_at()` para ordenar por novedad; esta tarea no aplica migraciones ni cambia datos compartidos.

Revisión de contrato read-only: `get_public_catalog()` es `SECURITY DEFINER` y actualmente no filtra por `user_id`, estado ni visibilidad; devuelve todas las filas actuales de `products` con los demás campos públicos del catálogo. `get_public_catalog_created_at()` usa el mismo conjunto base, pero expone solo `id` y `created_at`, por lo que no amplía el conjunto de filas ni los campos del catálogo existente. Se mantiene esa paridad para no cambiar silenciosamente el comportamiento actual. Si la aplicación pasa a multi-tienda/multi-tenant, ambas RPC deben restringirse juntas al administrador/tienda autorizada antes de cargar productos de otros propietarios; el despliegue actual es de una sola tienda.

## Pendiente para completar la fase

Siguen pendientes las etiquetas administrables de destacado/nuevo/oferta/últimas unidades, el filtro de ofertas y su relación con datos y stock del servidor. No se infieren ofertas desde precios o costos. La recuperación del carrito permanece pendiente para no alterar reservas vigentes ni crear referencias duplicadas. La galería, guía y contenido relacionado existentes se conservan, pero no se considera una nueva verificación de despliegue.

Antes de habilitar «Más recientes» en un entorno compartido, aplicar y verificar la migración/RPC correspondiente en un entorno aislado y mantener sus pruebas fuera de producción.

## Validación y despliegue

Se ejecutó:

```text
node tests/catalog_discovery_regression.mjs
```

La regresión es independiente y usa una VM real de Node con fixtures de variantes/stock: comprueba filtros de precio/color/talla/disponibilidad, persistencia ID-only en `localStorage`, aislamiento de claves de compra y round-trip de filtros en el URL. También compila con el parser real de Node los scripts inline ejecutables del HTML. El resultado fue `catalog_discovery_regression: OK`.

En el cierre de integración también pasaron `node scripts/validate.mjs` y `git diff --check`. Se agregó el fixture de color+talla cruzados: debe existir una misma variante compatible, no stock separado de dos variantes distintas. La migración/SQL de metadata se incluyó localmente y se analizó con `pglast`, sin ejecutarla. No se ejecutaron pagos, navegador ni SQL, no se aplicó ninguna migración ni se editaron datos remotos; el sitio no está desplegado y la rama no está fusionada. La fase no debe declararse completa.
