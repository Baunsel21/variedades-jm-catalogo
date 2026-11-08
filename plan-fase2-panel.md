# Fase 2 — Panel administrativo y protección de datos

Esta fase protege el acceso al panel y reduce exposición accidental de datos sin cambiar reservas, inventario físico, Wompi ni la creación de pedidos.

## Cambios implementados

El panel ya no ofrece creación pública de cuentas. Al iniciar sesión, consulta `is_store_admin()` en Supabase antes de mostrar el panel; una cuenta autenticada pero no autorizada se cierra y recibe un mensaje claro. La carga de pedidos omite la cédula del listado general y no la usa para búsquedas en el navegador. Las transiciones visibles de pedidos se limitan según su estado actual para evitar reactivaciones accidentales.

La migración de permisos conserva únicamente las lecturas públicas históricas de productos y categorías, conserva la inserción pública necesaria de `web_orders` y retira privilegios anónimos de escritura y lectura sobre clientes, ventas, pedidos y configuración sensible. No modifica filas ni funciones de reservas.

## Pendientes separados

Aún queda pendiente convertir las operaciones destructivas del panel en RPC transaccionales auditadas, porque requieren revisar el flujo de respaldo y no deben resolverse con un simple botón de frontend. También queda pendiente revisar uno por uno los grants de funciones `SECURITY DEFINER`; algunos son públicos intencionalmente para catálogo/checkout y otros deben restringirse después de confirmar sus consumidores.

## Validación

Se verificó la sintaxis JavaScript del panel, la respuesta HTTP del catálogo y del panel publicados, y los grants efectivos de `anon` después de la migración. No se realizaron borrados, inserciones de prueba ni cambios en reservas.
