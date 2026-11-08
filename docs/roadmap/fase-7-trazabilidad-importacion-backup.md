# Fase 7 — Trazabilidad, importación y backup

**Estado:** contrato local de previsualización CSV implementado; persistencia, bitácora y restauración siguen abiertas. Este documento acompaña el slice puro de `scripts/fase7_csv_preview.mjs` y no autoriza cambios en Supabase, inventario, pedidos ni archivos R2.

## Relación con el roadmap

El plan integral define para esta fase cuatro líneas de trabajo: bitácora administrativa append-only, importación de productos con previsualización/dry-run y commit transaccional, backup con lista blanca de columnas sensibles e inventario de archivos R2 con prueba de restauración, y archivado reversible/neutralización de fórmulas CSV. El TODO de mejoras mantiene estos criterios abiertos. La implementación de este slice no los da por aprobados ni reemplaza el preflight de contratos de las fases anteriores.

## Slice entregado: contrato de previsualización CSV

`previewProductsCsv(input, options)` es un helper ESM puro. No importa filesystem, navegador, Supabase ni módulos de red; tampoco ejecuta comandos, escribe base de datos, modifica inventario/pedidos o crea archivos. El resultado es siempre un dry-run:

- `canCommit` es siempre `false`.
- `dryRun` es `true` y `writePerformed` es `false`.
- `rows` contiene solo filas válidas y normaliza los importes a números enteros seguros para mostrar el preview.
- `errors` contiene errores con `row` (fila lógica, encabezado = 1), `field`, `code` y `message`; no devuelve valores sensibles en el mensaje.
- `summary` informa bytes UTF-8, cantidad de filas de datos, filas válidas/ inválidas y límites usados.

Las únicas cabeceras aceptadas, con nombres exactos después de quitar espacios exteriores, son:

```text
code,name,category,cost,sale_price,quantity
```

Se rechazan cabeceras duplicadas, desconocidas, extras y ausentes. Cabeceras que sugieren `variant`, `sku`, `talla`, `size`, `color` u `option` producen además un error explícito de datos de variantes no soportados. Este contrato no modela variantes, combinaciones de talla/color, SKU por variante ni stock por variante; esos datos deben esperar un contrato separado y no se deben forzar dentro de `category` u otra columna.

El parser soporta BOM UTF-8, comas, comillas dobles escapadas (`""`), campos con saltos de línea y terminadores LF/CRLF/CR. Comillas sin cierre, comillas en campos no entrecomillados y contenido después de una comilla de cierre se consideran CSV malformado. Un BOM no se importa como parte de la primera cabecera.

Los límites predeterminados de esta utilidad son **5 MiB UTF-8** y **10.000 filas de datos**, configurables mediante `maxBytes`/`maxRows` o `limits`. Son límites técnicos de seguridad del preview, no una decisión comercial sobre el tamaño final de una carga. Si se exceden, el resultado falla cerrado, no devuelve filas importables y sigue indicando `canCommit: false`.

`cost` y `sale_price` requieren una cadena decimal de COP no negativa, entera y dentro del rango entero seguro de JavaScript. `quantity` requiere un entero no negativo dentro del mismo rango seguro. `0` explícito permanece `0`; un valor inválido nunca cae silenciosamente a cero. No se compara `sale_price` contra `cost` ni se impone una regla de descuento: esas decisiones comerciales no están aprobadas en esta fase.

Los códigos se comparan localmente con NFKC, espacios exteriores retirados y minúsculas. La detección usa los códigos de la propia carga y el argumento opcional `existingCodes`; no consulta red ni base de datos. La fila conserva el código recortado, mientras que la normalización solo se usa para detectar colisiones. Cadenas que parecen fórmulas se rechazan sin evaluarse, incluso cuando aparecen en un campo de texto; no se usa `eval`, no se ejecuta ninguna función de hoja de cálculo y no se convierte una fórmula o texto inválido en un precio cero.

## Pruebas locales del slice

La prueba dedicada es `tests/fase7_csv_preview.mjs`. Cubre fixtures de BOM/CRLF, comas y dobles comillas, saltos multilínea, límites de bytes y filas, COP/enteros/rango, cabeceras duplicadas/desconocidas/ausentes/extras, columnas de variantes, duplicados locales y contra `existingCodes`, fórmulas y CSV malformado. Su ejecución es local y sintética; no lee tablas, no crea pedidos/reservas y no toca inventario.

## Decisiones abiertas antes de importar de verdad

### RPC transaccional o staging

No está decidido si el flujo autorizado debe escribir primero en una tabla de staging con versión/estado y luego promover, o llamar un RPC transaccional que valide y aplique el lote completo. Antes de elegir, hay que documentar la forma real de productos, inventario, precios, restricciones, concurrencia, idempotencia, actor admin y rollback. El preview no reserva IDs, no calcula reglas comerciales nuevas y no puede ser tratado como autorización de commit.

La decisión pendiente debe cubrir al menos: token/idempotency del lote, aislamiento y locks, qué pasa si cambia un producto entre preview y commit, orden de aplicación de precios e inventario, respuesta parcial versus todo-o-nada, tamaño máximo del lote, reintentos seguros, permisos/RLS/RPC, y cómo se enlaza cada cambio con la bitácora. Ninguna opción se considera aprobada por este documento.

### PII: allowlist, minimización y retención

Aún falta acordar una allowlist de columnas sensibles para exportación y backup. No se debe inferir que toda la tabla es exportable ni copiar PII a logs, errores de preview, CSV de soporte, URLs o `localStorage`. La decisión debe identificar propietario/actor autorizado, finalidad, campos incluidos, campos excluidos o enmascarados, cifrado, acceso, periodo de retención, borrado y evidencia de cumplimiento. Productos CSV de este slice no son un mecanismo para exportar clientes, teléfonos, direcciones, pagos ni notas privadas.

### Bitácora administrativa append-only

Queda por diseñar una bitácora inmutable que registre, para el alcance aprobado, actor autorizado, entidad, acción, timestamp, resultado, lote/correlación y valores antes/después permitidos. Debe definirse qué valores se omiten o anonimizan, qué retención aplica, quién puede leerla, cómo se evita UPDATE/DELETE/TRUNCATE directo, cómo se registran fallos y cómo se auditan reparaciones. La bitácora no debe capturar secretos, tokens, PII innecesaria ni el contenido completo de un CSV si no existe una allowlist aprobada.

También falta decidir si la bitácora se escribe dentro de la misma transacción que el cambio o mediante un mecanismo durable outbox; una escritura que no deje evidencia o un log que confirme una transacción revertida serían estados inválidos que el diseño debe resolver.

### Manifest de R2 y restauración

No existe todavía una especificación aprobada de backup. Debe definirse un manifest versionado que enumere objeto/clave, tamaño, hash, tipo, fecha, relación con el snapshot y estado de cifrado, sin exponer URLs firmadas ni secretos. El inventario de archivos R2 debe poder detectar faltantes, huérfanos, cambios de hash y archivos fuera de la allowlist.

La prueba de restauración debe ejecutarse en un entorno aislado y documentar qué se restaura, qué no se restaura, orden, dependencias, verificación de integridad, permisos, rollback/limpieza y resultado. No se debe restaurar sobre producción para probar. Falta acordar RPO/RTO, retención de snapshots, rotación de claves y procedimiento de salida segura si el manifest o un objeto no coincide.

### Archivado reversible y neutralización CSV

El archivado reversible de ventas y otros registros todavía requiere contrato de estados, permisos, retención y restauración idempotente. No se debe usar `DELETE` como sustituto de archivado ni asumir que una copia de tabla basta para recuperar relaciones, bitácora o archivos.

Para exportaciones CSV futuras debe mantenerse la neutralización de fórmulas ya existente en la superficie administrativa. El preview de esta fase no evalúa fórmulas y rechaza valores que parezcan fórmula; la estrategia final de exportación/importación, incluidos prefijos de neutralización, librería CSV y pruebas con Excel/LibreOffice, sigue pendiente de decisión y revisión de seguridad.

## Límites y no objetivos

Esta fase no aprueba reglas de precio, descuentos, impuestos, categorías, variantes, disponibilidad comercial, estados de pedido, retención de PII ni política de backup. No implementa commit, migraciones, RPC, staging, bitácora, R2, restauración, interfaz administrativa ni cambios de inventario. El padre puede integrar una UI después, pero debe conservar este módulo como previsualización sin escritura y resolver las decisiones abiertas mediante un contrato separado y revisable.
