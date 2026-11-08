# TODO de mejoras verificables

## Auditoría y línea base

- [x] Auditar `index.html`, `admin.html`, Edge Functions y migraciones sin modificar producción.
- [x] Confirmar sintaxis JavaScript embebida.
- [x] Confirmar que reservas, envío gratis en Cali y Wompi no se cambien durante la Fase 1.
- [x] Preparar plan y ramas de trabajo.

## Fase 1 — catálogo público

- [x] Restaurar hero visible y añadir un único H1.
- [x] Corregir formato real del asset hero.
- [ ] Mejorar teclado, foco y Escape en tarjetas, menú y modales.
- [ ] Evitar IDs incrustados en `onclick` cuando sea posible.
- [x] Aceptar solo enlaces promocionales HTTPS.
- [x] Fijar versión del SDK público y documentar integridad del recurso.
- [ ] Mostrar tarifa nacional como estimada hasta la cotización del servidor.

## Fase 2 — checkout

- [ ] Revisar consentimiento de tratamiento de datos y su persistencia.
- [ ] Cambiar contraentrega a modo fail-closed cuando la configuración no esté confirmada.
- [ ] Mejorar mensajes de error y reintento sin duplicar pedidos.
- [ ] Verificar WhatsApp, contraentrega y Wompi sin cobros reales.

## Fase 3 — administrador

- [ ] Restringir el alta pública y comprobar rol/allowlist de administrador.
- [ ] Reducir PII cargada y paginar pedidos.
- [ ] Reemplazar borrado masivo por archivado/RPC auditado.
- [ ] Validar transiciones de pedidos en UI y servidor.
- [ ] Hacer transaccional el reordenamiento de categorías.
- [ ] Separar stock físico, reservado y disponible.
- [ ] Añadir recuperación global ante fallos de carga.
- [ ] Definir flujo operativo de conciliación Wompi.
- [ ] Completar etiquetas y foco accesible.

## Fase 4 — Supabase y seguridad

- [ ] Auditar y endurecer RLS explícitamente.
- [ ] Auditar grants de funciones `SECURITY DEFINER`.
- [ ] Confirmar índice/constraint único de referencias.
- [ ] Añadir anti-replay para webhook Wompi.
- [ ] Verificar idempotencia transaccional de reserva, confirmación y liberación.

## Publicación

- [ ] Validar cada fase con diff, sintaxis y pruebas de lectura.
- [ ] Crear Pull Request por fase.
- [ ] No fusionar cambios de permisos o borrado sin autorización adicional.
- [ ] Confirmar publicación y hacer una prueba final de catálogo sin iniciar cobros.
