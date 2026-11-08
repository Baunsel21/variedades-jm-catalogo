# Plan de mejoras seguras para Sirevya

## Objetivo
Mejorar catálogo público, checkout, panel administrativo, SEO, seguridad y operaciones sin alterar las reglas de reservas que se están revisando por separado.

## Alcance y límites

- Mantener envío gratis en Cali.
- Mantener el vencimiento de reservas en 10 minutos.
- No cambiar claves de localStorage ni referencias de reservas en esta fase.
- No convertir ni liberar reservas históricas automáticamente.
- No borrar pedidos, ventas ni movimientos.
- Aplicar cambios en ramas separadas y publicar solo después de validación.

## Fases

### Fase 1 — Catálogo, accesibilidad y robustez visual

- Restaurar el hero que existe en CSS y asset, incorporando un único H1.
- Corregir el asset hero para que su extensión y MIME coincidan.
- Hacer tarjetas de producto operables con teclado sin insertar IDs dentro de handlers inline.
- Unificar cierre por Escape y foco básico de modales.
- Aceptar únicamente URLs promocionales HTTPS.
- Fijar la versión del SDK público de Supabase y preparar SRI compatible.
- Mantener la tarifa nacional como estimada hasta recibir la cotización autoritativa.
- Mantener Cali como envío gratis y validar siempre el total en Supabase.

### Fase 2 — Checkout y privacidad

- Agregar consentimiento explícito no premarcado para tratamiento de datos.
- Registrar aceptación solo después de confirmar el diseño de almacenamiento y la migración correspondiente.
- Revisar errores, reintentos y estados de carga de Wompi y contraentrega.
- Revisar la configuración fail-closed de contraentrega.
- Probar WhatsApp y contraentrega sin tocar reservas históricas.

### Fase 3 — Panel administrativo

- Eliminar el alta pública o sustituirla por autorización explícita de administrador.
- Reducir columnas y paginar pedidos para no cargar PII innecesaria.
- Sustituir borrado masivo por archivado/RPC transaccional y auditado.
- Corregir transiciones de estado y operaciones parciales de categorías.
- Mostrar físico, reservado y disponible por separado.
- Añadir manejo global de errores y reintento.
- Diseñar resolución idempotente para conciliaciones Wompi.
- Mejorar etiquetas accesibles y gestión de foco.

### Fase 4 — Supabase y seguridad

- Habilitar RLS explícitamente donde corresponda.
- Revisar grants de funciones SECURITY DEFINER y revocar EXECUTE público cuando sea seguro.
- Unificar políticas administrativas con `is_store_admin()`.
- Confirmar unique constraint de referencias de pedidos.
- Añadir anti-replay para webhook Wompi.
- Confirmar RPCs transaccionales e idempotentes para reserva, confirmación y liberación.

## Estrategia de validación

Cada fase se valida con sintaxis JavaScript/TypeScript, revisión de diff, pruebas de lectura y pruebas controladas que no borren datos ni hagan cobros reales. Los cambios de Supabase se preparan primero como migraciones versionadas; las migraciones destructivas o relacionadas con permisos requieren revisión separada antes de producción.

## Diseño visual elegido

- Movimiento: boutique editorial contemporánea, con una portada visual fuerte y navegación ligera.
- Principios: confianza, claridad de precio, foco en producto y accesibilidad móvil.
- Color: conservar la identidad actual y usar el acento dorado solo para acciones y promociones.
- Layout: hero editorial seguido de beneficios y catálogo, evitando adornos que compitan con el producto.
- Firma: marcos suaves, tarjetas con foco visible y microinteracciones breves.
- Tipografía: mantener la tipografía existente; reforzar jerarquía con un H1 claro y H2 de secciones.
- Voz: directa y comercial, sin prometer condiciones que no estén confirmadas por Supabase.
