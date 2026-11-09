# Fase 7 — Importación CSV transaccional (candidata)

## Estado

La interfaz extiende el preview CSV con una acción de aplicación explícita. Antes de habilitarla ejecuta preview local y un probe autenticado del RPC con lote vacío; ese probe nunca escribe y el botón queda deshabilitado si el RPC no está desplegado/disponible, si hay errores, si el lote supera 250 filas o si la sesión/admin no está autorizada. La RPC propuesta inserta productos nuevos como transacción, respeta RLS y rechaza duplicados/valores fuera del contrato; nunca actualiza productos existentes ni importa fotos/variantes.

El código puede integrarse/publicarse con la importación efectivamente desactivada mientras el probe no confirme el RPC. La migración continúa **sin aplicar** en producción. Usa columnas/índice/RLS revisados por metadatos read-only (`products_user_code_idx`, `products own`) y se prueba contra una fixture PostgreSQL sintética. La falta de backup restaurable y la necesidad de validar el lock/contrato sobre un restore aislado siguen bloqueando activación productiva.

## Protección y límites

- Allowlist de fila: `row`, `code`, `name`, `category`, `cost`, `sale_price`, `quantity`.
- 250 filas por lote y hasta 1 MiB para el payload RPC; tamaño del CSV y número de filas del preview mantienen sus límites existentes.
- Cualquier error de validación/duplicado cancela el lote antes de escribir; una violación inesperada dentro del `INSERT` revierte la sentencia RPC.
- Los errores al cliente solo incluyen fila, campo y código; no incluyen valores de productos.
- `SECURITY INVOKER`; `authenticated` únicamente. RLS `products own` valida admin y `user_id`; no se concede a `anon` ni `service_role`.
- Ante error de red ambiguo, el UI exige volver a previsualizar; el servidor no reescribe códigos existentes.

## Evidencia candidata

- `tests/run_admin_csv_import_atomic_local.sh`: fixture/scratch local, roles sintéticos y regresión de atomicidad/RLS/duplicados/límites.
- `tests/admin_csv_import_ui_regression.mjs`: confirmación, payload allowlist, errores, límite de filas y respuesta de red ambigua.

Ver `docs/deployment/csv-transactional-import-runbook.md` para el gate. Esta nota no declara importación real terminada ni producción habilitada.
