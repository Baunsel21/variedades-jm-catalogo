# Runbook: backup y ensayo de restauración Supabase antes de migraciones

## Alcance y estado comprobado

Este procedimiento prepara un respaldo lógico de los esquemas de aplicación y una restauración de ensayo aislada, antes de cualquier migración de riesgo. No es evidencia de que ya exista un backup, ni autoriza aplicar una migración en producción.

Consulta de solo lectura del 9 de noviembre de 2026: proyecto `hnlbbtnfmbnbkcgegufa`, PostgreSQL 17.6, plan de organización Free; `pg_cron` 1.6.4 y Vault 0.3.1 están instalados. `pg_net` 0.20.4 y `http` 1.6 están disponibles en el catálogo, pero no instalados. La documentación de Supabase indica que los backups automáticos diarios son para Pro/Team/Enterprise y recomienda exportes periódicos con CLI para Free. Por tanto, no se debe asumir que hay un backup automático reciente.

El entorno Sandbox actual solo tiene `psql` 16; no tiene Supabase CLI ni Docker. No se exportaron datos, no se recibió ni mostró una contraseña de base de datos y no se intentó restaurar producción. La prueba de restauración descrita abajo debe ejecutarse en una estación controlada con PostgreSQL/Supabase local versión 17 y Docker, sin crear un proyecto remoto.

## 1. Preparar un destino privado

Ejecutar desde una estación confiable, con disco cifrado, acceso restringido y espacio libre suficiente. No guardar los archivos dentro del checkout Git, en la carpeta de descargas del navegador, en Preview, en GitHub ni en una conversación. Los dumps contienen datos de clientes y pedidos.

Use Supabase CLI actual y Docker. Obtenga la cadena de conexión desde el panel de Supabase; no la envíe por chat, no la escriba en un archivo versionado, no active `set -x` y no publique capturas que la muestren. Use una terminal de operador privada y elimine su variable de entorno al finalizar.

```sh
set +x
umask 077
export BACKUP_DIR="$HOME/secure-backups/sirevya-preflight-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
cd "$BACKUP_DIR"
# Cargar SIREVYA_DB_URL desde el gestor seguro del operador; nunca imprimirla.
```

Si la conexión directa no es alcanzable desde esa estación, utilice el Session Pooler indicado por el panel. No cambie el password de producción solo para esta operación. Si el operador no puede obtener una conexión de solo lectura a la base, deténgase: no sustituya el respaldo por un checkout de Git ni por una consulta parcial.

## 2. Exportar usando Supabase CLI

Los comandos deben apuntar al proyecto de producción solo para leer. No use `db reset`, `migration up`, `apply_migration` ni comandos de restauración contra esa URL.

```sh
supabase db dump --db-url "$SIREVYA_DB_URL" -f "$BACKUP_DIR/roles.sql" --role-only
supabase db dump --db-url "$SIREVYA_DB_URL" -f "$BACKUP_DIR/schema.sql"
supabase db dump --db-url "$SIREVYA_DB_URL" -f "$BACKUP_DIR/data.sql" --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"

test -s "$BACKUP_DIR/roles.sql"
test -s "$BACKUP_DIR/schema.sql"
test -s "$BACKUP_DIR/data.sql"
sha256sum roles.sql schema.sql data.sql > SHA256SUMS
sha256sum -c SHA256SUMS
```

`supabase db dump` aplica filtros para Supabase; la documentación advierte que un `pg_dump` crudo puede incluir esquemas internos. El dump lógico no es un backup íntegro del proyecto: no incluye los objetos binarios de Storage, configuración de Auth, Edge Functions, API keys ni configuración/extensiones administradas. Los esquemas internos como `auth`, `storage` y los creados por extensiones se excluyen. En particular, no cuente con estos archivos para recuperar secretos de Vault ni los secretos de Edge Functions. No exporte ni copie secretos a este repositorio.

Guarde un manifiesto junto con los archivos, con el ref del proyecto, hora UTC, versión de Supabase CLI, versión PostgreSQL, SHA de `main` y los tamaños/hashes de los tres dumps. El manifiesto no debe contener URL de conexión, password, tokens, payloads de pedidos ni filas. Cifre el conjunto antes de almacenarlo fuera del equipo y conserve el hash de verificación por un canal protegido.

## 3. Restaurar en una instancia local desechable

Levante una instancia local aislada de Supabase/PostgreSQL 17 con Docker. Use una base vacía dedicada, por ejemplo `sirevya_restore`, accesible solo por loopback. Compruebe host, puerto, base y versión antes de cargar. La URL de destino debe ser local; nunca reutilice `SIREVYA_DB_URL` como destino.

```sh
psql "$SIREVYA_LOCAL_RESTORE_URL" -Atc \
  "select current_database(), version(), inet_server_addr(), inet_server_port();"
```

La restauración debe detenerse si el host no es `localhost`, `127.0.0.1` o `::1`, si no es la base local desechable elegida, o si la versión mayor no es 17. Use el orden documentado por Supabase, con errores fatales ante cualquier sentencia fallida:

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

La repetición de roles personalizados con `LOGIN` puede requerir una contraseña local independiente; los dumps no contienen sus passwords. No reutilice ni registre credenciales de producción para roles locales.

## 4. Verificar el ensayo de restauración

La restauración solo cuenta como aprobada si todos los puntos pasan:

1. `sha256sum -c SHA256SUMS` retorna éxito antes de restaurar.
2. La carga completa termina con código cero y `ON_ERROR_STOP`; no se aceptan errores ignorados ni restauraciones parciales.
3. El destino sigue siendo local, y `version()` confirma PostgreSQL 17.
4. Existen las tablas críticas de aplicación: `public.products`, `public.orders`, `public.web_orders`, `public.inventory_reservations`, `public.inventory_movements` y `public.store_settings`.
5. El operador ejecuta las mismas consultas de conteo, de solo lectura, sobre origen y destino y compara los resultados. No exporta valores de filas ni PII al log. Si el número no coincide, no modifica manualmente el destino para forzar coincidencia: corrige el proceso de dump/restore y repite en una base vacía.
6. Las políticas/RLS, funciones, triggers e índices de aplicación existen en el destino según el manifiesto de objetos previo. Los estados de extensiones, Vault, `pg_cron`, `pg_net` y los secretos se verifican por separado; no se presumen restaurados por el dump lógico.
7. Tras la restauración, se aplica en esa instancia local únicamente la migración candidata que se pretende evaluar y se ejecutan sus regresiones. Se confirma que ninguna URL de producción, Telegram, Wompi ni webhook se invoca. Para Vault se usan stubs/secretos sintéticos, nunca el token real.

Conserve solo evidencia redactada: fecha, versiones, resultado PASS/FAIL, hashes y conteos agregados. No adjunte los SQL dumps, connection strings, credenciales ni filas al PR.

## 5. Gate antes de aplicar una migración de riesgo

No ejecutar una migración en producción hasta que un operador autorizado complete y comunique estos resultados: (a) los tres dumps existen y pasan su checksum; (b) la restauración completa a una instancia local aislada PG17 tuvo éxito; (c) se conservaron y compararon conteos de tablas de negocio y objetos de esquema; (d) las regresiones del cambio pasan sobre la instancia restaurada; y (e) existe un plan de rollback específico que no borre ni altere datos de pedidos, inventario o configuración compartida.

El plan Free no aporta en este momento evidencia de backup diario automático. La ruta sin costo adicional de un proyecto es CLI + restauración local con Docker en una estación confiable. Crear un proyecto de staging/clone, habilitar PITR o cambiar el plan puede generar cargos; no hacerlo sin autorización separada y evaluación del precio.

Para el candidato Telegram, el ensayo local debe verificar las extensiones disponibles en la instancia y la compatibilidad real de `pg_cron`, Vault y `pg_net` antes de considerar producción. El listado de extensiones de producción prueba disponibilidad del paquete, no que `pg_net` ya esté instalado ni que el scheduler esté listo.

## Fuentes oficiales

- [Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase CLI `db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump)
- [Restoring a downloaded backup locally](https://supabase.com/docs/guides/local-development/restoring-downloaded-backup)
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
