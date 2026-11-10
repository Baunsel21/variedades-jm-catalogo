#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="sirevya_city_shipping_local_${RANDOM}_$$"
PREFLIGHT_DB="${DB}_preflight"
PREFLIGHT_ERROR="$(mktemp "${TMPDIR:-/tmp}/sirevya-city-preflight.XXXXXX")"
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
  sudo -u postgres dropdb --if-exists --port="$PGPORT" "$PREFLIGHT_DB" >/dev/null 2>&1 || true
  rm -f "$PREFLIGHT_ERROR"
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
run_sql "$MIGRATION"
run_sql "$REGRESSION"

sudo -u postgres createdb --port="$PGPORT" "$PREFLIGHT_DB"
if sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 --port="$PGPORT" -d "$PREFLIGHT_DB" < "$MIGRATION" >/dev/null 2>"$PREFLIGHT_ERROR"; then
  printf 'Preflight should reject an empty schema before creating city tables.\n' >&2
  exit 1
fi
if ! grep -Fq 'Storefront city shipping prerequisites are missing or incompatible.' "$PREFLIGHT_ERROR"; then
  printf 'Migration failed for a reason other than the expected preflight.\n' >&2
  cat "$PREFLIGHT_ERROR" >&2
  exit 1
fi
preflight_tables_absent="$(sudo -u postgres psql -X -Atq --port="$PGPORT" -d "$PREFLIGHT_DB" -c "SELECT to_regclass('public.storefront_shipping_rules') IS NULL AND to_regclass('public.storefront_shipping_rule_destinations') IS NULL")"
if [[ "$preflight_tables_absent" != "t" ]]; then
  printf 'Preflight rejection left city tables behind.\n' >&2
  exit 1
fi
sudo -u postgres dropdb --if-exists --port="$PGPORT" "$DB" >/dev/null
sudo -u postgres dropdb --if-exists --port="$PGPORT" "$PREFLIGHT_DB" >/dev/null
rm -f "$PREFLIGHT_ERROR"
trap - EXIT
printf 'run_storefront_city_shipping_local: PASS (PostgreSQL %s; twice-applied migration, synthetic quote regression, empty-schema rejection before DDL; temporary DBs dropped)\n' "$PG_VERSION"
