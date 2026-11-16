#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if ! command -v pg_lsclusters >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  echo 'FAIL: PostgreSQL 17 local y psql son requeridos.' >&2
  exit 2
fi
started_cluster=0
port="$(pg_lsclusters --no-header | awk '$1==17 && $4=="online" { print $3; exit }')"
if [[ -z "$port" ]]; then
  if ! pg_lsclusters --no-header | awk '$1==17 { found=1 } END { exit !found }'; then
    echo 'FAIL: no existe PostgreSQL 17 local; el runner no instalará componentes.' >&2
    exit 2
  fi
  sudo pg_ctlcluster 17 main start
  started_cluster=1
  port="$(pg_lsclusters --no-header | awk '$1==17 && $4=="online" { print $3; exit }')"
fi
if [[ -z "$port" ]]; then echo 'FAIL: no se pudo iniciar el clúster PostgreSQL 17.' >&2; exit 2; fi
DB="sirevya_cart_scoped_scratch_${RANDOM}_$(date +%s)"
had_anon="$(sudo -u postgres psql -X -A -t -p "$port" -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname='anon';")"
had_authenticated="$(sudo -u postgres psql -X -A -t -p "$port" -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname='authenticated';")"
had_service_role="$(sudo -u postgres psql -X -A -t -p "$port" -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname='service_role';")"
cleanup() {
  sudo -u postgres dropdb -p "$port" --if-exists "$DB" >/dev/null 2>&1 || true
  [[ "$had_anon" == '1' ]] || sudo -u postgres psql -X -p "$port" -d postgres -c 'DROP ROLE IF EXISTS anon' >/dev/null 2>&1 || true
  [[ "$had_authenticated" == '1' ]] || sudo -u postgres psql -X -p "$port" -d postgres -c 'DROP ROLE IF EXISTS authenticated' >/dev/null 2>&1 || true
  [[ "$had_service_role" == '1' ]] || sudo -u postgres psql -X -p "$port" -d postgres -c 'DROP ROLE IF EXISTS service_role' >/dev/null 2>&1 || true
  if [[ "$started_cluster" == '1' ]]; then sudo pg_ctlcluster 17 main stop >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
sudo -u postgres createdb -p "$port" "$DB"
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -f tests/wompi_request_cancellation_scratch_setup.sql >/tmp/sirevya_cart_scope_setup.log 2>&1 || { tail -100 /tmp/sirevya_cart_scope_setup.log; exit 1; }
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -f supabase/migrations/20261116070000_wompi_request_cancellation_manual_recovery.sql >/tmp/sirevya_cart_scope_700.log 2>&1 || { tail -120 /tmp/sirevya_cart_scope_700.log; exit 1; }
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -f supabase/migrations/20261116090000_wompi_checkout_safe_request_recovery.sql >/tmp/sirevya_cart_scope_900.log 2>&1 || { tail -160 /tmp/sirevya_cart_scope_900.log; exit 1; }
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -f supabase/migrations/20261116092000_wompi_cart_scoped_checkout_guards.sql >/tmp/sirevya_cart_scope_920.log 2>&1 || { tail -160 /tmp/sirevya_cart_scope_920.log; exit 1; }
sudo -u postgres psql -X -P pager=off -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -f tests/wompi_cart_scoped_guards_scratch_regression.sql
printf 'PASS: focused PostgreSQL 17 scratch only; cart-scoped locks/attempts/reconciliation and verified retry tested; no Wompi calls, no production writes; scratch database dropped on exit.\n'
