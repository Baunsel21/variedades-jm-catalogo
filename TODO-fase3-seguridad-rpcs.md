# TODO — Fase 3: seguridad de RPCs

## Completado en esta etapa

- [x] Enumerar funciones públicas `SECURITY DEFINER`.
- [x] Comparar permisos `anon` y `authenticated`.
- [x] Identificar funciones públicas que sí deben conservarse para catálogo, reservas, cotización y contraentrega.
- [x] Detectar que `set_online_payment_status(boolean)` tenía ejecución anónima innecesaria.
- [x] Revocar la ejecución anónima de la función de configuración de pagos.
- [x] No modificar filas, reservas, inventario, pagos ni categorías durante la auditoría.

## Pendiente de implementación revisable

- [ ] Añadir `is_store_admin()` a las tres funciones globales de categorías.
- [ ] Añadir guardia administrativa a las operaciones del panel que cambian inventario y pedidos.
- [ ] Revisar y cerrar sobrecargas antiguas de funciones administrativas que ya no usa el panel.
- [ ] Verificar con una cuenta autenticada no administradora que cada RPC administrativa rechace la operación sin filtrar datos.
- [ ] Crear pruebas de regresión para contraentrega, Wompi, reservas de 10 minutos y actualización de pedidos.
