-- Toda esta prueba corre en una base temporal de tests/run_wompi_request_cancellation_scratch.sh.
CREATE OR REPLACE FUNCTION public.scratch_start_and_prepare(
  p_request_id uuid,p_reference text,p_phone text,p_make_attempt boolean,p_coupon_code text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public','pg_temp' AS $$
DECLARE v_cart_hash text:=encode(extensions.digest('scratch-cart-v1','sha256'),'hex');
  v_snapshot_hash text:=encode(extensions.digest('scratch-snapshot-'||p_reference,'sha256'),'hex');
  v_phone_hash text:=encode(extensions.digest(public._storefront_coupon_normalized_phone(p_phone),'sha256'),'hex');
  v_raw_items jsonb:=jsonb_build_array(jsonb_build_object('id','11111111-1111-4111-8111-111111111111','qty',1,'color','','size',''));
  v_items jsonb; v_quote jsonb; v_attempt_quote jsonb; v_result jsonb; v_prepared jsonb; v_expiry timestamptz:=now()+interval '10 minutes';
BEGIN
  v_quote:=public.get_storefront_cart_quote_with_coupon(v_raw_items,'Cali',p_coupon_code,'scratch@example.test',p_phone);
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_quote; END IF;
  v_result:=public.start_storefront_wompi_checkout_request(p_request_id,p_reference,v_snapshot_hash,v_cart_hash,v_phone_hash);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_result; END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(p_request_id,v_snapshot_hash,'reserve_lock',
    jsonb_build_object('p_customer_phone',p_phone,'p_cart_hash',v_cart_hash,'p_minutes',10));
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_result; END IF;
  v_prepared:=public.advance_storefront_wompi_checkout_request(p_request_id,v_snapshot_hash,'prepare',
    jsonb_build_object('p_items',v_raw_items,'p_city','Cali','p_coupon_code',p_coupon_code,'p_customer_email','scratch@example.test',
      'p_customer_phone',p_phone,'p_expected_quote',v_quote));
  IF coalesce((v_prepared->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_prepared; END IF;
  v_quote:=v_prepared->'quote'; v_items:=v_quote->'items';
  v_attempt_quote:=v_quote||jsonb_build_object(
    'original_subtotal',round((v_quote->>'original_subtotal')::numeric),
    'discounted_subtotal',round((v_quote->>'discounted_subtotal')::numeric),
    'discount_total',round((v_quote->>'discount_total')::numeric),
    'coupon_discount_total',round((v_quote->>'coupon_discount_total')::numeric),
    'shipping',round((v_quote->>'shipping')::numeric),'total',round((v_quote->>'total')::numeric));
  v_result:=public.advance_storefront_wompi_checkout_request(p_request_id,v_snapshot_hash,'claim','{}'::jsonb);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_result; END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(p_request_id,v_snapshot_hash,'create_order',
    jsonb_build_object('p_customer_name','Synthetic Scratch Buyer','p_phone',p_phone,'p_city','Cali',
      'p_address','Scratch Address','p_neighborhood','Scratch','p_items',v_items,
      'p_subtotal',round((v_quote->>'original_subtotal')::numeric)::bigint,
      'p_shipping',round((v_quote->>'shipping')::numeric)::bigint,
      'p_total',round((v_quote->>'total')::numeric)::bigint,'p_coupon_id',v_quote->>'coupon_id','p_coupon_code',v_quote->>'coupon_code',
      'p_coupon_discount_total',round((v_quote->>'coupon_discount_total')::numeric)::bigint));
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_result; END IF;
  IF NOT p_make_attempt THEN
    RETURN jsonb_build_object('success',true,'state','order_created','snapshot_hash',v_snapshot_hash,
      'cart_hash',v_cart_hash,'phone_hash',v_phone_hash,'quote',v_attempt_quote,'items',v_items);
  END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(p_request_id,v_snapshot_hash,'begin_attempt',
    jsonb_build_object('p_customer_name','Synthetic Scratch Buyer','p_customer_phone',p_phone,'p_city','Cali',
      'p_address','Scratch Address','p_neighborhood','Scratch','p_expected_quote',v_attempt_quote,'p_cart_hash',v_cart_hash,
      'p_is_new_order',true,'p_expiration_time',v_expiry,'p_amount_in_cents',round((v_quote->>'total')::numeric*100)::bigint));
  RETURN v_result||jsonb_build_object('snapshot_hash',v_snapshot_hash,'cart_hash',v_cart_hash,'phone_hash',v_phone_hash,
    'quote',v_attempt_quote,'items',v_items);
END $$;

INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.store_settings(id,admin_user_id,storefront_coupons_enabled) VALUES (1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
INSERT INTO public.storefront_shipping_settings(id,national_shipping_cost,free_shipping_threshold) VALUES (1,15000,NULL);
INSERT INTO public.storefront_cod_settings(id,enabled,allowed_cities) VALUES (1,true,ARRAY['Cali']::text[]);
INSERT INTO public.storefront_coupons(id,code,discount_type,discount_value,minimum_subtotal,enabled)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','SCRATCH10','percent',10,0,true);
INSERT INTO public.products(id,user_id,code,name,category,quantity,cost_price,sale_price)
VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SCRATCH-COR-038','Scratch COR-038','Ropa',5,0,2000);

DO $test$
DECLARE v jsonb; v2 jsonb; v_result jsonb; v_ref text; v_req uuid; v_attempt text; v_snapshot text;
  v_cart text; v_phone_hash text; v_phone text; v_quote jsonb; v_items jsonb; v_admin uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_count bigint; v_stock integer; v_table text; v_privilege text; v_function text;
  v_cod_error text; v_cod_sqlstate text; v_inventory_ref text;
  v_candidate_functions text[]:=ARRAY[
    'start_storefront_wompi_checkout_request','advance_storefront_wompi_checkout_request',
    'cancel_storefront_wompi_checkout_request','publish_storefront_wompi_checkout_request',
    'verify_storefront_wompi_no_transaction','verify_storefront_wompi_no_attempt',
    'prepare_storefront_wompi_manual_retry_lock','resume_storefront_wompi_unattempted_request',
    'create_storefront_wompi_pending_order','begin_storefront_wompi_payment_attempt',
    'transition_storefront_wompi_payment_attempt'];
BEGIN
  IF has_function_privilege('anon','public.start_storefront_wompi_checkout_request(uuid,text,text,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.cancel_storefront_wompi_checkout_request(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.cancel_storefront_wompi_checkout_request(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: request RPC privileges are too broad or missing';
  END IF;
  FOREACH v_table IN ARRAY ARRAY[
    'storefront_wompi_checkout_requests','storefront_wompi_checkout_cancel_tombstones',
    'storefront_wompi_recovery_audit','storefront_wompi_manual_recovery_events'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=v_table AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'FAIL: RLS is not enabled on %',v_table;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=v_table) THEN
      RAISE EXCEPTION 'FAIL: direct row policies unexpectedly exist on private table %',v_table;
    END IF;
    FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege('anon',format('public.%I',v_table),v_privilege)
         OR has_table_privilege('authenticated',format('public.%I',v_table),v_privilege) THEN
        RAISE EXCEPTION 'FAIL: % has % access to private table %',CASE WHEN has_table_privilege('anon',format('public.%I',v_table),v_privilege) THEN 'anon' ELSE 'authenticated' END,v_privilege,v_table;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_function IN ARRAY ARRAY[
    'public.start_storefront_wompi_checkout_request(uuid,text,text,text,text)',
    'public.advance_storefront_wompi_checkout_request(uuid,text,text,jsonb)',
    'public.cancel_storefront_wompi_checkout_request(uuid)',
    'public.publish_storefront_wompi_checkout_request(uuid,text,text,bigint,timestamptz)',
    'public.verify_storefront_wompi_no_transaction(text,uuid,boolean)',
    'public.verify_storefront_wompi_no_attempt(text,uuid,boolean)',
    'public.prepare_storefront_wompi_manual_retry_lock(uuid,text,text,text,text,text,text,text,jsonb,text,jsonb,text)',
    'public.resume_storefront_wompi_unattempted_request(uuid,text,text,text,text,text,text,text,jsonb,text,jsonb,text)'
  ] LOOP
    IF has_function_privilege('anon',v_function,'EXECUTE') OR has_function_privilege('authenticated',v_function,'EXECUTE')
       OR NOT has_function_privilege('service_role',v_function,'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: RPC permissions are too broad or missing for %',v_function;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname=ANY(v_candidate_functions);
  IF v_count<>cardinality(v_candidate_functions) THEN
    RAISE EXCEPTION 'FAIL: expected % candidate RPCs, found %',cardinality(v_candidate_functions),v_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname=ANY(v_candidate_functions)
       AND (NOT p.prosecdef OR NOT EXISTS (
         SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) AS cfg
          WHERE cfg LIKE 'search_path=pg_catalog%public%pg_temp%'))
  ) THEN
    RAISE EXCEPTION 'FAIL: a candidate RPC is not SECURITY DEFINER with the restricted search_path';
  END IF;
  FOR v_function IN
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname=ANY(v_candidate_functions)
  LOOP
    IF has_function_privilege('anon',v_function,'EXECUTE')
       OR has_function_privilege('authenticated',v_function,'EXECUTE')
       OR NOT has_function_privilege('service_role',v_function,'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: candidate RPC ACL is not service_role-only for %',v_function;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('anon','public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric)','EXECUTE')
     OR NOT has_function_privilege('anon','public.create_contra_delivery_order_with_coupon(text,text,text,text,text,text,text,text,jsonb,text,numeric,numeric,numeric)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: public storefront lost anon EXECUTE on a COD RPC';
  END IF;

  -- A browser may signal a changed snapshot before the Edge POST creates its row.
  v_req:='30000000-0000-4000-8000-000000000003'; v_ref:='SCRATCH-CANCEL-BEFORE-START';
  v_result:=public.cancel_storefront_wompi_checkout_request(v_req);
  IF v_result->>'tombstone'<>'true' THEN RAISE EXCEPTION 'FAIL: cancel-before-start tombstone missing: %',v_result; END IF;
  v2:=public.start_storefront_wompi_checkout_request(v_req,v_ref,repeat('a',64),repeat('b',64),repeat('c',64));
  IF coalesce((v2->>'success')::boolean,false) OR v2->>'code'<>'WOMPI_REQUEST_CANCELLED'
     OR EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_requests WHERE request_id=v_req) THEN
    RAISE EXCEPTION 'FAIL: late start passed cancellation tombstone: %',v2;
  END IF;

  -- Safe pre-order cancel: releases only the lock/reservation owned by this request.
  v_req:='10000000-0000-4000-8000-000000000001'; v_ref:='SCRATCH-CANCEL-BEFORE'; v_phone:='3000000001';
  v:=public.scratch_start_and_prepare(v_req,v_ref,v_phone,false);
  IF coalesce((v->>'success')::boolean,false) IS DISTINCT FROM true OR v->>'state'<>'order_created' THEN
    RAISE EXCEPTION 'FAIL: could not prepare synthetic pre-cancel request: %',v;
  END IF;
  v2:=public.scratch_start_and_prepare('70000000-0000-4000-8000-000000000007','SCRATCH-OTHER-OWNER','3000000007',false);
  IF coalesce((v2->>'success')::boolean,false) IS DISTINCT FROM true OR v2->>'state'<>'order_created'
     OR (SELECT count(*) FROM public.inventory_reservations WHERE reference='SCRATCH-OTHER-OWNER' AND lower(status)='active' AND expires_at>now())<>1 THEN
    RAISE EXCEPTION 'FAIL: could not prepare the second request-owned synthetic reservation: %',v2;
  END IF;
  -- This fixture helper created the order; emulate the lower-risk prepared-only request
  -- by removing only its synthetic order before cancellation, then assert the function
  -- conservatively protects the reservation if a row remains.
  DELETE FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_ref;
  DELETE FROM public.orders WHERE reference=v_ref;
  UPDATE public.storefront_wompi_checkout_requests SET order_created_by_request=false,state='prepared' WHERE request_id=v_req;
  v_result:=public.cancel_storefront_wompi_checkout_request(v_req);
  IF v_result->>'state'<>'cancelled' OR v_result->>'released'<>'true' THEN
    RAISE EXCEPTION 'FAIL: owned reservation cancel did not release: %',v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now())
     OR EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_locks WHERE reference=v_ref AND status='active')
     OR EXISTS (SELECT 1 FROM public.orders WHERE reference=v_ref) THEN
    RAISE EXCEPTION 'FAIL: pre-order cancel left an active reservation, lock, or order';
  END IF;
  IF (SELECT count(*) FROM public.inventory_reservations WHERE reference='SCRATCH-OTHER-OWNER' AND lower(status)='active' AND expires_at>now())<>1
     OR NOT EXISTS (SELECT 1 FROM public.storefront_wompi_checkout_locks WHERE reference='SCRATCH-OTHER-OWNER' AND status='active')
     OR NOT EXISTS (SELECT 1 FROM public.orders WHERE reference='SCRATCH-OTHER-OWNER') THEN
    RAISE EXCEPTION 'FAIL: cancellation of one request altered the other request order/lock/reservation';
  END IF;
  v_result:=public.cancel_storefront_wompi_checkout_request(v_req);
  IF v_result->>'idempotent'<>'true' THEN RAISE EXCEPTION 'FAIL: cancel is not idempotent: %',v_result; END IF;
  DELETE FROM public.inventory_reservations WHERE reference='SCRATCH-OTHER-OWNER';
  DELETE FROM public.orders WHERE reference='SCRATCH-OTHER-OWNER';
  DELETE FROM public.storefront_wompi_checkout_locks WHERE reference='SCRATCH-OTHER-OWNER';
  DELETE FROM public.storefront_wompi_checkout_requests WHERE request_id='70000000-0000-4000-8000-000000000007';

  -- Server response after order creation: preserve order and hold, fence publication.
  v_req:='20000000-0000-4000-8000-000000000002'; v_ref:='SCRATCH-LATE-ORDER'; v_phone:='3000000002';
  v:=public.scratch_start_and_prepare(v_req,v_ref,v_phone,false);
  v_result:=public.cancel_storefront_wompi_checkout_request(v_req);
  IF v_result->>'state'<>'manual_recovery_required' OR v_result->>'released'<>'false' THEN
    RAISE EXCEPTION 'FAIL: cancel after order must preserve and fence: %',v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE reference=v_ref AND payment_status='PENDING' AND transaction_id IS NULL)
     OR (SELECT count(*) FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now())<>1 THEN
    RAISE EXCEPTION 'FAIL: late order response did not leave one recoverable order and hold';
  END IF;
  v_result:=public.publish_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','SW-00000000000000000000000000000000',200000,now()+interval '10 minutes');
  IF coalesce((v_result->>'success')::boolean,false) THEN RAISE EXCEPTION 'FAIL: cancelled request published a Wompi session'; END IF;
  v_result:=public.verify_storefront_wompi_no_attempt(v_ref,v_admin,true);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_result->>'attempt_issued'<>'false' THEN
    RAISE EXCEPTION 'FAIL: audited no-attempt recovery failed: %',v_result;
  END IF;
  UPDATE public.storefront_wompi_checkout_requests SET manual_verified_at=now()-interval '16 minutes' WHERE request_id=v_req;
  UPDATE public.orders SET created_at=now()-interval '40 minutes' WHERE reference=v_ref;
  UPDATE public.inventory_reservations SET expires_at=now()-interval '1 minute' WHERE reference=v_ref;
  v2:=public.start_storefront_wompi_checkout_request(v_req,v_ref,v->>'snapshot_hash',v->>'cart_hash',v->>'phone_hash');
  IF v2->>'request_state'<>'started' OR v2->>'order_created_by_request'<>'true' THEN
    RAISE EXCEPTION 'FAIL: no-attempt request did not resume same order: %',v2;
  END IF;
  v_quote:=v->'quote'; v_items:=v->'items';
  v_result:=public.prepare_storefront_wompi_manual_retry_lock(v_req,v->>'snapshot_hash','Synthetic Scratch Buyer',v_phone,
    'Cali','Scratch Address','Scratch','scratch@example.test',v_items,'',v_quote,v->>'cart_hash');
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_result->>'no_attempt_recovered'<>'true' THEN
    RAISE EXCEPTION 'FAIL: same-order no-attempt recovery/renewal failed: %',v_result;
  END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','claim','{}'::jsonb);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: claim recovered request: %',v_result; END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','mark_existing_order','{}'::jsonb);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: existing order link failed: %',v_result; END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','begin_attempt',
    jsonb_build_object('p_customer_name','Synthetic Scratch Buyer','p_customer_phone',v_phone,'p_city','Cali',
      'p_address','Scratch Address','p_neighborhood','Scratch','p_expected_quote',v_quote,'p_cart_hash',v->>'cart_hash',
      'p_is_new_order',true,'p_expiration_time',now()+interval '10 minutes','p_amount_in_cents',200000));
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: first verified attempt not issued: %',v_result; END IF;
  v_attempt:=v_result->>'attempt_reference';
  IF (SELECT count(*) FROM public.orders WHERE reference=v_ref)<>1
     OR (SELECT count(*) FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now())<>1
     OR (SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111')<>5 THEN
    RAISE EXCEPTION 'FAIL: same order/reservation was duplicated or stock was deducted';
  END IF;
  v_result:=public.publish_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash',v_attempt,200000,
    (SELECT expires_at FROM public.storefront_wompi_checkout_requests WHERE request_id=v_req));
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: publish fence failed: %',v_result; END IF;
  v2:=public.publish_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash',v_attempt,200000,
    (SELECT expires_at FROM public.storefront_wompi_checkout_requests WHERE request_id=v_req));
  IF coalesce((v2->>'success')::boolean,false) OR v2->>'code'<>'WOMPI_REQUEST_ALREADY_PUBLISHED' THEN
    RAISE EXCEPTION 'FAIL: published payment session was re-issued: %',v2;
  END IF;
  v2:=public.start_storefront_wompi_checkout_request(v_req,v_ref,v->>'snapshot_hash',v->>'cart_hash',v->>'phone_hash');
  IF coalesce((v2->>'success')::boolean,false) OR v2->>'code'<>'WOMPI_REQUEST_NOT_REPLAYABLE' THEN
    RAISE EXCEPTION 'FAIL: published signature was replayed after ambiguous response: %',v2;
  END IF;
  v_result:=public.cancel_storefront_wompi_checkout_request(v_req);
  IF v_result->>'state'<>'published' OR v_result->>'released'<>'false' OR v_result->>'manual_recovery_required'<>'true' THEN
    RAISE EXCEPTION 'FAIL: cancel after signature publication changed or released protected state: %',v_result;
  END IF;
  UPDATE public.storefront_wompi_payment_attempts SET created_at=now()-interval '40 minutes' WHERE attempt_reference=v_attempt;
  UPDATE public.storefront_wompi_checkout_requests SET expires_at=now()-interval '20 minutes' WHERE request_id=v_req;
  UPDATE public.inventory_reservations SET expires_at=now()-interval '1 minute' WHERE reference=v_ref;
  v_result:=public.verify_storefront_wompi_no_transaction(v_attempt,v_admin,true);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_result->>'reservation_released'<>'false' THEN
    RAISE EXCEPTION 'FAIL: manual no-transaction attestation failed: %',v_result;
  END IF;
  IF (SELECT status FROM public.storefront_wompi_payment_attempts WHERE attempt_reference=v_attempt)<>'INITIATED'
     OR EXISTS (SELECT 1 FROM public.storefront_wompi_payment_attempts WHERE attempt_reference=v_attempt AND transaction_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.orders WHERE reference=v_ref AND payment_status<>'PENDING') THEN
    RAISE EXCEPTION 'FAIL: manual verification falsified payment/order status';
  END IF;
  UPDATE public.storefront_wompi_payment_attempts SET manual_verified_at=now()-interval '16 minutes' WHERE attempt_reference=v_attempt;
  UPDATE public.storefront_wompi_checkout_requests SET manual_verified_at=now()-interval '16 minutes' WHERE request_id=v_req;
  v2:=public.start_storefront_wompi_checkout_request(v_req,v_ref,v->>'snapshot_hash',v->>'cart_hash',v->>'phone_hash');
  IF v2->>'request_state'<>'started' THEN RAISE EXCEPTION 'FAIL: manually verified attempt did not resume after grace: %',v2; END IF;
  v_result:=public.prepare_storefront_wompi_manual_retry_lock(v_req,v->>'snapshot_hash','Synthetic Scratch Buyer',v_phone,
    'Cali','Scratch Address','Scratch','scratch@example.test',v_items,'',v_quote,v->>'cart_hash');
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_result->>'manual_attempt_recovered'<>'true' THEN
    RAISE EXCEPTION 'FAIL: existing attempt retry/atomic reservation renewal failed: %',v_result;
  END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','claim','{}'::jsonb);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: retry claim failed: %',v_result; END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','mark_existing_order','{}'::jsonb);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: retry order re-link failed: %',v_result; END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','begin_attempt',
    jsonb_build_object('p_customer_name','Synthetic Scratch Buyer','p_customer_phone',v_phone,'p_city','Cali',
      'p_address','Scratch Address','p_neighborhood','Scratch','p_expected_quote',v_quote,'p_cart_hash',v->>'cart_hash',
      'p_is_new_order',false,'p_expiration_time',now()+interval '10 minutes','p_amount_in_cents',200000));
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: same-order retry attempt failed: %',v_result; END IF;
  IF (SELECT count(*) FROM public.orders WHERE reference=v_ref)<>1
     OR (SELECT count(*) FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now())<>1
     OR (SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111')<>5 THEN
    RAISE EXCEPTION 'FAIL: retry duplicated order/reservation or deducted stock';
  END IF;
  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt,'TX-SCRATCH-LATE-1','PENDING',200000,'COP','prod');
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_result->>'is_current'<>'false'
     OR v_result->>'manual_recovery_conflict'<>'true' THEN RAISE EXCEPTION 'FAIL: tardy pending webhook was not fenced: %',v_result; END IF;
  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt,'TX-SCRATCH-LATE-1','APPROVED',200000,'COP','prod');
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_result->>'late_approval'<>'true' THEN
    RAISE EXCEPTION 'FAIL: tardy approval was not isolated for reconciliation: %',v_result;
  END IF;
  IF (SELECT transaction_id FROM public.storefront_wompi_payment_attempts WHERE attempt_reference=v_attempt) IS NOT NULL
     OR (SELECT status FROM public.storefront_wompi_payment_attempts WHERE attempt_reference=v_attempt)<>'INITIATED'
     OR (SELECT payment_status FROM public.orders WHERE reference=v_ref)<>'PENDING'
     OR NOT (SELECT wompi_reconciliation_required FROM public.orders WHERE reference=v_ref)
     OR (SELECT count(*) FROM public.storefront_wompi_manual_recovery_events WHERE attempt_reference=v_attempt AND transaction_id='TX-SCRATCH-LATE-1')<>1
     OR (SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111')<>5 THEN
    RAISE EXCEPTION 'FAIL: late webhook changed attempt/order status or stock outside reconciliation fence';
  END IF;

  -- A real browser cancellation may win after the server recorded an INITIATED
  -- attempt but before publish. Preserve the ambiguous attempt/order/hold; do not
  -- expose a signature, free stock, or let the same request publish later.
  v_req:='60000000-0000-4000-8000-000000000006'; v_ref:='SCRATCH-CANCEL-BEFORE-PUBLISH'; v_phone:='3000000006';
  v_stock:=(SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111');
  v:=public.scratch_start_and_prepare(v_req,v_ref,v_phone,true);
  IF coalesce((v->>'success')::boolean,false) IS DISTINCT FROM true OR v->>'request_state'<>'attempt_issued' THEN
    RAISE EXCEPTION 'FAIL: could not prepare request with an issued, unpublished attempt: %',v;
  END IF;
  v_attempt:=v->>'attempt_reference';
  v_result:=public.cancel_storefront_wompi_checkout_request(v_req);
  IF v_result->>'state'<>'manual_recovery_required' OR v_result->>'released'<>'false' THEN
    RAISE EXCEPTION 'FAIL: cancel after attempt issuance did not preserve ambiguous checkout: %',v_result;
  END IF;
  IF (SELECT count(*) FROM public.orders WHERE reference=v_ref AND payment_status='PENDING' AND transaction_id IS NULL)<>1
     OR (SELECT count(*) FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now())<>1
     OR (SELECT count(*) FROM public.storefront_wompi_payment_attempts WHERE attempt_reference=v_attempt AND status='INITIATED' AND transaction_id IS NULL)<>1
     OR (SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111')<>v_stock THEN
    RAISE EXCEPTION 'FAIL: cancel-before-publish deleted, duplicated, or altered protected state';
  END IF;
  v_result:=public.publish_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash',v_attempt,200000,
    (SELECT expires_at FROM public.storefront_wompi_checkout_requests WHERE request_id=v_req));
  IF coalesce((v_result->>'success')::boolean,false) OR v_result->>'code'<>'WOMPI_REQUEST_PUBLISH_DENIED' THEN
    RAISE EXCEPTION 'FAIL: cancelled request exposed a late signature: %',v_result;
  END IF;
  v2:=public.start_storefront_wompi_checkout_request(v_req,v_ref,v->>'snapshot_hash',v->>'cart_hash',v->>'phone_hash');
  IF coalesce((v2->>'success')::boolean,false) OR v2->>'code'<>'WOMPI_MANUAL_RECOVERY_REQUIRED' THEN
    RAISE EXCEPTION 'FAIL: ambiguous attempt was automatically restarted: %',v2;
  END IF;

  -- If a response was lost after the request-owned order/hold was created but
  -- before any attempt or signature existed, the exact same request may recover
  -- itself immediately through the atomic quote/inventory revalidation RPC.
  v_req:='20000000-0000-4000-8000-000000000007'; v_ref:='SCRATCH-RECOVER-ORDER-NO-ATTEMPT'; v_phone:='3000000007';
  v_stock:=(SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111');
  v:=public.scratch_start_and_prepare(v_req,v_ref,v_phone,false);
  v2:=public.start_storefront_wompi_checkout_request(v_req,v_ref,v->>'snapshot_hash',v->>'cart_hash',v->>'phone_hash');
  IF v2->>'request_state'<>'order_created' OR v2->>'order_created_by_request'<>'true' THEN
    RAISE EXCEPTION 'FAIL: response-lost order ownership was not recoverable: %',v2;
  END IF;
  v_result:=public.resume_storefront_wompi_unattempted_request(v_req,v->>'snapshot_hash','Synthetic Scratch Buyer',v_phone,
    'Cali','Scratch Address','Scratch','scratch@example.test',v->'items','',v->'quote',v->>'cart_hash');
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_result->>'reservation_revalidated'<>'true' THEN
    RAISE EXCEPTION 'FAIL: same-order idempotent quote/reservation resume failed: %',v_result;
  END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','claim','{}'::jsonb);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: recovered claim failed: %',v_result; END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','mark_existing_order','{}'::jsonb);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: recovered order link failed: %',v_result; END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','begin_attempt',
    jsonb_build_object('p_customer_name','Synthetic Scratch Buyer','p_customer_phone',v_phone,'p_city','Cali',
      'p_address','Scratch Address','p_neighborhood','Scratch','p_expected_quote',v->'quote','p_cart_hash',v->>'cart_hash',
      'p_is_new_order',true,'p_expiration_time',now()+interval '10 minutes','p_amount_in_cents',200000));
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: resumed same-order attempt failed: %',v_result; END IF;
  v_attempt:=v_result->>'attempt_reference';
  IF (SELECT count(*) FROM public.orders WHERE reference=v_ref)<>1
     OR (SELECT count(*) FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now())<>1
     OR (SELECT count(*) FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_ref)<>1
     OR (SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111')<>v_stock THEN
    RAISE EXCEPTION 'FAIL: recovered order duplicated rows/reservation or deducted stock';
  END IF;

  -- Synthetic transaction states must not be released or rewritten by a late
  -- browser cancellation. First keep a pending transaction intact, then advance
  -- that same synthetic transaction to approved and verify cancel remains inert.
  v_result:=public.publish_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash',v_attempt,200000,
    (SELECT expires_at FROM public.storefront_wompi_checkout_requests WHERE request_id=v_req));
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: could not publish local-only fixture before synthetic transaction states: %',v_result;
  END IF;
  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt,'TX-SCRATCH-CURRENT-1','PENDING',200000,'COP','prod');
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_result->>'is_current'<>'true' THEN
    RAISE EXCEPTION 'FAIL: synthetic current PENDING transition failed: %',v_result;
  END IF;
  v_stock:=(SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111');
  v2:=jsonb_build_object(
    'order',(SELECT jsonb_build_object('status',payment_status,'transaction_id',transaction_id) FROM public.orders WHERE reference=v_ref),
    'attempt',(SELECT jsonb_build_object('status',status,'transaction_id',transaction_id) FROM public.storefront_wompi_payment_attempts WHERE attempt_reference=v_attempt),
    'active_reservations',(SELECT count(*) FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now()),
    'stock',v_stock);
  v_result:=public.cancel_storefront_wompi_checkout_request(v_req);
  IF v_result->>'released'<>'false'
     OR v2 IS DISTINCT FROM jsonb_build_object(
       'order',(SELECT jsonb_build_object('status',payment_status,'transaction_id',transaction_id) FROM public.orders WHERE reference=v_ref),
       'attempt',(SELECT jsonb_build_object('status',status,'transaction_id',transaction_id) FROM public.storefront_wompi_payment_attempts WHERE attempt_reference=v_attempt),
       'active_reservations',(SELECT count(*) FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now()),
       'stock',(SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111')) THEN
    RAISE EXCEPTION 'FAIL: pending cancellation invariant (cancel=%, order=%, attempt=%, reservation=%, stock=%/%).',v_result,
      (SELECT jsonb_build_object('status',payment_status,'transaction_id',transaction_id) FROM public.orders WHERE reference=v_ref),
      (SELECT jsonb_build_object('status',status,'transaction_id',transaction_id) FROM public.storefront_wompi_payment_attempts WHERE attempt_reference=v_attempt),
      (SELECT count(*) FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now()),
      v_stock,(SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111');
  END IF;
  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt,'TX-SCRATCH-CURRENT-1','APPROVED',200000,'COP','prod');
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_result->>'is_current'<>'true' THEN
    RAISE EXCEPTION 'FAIL: synthetic current APPROVED transition failed: %',v_result;
  END IF;
  v_stock:=(SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111');
  v2:=jsonb_build_object(
    'order',(SELECT jsonb_build_object('status',payment_status,'transaction_id',transaction_id) FROM public.orders WHERE reference=v_ref),
    'attempt',(SELECT jsonb_build_object('status',status,'transaction_id',transaction_id) FROM public.storefront_wompi_payment_attempts WHERE attempt_reference=v_attempt),
    'active_reservations',(SELECT count(*) FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now()),
    'stock',v_stock);
  v_result:=public.cancel_storefront_wompi_checkout_request(v_req);
  IF v_result->>'released'<>'false'
     OR v2 IS DISTINCT FROM jsonb_build_object(
       'order',(SELECT jsonb_build_object('status',payment_status,'transaction_id',transaction_id) FROM public.orders WHERE reference=v_ref),
       'attempt',(SELECT jsonb_build_object('status',status,'transaction_id',transaction_id) FROM public.storefront_wompi_payment_attempts WHERE attempt_reference=v_attempt),
      'active_reservations',(SELECT count(*) FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now()),
      'stock',(SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111')) THEN
    RAISE EXCEPTION 'FAIL: cancellation changed an approved payment, attempt, or stock';
  END IF;

  v_result:=public.create_contra_delivery_order_with_quote(
    'SCRATCH-COD-NOCOUPON-0001','Synthetic COD Buyer','1234567890','3000000001','scratch@example.test',
    'Cali','Scratch Address','Scratch Neighborhood',
    jsonb_build_array(jsonb_build_object('id','11111111-1111-4111-8111-111111111111','qty',1,'color','','size','')),
    2000,0);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.web_orders WHERE client_reference='SCRATCH-COD-NOCOUPON-0001' AND payment_method='Contra entrega')<>1
     OR (SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111')<>5 THEN
    RAISE EXCEPTION 'FAIL: actual no-coupon COD RPC failed or changed product quantity: %',v_result;
  END IF;
  SELECT inventory_reference INTO v_inventory_ref FROM public.web_orders WHERE client_reference='SCRATCH-COD-NOCOUPON-0001';
  IF v_inventory_ref IS NULL
     OR (SELECT count(*) FROM public.inventory_reservations WHERE reference=v_inventory_ref AND lower(status)='active' AND expires_at>now())<>1 THEN
    RAISE EXCEPTION 'FAIL: actual COD RPC did not create exactly one active inventory hold';
  END IF;
  v2:=public.create_contra_delivery_order_with_quote(
    'SCRATCH-COD-NOCOUPON-0001','Synthetic COD Buyer','1234567890','3000000001','scratch@example.test',
    'Cali','Scratch Address','Scratch Neighborhood',
    jsonb_build_array(jsonb_build_object('id','11111111-1111-4111-8111-111111111111','qty',1,'color','','size','')),
    2000,0);
  IF coalesce((v2->>'success')::boolean,false) IS DISTINCT FROM true OR v2->>'duplicate'<>'true'
     OR (SELECT count(*) FROM public.web_orders WHERE client_reference='SCRATCH-COD-NOCOUPON-0001')<>1
     OR (SELECT count(*) FROM public.inventory_reservations WHERE reference=v_inventory_ref AND lower(status)='active' AND expires_at>now())<>1
     OR (SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111')<>5 THEN
    RAISE EXCEPTION 'FAIL: duplicate no-coupon COD call created another order/hold or changed stock: %',v2;
  END IF;

  -- The actual Wompi prepare RPC must reserve a valid synthetic coupon and be replay-safe.
  v:=public.scratch_start_and_prepare('80000000-0000-4000-8000-000000000008','SCRATCH-WOMPI-COUPON-0001','3000000008',false,'SCRATCH10');
  IF coalesce((v->>'success')::boolean,false) IS DISTINCT FROM true OR v->>'state'<>'order_created'
     OR round((v#>>'{quote,total}')::numeric,0)<>1800
     OR round((v#>>'{quote,coupon_discount_total}')::numeric,0)<>200
     OR (SELECT count(*) FROM public.orders WHERE reference='SCRATCH-WOMPI-COUPON-0001')<>1
     OR (SELECT count(*) FROM public.inventory_reservations WHERE reference='SCRATCH-WOMPI-COUPON-0001' AND lower(status)='active' AND expires_at>now())<>1
     OR (SELECT count(*) FROM public.storefront_coupon_redemptions WHERE reference='SCRATCH-WOMPI-COUPON-0001' AND status='reserved')<>1
     OR (SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111')<>5 THEN
    RAISE EXCEPTION 'FAIL: real Wompi prepare with coupon did not create one correctly priced order/hold/redemption: %',v;
  END IF;
  v_req:='80000000-0000-4000-8000-000000000008'; v_ref:='SCRATCH-WOMPI-COUPON-0001'; v_phone:='3000000008';
  v_stock:=(SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111');
  v2:=public.start_storefront_wompi_checkout_request(v_req,v_ref,v->>'snapshot_hash',v->>'cart_hash',v->>'phone_hash');
  IF v2->>'request_state'<>'order_created' OR v2->>'order_created_by_request'<>'true' THEN
    RAISE EXCEPTION 'FAIL: coupon-bearing order was not recognized as owned/recoverable: %',v2;
  END IF;
  v_result:=public.resume_storefront_wompi_unattempted_request(v_req,v->>'snapshot_hash','Synthetic Scratch Buyer',v_phone,
    'Cali','Scratch Address','Scratch','scratch@example.test',v->'items','SCRATCH10',v->'quote',v->>'cart_hash');
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true OR v_result->>'reservation_revalidated'<>'true' THEN
    RAISE EXCEPTION 'FAIL: coupon order/reservation could not be resumed idempotently: %',v_result;
  END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','claim','{}'::jsonb);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: coupon resume claim failed: %',v_result; END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','mark_existing_order','{}'::jsonb);
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: coupon resume order link failed: %',v_result; END IF;
  v_result:=public.advance_storefront_wompi_checkout_request(v_req,v->>'snapshot_hash','begin_attempt',
    jsonb_build_object('p_customer_name','Synthetic Scratch Buyer','p_customer_phone',v_phone,'p_city','Cali',
      'p_address','Scratch Address','p_neighborhood','Scratch','p_expected_quote',v->'quote','p_cart_hash',v->>'cart_hash',
      'p_is_new_order',true,'p_expiration_time',now()+interval '10 minutes','p_amount_in_cents',180000));
  IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.orders WHERE reference=v_ref)<>1
     OR (SELECT count(*) FROM public.inventory_reservations WHERE reference=v_ref AND lower(status)='active' AND expires_at>now())<>1
     OR (SELECT count(*) FROM public.storefront_coupon_redemptions WHERE reference=v_ref AND status='reserved')<>1
     OR (SELECT count(*) FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_ref)<>1
     OR (SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111')<>v_stock THEN
    RAISE EXCEPTION 'FAIL: coupon resume duplicated order/hold/redemption/attempt or changed stock: %',v_result;
  END IF;
  DELETE FROM public.storefront_coupon_redemptions WHERE reference='SCRATCH-WOMPI-COUPON-0001';
  DELETE FROM public.storefront_wompi_payment_attempts WHERE order_reference='SCRATCH-WOMPI-COUPON-0001';
  DELETE FROM public.inventory_reservations WHERE reference='SCRATCH-WOMPI-COUPON-0001';
  DELETE FROM public.orders WHERE reference='SCRATCH-WOMPI-COUPON-0001';
  DELETE FROM public.storefront_wompi_checkout_locks WHERE reference='SCRATCH-WOMPI-COUPON-0001';
  DELETE FROM public.storefront_wompi_checkout_requests WHERE request_id='80000000-0000-4000-8000-000000000008';

  v_quote:=public.get_storefront_cart_quote_with_coupon(
    jsonb_build_array(jsonb_build_object('id','11111111-1111-4111-8111-111111111111','qty',1,'color','','size','')),
    'Cali','SCRATCH10','scratch@example.test','3000000002');
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true
     OR round((v_quote->>'coupon_discount_total')::numeric,0)<>200
     OR round((v_quote->>'total')::numeric,0)<>1800 THEN
    RAISE EXCEPTION 'FAIL: synthetic coupon quote did not match the fixture: %',v_quote;
  END IF;
  v2:=jsonb_build_object(
    'web_orders',(SELECT count(*) FROM public.web_orders),
    'reservations',(SELECT count(*) FROM public.inventory_reservations),
    'redemptions',(SELECT count(*) FROM public.storefront_coupon_redemptions),
    'stock',(SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111'));
  v_cod_error:=NULL; v_cod_sqlstate:=NULL;
  BEGIN
    v_result:=public.create_contra_delivery_order_with_coupon(
      'SCRATCH-COD-WITHCOUPON-0001','Synthetic Coupon Buyer','1234567890','3000000002','scratch@example.test',
      'Cali','Scratch Address','Scratch Neighborhood',
      jsonb_build_array(jsonb_build_object('id','11111111-1111-4111-8111-111111111111','qty',1,'color','','size','')),
      'SCRATCH10',round((v_quote->>'total')::numeric,0),round((v_quote->>'discount_total')::numeric,0),
      round((v_quote->>'coupon_discount_total')::numeric,0));
    RAISE EXCEPTION 'FAIL: expected the captured production COD coupon incompatibility was not reproduced';
  EXCEPTION WHEN undefined_column THEN
    GET STACKED DIAGNOSTICS v_cod_error=MESSAGE_TEXT,v_cod_sqlstate=RETURNED_SQLSTATE;
  END;
  IF v_cod_sqlstate<>'42703' OR v_cod_error NOT ILIKE '%original_subtotal%' THEN
    RAISE EXCEPTION 'FAIL: unexpected COD coupon result: SQLSTATE %, message %',v_cod_sqlstate,v_cod_error;
  END IF;
  IF v2 IS DISTINCT FROM jsonb_build_object(
       'web_orders',(SELECT count(*) FROM public.web_orders),
       'reservations',(SELECT count(*) FROM public.inventory_reservations),
       'redemptions',(SELECT count(*) FROM public.storefront_coupon_redemptions),
       'stock',(SELECT quantity FROM public.products WHERE id='11111111-1111-4111-8111-111111111111'))
     OR EXISTS (SELECT 1 FROM public.web_orders WHERE client_reference='SCRATCH-COD-WITHCOUPON-0001') THEN
    RAISE EXCEPTION 'FAIL: failed coupon COD subtransaction left order/reservation/redemption or changed stock';
  END IF;
  RAISE NOTICE 'KNOWN BASELINE ISSUE: production coupon COD RPC references missing web_orders.original_subtotal (SQLSTATE 42703); transaction rolled back with zero order/reservation/redemption delta.';

  RAISE NOTICE 'PASS: cancel releases only its own hold and preserves another request order/lock/reservation; response loss recovers same order/reservation; pending and approved payments survive late cancellation; cancel-before-publish blocks late signature; publish is one-shot; manual audit/renewal is safe; late webhooks quarantined; Wompi coupon prepare/resume keeps one order, hold, redemption and attempt; no-coupon COD idempotent with stock unchanged; coupon COD baseline failure isolated and fully rolled back.';
END
$test$;
