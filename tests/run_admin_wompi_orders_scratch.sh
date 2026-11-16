#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if ! command -v pg_lsclusters >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  echo "FAIL: se requiere PostgreSQL local 17 y psql." >&2
  exit 2
fi
port="$(pg_lsclusters --no-header | awk '$1==17 && $4=="online" { print $3; exit }')"
if [[ -z "$port" ]]; then echo "FAIL: no hay clúster PostgreSQL 17 local online." >&2; exit 2; fi
DB="sirevya_admin_wompi_scratch_${RANDOM}_$(date +%s)"
cleanup() { sudo -u postgres dropdb -p "$port" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
sudo -u postgres createdb -p "$port" "$DB"

sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$DB" <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  customer_name text,
  phone text,
  city text,
  address text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal bigint NOT NULL DEFAULT 0,
  shipping bigint NOT NULL DEFAULT 0,
  total bigint NOT NULL DEFAULT 0,
  payment_method text,
  payment_status text,
  transaction_id text,
  coupon_code text,
  coupon_discount_total bigint NOT NULL DEFAULT 0,
  wompi_reconciliation_required boolean NOT NULL DEFAULT false,
  coupon_reconciliation_required boolean NOT NULL DEFAULT false
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orders FROM PUBLIC, anon, authenticated;
INSERT INTO public.orders(id,reference,customer_name,phone,city,address,items,subtotal,shipping,total,payment_method,payment_status,transaction_id)
VALUES
('11111111-1111-4111-8111-111111111111','SCRATCH-WOMPI-APPROVED','Synthetic Buyer','3000000000','Cali','Synthetic address','[{"id":"P-1","name":"Synthetic item","code":"TEST-1","qty":1,"price":2000}]',2000,0,2000,'wompi','APPROVED','TX-SCRATCH-APPROVED'),
('22222222-2222-4222-8222-222222222222','SCRATCH-COD','Synthetic COD Buyer','3000000001','Cali','Synthetic address','[]',2000,0,2000,'contraentrega','PENDING',NULL);
CREATE OR REPLACE FUNCTION public.is_store_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false) $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
SQL

sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -f supabase/migrations/20261116080000_admin_wompi_orders_readonly.sql

admin_result="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" <<'SQL'
SET ROLE authenticated;
SET request.jwt.claims='{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
SELECT reference||'|'||payment_status||'|'||total FROM public.admin_list_wompi_orders(10,0);
SQL
)"
if ! grep -q 'SCRATCH-WOMPI-APPROVED|APPROVED|2000' <<<"$admin_result"; then echo "FAIL: el administrador no ve el pedido Wompi sintético: $admin_result" >&2; exit 1; fi
if grep -q 'SCRATCH-COD' <<<"$admin_result"; then echo "FAIL: el listado Wompi incluyó contraentrega." >&2; exit 1; fi

if nonadmin_result="$(sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$DB" <<'SQL' 2>&1
\set VERBOSITY verbose
SET ROLE authenticated;
SET request.jwt.claims='{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
SELECT count(*) FROM public.admin_list_wompi_orders(10,0);
SQL
)"; then echo "FAIL: un usuario autenticado no admin pudo consultar pedidos Wompi." >&2; exit 1; fi
if ! grep -q '42501' <<<"$nonadmin_result"; then echo "FAIL: la denegación al no-admin no tuvo el código esperado: $nonadmin_result" >&2; exit 1; fi

anon_exec="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT has_function_privilege('anon','public.admin_list_wompi_orders(integer,integer)','EXECUTE')")"
auth_select="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT has_table_privilege('authenticated','public.orders','SELECT')")"
rls_enabled="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT relrowsecurity FROM pg_class WHERE oid='public.orders'::regclass")"
security_definer="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT prosecdef FROM pg_proc WHERE oid='public.admin_list_wompi_orders(integer,integer)'::regprocedure")"
search_path="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT array_to_string(proconfig,',') FROM pg_proc WHERE oid='public.admin_list_wompi_orders(integer,integer)'::regprocedure")"
row_count="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT count(*) FROM public.orders")"
if [[ "$anon_exec" != "f" || "$auth_select" != "f" || "$rls_enabled" != "t" || "$security_definer" != "t" || "$search_path" != "search_path=pg_catalog, public, pg_temp" || "$row_count" != "2" ]]; then
  echo "FAIL: acceso/seguridad/integridad no coincide (anon=$anon_exec authenticated_select=$auth_select rls=$rls_enabled definer=$security_definer path=$search_path rows=$row_count)." >&2
  exit 1
fi
printf 'PASS: PostgreSQL 17 scratch; migración aplicada solo a DB temporal; el administrador ve el pedido Wompi sintético; no-admin/anon bloqueados; orders conserva RLS y sin SELECT directo; RPC SECURITY DEFINER con search_path restringido; contraentrega excluida; filas sin cambios; DB eliminada.\n'
