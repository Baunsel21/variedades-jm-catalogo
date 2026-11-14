#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="sirevya_inventory_finalize_scratch_$$_$(date +%s)"
MIGRATION_FILE="${SIREVYA_MIGRATION_FILE:-$ROOT/supabase/migrations/20261115020000_fix_inventory_finalization_idempotency.sql}"
cleanup(){ dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"
psql -X -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
CREATE EXTENSION pgcrypto;
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  quantity integer NOT NULL DEFAULT 0
);
CREATE TABLE public.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL,
  color text,
  size text,
  expires_at timestamptz NOT NULL,
  status text NOT NULL
);
CREATE OR REPLACE FUNCTION public.cleanup_inventory_reservations() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN NULL; END $$;
SQL

psql -X -v ON_ERROR_STOP=1 -d "$DB" -c "\i '$MIGRATION_FILE'"

psql -X -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
DO $$
DECLARE
  v_variant_product uuid;
  v_legacy uuid;
  v_active uuid;
  v_plain uuid;
  v_plain_reservation uuid;
  v_bad uuid;
  v_result jsonb;
  v_stock integer;
  v_status text;
  v_expired_variant uuid;
  v_expired_plain uuid;
BEGIN
  INSERT INTO public.products(code, variants, quantity)
  VALUES ('VAR-LEGACY', '[{"color":"Café","size":"M","stock":3},{"color":"Blanco","size":"M","stock":2}]', 5)
  RETURNING id INTO v_variant_product;
  INSERT INTO public.inventory_reservations(reference,product_id,quantity,color,size,expires_at,status)
  VALUES ('legacy-ref',v_variant_product,2,'Café','M',now()+interval '5 minutes','WHATSAPP_CONFIRMED')
  RETURNING id INTO v_legacy;

  v_result := public.finalize_inventory_reservation('legacy-ref');
  IF COALESCE((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'legacy finalize failed: %', v_result; END IF;
  SELECT ((variants->0->>'stock')::integer), status INTO v_stock,v_status FROM public.products p JOIN public.inventory_reservations r ON r.product_id=p.id WHERE r.id=v_legacy;
  IF v_stock <> 3 OR v_status <> 'CONVERTED' THEN RAISE EXCEPTION 'legacy double decrement or status failure: stock %, status %',v_stock,v_status; END IF;
  v_result := public.finalize_inventory_reservation('legacy-ref');
  IF COALESCE((v_result->>'already_finalized')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'legacy retry not idempotent: %',v_result; END IF;

  INSERT INTO public.inventory_reservations(reference,product_id,quantity,color,size,expires_at,status)
  VALUES ('active-ref',v_variant_product,2,'Blanco','M',now()+interval '5 minutes','active')
  RETURNING id INTO v_active;
  v_result := public.finalize_inventory_reservation('active-ref');
  SELECT (variants->1->>'stock')::integer INTO v_stock FROM public.products WHERE id=v_variant_product;
  IF COALESCE((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_stock <> 0 THEN RAISE EXCEPTION 'active finalize incorrect: result %, stock %',v_result,v_stock; END IF;
  v_result := public.finalize_inventory_reservation('active-ref');
  SELECT (variants->1->>'stock')::integer INTO v_stock FROM public.products WHERE id=v_variant_product;
  IF COALESCE((v_result->>'already_finalized')::boolean,false) IS DISTINCT FROM true OR v_stock <> 0 THEN RAISE EXCEPTION 'active retry not idempotent: result %, stock %',v_result,v_stock; END IF;

  INSERT INTO public.products(code,variants,quantity)
  VALUES ('EXPIRED-VAR', '[{"color":"Café","size":"M","stock":3}]', 3)
  RETURNING id INTO v_expired_variant;
  INSERT INTO public.inventory_reservations(reference,product_id,quantity,color,size,expires_at,status)
  VALUES ('expired-var-ref',v_expired_variant,2,'Café','M',now()-interval '1 minute','PENDING');
  PERFORM public.cleanup_inventory_reservations();
  SELECT (variants->0->>'stock')::integer, status INTO v_stock,v_status FROM public.products p JOIN public.inventory_reservations r ON r.product_id=p.id WHERE r.reference='expired-var-ref';
  IF v_stock <> 5 OR v_status <> 'EXPIRED' THEN RAISE EXCEPTION 'expired variant was not restored exactly once: stock %, status %',v_stock,v_status; END IF;

  INSERT INTO public.products(code,variants,quantity) VALUES ('EXPIRED-PLAIN','[]',3) RETURNING id INTO v_expired_plain;
  INSERT INTO public.inventory_reservations(reference,product_id,quantity,expires_at,status) VALUES ('expired-plain-ref',v_expired_plain,2,now()-interval '1 minute','PENDING');
  PERFORM public.cleanup_inventory_reservations();
  SELECT p.quantity, r.status INTO v_stock,v_status FROM public.products p JOIN public.inventory_reservations r ON r.product_id=p.id WHERE r.reference='expired-plain-ref';
  IF v_stock <> 5 OR v_status <> 'EXPIRED' THEN RAISE EXCEPTION 'expired plain reservation was not restored exactly once: stock %, status %',v_stock,v_status; END IF;

  INSERT INTO public.products(code,variants,quantity) VALUES ('PLAIN','[]',5) RETURNING id INTO v_plain;
  INSERT INTO public.inventory_reservations(reference,product_id,quantity,expires_at,status) VALUES ('plain-ref',v_plain,2,now()+interval '5 minutes','active') RETURNING id INTO v_plain_reservation;
  v_result := public.finalize_inventory_reservation('plain-ref');
  SELECT quantity INTO v_stock FROM public.products WHERE id=v_plain;
  IF COALESCE((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_stock <> 3 THEN RAISE EXCEPTION 'plain finalize incorrect: result %, stock %',v_result,v_stock; END IF;

  INSERT INTO public.products(code,variants,quantity) VALUES ('BAD','[{"color":"Negro","size":"S","stock":1}]',1) RETURNING id INTO v_bad;
  INSERT INTO public.inventory_reservations(reference,product_id,quantity,color,size,expires_at,status) VALUES ('bad-ref',v_bad,2,'Negro','S',now()+interval '5 minutes','active');
  v_result := public.finalize_inventory_reservation('bad-ref');
  SELECT (variants->0->>'stock')::integer INTO v_stock FROM public.products WHERE id=v_bad;
  SELECT status INTO v_status FROM public.inventory_reservations WHERE reference='bad-ref';
  IF COALESCE((v_result->>'success')::boolean,true) IS DISTINCT FROM false OR v_stock <> 1 OR v_status <> 'active' THEN RAISE EXCEPTION 'insufficient stock changed state: result %, stock %, status %',v_result,v_stock,v_status; END IF;
END $$;
SQL
echo 'PASS inventory finalization idempotency scratch: legacy, active, plain, retry and insufficient-stock cases.'
