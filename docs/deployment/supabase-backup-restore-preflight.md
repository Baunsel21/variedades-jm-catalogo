# Runbook: backup y ensayo de restauración Supabase antes de migraciones

## Alcance y estado comprobado

Este procedimiento prepara un respaldo lógico de los esquemas de aplicación y un ensayo de restauración aislado antes de cualquier migración de riesgo. No es evidencia de que ya exista un backup real de Sirevya ni autoriza aplicar una migración en producción.

Consulta read-only del 9 de noviembre de 2026: el proyecto Sirevya usa PostgreSQL 17.6 y la organización está en plan Free. `pg_cron` 1.6.4 y Vault 0.3.1 están instalados. `pg_net` 0.20.4 y `http` 1.6 están disponibles, pero no instalados. Supabase indica que los backups automáticos diarios cubren planes Pro, Team y Enterprise; en Free recomienda exportar periódicamente con CLI. No se debe presumir que existe un backup automático reciente. [1]

En este Sandbox están PostgreSQL 16.15 y 17.11, con clusters locales separados; también están `psql`/`pg_dump` 17.11. Se repitió un smoke test sintético en PG17.11: dump de esquema/datos de dos tablas ficticias con un trigger de auditoría, verificación SHA-256, restore `psql --single-transaction`/`ON_ERROR_STOP` con triggers deshabilitados durante la carga y conteos iguales `2:2` entre origen/destino. Las dos bases y los dumps temporales se eliminaron. También había pasado un smoke test anterior en PG16. Esto prueba el mecanismo local en la misma versión mayor de Sirevya, no una restauración de Sirevya ni que el CLI remoto funcione. No se consultó una URI, no se exportó información del proyecto y no se mostró una credencial de producción.

## Herramientas y acción que faltan

La prueba real requiere una computadora de escritorio confiable, porque la app Android no ofrece un terminal local apropiado para manejar dumps con PII. Allí se necesitan Supabase CLI v3, Docker Desktop o un runtime compatible y la URI privada de base de datos obtenida por el operador desde el panel. El Sandbox ya tiene `psql`/`pg_dump` 17.11, pero faltan Supabase CLI, Docker y acceso privado a la URI. No se debe pegar la URI ni los dumps en chat, GitHub o Preview.

Instala el CLI desde sus fuentes oficiales. En macOS o Linux con Homebrew:

```sh
brew install supabase/tap/supabase
```

En Windows PowerShell:

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

En Linux también se distribuyen paquetes `.deb`, `.rpm` y `.apk` en la página oficial de releases. Para ejecutar el stack local completo se necesita Docker Desktop o un runtime compatible. Instala PostgreSQL 17 desde el distribuidor oficial del sistema operativo y confirma que `psql --version` indique la versión mayor 17. [2]

A partir de CLI v3, `db dump` apunta por defecto al stack local. Pasa siempre `--remote` con la URI privada para seleccionar la base remota de lectura. La opción antigua `--db-url` aún existe, pero está deprecada. No ejecutes `supabase db dump` sin `--remote`. [3]

## 1. Preparar destino privado y conexión

Los ejemplos de shell son Bash (Linux, macOS o WSL); no ejecutes estos bloques directamente en PowerShell ni en Android. Trabaja en una computadora de operador con disco cifrado, acceso restringido y espacio libre suficiente. Los archivos deben quedar fuera del checkout Git, Descargas, Preview y sincronizadores públicos. No actives `set -x` ni grabación de sesión.

```sh
set +x
set -euo pipefail
umask 077
export BACKUP_DIR="$HOME/secure-backups/sirevya-preflight-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd /path/to/variedades-jm-catalogo
test -f supabase/config.toml
supabase --version
docker --version
docker info >/dev/null
psql --version
# Carga SIREVYA_DB_URL desde el gestor seguro del operador; nunca la imprimas.
```

Usa una terminal privada. La URI aparecerá como argumento del proceso CLI, así que ejecútalo en una computadora de operador confiable y no compartida. Si la conexión directa no es alcanzable desde esa estación, usa el Session Pooler que muestre el panel. No cambies la contraseña de producción solo para esta operación. Si no puedes obtener una URI de base de datos de forma privada, detente; no reemplaces el respaldo por un checkout Git ni una consulta parcial. No es necesario ejecutar `supabase login` para estos comandos cuando se usa la URI directa.

## 2. Exportar con Supabase CLI

Ejecuta desde el root del repositorio, donde está `supabase/config.toml`. Estos comandos leen la base remota. En CLI v3, `--remote` selecciona explícitamente el destino remoto. No uses `db reset`, `migration up`, `db push`, `apply_migration` ni comandos de restauración contra la URL de producción. [3] [4]

```sh
supabase db dump --remote="$SIREVYA_DB_URL" -f "$BACKUP_DIR/roles.sql" --role-only
supabase db dump --remote="$SIREVYA_DB_URL" -f "$BACKUP_DIR/schema.sql"
supabase db dump --remote="$SIREVYA_DB_URL" -f "$BACKUP_DIR/data.sql" --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"

test -s "$BACKUP_DIR/roles.sql"
test -s "$BACKUP_DIR/schema.sql"
test -s "$BACKUP_DIR/data.sql"
if command -v sha256sum >/dev/null 2>&1; then
  HASH=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  HASH=(shasum -a 256)
else
  echo "Falta sha256sum/shasum; detente sin borrar los dumps." >&2
  exit 1
fi
(cd "$BACKUP_DIR" && "${HASH[@]}" roles.sql schema.sql data.sql > SHA256SUMS && "${HASH[@]}" -c SHA256SUMS)
```

En macOS, si falta `sha256sum`, el bloque usa `shasum -a 256` automáticamente. No cambies el orden ni edites manualmente `SHA256SUMS`. Guarda un manifiesto con ref del proyecto, hora UTC, versión de CLI, versión de PostgreSQL, SHA de `main` y tamaño/hash de cada archivo. No incluyas URI, contraseña, tokens, valores de filas ni PII. Cifra el conjunto y guárdalo fuera del equipo; conserva el hash de verificación por un canal protegido.

El dump lógico no es una copia íntegra de todo Supabase. No incluye bytes de Storage, configuración de Auth, funciones Edge, API keys, credenciales ni configuración administrada por la plataforma. Los esquemas `auth`, `storage` y los creados por extensiones no se tratan como un respaldo completo. Las personalizaciones propias en `auth`/`storage` deben revisarse aparte. Vault no incluye la clave raíz en los dumps; no copies secretos al repositorio. [1] [4]

## 3. Crear un destino local aislado

En una carpeta scratch vacía, fuera del repositorio, inicia un proyecto Supabase local nuevo. No uses una base que contenga datos reales ni el checkout del producto; así evitas ejecutar migraciones candidatas automáticamente. El runtime utiliza recursos locales del equipo y no crea otro proyecto Supabase facturable. [2]

```sh
mkdir -p "$HOME/sirevya-restore-scratch"
cd "$HOME/sirevya-restore-scratch"
supabase init
# En el config.toml local, confirma [db].major_version = 17 antes de iniciar.
supabase start
supabase status
```

Confirma el valor que realmente reporta `supabase status`; no asumas que el puerto está libre. La URI local predeterminada suele ser `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, pero usa la que informa el CLI:

```sh
export SIREVYA_LOCAL_RESTORE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
psql "$SIREVYA_LOCAL_RESTORE_URL" -Atc \
  "select current_database(), current_setting('server_version_num')::int / 10000, inet_server_addr(), inet_server_port();"
```

Detente si el destino no termina en loopback (`localhost`, `127.0.0.1` o `::1`), si no es la base scratch recién iniciada o si `server_version_num` no confirma versión mayor 17. No ejecutes `supabase start` desde el checkout del producto para este ensayo.

Antes de restaurar, confirma qué extensiones requiere el esquema y que el destino local tenga los paquetes correspondientes. Las extensiones, esquemas administrados, funciones Edge y secretos no se presumen restaurados por los tres dumps. Usa valores/stubs Vault sintéticos; no copies tokens Telegram/Wompi ni credenciales de producción. [4]

## 4. Restaurar y verificar

Usa el orden documentado por Supabase: roles, esquema, desactivación temporal de triggers para la carga y datos. `ON_ERROR_STOP` y la transacción única hacen que un error detenga el ensayo. El destino debe ser local; nunca reutilices `SIREVYA_DB_URL` como `--dbname`. [4]

```sh
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$BACKUP_DIR/roles.sql" \
  --file "$BACKUP_DIR/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$BACKUP_DIR/data.sql" \
  --dbname "$SIREVYA_LOCAL_RESTORE_URL"
```

La prueba solo pasa si los checksums fueron válidos, el restore terminó con código cero, el host/versión son correctos y existen `public.products`, `public.orders`, `public.web_orders`, `public.inventory_reservations`, `public.inventory_movements` y `public.store_settings`. Ejecuta esta consulta de solo lectura en origen y destino y compara los conteos agregados. Ejecuta el scan de origen fuera de hora pico y guarda solo los números, nunca filas:

```sql
SELECT 'products' AS table_name, count(*)::bigint AS row_count FROM public.products
UNION ALL SELECT 'orders', count(*)::bigint FROM public.orders
UNION ALL SELECT 'web_orders', count(*)::bigint FROM public.web_orders
UNION ALL SELECT 'inventory_reservations', count(*)::bigint FROM public.inventory_reservations
UNION ALL SELECT 'inventory_movements', count(*)::bigint FROM public.inventory_movements
UNION ALL SELECT 'store_settings', count(*)::bigint FROM public.store_settings
ORDER BY table_name;
```

Si un número no coincide, no edites la copia para forzar coincidencia: corrige el proceso y repite en una base scratch vacía. Confirma además que las políticas/RLS, funciones, triggers e índices de aplicación esperados existen. Revisa extensiones, Vault, `pg_cron`, `pg_net` y secretos por separado. Una restauración lógica que termina sin error no demuestra que Auth, Storage binario, configuración de Edge o scheduler hayan sido clonados.

Solo después de verificar la copia, aplica en ella la migración candidata que se evalúa y ejecuta sus regresiones con fixtures sintéticas. Ninguna URL de producción, Telegram, Wompi o webhook debe ser invocada. Para Telegram, los stubs locales no sustituyen la validación de la extensión real `pg_cron`/Vault/`pg_net`.

Conserva evidencia redactada: fecha, versiones, PASS/FAIL, hashes, conteos agregados y nombres de comandos. No adjuntes dumps, URI, credenciales, payloads ni filas a GitHub.

## 5. Gate antes de migraciones o Edge deploy sensibles

No aplicar una migración de riesgo en producción ni desplegar una Edge Function que modifique flujos compartidos hasta que un operador autorizado complete y comunique: (a) dump roles/schema/data con checksums válidos; (b) restore completo en scratch aislado PostgreSQL 17; (c) conteos y objetos de esquema comparados; (d) regresiones sobre la copia restaurada; y (e) plan de rollback que no borre ni altere pedidos, inventario ni configuración compartida.

El plan Free no confirma backup diario automático. El camino sin proyecto Supabase nuevo es CLI + restauración local con Docker. Crear staging/clone, habilitar PITR o cambiar el plan puede generar cargos; no hacerlo sin autorización separada y evaluación de precio. Una restauración **in-place** sobre producción puede reemplazar datos recientes y causar indisponibilidad; no se usa como prueba. [1]

**Acción manual que falta:** ejecuta las secciones 1–4 desde un PC/Mac/Linux confiable. No compartas la URI ni los archivos. Comunica solo si el dump pasó checksums, si PG17 restauró sin errores, la versión local y los conteos agregados comparados. El Sandbox ya probó restauración sintética en PG17.11; no puede exportar/restaurar Sirevya porque aquí siguen faltando Supabase CLI, Docker y la URI privada.

## References

[1]: https://supabase.com/docs/guides/platform/backups "Supabase Database Backups"
[2]: https://supabase.com/docs/guides/local-development/cli/getting-started "Supabase CLI installation and local stack"
[3]: https://supabase.com/changelog/supabase-cli-v3 "Supabase CLI v3 defaults and remote flags"
[4]: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore "Supabase Backup and Restore using the CLI"
