# TODO — Fase 2: panel y protección de datos

## Completado

- [x] Retirar el botón de creación pública de cuentas del panel.
- [x] Validar el rol de administrador mediante `is_store_admin()` antes de mostrar el panel.
- [x] Mostrar un error recuperable si falla la validación de sesión o autorización.
- [x] No cargar la cédula en la consulta general de pedidos.
- [x] No mostrar ni buscar cédula en la lista general de pedidos.
- [x] Limitar las opciones de transición visibles según el estado actual del pedido.
- [x] Retirar privilegios anónimos de lectura/escritura sobre clientes y ventas.
- [x] Retirar privilegios anónimos de escritura sobre productos y categorías.
- [x] Retirar privilegios anónimos de lectura, modificación y borrado sobre pedidos web, conservando su inserción pública compatible.
- [x] Verificar sintaxis del panel, HTTP 200 del catálogo/panel y grants efectivos.

## Pendiente sin tocar producción de datos

- [ ] Reemplazar el borrado masivo del historial por archivado o RPC transaccional auditada.
- [ ] Reducir también la carga de dirección y teléfono mediante una vista resumida y un detalle bajo demanda.
- [ ] Revisar los grants de todas las funciones `SECURITY DEFINER` según sus consumidores reales.
- [ ] Añadir control anti-replay e idempotencia operativa para conciliación Wompi.
- [ ] Hacer transaccional el reordenamiento de categorías.
- [ ] Confirmar mediante prueba con una cuenta no administradora que el panel permanece bloqueado.
