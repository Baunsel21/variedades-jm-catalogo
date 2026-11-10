#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="sirevya_cedula_regression_$(date +%s)_$$"

sudo service postgresql start >/dev/null
sudo -u postgres createdb "$DB"
cleanup() { sudo -u postgres dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql_local_file() {
  local file="$1"
  sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "$DB" < "$file"
}
psql_local_file "$ROOT/tests/fixtures/checkout_cedula_schema.sql"
psql_local_file "$ROOT/supabase/migrations/20261109090000_require_customer_cedula.sql"
psql_local_file "$ROOT/tests/checkout_cedula_local_regression.sql"
