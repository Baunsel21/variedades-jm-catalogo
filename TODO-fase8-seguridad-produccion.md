# TODO — Fase 8

- [x] Las funciones internas reserve_inventory y confirm_inventory_reservation no admiten anon/authenticated; service_role conserva EXECUTE y las RPC públicas legítimas funcionan.
- [x] Usuarios no administradores no pueden modificar productos, fotos, ventas ni clientes por tablas del panel; el administrador conserva sus datos y operaciones.
- [x] Las fotografías solo pueden asociarse a productos del mismo propietario; Storage permite mutaciones únicamente al administrador y sigue sirviendo imágenes públicas.
- [x] Categorías se consultan sin acceder directamente a store_settings; el catálogo recibe solo nombre y orden mediante una RPC pública.
- [x] La inserción directa de web_orders no está habilitada para anon/authenticated; contraentrega continúa usando su RPC validada.
- [x] Cierre/cambio de sesión oculta el panel y detiene su canal, sin desactivar refresco de 15 segundos ni Realtime de una sesión válida. Un error temporal de red no se anuncia como revocación confirmada.
- [x] CSV neutraliza fórmulas de texto y mantiene números; las etiquetas de promoción se escapan al renderizar.
- [x] SDK Supabase tiene versión idéntica e integridad verificada en panel y catálogo; las comprobaciones reproducibles pasan.
- [ ] Publicación de GitHub Pages confirmada y versión servida verificada; ninguna clave localStorage, precio, tarifa, ciudad, reserva o función Wompi fue modificada.
