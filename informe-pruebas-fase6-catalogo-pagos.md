# Fase 6 — Pruebas del catálogo y pasarela de pagos

## Alcance

Se probaron funciones públicas sin iniciar sesión, sin crear pedidos reales y sin realizar cobros. La prueba utilizó un producto disponible del catálogo y se detuvo antes de confirmar cualquier pedido.

## Resultados

| Área | Resultado | Evidencia |
|---|---|---|
| Carga del catálogo | PASS | El sitio cargó 52 productos y las categorías públicas. |
| Detalle de producto | PASS | Se abrió un producto, se mostró la imagen, precio, color Dorado y disponibilidad. |
| Checkout | PASS | El checkout abrió con resumen del producto, total y medios de pago. |
| Envío en Cali | PASS | Para Cali mostró `GRATIS` y el texto “Envío gratis dentro de Cali”. |
| Envío nacional | PASS | Para Bogotá, con un producto de $30.000, mostró `$15.000`; el total fue `$45.000`. |
| Pagos online | PASS | PSE/Nequi y tarjeta/Bancolombia aparecieron habilitados; no se inició un pago. |
| Contraentrega | PASS | En Cali apareció habilitada con el mensaje “Disponible para esta ciudad”. |
| Validación de formulario | PASS | Un checkout incompleto fue detenido y enumeró los campos faltantes. |
| Endpoint Wompi | PASS | Una solicitud deliberadamente incompleta respondió HTTP 400 con validación, sin crear pedido ni reserva. |
| Sintaxis JavaScript | PASS | `index.html` y `admin.html` pasaron `node --check`. |
| Contacto público | PASS | El navegador mostró `sirevya99@gmail.com` y `+57 302 546 9983`; el teléfono 312 ya no apareció. |

## Límites de la prueba

No se envió un pedido válido, no se reservó inventario, no se abrió Wompi con una referencia real y no se ingresaron datos personales o bancarios. Por ese motivo esta fase confirma el funcionamiento de la interfaz, cálculo de envío, validación y disponibilidad del endpoint, pero no sustituye una transacción controlada con las credenciales y ambiente de pruebas del comercio.

## Siguiente prueba recomendada

La siguiente fase debe probar, con autorización y datos de prueba controlados, el ciclo completo de una reserva: crear una reserva, regresar desde Wompi, reintentar con el mismo carrito, comprobar que no se duplique, simular rechazo y verificar liberación. Esa prueba debe ejecutarse evitando cargos reales y sin usar datos de clientes.
