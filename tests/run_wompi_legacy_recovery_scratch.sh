#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v pg_lsclusters >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  echo "FAIL: se requiere PostgreSQL local y psql para la prueba scratch." >&2
  exit 2
fi
cluster="$(pg_lsclusters --no-header | awk '$4=="online" { print $1, $3; exit }')"
if [[ -z "$cluster" ]]; then
  echo "FAIL: no hay cluster PostgreSQL local online." >&2
  exit 2
fi
read -r version port <<<"$cluster"
db="sirevya_wompi_recovery_scratch_${RANDOM}_$(date +%s)"
cleanup() { sudo -u postgres dropdb -p "$port" --if-exists "$db" >/dev/null 2>&1 || true; }
trap cleanup EXIT
sudo -u postgres createdb -p "$port" "$db"
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$db" -f tests/wompi_legacy_recovery_scratch_setup.sql
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$db" -f supabase/migrations/20261116050000_wompi_verified_retry_attempts.sql
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$db" -f supabase/migrations/20261116060000_wompi_legacy_order_recovery.sql
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$db" -f tests/wompi_attempt_retry_scratch_regression.sql
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$db" -f tests/wompi_legacy_recovery_scratch_regression.sql
echo "PASS: PostgreSQL ${version} scratch recovery suite; temporary DB will be dropped by trap."
