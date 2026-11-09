#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="sirevya_promotion_calendar_local_${RANDOM}_$$"
PG_VERSION="$(pg_config --version | awk '{print $2}')"
PG_MAJOR="${PG_VERSION%%.*}"
PGHOST="${PGHOST:-/var/run/postgresql}"
if [[ -z "${PGPORT:-}" ]]; then
  PGPORT="$(pg_lsclusters --no-header "$PG_MAJOR" | awk '$4 == "online" {print $3; exit}')"
fi
if [[ -z "${PGPORT:-}" ]]; then
  printf 'No active local PostgreSQL cluster found for major version %s.\n' "$PG_MAJOR" >&2
  exit 1
fi

FIXTURE="$ROOT/tests/fixtures/promotion_calendar_local_setup.sql"
CITY_MIGRATION="$ROOT/supabase/migrations/20261108070000_storefront_city_shipping_rules.sql"
PROMOTION_MIGRATION="$ROOT/supabase/migrations/20261108090000_storefront_combo_calendar_priority.sql"
REGRESSION="$ROOT/tests/promotion_priority_regression.sql"

cleanup() {
  sudo -u postgres dropdb --if-exists --host="$PGHOST" --port="$PGPORT" "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sudo service postgresql start >/dev/null
pg_isready -q -h "$PGHOST" -p "$PGPORT"
sudo -u postgres createdb --host="$PGHOST" --port="$PGPORT" "$DB"
run_sql() {
  local file="$1"
  sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 --host="$PGHOST" --port="$PGPORT" -d "$DB" < "$file"
}

run_sql "$FIXTURE"
run_sql "$CITY_MIGRATION"
run_sql "$PROMOTION_MIGRATION"
run_sql "$REGRESSION"
printf 'run_promotion_calendar_local: PASS (PostgreSQL %s, local socket only, synthetic fixture; temporary DB dropped)\n' "$PG_VERSION"
