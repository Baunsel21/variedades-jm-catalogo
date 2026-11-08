# Plan de mejoras integrales para Sirevya

## Objetivo

Completar las mejoras solicitadas para el catálogo y el panel administrativo por etapas pequeñas, revisables y con regresión demostrable. No reemplazar ni rediseñar de golpe la tienda existente. Conservar su identidad visual actual, funcionamiento móvil y los flujos de compra vigentes.

## Diseño e implementación

**Dirección visual:** reutilizar el estilo actual de Sirevya: femenino, claro y orientado a producto; mantener paleta, tipografía, tarjetas, modales y controles existentes. Nuevos módulos administrativos deben seguir el patrón de cajas, estados y botones del panel, sin añadir imágenes decorativas a herramientas internas.

**Principio central:** Supabase es fuente autoritativa para precios, descuentos, inventario, tarifas, elegibilidad COD y pedidos. El navegador muestra estimados; el servidor recalcula antes de crear un pedido o firmar un pago. Las operaciones peligrosas son transaccionales y restringidas por `is_store_admin()` o service role según corresponda.

**Estructura actual:** `index.html` contiene el catálogo, producto, filtros, carrito y checkout; `admin.html` contiene inventario, ventas, pedidos, clientes, reportes y configuración; `supabase/migrations/` versiona DDL/permisos; `supabase/functions/` contiene checkout y webhook Wompi; `tests/` guarda regresiones SQL y `scripts/validate.mjs` revisa contratos estáticos. En las primeras etapas se reutilizarán esos módulos. Se extraerán archivos separados solo cuando sea viable sin cambiar la forma de publicación GitHub Pages.

## Fases de ejecución

### Fase 1 — Envíos configurables desde el admin

Versionar una configuración protegida por administrador y funciones de lectura/guardado. Inicializarla con el comportamiento vigente: **Cali gratis, $15.000 para otras ciudades y envío gratis desde $130.000 de subtotal después de descuentos**. Hacer que `get_storefront_cart_quote` lea la configuración para que Wompi y COD hereden una única decisión autoritativa; mantener los importes históricos ya almacenados. El admin permitirá editar tarifa nacional y umbral, con validación, vista previa y restauración de los valores actuales. Añadir prueba de frontera para $129.999/$130.000, combos y alias de Cali. Despliegue seguro en orden: (1) publicar la Edge Function Wompi con la comparación del total confirmado antes de reserva/pedido; la página pública actual ya envía `expected_total` y `expected_discount_total`; (2) con autorización, aplicar solo `20261108060000` y `20261108060100` mientras se mantiene el RPC COD legacy accesible; (3) publicar el frontend que lee las tarifas y llama `create_contra_delivery_order_with_quote`, y comprobar COD; (4) solo entonces ejecutar manualmente `docs/deployment/restrict_legacy_cod_rpc_after_frontend.sql`, nunca como migración automática anterior al frontend. La guardia Wompi rechaza cambios con 409 antes de crear pedidos o reservas, exige importes COP enteros y no libera reservas previas. COD falla cerrado ante cotizaciones/importes incompletos y nunca oculta un pedido duplicado con total distinto. Ningún paso de producción se ejecuta hasta confirmar despliegue y probar el contrato completo.

### Fase 2 — Tarifas y destinos

Ampliar gradualmente a tarifa/umbral opcional por ciudad o zona; definir normalización y ciudades cubiertas; integrar contraentrega con la misma lista de destinos sin duplicar su configuración actual. Conservar compatibilidad de `Otra ciudad`; impedir que el cliente cambie el precio manipulado desde el navegador.

### Fase 3 — Descubrimiento y conversión del catálogo

Agregar etiquetas administrables (destacado, nuevo, oferta, últimas unidades), filtros accesibles de escritorio/móvil, fallback de foto, guía de tallas, relacionados, CTA contextual de WhatsApp y acceso de compra rápida que conserve selección de variantes y reserva server-side. Añadir favoritos/lista de deseos local con clave propia y sin tocar claves de reserva existentes. Evaluar recuperación de carrito sin renovar la reserva de 10 minutos ni crear referencias nuevas para evadir conflictos.

### Fase 4 — Promociones y campañas

Completar promociones, cupones con vigencia/límites, combos, calendarios y descuentos solo si la cotización server-side y Wompi/COD calculan el mismo total. Evitar promesas promocionales que no estén vinculadas a reglas de precio/envío. No duplicar el módulo actual de combos ni popup; extenderlo.

### Fase 5 — Pedidos y pagos

Alinear con evidencia las tablas `orders` y `web_orders` antes de unificarlas o presentar un panel conjunto. Fortalecer idempotencia/concurrencia de webhooks y reservas, mostrar estado de pago/logística/inventario en conciliación, agregar reintento seguro solo mediante RPC atómica y auditar decisiones. No hacer cargos de prueba; PSE solo en sandbox del comercio si está disponible.

### Fase 6 — Operación administrativa

Mejorar dashboard con pedidos pendientes, ventas por periodo, inventario bajo y pagos que requieren atención; agregar filtros/periodos y paginación donde hoy hay cortes de lista. Ampliar clientes con historial sin exponer PII a usuarios no autorizados. Separar estado logístico (transportadora, guía, promesa y entrega) del estado comercial/pago.

### Fase 7 — Trazabilidad, importación y datos

Añadir bitácora administrativa append-only para cambios de precio, inventario, pedidos, envíos y configuración. Diseñar importación de productos con previsualización/dry-run, límites, detección de duplicados y commit transaccional. Mejorar backup con lista blanca de columnas sensibles, inventario de archivos R2 y prueba de restauración; conservar archivado reversible y neutralización de fórmulas CSV.

### Fase 8 — Confianza, SEO y crecimiento

Agregar/terminar páginas de políticas, preguntas frecuentes y comunicación clara de envíos/pagos; metadatos y rutas indexables por producto; PWA; avisos configurables; optimización de imágenes, paginación y medición de rendimiento. No cachear precios/stock como si fueran disponibilidad actual.

## Límites de seguridad y lanzamiento

- No renombrar ni borrar referencias o claves de `localStorage` de Wompi/COD.
- No alterar expiración de reservas (10 minutos), descuentos existentes, impuestos/precios, ciudades COD ni estados actuales sin pruebas específicas.
- No editar `orders`, `web_orders`, inventario o datos reales para simular compras.
- Migraciones de producción se aplican de forma explícita, después de revisar diff/SQL y una prueba en un entorno aislado o transacción reversible.
- Cada etapa se entrega en rama/PR con cambios acotados. No fusionar una rama vieja por encima de `main` sin resolver y revisar el diff propio.
- Para etapas financieras se requiere prueba de paridad local/RPC/Wompi/COD, rollback o salida segura, y verificación de la web publicada después del merge.
