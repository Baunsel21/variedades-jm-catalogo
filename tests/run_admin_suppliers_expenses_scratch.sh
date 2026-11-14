#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="sirevya_phase2_scratch_$$_$(date +%s)"
ADMIN="00000000-0000-0000-0000-000000000001"
OTHER="00000000-0000-0000-0000-000000000002"
MIGRATION_FILE="${SIREVYA_MIGRATION_FILE:-$ROOT/supabase/migrations/20261114010000_admin_suppliers_expenses.sql}"
cleanup(){ dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"

psql -X -v ON_ERROR_STOP=1 -d "$DB" <<SQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END
\$\$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users(id) VALUES ('$ADMIN'), ('$OTHER');
CREATE TABLE public.store_settings (id bigint PRIMARY KEY, admin_user_id uuid NOT NULL);
INSERT INTO public.store_settings VALUES (1, '$ADMIN');
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS \$\$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid \$\$;
CREATE OR REPLACE FUNCTION public.is_store_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS \$\$ SELECT auth.uid() = (SELECT admin_user_id FROM public.store_settings WHERE id=1 LIMIT 1) \$\$;
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_store_admin() TO authenticated;
SQL

BASELINE="$(psql -X -At -d "$DB" -c "SELECT string_agg(relname, ',' ORDER BY relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p');")"
psql -X -v ON_ERROR_STOP=1 -d "$DB" -f "$MIGRATION_FILE"

psql -X -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
DO $$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('public.suppliers') IS NULL OR to_regclass('public.expenses') IS NULL THEN RAISE EXCEPTION 'missing candidate tables'; END IF;
  SELECT count(*) INTO v_count FROM pg_indexes WHERE schemaname='public' AND indexname IN ('suppliers_user_name_idx','expenses_user_date_idx');
  IF v_count <> 2 THEN RAISE EXCEPTION 'expected 2 candidate indexes, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname IN ('suppliers','expenses') AND c.contype IN ('p','f','c');
  IF v_count < 8 THEN RAISE EXCEPTION 'expected primary/foreign/check constraints, got %', v_count; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='suppliers_admin_select') THEN RAISE EXCEPTION 'supplier select policy missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expenses' AND policyname='expenses_admin_insert') THEN RAISE EXCEPTION 'expense insert policy missing'; END IF;
END $$;
SQL

if [[ "$BASELINE" != *"store_settings"* || "$BASELINE" != *"auth"* ]]; then :; fi
# Existing scratch tables must still exist and candidate must not remove them.
psql -X -v ON_ERROR_STOP=1 -d "$DB" -c "SELECT to_regclass('public.store_settings') AS existing_store_settings, to_regclass('auth.users') AS existing_auth_users;"

auth_cmd(){ psql -X -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE authenticated; SET request.jwt.claim.sub = '$ADMIN'; $1"; }
other_cmd(){ psql -X -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE authenticated; SET request.jwt.claim.sub = '$OTHER'; $1"; }
anon_cmd(){ psql -X -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE anon; RESET request.jwt.claim.sub; $1"; }
expect_fail(){
  local label="$1"; shift
  if "$@" >/tmp/sirevya_phase2_expected_failure.log 2>&1; then
    cat /tmp/sirevya_phase2_expected_failure.log
    echo "FAIL $label: operación inesperadamente permitida"
    exit 1
  fi
  echo "PASS $label: acceso rechazado"
}

# Admin can create and read own records.
auth_cmd "INSERT INTO public.suppliers(user_id,name) VALUES ('$ADMIN','Proveedor scratch admin'); INSERT INTO public.expenses(user_id,concept,amount) VALUES ('$ADMIN','Gasto scratch admin',12000); SELECT count(*) AS admin_own_rows FROM public.suppliers s JOIN public.expenses e ON e.user_id=s.user_id WHERE s.user_id='$ADMIN';"
# Seed another owner's rows as table owner, then confirm tenant isolation.
psql -X -v ON_ERROR_STOP=1 -d "$DB" -c "INSERT INTO public.suppliers(user_id,name) VALUES ('$OTHER','Proveedor scratch otro'); INSERT INTO public.expenses(user_id,concept,amount) VALUES ('$OTHER','Gasto scratch otro',13000);"
auth_cmd "SELECT count(*) AS admin_visible_suppliers FROM public.suppliers; SELECT count(*) AS admin_visible_expenses FROM public.expenses; UPDATE public.suppliers SET note='admin update' WHERE user_id='$ADMIN'; DELETE FROM public.expenses WHERE user_id='$ADMIN';"
# Admin cannot affect another user's row; UPDATE/DELETE match zero rows because RLS hides it.
[[ "$(auth_cmd "SELECT count(*) FROM public.suppliers WHERE user_id='$OTHER';" | tail -1 | tr -d ' ')" == "0" ]] && echo "PASS admin tenant isolation: other owner hidden"

expect_fail "non-admin supplier insert" other_cmd "INSERT INTO public.suppliers(user_id,name) VALUES ('$OTHER','No permitido');"
expect_fail "non-admin expense insert" other_cmd "INSERT INTO public.expenses(user_id,concept,amount) VALUES ('$OTHER','No permitido',1);"
[[ "$(other_cmd "SELECT count(*) FROM public.suppliers; SELECT count(*) FROM public.expenses;" | grep -E '^[0-9]+$' | tr '\n' ' ')" == "0 0 " ]] && echo "PASS non-admin read isolation: zero visible rows"
[[ "$(other_cmd "UPDATE public.suppliers SET note='No permitido' WHERE user_id='$OTHER' RETURNING id;" | grep -E '^[0-9a-f-]{36}$' | wc -l | tr -d ' ')" == "0" ]] && echo "PASS non-admin supplier update: 0 rows visible/modified"
[[ "$(other_cmd "DELETE FROM public.suppliers WHERE user_id='$OTHER' RETURNING id;" | grep -E '^[0-9a-f-]{36}$' | wc -l | tr -d ' ')" == "0" ]] && echo "PASS non-admin supplier delete: 0 rows visible/deleted"
expect_fail "anon supplier read" anon_cmd "SELECT count(*) FROM public.suppliers;"
expect_fail "anon expense insert" anon_cmd "INSERT INTO public.expenses(user_id,concept,amount) VALUES ('$ADMIN','No permitido',1);"

# Input constraints.
expect_fail "empty supplier name constraint" auth_cmd "INSERT INTO public.suppliers(user_id,name) VALUES ('$ADMIN','');"
expect_fail "negative expense constraint" auth_cmd "INSERT INTO public.expenses(user_id,concept,amount) VALUES ('$ADMIN','Inválido',-1);"

echo "PASS scratch migration and RLS: suppliers/expenses; production untouched."
