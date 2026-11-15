-- Ejecutar solo en DB PostgreSQL scratch tras los dos migrations candidatos.
DO $$
DECLARE
  v_ref text:='WOMPI-LEGACY-RECOVERY-SCRATCH-001';
  v_fail_ref text:='WOMPI-LEGACY-RECOVERY-SCRATCH-002';
  v_price_ref text:='WOMPI-LEGACY-RECOVERY-SCRATCH-003';
  v_coupon_ref text:='WOMPI-LEGACY-RECOVERY-SCRATCH-004';
  v_coupon_fail_ref text:='WOMPI-LEGACY-RECOVERY-SCRATCH-005';
  v_phone text:='3001111001';
  v_fail_phone text:='3001111002';
  v_price_phone text:='3001111003';
  v_coupon_phone text:='3001111004';
  v_coupon_fail_phone text:='3001111005';
  v_hash text:=repeat('a',64);
  v_product uuid:='11111111-1111-4111-8111-111111111111';
  v_coupon_id uuid:=gen_random_uuid();
  v_items jsonb;
  v_coupon_items jsonb;
  v_attempts jsonb;
  v_coupon_attempts jsonb;
  v_quote jsonb;
  v_result jsonb;
  v_attempt1 text;
  v_attempt2 text;
  v_attempt3 text;
  v_order_count integer;
BEGIN
  v_items:=jsonb_build_array(jsonb_build_object('id',v_product,'qty',1,'color','Negro','size','M','price',10000,
    'original_subtotal',10000,'discount_total',0,'net_subtotal',10000,'coupon_discount_total',0));
  v_attempts:=jsonb_build_array(
    jsonb_build_object('transaction_id','TX-LEGACY-001','reference',v_ref,'amount_in_cents',1500000,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '17 minutes'),
    jsonb_build_object('transaction_id','TX-LEGACY-002','reference',v_ref,'amount_in_cents',1500000,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '16 minutes')
  );
  INSERT INTO public.orders(reference,customer_name,phone,city,address,items,subtotal,shipping,total,payment_method,payment_status)
    VALUES(v_ref,'Comprador sintético',v_phone,'Ciudad Scratch','Dirección Scratch',v_items,10000,5000,15000,'wompi','PENDING');
  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at)
    VALUES(v_ref,encode(extensions.digest(v_phone,'sha256'),'hex'),v_hash,'active',now()-interval '1 minute');
  INSERT INTO public.inventory_reservations(reference,product_id,quantity,color,size,expires_at,status)
    VALUES(v_ref,v_product,1,'Negro','M',now()-interval '1 minute','RELEASED');

  -- Two verified ERRORs recover the same order and a fresh hold, with no payment started.
  v_result:=public.recover_storefront_wompi_legacy_order(v_ref,v_hash,'',v_attempts);
  IF v_result->>'success'<>'true' OR v_result->>'order_reused'<>'true' OR v_result->>'payment_started'<>'false'
     OR v_result->>'order_created'<>'false' OR v_result->>'legacy_attempts_registered'<>'2' THEN
    RAISE EXCEPTION 'legacy recovery did not succeed safely: %',v_result;
  END IF;
  SELECT count(*) INTO v_order_count FROM public.orders WHERE reference=v_ref;
  IF v_order_count<>1 OR (SELECT payment_status<>'ERROR' OR transaction_id<>'TX-LEGACY-002' FROM public.orders WHERE reference=v_ref) THEN
    RAISE EXCEPTION 'recovery changed order identity or current legacy state';
  END IF;
  IF (SELECT count(*)<>2 FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_ref AND is_legacy=true
       AND wompi_reference=v_ref AND status='ERROR') THEN RAISE EXCEPTION 'two legacy attempts not recorded'; END IF;
  SELECT attempt_reference INTO v_attempt1 FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_ref AND transaction_id='TX-LEGACY-001';
  SELECT attempt_reference INTO v_attempt2 FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_ref AND transaction_id='TX-LEGACY-002';
  IF v_attempt1=v_attempt2 OR v_attempt1 !~ '^SW-[A-F0-9]{32}$' OR v_attempt2 !~ '^SW-[A-F0-9]{32}$' THEN
    RAISE EXCEPTION 'legacy attempts do not have separate immutable internal keys';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_reservations WHERE reference=v_ref AND status='active' AND expires_at>now()) THEN
    RAISE EXCEPTION 'expired hold was not revalidated and renewed';
  END IF;
  IF (SELECT status<>'terminal_grace' OR transaction_id<>'TX-LEGACY-002' FROM public.storefront_wompi_checkout_locks WHERE reference=v_ref) THEN
    RAISE EXCEPTION 'same-reference lock was not preserved';
  END IF;

  -- Idempotent repeat does not add order/attempt rows.
  v_result:=public.recover_storefront_wompi_legacy_order(v_ref,v_hash,'',v_attempts);
  IF v_result->>'success'<>'true' OR v_result->>'idempotent'<>'true'
     OR (SELECT count(*)<>2 FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_ref) THEN
    RAISE EXCEPTION 'recovery repeat was not idempotent: %',v_result;
  END IF;

  -- The same order can now proceed to a new (third) unique payment attempt.
  v_result:=public.prepare_storefront_wompi_retry_lock(v_ref,v_phone,v_hash,10);
  IF v_result->>'success'<>'true' THEN RAISE EXCEPTION 'recovered order retry lock failed: %',v_result; END IF;
  UPDATE public.storefront_wompi_checkout_locks SET checkout_claimed_at=now() WHERE reference=v_ref;
  v_quote:=public.get_storefront_cart_quote_with_coupon(v_items,'Ciudad Scratch','','','');
  v_result:=public.begin_storefront_wompi_payment_attempt(v_ref,'Comprador sintético',v_phone,'Ciudad Scratch','Dirección Scratch','',v_quote,v_hash,false);
  IF v_result->>'success'<>'true' OR v_result->>'attempt_number'<>'3' THEN RAISE EXCEPTION 'third attempt did not reuse order: %',v_result; END IF;
  v_attempt3:=v_result->>'attempt_reference';
  IF (SELECT count(*)<>1 FROM public.orders WHERE reference=v_ref) OR
     (SELECT is_legacy OR wompi_reference<>attempt_reference FROM public.storefront_wompi_payment_attempts WHERE attempt_reference=v_attempt3) THEN
    RAISE EXCEPTION 'new Wompi attempt did not keep unique reference or duplicated order';
  END IF;
  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt3,'TX-LEGACY-003','PENDING',1500000,'COP','prod');
  IF v_result->>'success'<>'true' OR v_result->>'is_current'<>'true' THEN RAISE EXCEPTION 'new current attempt not accepted: %',v_result; END IF;
  UPDATE public.orders SET payment_status='PENDING',transaction_id='TX-LEGACY-003' WHERE reference=v_ref;
  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt1,'TX-LEGACY-001','APPROVED',1500000,'COP','prod');
  IF v_result->>'success'<>'true' OR v_result->>'status'<>'APPROVED_LATE' OR v_result->>'is_current'<>'false' THEN
    RAISE EXCEPTION 'late legacy webhook was not isolated: %',v_result;
  END IF;
  IF (SELECT payment_status<>'PENDING' OR transaction_id<>'TX-LEGACY-003' OR NOT wompi_reconciliation_required
      FROM public.orders WHERE reference=v_ref) THEN RAISE EXCEPTION 'late legacy webhook overwrote new payment'; END IF;
  IF (SELECT count(*)<>1 FROM public.inventory_reservations WHERE reference=v_ref AND status='active') THEN
    RAISE EXCEPTION 'late webhook changed the current hold';
  END IF;

  -- A current approved payment remains an idempotent terminal state.
  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt3,'TX-LEGACY-003','APPROVED',1500000,'COP','prod');
  IF v_result->>'success'<>'true' OR v_result->>'status'<>'APPROVED' THEN RAISE EXCEPTION 'current approval transition failed: %',v_result; END IF;
  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt3,'TX-LEGACY-003','APPROVED',1500000,'COP','prod');
  IF v_result->>'success'<>'true' OR v_result->>'idempotent'<>'true' THEN RAISE EXCEPTION 'duplicate approval not idempotent: %',v_result; END IF;

  -- Insufficient stock rolls back imported attempts, order transition, lock and reservations.
  INSERT INTO public.orders(reference,customer_name,phone,city,address,items,subtotal,shipping,total,payment_method,payment_status)
    VALUES(v_fail_ref,'Comprador sintético',v_fail_phone,'Ciudad Scratch','Dirección Scratch',v_items,10000,5000,15000,'wompi','PENDING');
  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at)
    VALUES(v_fail_ref,encode(extensions.digest(v_fail_phone,'sha256'),'hex'),v_hash,'active',now()-interval '1 minute');
  INSERT INTO public.inventory_reservations(reference,product_id,quantity,color,size,expires_at,status)
    VALUES(v_fail_ref,v_product,1,'Negro','M',now()-interval '1 minute','RELEASED');
  UPDATE public.scratch_recovery_control SET allow_reserve=false;
  v_result:=public.recover_storefront_wompi_legacy_order(v_fail_ref,v_hash,'',
    jsonb_build_array(
      jsonb_build_object('transaction_id','TX-FAIL-001','reference',v_fail_ref,'amount_in_cents',1500000,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '17 minutes'),
      jsonb_build_object('transaction_id','TX-FAIL-002','reference',v_fail_ref,'amount_in_cents',1500000,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '16 minutes')));
  UPDATE public.scratch_recovery_control SET allow_reserve=true;
  IF v_result->>'success'<>'false' OR v_result->>'code'<>'WOMPI_INVENTORY_INSUFFICIENT'
     OR (SELECT count(*)<>0 FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_fail_ref)
     OR (SELECT payment_status<>'PENDING' OR transaction_id IS NOT NULL FROM public.orders WHERE reference=v_fail_ref)
     OR NOT EXISTS (SELECT 1 FROM public.inventory_reservations WHERE reference=v_fail_ref AND status='RELEASED') THEN
    RAISE EXCEPTION 'insufficient inventory left partial recovery writes: %',v_result;
  END IF;

  -- Amount mismatch, PENDING and APPROVED are rejected before writes.
  INSERT INTO public.orders(reference,customer_name,phone,city,address,items,subtotal,shipping,total,payment_method,payment_status)
    VALUES(v_price_ref,'Comprador sintético',v_price_phone,'Ciudad Scratch','Dirección Scratch',v_items,10000,5000,15000,'wompi','PENDING');
  v_result:=public.recover_storefront_wompi_legacy_order(v_price_ref,v_hash,'',
    jsonb_build_array(
      jsonb_build_object('transaction_id','TX-PRICE-001','reference',v_price_ref,'amount_in_cents',1499900,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '17 minutes'),
      jsonb_build_object('transaction_id','TX-PRICE-002','reference',v_price_ref,'amount_in_cents',1500000,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '16 minutes')));
  IF v_result->>'success'<>'false' OR (SELECT count(*)<>0 FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_price_ref)
     OR (SELECT payment_status<>'PENDING' OR transaction_id IS NOT NULL FROM public.orders WHERE reference=v_price_ref) THEN
    RAISE EXCEPTION 'amount mismatch caused partial writes: %',v_result;
  END IF;
  v_result:=public.recover_storefront_wompi_legacy_order(v_price_ref,v_hash,'',
    jsonb_build_array(
      jsonb_build_object('transaction_id','TX-PENDING-001','reference',v_price_ref,'amount_in_cents',1500000,'currency','COP','status','PENDING','environment','prod','terminal_at',now()-interval '17 minutes'),
      jsonb_build_object('transaction_id','TX-PENDING-002','reference',v_price_ref,'amount_in_cents',1500000,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '16 minutes')));
  IF v_result->>'success'<>'false' OR (SELECT count(*)<>0 FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_price_ref) THEN
    RAISE EXCEPTION 'PENDING transaction was not rejected before writes: %',v_result;
  END IF;
  v_result:=public.recover_storefront_wompi_legacy_order(v_price_ref,v_hash,'',
    jsonb_build_array(
      jsonb_build_object('transaction_id','TX-APPROVED-001','reference',v_price_ref,'amount_in_cents',1500000,'currency','COP','status','APPROVED','environment','prod','terminal_at',now()-interval '17 minutes'),
      jsonb_build_object('transaction_id','TX-APPROVED-002','reference',v_price_ref,'amount_in_cents',1500000,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '16 minutes')));
  IF v_result->>'success'<>'false' OR (SELECT count(*)<>0 FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_price_ref) THEN
    RAISE EXCEPTION 'APPROVED transaction was not rejected before writes: %',v_result;
  END IF;

  -- Coupon reopens only for the exact second verified terminal attempt; a later coupon failure rolls back all writes.
  INSERT INTO public.storefront_coupons(id,code,enabled,global_limit,per_customer_limit)
    VALUES(v_coupon_id,'LEGACY5',true,5,1);
  v_coupon_items:=jsonb_build_array(jsonb_build_object('id',v_product,'qty',1,'color','Negro','size','M','price',10000,
    'original_subtotal',10000,'discount_total',5000,'net_subtotal',5000,'coupon_discount_total',5000));
  INSERT INTO public.orders(reference,customer_name,phone,city,address,items,subtotal,shipping,total,coupon_id,coupon_code,coupon_discount_total,payment_method,payment_status)
    VALUES(v_coupon_ref,'Comprador sintético',v_coupon_phone,'Ciudad Scratch','Dirección Scratch',v_coupon_items,10000,5000,10000,v_coupon_id,'LEGACY5',5000,'wompi','PENDING');
  INSERT INTO public.storefront_coupon_redemptions(coupon_id,code,channel,reference,customer_hash,discount_total,status,expires_at)
    VALUES(v_coupon_id,'LEGACY5','wompi',v_coupon_ref,public._storefront_coupon_customer_hash('buyer@example.test',v_coupon_phone),5000,'released',now()-interval '1 minute');
  v_coupon_attempts:=jsonb_build_array(
    jsonb_build_object('transaction_id','TX-LEGACY-COUPON-001','reference',v_coupon_ref,'amount_in_cents',1000000,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '17 minutes'),
    jsonb_build_object('transaction_id','TX-LEGACY-COUPON-002','reference',v_coupon_ref,'amount_in_cents',1000000,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '16 minutes'));
  v_result:=public.recover_storefront_wompi_legacy_order(v_coupon_ref,v_hash,'buyer@example.test',v_coupon_attempts);
  IF v_result->>'success'<>'true' OR (SELECT status<>'reserved' OR released_attempt_reference IS NOT NULL
       FROM public.storefront_coupon_redemptions WHERE reference=v_coupon_ref) THEN
    RAISE EXCEPTION 'coupon recovery failed or was not reopened: %',v_result;
  END IF;
  INSERT INTO public.orders(reference,customer_name,phone,city,address,items,subtotal,shipping,total,coupon_id,coupon_code,coupon_discount_total,payment_method,payment_status)
    VALUES(v_coupon_fail_ref,'Comprador sintético',v_coupon_fail_phone,'Ciudad Scratch','Dirección Scratch',v_coupon_items,10000,5000,10000,v_coupon_id,'LEGACY5',5000,'wompi','PENDING');
  INSERT INTO public.storefront_coupon_redemptions(coupon_id,code,channel,reference,customer_hash,discount_total,status,expires_at)
    VALUES(v_coupon_id,'LEGACY5','wompi',v_coupon_fail_ref,public._storefront_coupon_customer_hash('buyer@example.test',v_coupon_fail_phone),5000,'released',now()-interval '1 minute');
  INSERT INTO public.storefront_coupon_redemptions(coupon_id,code,channel,reference,customer_hash,discount_total,status,expires_at)
    VALUES(v_coupon_id,'LEGACY5','cod','WOMPI-LEGACY-COUPON-USED-005',
      public._storefront_coupon_customer_hash('buyer@example.test',v_coupon_fail_phone),5000,'redeemed',now()-interval '1 day');
  v_result:=public.recover_storefront_wompi_legacy_order(v_coupon_fail_ref,v_hash,'buyer@example.test',jsonb_build_array(
    jsonb_build_object('transaction_id','TX-LEGACY-COUPON-FAIL-001','reference',v_coupon_fail_ref,'amount_in_cents',1000000,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '17 minutes'),
    jsonb_build_object('transaction_id','TX-LEGACY-COUPON-FAIL-002','reference',v_coupon_fail_ref,'amount_in_cents',1000000,'currency','COP','status','ERROR','environment','prod','terminal_at',now()-interval '16 minutes')));
  IF v_result->>'success'<>'false' OR v_result->>'code'<>'COUPON_CUSTOMER_LIMIT'
     OR (SELECT count(*)<>0 FROM public.storefront_wompi_payment_attempts WHERE order_reference=v_coupon_fail_ref)
     OR (SELECT payment_status<>'PENDING' OR transaction_id IS NOT NULL FROM public.orders WHERE reference=v_coupon_fail_ref)
     OR (SELECT status<>'released' OR released_attempt_reference IS NOT NULL FROM public.storefront_coupon_redemptions WHERE reference=v_coupon_fail_ref)
     OR EXISTS (SELECT 1 FROM public.inventory_reservations WHERE reference=v_coupon_fail_ref AND status='active' AND expires_at>now()) THEN
    RAISE EXCEPTION 'coupon failure left partial recovery writes: %',v_result;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.storefront_wompi_payment_attempts'::regclass) THEN
    RAISE EXCEPTION 'attempt ledger RLS is not enabled';
  END IF;
  IF has_function_privilege('public','public.recover_storefront_wompi_legacy_order(text,text,text,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.recover_storefront_wompi_legacy_order(text,text,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.recover_storefront_wompi_legacy_order(text,text,text,jsonb)','EXECUTE')
     OR has_function_privilege('service_role','public.recover_storefront_wompi_legacy_order(text,text,text,jsonb)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'legacy recovery RPC grants are not service_role-only';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='recover_storefront_wompi_legacy_order'
        AND (NOT p.prosecdef OR position('search_path=pg_catalog, public, pg_temp' IN coalesce(array_to_string(p.proconfig,','),''))=0)) THEN
    RAISE EXCEPTION 'recovery RPC is missing SECURITY DEFINER or pinned search_path';
  END IF;
  RAISE NOTICE 'PASS: exact two legacy ERRORs, same order/reference, expired hold renewal, idempotent recovery, new attempt 3, stale webhook isolation, current approval idempotency, amount/status mismatch rollback, insufficient stock rollback, coupon revalidation/reopen, coupon failure rollback, RLS/ACL/search_path.';
END $$;
