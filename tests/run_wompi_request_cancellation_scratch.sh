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
DB="sirevya_wompi_request_scratch_${RANDOM}_$(date +%s)"
cleanup() { sudo -u postgres dropdb -p "$port" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
sudo -u postgres createdb -p "$port" "$DB"
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -f tests/wompi_request_cancellation_scratch_setup.sql >/tmp/sirevya_wompi_prod_rpc_setup.log 2>&1 || { tail -100 /tmp/sirevya_wompi_prod_rpc_setup.log; exit 1; }
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -f supabase/migrations/20261116070000_wompi_request_cancellation_manual_recovery.sql >/tmp/sirevya_wompi_candidate_migration.log 2>&1 || { tail -120 /tmp/sirevya_wompi_candidate_migration.log; exit 1; }
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -f tests/wompi_request_cancellation_scratch_regression.sql

# Two simultaneous starts with one UUID must converge on the same request row.
tmp1="$(mktemp)"; tmp2="$(mktemp)"
sql="SELECT public.start_storefront_wompi_checkout_request('40000000-0000-4000-8000-000000000004','SCRATCH-CONCURRENT',repeat('d',64),repeat('e',64),repeat('f',64));"
sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "$sql" >"$tmp1" & pid1=$!
sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "$sql" >"$tmp2" & pid2=$!
wait "$pid1"; wait "$pid2"
if ! grep -q '"success": true' "$tmp1" || ! grep -q '"success": true' "$tmp2"; then cat "$tmp1" "$tmp2" >&2; exit 1; fi
rows="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT count(*) FROM public.storefront_wompi_checkout_requests WHERE request_id='40000000-0000-4000-8000-000000000004';")"
rm -f "$tmp1" "$tmp2"
if [[ "$rows" != "1" ]]; then echo "FAIL: concurrent starts created $rows rows." >&2; exit 1; fi

# Serialize two begin_attempts and two publishes; only one attempt/session may be exposed.
publish_req="50000000-0000-4000-8000-000000000005"
publish_ref="SCRATCH-CONCURRENT-PUBLISH"
before_qty="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111';")"
fixture="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT public.scratch_start_and_prepare('$publish_req','$publish_ref','3000000005',true);")"
if ! grep -q '"success": true' <<<"$fixture"; then echo "FAIL: unable to prepare synthetic concurrent publish fixture: $fixture" >&2; exit 1; fi
begin_sql="SELECT public.advance_storefront_wompi_checkout_request('$publish_req',(SELECT snapshot_hash FROM public.storefront_wompi_checkout_requests WHERE request_id='$publish_req'),'begin_attempt','{}'::jsonb);"
tmpb1="$(mktemp)"; tmpb2="$(mktemp)"
sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "$begin_sql" >"$tmpb1" & pidb1=$!
sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "$begin_sql" >"$tmpb2" & pidb2=$!
wait "$pidb1"; wait "$pidb2"
begin_results="$(cat "$tmpb1" "$tmpb2")"; rm -f "$tmpb1" "$tmpb2"
attempt_count="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT count(*) FROM public.storefront_wompi_payment_attempts WHERE order_reference='$publish_ref';")"
if [[ "$(grep -o '"success": true' <<<"$begin_results" | wc -l)" != "2" || "$attempt_count" != "1" ]]; then echo "FAIL: concurrent begin_attempt did not converge to one attempt." >&2; exit 1; fi
publish_sql="SELECT public.publish_storefront_wompi_checkout_request('$publish_req',(SELECT snapshot_hash FROM public.storefront_wompi_checkout_requests WHERE request_id='$publish_req'),(SELECT attempt_reference FROM public.storefront_wompi_checkout_requests WHERE request_id='$publish_req'),200000,(SELECT expires_at FROM public.storefront_wompi_checkout_requests WHERE request_id='$publish_req'));"
tmp3="$(mktemp)"; tmp4="$(mktemp)"
sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "$publish_sql" >"$tmp3" & pid3=$!
sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "$publish_sql" >"$tmp4" & pid4=$!
wait "$pid3"; wait "$pid4"
successes="$(grep -h -o '"success": true' "$tmp3" "$tmp4" | wc -l)"
denials="$(grep -h -o 'WOMPI_REQUEST_ALREADY_PUBLISHED' "$tmp3" "$tmp4" | wc -l)"
rm -f "$tmp3" "$tmp4"
if [[ "$successes" != "1" || "$denials" != "1" ]]; then echo "FAIL: publish fence was not one-shot (success=$successes denial=$denials)." >&2; exit 1; fi
after_qty="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111';")"
final_state="$(sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -p "$port" -d "$DB" -c "SELECT (SELECT state FROM public.storefront_wompi_checkout_requests WHERE request_id='$publish_req')||'|'||(SELECT count(*) FROM public.orders WHERE reference='$publish_ref')||'|'||(SELECT count(*) FROM public.inventory_reservations WHERE reference='$publish_ref' AND lower(status)='active' AND expires_at>now());")"
if [[ "$before_qty" != "$after_qty" || "$final_state" != "published|1|1" ]]; then echo "FAIL: final order/reservation/quantity invariant failed ($final_state, qty=$before_qty/$after_qty)." >&2; exit 1; fi
printf 'PASS: PostgreSQL 17 scratch; exact catalog-derived production RPC/schema baseline; candidate migration compiled; request/cancellation/recovery, cross-request reservation isolation, concurrency and one-shot publish passed; Wompi coupon prepare/resume retained one order/hold/redemption/attempt; no-coupon COD is idempotent; coupon COD missing-column failure was reproduced and fully rolled back; inventory quantity unchanged; database dropped.\n'
