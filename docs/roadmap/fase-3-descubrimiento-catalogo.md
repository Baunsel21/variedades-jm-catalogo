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
- Se unifica la vigencia local de referencias pendientes/reservas: conserva el borde exacto de 10 minutos y admite hasta 60 segundos de desfase de reloj, pero descarta timestamps futuros más alejados para que un puntero obsoleto/manipulado no vuelva a abrir checkout. El reintento usa el `startedAt` original. No crea claves nuevas ni renueva reservas.

La función instalada `get_public_catalog()` no devuelve `created_at`, aunque la tabla `products` sí lo tiene. La implementación espera la RPC independiente `get_public_catalog_created_at()` para ordenar por novedad; esta tarea no aplica migraciones ni cambia datos compartidos.

Revisión de contrato read-only: `get_public_catalog()` es `SECURITY DEFINER` y actualmente no filtra por `user_id`, estado ni visibilidad; devuelve todas las filas actuales de `products` con los demás campos públicos del catálogo. `get_public_catalog_created_at()` usa el mismo conjunto base, pero expone solo `id` y `created_at`, por lo que no amplía el conjunto de filas ni los campos del catálogo existente. Se mantiene esa paridad para no cambiar silenciosamente el comportamiento actual. Si la aplicación pasa a multi-tienda/multi-tenant, ambas RPC deben restringirse juntas al administrador/tienda autorizada antes de cargar productos de otros propietarios; el despliegue actual es de una sola tienda.

## Pendiente para completar la fase

Siguen pendientes las etiquetas administrables de destacado/nuevo/oferta/últimas unidades, el filtro de ofertas y su relación con datos y stock del servidor. No se infieren ofertas desde precios o costos. La recuperación avanzada del carrito (avisar cambios de stock con autoridad, coordinar entre dispositivos y demostrar concurrencia de reutilización) permanece abierta. El carrito y checkout anuncian en región accesible si el precio local difiere del catálogo cargado. Las líneas reservadas cuyo producto no aparece se conservan en vez de filtrarse; se marcan «Por verificar», no muestran subtotal/envío/total parcial, tarifa/beneficio superior, descuentos por línea ni resumen combo, y guards detienen payload y rutas COD/Wompi antes de efectos. El drawer también oculta descuentos/progreso calculados sobre un subtotal incompleto. Sin ciudad o con “Otra” vacía tampoco se muestra “GRATIS” ni total. Previews/selectores/toast de combos exigen precio verificado y no calculan ahorro ni agregan items si `sale_price` es nulo/negativo. La cotización SQL rechaza precio `NULL` antes de convertirlo en importe; Wompi exige cotización válida y equivalencia canónica de ítems. Se revisó código fuente local, no la versión desplegada. Este slice verifica precio vigente, cotización antes de pedido/reserva/pago y que leer/reintentar/restaurar no extiende `startedAt`. La galería, guía y contenido relacionado se conservan; no es una nueva verificación de despliegue.

Antes de habilitar «Más recientes» en un entorno compartido, aplicar y verificar la migración/RPC correspondiente en un entorno aislado y mantener sus pruebas fuera de producción.

## Validación y despliegue

Se ejecutó:

```text
node tests/catalog_discovery_regression.mjs
node tests/cart_recovery_regression.mjs
```

`catalog_discovery_regression.mjs` es independiente y usa una VM real de Node con fixtures de variantes/stock: comprueba filtros de precio/color/talla/disponibilidad, persistencia ID-only en `localStorage`, aislamiento de claves de compra y round-trip de filtros en el URL. `cart_recovery_regression.mjs` ejecuta helpers reales de reserva con reloj/localStorage sintéticos: TTL, desfase futuro, no renovación, precio del catálogo y orden de cotización. También compila con el parser real de Node los scripts inline ejecutables del HTML.

En el cierre de integración también pasaron `node scripts/validate.mjs` y `git diff --check`. Se agregó el fixture de color+talla cruzados: debe existir una misma variante compatible, no stock separado de dos variantes distintas. La migración/SQL de metadata se incluyó localmente y se analizó con `pglast`, sin ejecutarla. No se ejecutaron pagos, navegador ni SQL, no se aplicó ninguna migración ni se editaron datos remotos; el sitio no está desplegado y la rama no está fusionada. La fase no debe declararse completa.
