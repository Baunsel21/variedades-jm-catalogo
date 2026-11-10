#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="sirevya_checkout_coupon_cedula_local_${RANDOM}_$$"
PG_VERSION="$(pg_config --version | awk '{print $2}')"
PG_MAJOR="${PG_VERSION%%.*}"
PGPORT="${PGPORT:-$(pg_lsclusters --no-header "$PG_MAJOR" | awk '$4 == "online" {print $3; exit}')}"
if [[ -z "$PGPORT" ]]; then
  printf 'No se encontró un clúster PostgreSQL local online para major %s.\n' "$PG_MAJOR" >&2
  exit 1
fi
PGSOCKET="/var/run/postgresql"

cleanup() {
  sudo -u postgres env PGHOST="$PGSOCKET" PGPORT="$PGPORT" dropdb --if-exists "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sudo service postgresql start >/dev/null
pg_isready -q -h "$PGSOCKET" -p "$PGPORT"
sudo -u postgres env PGHOST="$PGSOCKET" PGPORT="$PGPORT" createdb "$DB"
run_sql() {
  sudo -u postgres env PGHOST="$PGSOCKET" PGPORT="$PGPORT" \
    psql -X -q -v ON_ERROR_STOP=1 -d "$DB" < "$1"
}

run_sql "$ROOT/tests/fixtures/checkout_coupons_cedula_local_prereqs.sql"
run_sql "$ROOT/tests/fixtures/promotion_calendar_local_setup.sql"
run_sql "$ROOT/tests/fixtures/checkout_coupons_cedula_local_schema.sql"
run_sql "$ROOT/supabase/migrations/20261108070000_storefront_city_shipping_rules.sql"
run_sql "$ROOT/supabase/migrations/20261108090000_storefront_combo_calendar_priority.sql"
run_sql "$ROOT/supabase/migrations/20261109090000_require_customer_cedula.sql"
run_sql "$ROOT/tests/fixtures/checkout_coupons_cedula_local_rpcs.sql"
run_sql "$ROOT/supabase/migrations/20261109120000_storefront_coupons.sql"
run_sql "$ROOT/tests/coupons_regression.sql"
run_sql "$ROOT/tests/checkout_cedula_local_regression.sql"

# El runner solo anuncia éxito después de confirmar que el scratch se eliminó.
sudo -u postgres env PGHOST="$PGSOCKET" PGPORT="$PGPORT" dropdb --if-exists "$DB" >/dev/null
trap - EXIT
printf '%s\n' 'run_checkout_coupons_cedula_local: PASS (scratch local; fixtures sintéticos; sin red, pagos, importación ni filas persistentes)'
