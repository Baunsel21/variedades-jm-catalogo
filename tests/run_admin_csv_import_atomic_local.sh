#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="sirevya_csv_import_local_${RANDOM}_$$"
PG_VERSION="$(pg_config --version | awk '{print $2}')"
PG_MAJOR="${PG_VERSION%%.*}"
if [[ -z "${PGPORT:-}" ]]; then
  PGPORT="$(pg_lsclusters --no-header "$PG_MAJOR" | awk '$4 == "online" {print $3; exit}')"
fi
if [[ -z "$PGPORT" ]]; then
  printf 'No online local PostgreSQL cluster found for major version %s.\n' "$PG_MAJOR" >&2
  exit 1
fi
FIXTURE="$ROOT/tests/fixtures/admin_csv_import_schema.sql"
MIGRATION="$ROOT/supabase/migrations/20261109213200_admin_csv_product_import_atomic.sql"
REGRESSION="$ROOT/tests/admin_csv_import_atomic_local_regression.sql"
MIGRATION_V2="$ROOT/supabase/migrations/20261113010000_admin_csv_product_import_images_variants_v2.sql"
REGRESSION_V2="$ROOT/tests/admin_csv_import_v2_local_regression.sql"

cleanup() {
  sudo -u postgres dropdb --if-exists --host=/var/run/postgresql --port="$PGPORT" "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sudo service postgresql start >/dev/null
pg_isready -q -h /var/run/postgresql -p "$PGPORT"
printf 'PostgreSQL local version: %s, port %s\n' "$PG_VERSION" "$PGPORT"
SERVER_VERSION_NUM="$(sudo -u postgres psql --host=/var/run/postgresql --port="$PGPORT" -XAt -d postgres -c 'SHOW server_version_num')"
SERVER_MAJOR="$((SERVER_VERSION_NUM / 10000))"
if [[ "$SERVER_MAJOR" != "$PG_MAJOR" ]]; then
  printf 'Refusing local server major %s; pg_config selected major %s.\n' "$SERVER_MAJOR" "$PG_MAJOR" >&2
  exit 1
fi
sudo -u postgres createdb --host=/var/run/postgresql --port="$PGPORT" "$DB"
run_sql() {
  local file="$1"
  sudo -u postgres psql --host=/var/run/postgresql -X -q -v ON_ERROR_STOP=1 --port="$PGPORT" -d "$DB" < "$file"
}

run_sql "$FIXTURE"
run_sql "$MIGRATION"
run_sql "$REGRESSION"
run_sql "$MIGRATION_V2"
run_sql "$REGRESSION_V2"
printf '%s\n' 'run_admin_csv_import_atomic_local: PASS (v1 + candidate v2; synthetic rows; no network; scratch database dropped)'
