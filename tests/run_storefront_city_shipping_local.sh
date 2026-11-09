#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="sirevya_city_shipping_local_${RANDOM}_$$"
PG_VERSION="$(pg_config --version | awk '{print $2}')"
PG_MAJOR="${PG_VERSION%%.*}"
if [[ -z "${PGPORT:-}" ]]; then
  PGPORT="$(pg_lsclusters --no-header "$PG_MAJOR" | awk '$4 == "online" {print $3; exit}')"
fi
if [[ -z "${PGPORT:-}" ]]; then
  printf 'No active local PostgreSQL cluster found for major version %s.\n' "$PG_MAJOR" >&2
  exit 1
fi

FIXTURE="$ROOT/tests/fixtures/storefront_city_shipping_local_setup.sql"
MIGRATION="$ROOT/supabase/migrations/20261108070000_storefront_city_shipping_rules.sql"
REGRESSION="$ROOT/tests/storefront_city_shipping_local_regression.sql"

cleanup() {
  sudo -u postgres dropdb --if-exists --port="$PGPORT" "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sudo service postgresql start >/dev/null
pg_isready -q -h /var/run/postgresql -p "$PGPORT"
sudo -u postgres createdb --port="$PGPORT" "$DB"
run_sql() {
  local file="$1"
  sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 --port="$PGPORT" -d "$DB" < "$file"
}

run_sql "$FIXTURE"
run_sql "$MIGRATION"
run_sql "$REGRESSION"
printf 'run_storefront_city_shipping_local: PASS (PostgreSQL %s, synthetic schema/data only; temporary DB dropped)\n' "$PG_VERSION"
