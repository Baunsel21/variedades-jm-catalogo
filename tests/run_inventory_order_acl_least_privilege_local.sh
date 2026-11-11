#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="sirevya_inventory_order_acl_local_${RANDOM}_$$"
PG_VERSION="$(pg_config --version | awk '{print $2}')"
PG_MAJOR="${PG_VERSION%%.*}"
if [[ -n "${PGHOST:-}${DATABASE_URL:-}${SUPABASE_DB_URL:-}" ]]; then
  printf 'Refusing to run with a configured remote database host or URI.\n' >&2
  exit 1
fi
PGPORT="${PGPORT:-}"
if [[ -z "$PGPORT" ]]; then
  PGPORT="$(pg_lsclusters --no-header "$PG_MAJOR" | awk '$4 == "online" {print $3; exit}')"
fi
if [[ -z "$PGPORT" ]]; then
  printf 'No online local PostgreSQL cluster found for major version %s.\n' "$PG_MAJOR" >&2
  exit 1
fi
FIXTURE="$ROOT/tests/fixtures/inventory_order_acl_schema.sql"
MIGRATION="$ROOT/supabase/migrations/20261115010000_inventory_and_order_direct_grants_least_privilege.sql"
REGRESSION="$ROOT/tests/inventory_order_acl_least_privilege_regression.sql"
cleanup() {
  sudo -u postgres dropdb --if-exists --host=/var/run/postgresql --port="$PGPORT" "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sudo service postgresql start >/dev/null
pg_isready -q -h /var/run/postgresql -p "$PGPORT"
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
printf '%s\n' "run_inventory_order_acl_least_privilege_local: PASS (local PostgreSQL $SERVER_MAJOR, synthetic roles/tables only; scratch dropped)"
