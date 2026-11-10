# Importación CSV transaccional (candidata)

**Estado (2026-11-10):** una consulta de catálogo de solo lectura detectó `admin_import_products_csv(p_rows jsonb)` en producción como `SECURITY INVOKER`, con `EXECUTE` para `authenticated` y sin `EXECUTE` para `anon` ni `service_role`. La consulta del historial de migraciones no registró `20261109213200`; por tanto está confirmada la presencia de la RPC y sus permisos, pero no la ruta exacta de aplicación del DDL. No se ejecutó una importación real ni se modificaron productos. La UI comprueba disponibilidad con `p_rows: []` y solo debe habilitar el botón tras una respuesta explícita esperada del backend.

## Contrato

- Solo acepta filas previsualizadas del allowlist `row, code, name, category, cost, sale_price, quantity`; no importa variantes, fotos ni otros atributos.
- Inserta productos nuevos del usuario autenticado; no actualiza registros existentes. Un duplicado en el archivo o en el catálogo rechaza el lote entero.
- La función es `SECURITY INVOKER`, usa la política RLS vigente, limita a 250 filas/1 MiB y sostiene un lock de escritores solo durante la validación e inserción acotada.
- Error de validación devuelve filas/códigos/campos, no el contenido del producto. Una excepción PostgreSQL revierte la transacción RPC completa.
- El botón requiere preview local sin errores, probe RPC disponible y confirmación explícita. El probe envía cero filas y nunca escribe. Ante una respuesta de red ambigua, deshabilita el reintento hasta volver a cargar/previsualizar; el servidor también rechaza códigos ya existentes.

## Contrato v2 (candidata, no aplicada)

- El importador conserva v1 como opción predeterminada. v2 se selecciona explícitamente y agrega las columnas `image_url` y `variants` al CSV; parser, preview y RPC trabajan con un esquema versionado.
- `image_url` es opcional; cuando está presente debe ser una URL HTTPS sin credenciales, espacios/control ni más de 2.048 bytes. Esta versión guarda una referencia remota; **no sube archivos de imagen**.
- `variants` es una celda JSON que contiene un arreglo de hasta 100 objetos. `color`, `size` y `stock` son obligatorios; `color_hex` (`#RRGGBB`) e `image_path` (HTTPS) son opcionales. Las combinaciones color/talla no pueden duplicarse y la suma de `stock` debe coincidir con `quantity`.
- El preview muestra la imagen como tipo de referencia y el número de variantes, no inserta su texto como HTML. Rechaza URLs no HTTPS, JSON inválido, fórmulas, campos extra, duplicados y payloads fuera del límite antes de habilitar el botón.
- `public.admin_import_products_csv_v2(jsonb)` es una migración candidata aditiva con `SECURITY INVOKER`, permisos `authenticated` únicamente, RLS, comprobación de duplicados, lock acotado y transacción atómica. El adaptador admin mantiene el commit v2 bloqueado mientras la RPC no responda al probe vacío esperado.
- Candidato versionado: `20261113010000_admin_csv_product_import_images_variants_v2.sql`. **No está aplicado en producción**; publicar la UI no activa esta capacidad de escritura. No lo apliques hasta restauración verificable y reconciliación de historial/firmas.

## Prueba local

Desde la raíz del repositorio, con PostgreSQL 17 local:

```bash
./tests/run_admin_csv_import_atomic_local.sh
```

La prueba aplica en un scratch sintético el RPC v1 y la migración candidata v2, cubriendo inserción local, imagen/variantes, errores, privilegios, duplicados y rollback ante una excepción. El scratch se elimina al salir; no necesita URI, Docker/Supabase CLI, ni conecta a producción. No constituye ensayo con datos reales ni valida la restauración de Sirevya.

## Gate posterior

Después de tener un restore real aislado, comparar la firma y ACL de la RPC, el índice `products_user_code_idx`, RLS `products own`, `is_store_admin()` y columnas/defaults con la migración candidata. Como la función ya existe pero la tabla de versiones no registra ese timestamp, **no reaplicar ni reemplazar DDL en producción a ciegas**. Revisar el lock/impacto sobre escritores y validar una importación solo en un entorno aislado; nunca usar el catálogo productivo como fixture ni importar productos ficticios.
