#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="sirevya_telegram_local_${RANDOM}_$$"
EXTENSION_DIR="$(pg_config --sharedir)/extension"
PG_VERSION="$(pg_config --version | awk '{print $2}')"
PG_MAJOR="${PG_VERSION%%.*}"
if [[ -z "${PGPORT:-}" ]]; then
  PGPORT="$(pg_lsclusters --no-header "$PG_MAJOR" | awk 'NR == 1 {print $3}')"
fi
if [[ -z "$PGPORT" ]]; then
  printf 'No local PostgreSQL cluster found for pg_config major version %s.\n' "$PG_MAJOR" >&2
  exit 1
fi
MOCK_EXT_DIR="$ROOT/tests/fixtures/local_extensions"
MIGRATION="$ROOT/supabase/migrations/20261109055000_telegram_notification_outbox.sql"
SCHEDULER_MIGRATION="$ROOT/supabase/migrations/20261109055100_telegram_notification_scheduler.sql"
FIXTURE="$ROOT/tests/fixtures/telegram_outbox_schema.sql"
REGRESSION="$ROOT/tests/telegram_outbox_local_regression.sql"
SCHEDULER_SETUP="$ROOT/tests/fixtures/telegram_scheduler_mock_setup.sql"
SCHEDULER_REGRESSION="$ROOT/tests/telegram_scheduler_local_regression.sql"
MOCKS_INSTALLED=0

cleanup() {
  sudo -u postgres dropdb --if-exists --port="$PGPORT" "$DB" >/dev/null 2>&1 || true
  if [[ "$MOCKS_INSTALLED" -eq 1 ]]; then
    sudo rm -f \
      "$EXTENSION_DIR/pg_net.control" "$EXTENSION_DIR/pg_net--1.0.sql" \
      "$EXTENSION_DIR/pg_cron.control" "$EXTENSION_DIR/pg_cron--1.0.sql"
  fi
}
trap cleanup EXIT

for extension_file in pg_net.control pg_net--1.0.sql pg_cron.control pg_cron--1.0.sql; do
  if [[ -e "$EXTENSION_DIR/$extension_file" ]]; then
    printf 'Refusing to overwrite installed extension file: %s\n' "$EXTENSION_DIR/$extension_file" >&2
    exit 1
  fi
done
MOCKS_INSTALLED=1
sudo install -m 0644 "$MOCK_EXT_DIR/pg_net.control" "$EXTENSION_DIR/pg_net.control"
sudo install -m 0644 "$MOCK_EXT_DIR/pg_net--1.0.sql" "$EXTENSION_DIR/pg_net--1.0.sql"
sudo install -m 0644 "$MOCK_EXT_DIR/pg_cron.control" "$EXTENSION_DIR/pg_cron.control"
sudo install -m 0644 "$MOCK_EXT_DIR/pg_cron--1.0.sql" "$EXTENSION_DIR/pg_cron--1.0.sql"

sudo service postgresql start >/dev/null
pg_isready -q -h /var/run/postgresql -p "$PGPORT"
sudo -u postgres createdb --port="$PGPORT" "$DB"
run_sql() {
  local file="$1"
  sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 --port="$PGPORT" -d "$DB" < "$file"
}

run_sql "$FIXTURE"
run_sql "$SCHEDULER_SETUP"
run_sql "$MIGRATION"
# Applying the same candidate twice checks that its DDL is rerunnable in isolation.
run_sql "$MIGRATION"
run_sql "$SCHEDULER_MIGRATION"
run_sql "$SCHEDULER_MIGRATION"
run_sql "$REGRESSION"
run_sql "$SCHEDULER_REGRESSION"
printf '%s\n' 'run_telegram_outbox_local: PASS (mock extensions only; no network; temporary DB dropped)'
