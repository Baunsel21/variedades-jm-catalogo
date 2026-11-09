#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_VERSION="$(pg_config --version | awk '{print $2}')"
PG_MAJOR="${PG_VERSION%%.*}"
PGPORT="$(pg_lsclusters --no-header "$PG_MAJOR" | awk '$4 == "online" {print $3; exit}')"
if [[ -z "$PGPORT" ]]; then
  printf 'No online local PostgreSQL cluster for major version %s; refusing to connect elsewhere.\n' "$PG_MAJOR" >&2
  exit 1
fi

DB="sirevya_hex_jsonb_local_${RANDOM}_$$"
PGHOST_LOCAL="/var/run/postgresql"
cleanup() {
  sudo -u postgres dropdb --if-exists --host="$PGHOST_LOCAL" --port="$PGPORT" "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

pg_isready -q -h "$PGHOST_LOCAL" -p "$PGPORT"
sudo -u postgres createdb --host="$PGHOST_LOCAL" --port="$PGPORT" "$DB"
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 --host="$PGHOST_LOCAL" --port="$PGPORT" -d "$DB" < "$ROOT/tests/variant_hex_postgres_roundtrip_setup.sql"
HEX_TEST_DB="$DB" HEX_TEST_PORT="$PGPORT" node "$ROOT/tests/variant_hex_persistence_roundtrip_postgres_regression.mjs"
printf 'run_variant_hex_postgres_roundtrip: PASS (PostgreSQL %s local scratch, synthetic JSONB only; database dropped)\n' "$PG_VERSION"
