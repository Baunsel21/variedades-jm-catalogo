# Importación CSV transaccional (candidata)

**Estado (2026-11-10):** una consulta de catálogo de solo lectura detectó `admin_import_products_csv(p_rows jsonb)` en producción como `SECURITY INVOKER`, con `EXECUTE` para `authenticated` y sin `EXECUTE` para `anon` ni `service_role`. La consulta del historial de migraciones no registró `20261109213200`; por tanto está confirmada la presencia de la RPC y sus permisos, pero no la ruta exacta de aplicación del DDL. No se ejecutó una importación real ni se modificaron productos. La UI comprueba disponibilidad con `p_rows: []` y solo debe habilitar el botón tras una respuesta explícita esperada del backend.

## Contrato

- Solo acepta filas previsualizadas del allowlist `row, code, name, category, cost, sale_price, quantity`; no importa variantes, fotos ni otros atributos.
- Inserta productos nuevos del usuario autenticado; no actualiza registros existentes. Un duplicado en el archivo o en el catálogo rechaza el lote entero.
- La función es `SECURITY INVOKER`, usa la política RLS vigente, limita a 250 filas/1 MiB y sostiene un lock de escritores solo durante la validación e inserción acotada.
- Error de validación devuelve filas/códigos/campos, no el contenido del producto. Una excepción PostgreSQL revierte la transacción RPC completa.
- El botón requiere preview local sin errores, probe RPC disponible y confirmación explícita. El probe envía cero filas y nunca escribe. Ante una respuesta de red ambigua, deshabilita el reintento hasta volver a cargar/previsualizar; el servidor también rechaza códigos ya existentes.

## Prueba local

Desde la raíz del repositorio, con PostgreSQL 17 local:

```bash
./tests/run_admin_csv_import_atomic_local.sh
```

La prueba usa un scratch sintético y lo elimina al salir; no necesita URI, Docker/Supabase CLI, ni conecta a producción. No constituye ensayo con datos reales ni valida la restauración de Sirevya.

## Gate posterior

Después de tener un restore real aislado, comparar la firma y ACL de la RPC, el índice `products_user_code_idx`, RLS `products own`, `is_store_admin()` y columnas/defaults con la migración candidata. Como la función ya existe pero la tabla de versiones no registra ese timestamp, **no reaplicar ni reemplazar DDL en producción a ciegas**. Revisar el lock/impacto sobre escritores y validar una importación solo en un entorno aislado; nunca usar el catálogo productivo como fixture ni importar productos ficticios.
