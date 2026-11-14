#!/usr/bin/env bash
set -Eeuo pipefail
export PAGER=cat
export PG_PAGER=cat
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}" )/.." && pwd)"
DB="sirevya_phase6_financial_scratch_$$_$(date +%s)"
ADMIN="00000000-0000-0000-0000-000000000001"
OTHER="00000000-0000-0000-0000-000000000002"
BASE_MIGRATION_FILE="${SIREVYA_BASE_MIGRATION_FILE:-$ROOT/supabase/migrations/20261114010000_admin_suppliers_expenses.sql}"
MIGRATION_FILE="${SIREVYA_MIGRATION_FILE:-$ROOT/supabase/migrations/20261116010000_financial_costs_supplier_links.sql}"
cleanup(){ dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"
psql -X -v ON_ERROR_STOP=1 -d "$DB" <<SQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END\$\$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('$ADMIN'),('$OTHER');
CREATE TABLE public.store_settings(id bigint PRIMARY KEY, admin_user_id uuid NOT NULL);
INSERT INTO public.store_settings VALUES (1,'$ADMIN');
CREATE TABLE public.products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), code text NOT NULL);
INSERT INTO public.products(id,user_id,code) VALUES ('10000000-0000-0000-0000-000000000001','$ADMIN','P-SCRATCH');
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$\$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid \$\$;
CREATE OR REPLACE FUNCTION public.is_store_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS \$\$ SELECT auth.uid()=(SELECT admin_user_id FROM public.store_settings WHERE id=1) \$\$;
GRANT USAGE ON SCHEMA public, auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_store_admin() TO authenticated;
SQL
psql -X -v ON_ERROR_STOP=1 -d "$DB" -f "$BASE_MIGRATION_FILE"
psql -X -v ON_ERROR_STOP=1 -d "$DB" -f "$MIGRATION_FILE"
psql -X -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
DO $$
DECLARE n integer;
BEGIN
 IF to_regclass('public.product_cost_profiles') IS NULL OR to_regclass('public.product_cost_history') IS NULL THEN RAISE EXCEPTION 'cost tables missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='expenses' AND column_name='supplier_id') THEN RAISE EXCEPTION 'supplier_id missing'; END IF;
 SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename IN ('product_cost_profiles','product_cost_history') AND policyname LIKE 'product_cost%';
 IF n < 5 THEN RAISE EXCEPTION 'cost RLS policies missing'; END IF;
END $$;
INSERT INTO public.suppliers(user_id,name) VALUES ('00000000-0000-0000-0000-000000000001','Proveedor fase 6'),('00000000-0000-0000-0000-000000000002','Proveedor otro');
SQL
supplier=$(psql -X -At -d "$DB" -c "SELECT id FROM public.suppliers WHERE user_id='$ADMIN' LIMIT 1")
other_supplier=$(psql -X -At -d "$DB" -c "SELECT id FROM public.suppliers WHERE user_id='$OTHER' LIMIT 1")
admin_cmd(){ psql -X -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE authenticated; SET request.jwt.claim.sub = '$ADMIN'; $1"; }
other_cmd(){ psql -X -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE authenticated; SET request.jwt.claim.sub = '$OTHER'; $1"; }
anon_cmd(){ psql -X -v ON_ERROR_STOP=1 -d "$DB" -c "SET ROLE anon; RESET request.jwt.claim.sub; $1"; }
expect_fail(){ local label="$1"; shift; if "$@" >/tmp/sirevya_phase6_expected.log 2>&1; then cat /tmp/sirevya_phase6_expected.log; echo "FAIL $label"; exit 1; else echo "PASS $label"; fi; }
admin_cmd "INSERT INTO public.expenses(user_id,concept,amount,supplier_id) VALUES ('$ADMIN','Compra fase 6',1000,'$supplier'); SELECT count(*) FROM public.expenses WHERE supplier_id='$supplier';"
expect_fail "supplier owner mismatch" admin_cmd "INSERT INTO public.expenses(user_id,concept,amount,supplier_id) VALUES ('$ADMIN','Cruce',1000,'$other_supplier');"
admin_cmd "SELECT public.admin_upsert_product_cost('10000000-0000-0000-0000-000000000001','Rojo|M',100,20,5,'2026-11-14'); SELECT public.admin_upsert_product_cost('10000000-0000-0000-0000-000000000001','Rojo|M',120,20,5,'2026-11-15');"
history=$(psql -X -At -d "$DB" -c "SELECT count(*) FROM public.product_cost_history")
if [[ "$history" == "2" ]]; then echo "PASS cost history snapshots: $history"; else
  echo "FAIL cost history: $history"
  psql -X -d "$DB" -c "SELECT tgname, tgenabled, tgtype FROM pg_trigger WHERE tgrelid='public.product_cost_profiles'::regclass AND NOT tgisinternal; SELECT product_id,variant_key,purchase_cost,import_cost,other_cost,effective_from,changed_reason FROM public.product_cost_history ORDER BY changed_at,id;"
  exit 1
fi
other_visible="$(other_cmd "SELECT count(*) FROM public.product_cost_profiles;" 2>&1)"; echo "$other_visible"
[[ "$(printf '%s\n' "$other_visible" | grep -E '^[[:space:]]*0[[:space:]]*$' | tail -1 | tr -d ' ')" == "0" ]] && echo 'PASS other admin cannot read cost profile' || { echo 'FAIL other admin cost visibility'; exit 1; }
expect_fail "other admin cannot set admin product cost" other_cmd "SELECT public.admin_upsert_product_cost('10000000-0000-0000-0000-000000000001','',1,0,0,'2026-11-15');"
expect_fail "anon cannot read costs" anon_cmd "SELECT count(*) FROM public.product_cost_profiles;"
[[ "$(psql -X -At -d "$DB" -c "SELECT count(*) FROM public.products WHERE code='P-SCRATCH'")" == "1" ]] && echo 'PASS existing product preserved' || exit 1
echo 'PASS phase6 financial costs/supplier scratch; production untouched.'
