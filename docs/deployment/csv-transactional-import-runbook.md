# Importación CSV transaccional (candidata)

**Estado:** no aplicada ni activa en Supabase de producción. La migración `20261109213200_admin_csv_product_import_atomic.sql` es candidata y debe mantenerse en revisión Draft hasta validar un backup restaurable y el contrato en un PostgreSQL aislado.

## Contrato

- Solo acepta filas previsualizadas del allowlist `row, code, name, category, cost, sale_price, quantity`; no importa variantes, fotos ni otros atributos.
- Inserta productos nuevos del usuario autenticado; no actualiza registros existentes. Un duplicado en el archivo o en el catálogo rechaza el lote entero.
- La función es `SECURITY INVOKER`, usa la política RLS vigente, limita a 250 filas/1 MiB y sostiene un lock de escritores solo durante la validación e inserción acotada.
- Error de validación devuelve filas/códigos/campos, no el contenido del producto. Una excepción PostgreSQL revierte la transacción RPC completa.
- El botón requiere preview local sin errores y confirmación explícita. Ante una respuesta de red ambigua, deshabilita el reintento hasta volver a cargar/previsualizar; el servidor también rechaza códigos ya existentes.

## Prueba local

Desde la raíz del repositorio, con PostgreSQL 17 local:

```bash
./tests/run_admin_csv_import_atomic_local.sh
```

La prueba usa un scratch sintético y lo elimina al salir; no necesita URI, Docker/Supabase CLI, ni conecta a producción. No constituye ensayo con datos reales ni valida la restauración de Sirevya.

## Gate posterior

Después de tener un restore real aislado, confirmar que el índice `products_user_code_idx`, RLS `products own`, `is_store_admin()` y columnas/defaults coinciden con la fixture. Luego revisar el lock/impacto sobre escritores, desplegar la migración de forma independiente y ejecutar una importación controlada solo en un entorno aislado, nunca con el catálogo productivo como prueba. El deploy/publicación de UI debe ser posterior a la disponibilidad del RPC.
