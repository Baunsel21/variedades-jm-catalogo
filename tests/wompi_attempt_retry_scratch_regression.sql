-- Ejecutar solo después de setup.sql y la migración candidata en una DB scratch.
DO $$
DECLARE
  v_reference text:='WOMPI-RETRY-SCRATCH-001';
  v_phone text:='3001234567';
  v_hash text:=repeat('a',64);
  v_phone_hash text:=encode(extensions.digest('3001234567','sha256'),'hex');
  v_product uuid:='11111111-1111-4111-8111-111111111111';
  v_items jsonb;
  v_quote jsonb;
  v_result jsonb;
  v_attempt1 text;
  v_attempt2 text;
  v_coupon_id uuid;
  v_coupon_ref text:='WOMPI-RETRY-SCRATCH-COUPON';
  v_coupon_phone text:='3007654321';
  v_coupon_phone_hash text:=encode(extensions.digest('3007654321','sha256'),'hex');
  v_coupon_hash text;
BEGIN
  v_items:=jsonb_build_array(jsonb_build_object(
    'id',v_product,'qty',1,'color','Negro','size','M','price',10000,
    'original_subtotal',10000,'discount_total',0,'net_subtotal',10000,'coupon_discount_total',0
  ));
  v_quote:=jsonb_build_object('success',true,'items',v_items,'original_subtotal',10000,
    'discounted_subtotal',10000,'discount_total',0,'coupon_discount_total',0,
    'shipping',5000,'total',15000,'coupon_id',NULL,'coupon_code',NULL,'currency','COP');

  INSERT INTO public.orders(reference,customer_name,phone,city,address,neighborhood,items,subtotal,shipping,total,
    coupon_discount_total,payment_method,payment_status)
  VALUES(v_reference,'Comprador sintético',v_phone,'Ciudad Scratch','Dirección Scratch','',v_items,10000,5000,15000,0,'wompi','PENDING');
  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at,checkout_claimed_at)
  VALUES(v_reference,v_phone_hash,v_hash,'active',now()+interval '10 minutes',now());
  INSERT INTO public.inventory_reservations(reference,product_id,quantity,color,size,expires_at,status)
  VALUES(v_reference,v_product,1,'Negro','M',now()+interval '10 minutes','active');

  v_result:=public.begin_storefront_wompi_payment_attempt(v_reference,'Comprador sintético',v_phone,
    'Ciudad Scratch','Dirección Scratch','',v_quote,v_hash,true);
  IF v_result->>'success'<>'true' OR v_result->>'attempt_number'<>'1' THEN
    RAISE EXCEPTION 'initial attempt did not start: %',v_result;
  END IF;
  v_attempt1:=v_result->>'attempt_reference';
  IF v_attempt1 !~ '^SW-[A-F0-9]{32}$' THEN RAISE EXCEPTION 'invalid unique attempt reference: %',v_attempt1; END IF;

  v_result:=public.begin_storefront_wompi_payment_attempt(v_reference,'Comprador sintético',v_phone,
    'Ciudad Scratch','Dirección Scratch','',v_quote,v_hash,false);
  IF v_result->>'code'<>'WOMPI_ATTEMPT_UNRESOLVED' THEN
    RAISE EXCEPTION 'unverified INITIATED attempt was not blocked: %',v_result;
  END IF;

  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt1,'TX-SCRATCH-001','PENDING',1500000,'COP','prod');
  IF v_result->>'success'<>'true' OR v_result->>'is_current'<>'true' OR v_result->>'status'<>'PENDING' THEN
    RAISE EXCEPTION 'PENDING transition failed: %',v_result;
  END IF;
  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt1,'TX-SCRATCH-001','ERROR',1500000,'COP','prod');
  IF v_result->>'success'<>'true' OR v_result->>'status'<>'ERROR' THEN
    RAISE EXCEPTION 'ERROR transition failed: %',v_result;
  END IF;
  UPDATE public.orders SET payment_status='ERROR',transaction_id='TX-SCRATCH-001' WHERE reference=v_reference;
  UPDATE public.storefront_wompi_checkout_locks SET status='terminal_grace',transaction_id='TX-SCRATCH-001',
    terminal_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' WHERE reference=v_reference;
  UPDATE public.storefront_wompi_payment_attempts SET terminal_at=now()-interval '16 minutes',verified_at=now()-interval '16 minutes'
   WHERE attempt_reference=v_attempt1;
  UPDATE public.inventory_reservations SET status='RELEASED',expires_at=now()-interval '1 minute' WHERE reference=v_reference;

  v_result:=public.prepare_storefront_wompi_retry_lock(v_reference,v_phone,v_hash,10);
  IF v_result->>'success'<>'true' OR v_result->>'retry_after_terminal'<>'true' THEN
    RAISE EXCEPTION 'verified retry lock was not reactivated after grace: %',v_result;
  END IF;
  IF (SELECT transaction_id IS NOT NULL OR status<>'active' FROM public.storefront_wompi_checkout_locks WHERE reference=v_reference) THEN
    RAISE EXCEPTION 'lock was not reset for a new attempt';
  END IF;
  INSERT INTO public.inventory_reservations(reference,product_id,quantity,color,size,expires_at,status)
  VALUES(v_reference,v_product,1,'Negro','M',now()+interval '10 minutes','active');
  UPDATE public.storefront_wompi_checkout_locks SET checkout_claimed_at=now() WHERE reference=v_reference;

  v_result:=public.begin_storefront_wompi_payment_attempt(v_reference,'Comprador sintético',v_phone,
    'Ciudad Scratch','Dirección Scratch','',v_quote,v_hash,false);
  IF v_result->>'success'<>'true' OR v_result->>'attempt_number'<>'2' THEN
    RAISE EXCEPTION 'retry did not reuse the same order: %',v_result;
  END IF;
  v_attempt2:=v_result->>'attempt_reference';
  IF v_attempt2=v_attempt1 THEN RAISE EXCEPTION 'a retry reused a Wompi transaction reference'; END IF;
  IF (SELECT payment_status<>'PENDING' OR transaction_id IS NOT NULL FROM public.orders WHERE reference=v_reference) THEN
    RAISE EXCEPTION 'retry did not reset only the current payment linkage';
  END IF;

  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt2,'TX-SCRATCH-002','PENDING',1500000,'COP','prod');
  IF v_result->>'success'<>'true' OR v_result->>'is_current'<>'true' OR v_result->>'status'<>'PENDING' THEN
    RAISE EXCEPTION 'current PENDING transition failed: %',v_result;
  END IF;
  UPDATE public.orders SET payment_status='PENDING',transaction_id='TX-SCRATCH-002' WHERE reference=v_reference;
  v_result:=public.begin_storefront_wompi_payment_attempt(v_reference,'Comprador sintético',v_phone,
    'Ciudad Scratch','Dirección Scratch','',v_quote,v_hash,false);
  IF v_result->>'code'<>'WOMPI_TRANSACTION_PENDING' THEN RAISE EXCEPTION 'pending retry was not blocked: %',v_result; END IF;

  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt1,'TX-SCRATCH-001','APPROVED',1500000,'COP','prod');
  IF v_result->>'success'<>'true' OR v_result->>'is_current'<>'false' OR v_result->>'status'<>'APPROVED_LATE'
     OR v_result->>'reconciliation_required'<>'true' THEN
    RAISE EXCEPTION 'late approval was not isolated as stale: %',v_result;
  END IF;
  IF (SELECT payment_status<>'PENDING' OR transaction_id<>'TX-SCRATCH-002' OR NOT wompi_reconciliation_required
      FROM public.orders WHERE reference=v_reference) THEN
    RAISE EXCEPTION 'late old approval overwrote the active order instead of flagging reconciliation';
  END IF;
  IF (SELECT count(*)<>1 FROM public.inventory_reservations WHERE reference=v_reference AND status='active') THEN
    RAISE EXCEPTION 'late approval changed the active inventory reservation';
  END IF;
  v_result:=public.prepare_storefront_wompi_retry_lock(v_reference,v_phone,v_hash,10);
  IF v_result->>'code'<>'WOMPI_RECONCILIATION_REQUIRED' THEN
    RAISE EXCEPTION 'late approval did not block subsequent payment attempts: %',v_result;
  END IF;

  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt2,'TX-SCRATCH-002','APPROVED',1500000,'COP','prod');
  IF v_result->>'success'<>'true' OR v_result->>'is_current'<>'true' OR v_result->>'status'<>'APPROVED' THEN
    RAISE EXCEPTION 'current APPROVED transition failed: %',v_result;
  END IF;
  v_result:=public.transition_storefront_wompi_payment_attempt(v_attempt2,'TX-SCRATCH-002','APPROVED',1500000,'COP','prod');
  IF v_result->>'success'<>'true' OR v_result->>'idempotent'<>'true' THEN
    RAISE EXCEPTION 'duplicate APPROVED event was not idempotent: %',v_result;
  END IF;

  -- Released coupons reopen only for an authenticated, terminal, expired attempt.
  v_coupon_id:=gen_random_uuid();
  INSERT INTO public.storefront_coupons(id,code,enabled,global_limit,per_customer_limit)
  VALUES(v_coupon_id,'RETRY5',true,5,1);
  v_coupon_hash:=public._storefront_coupon_customer_hash('buyer@example.test',v_coupon_phone);
  UPDATE public.orders SET coupon_id=v_coupon_id,coupon_code='RETRY5',coupon_discount_total=5000
   WHERE reference=v_reference;
  -- The coupon helper tests its own order/attempt binding; use a separate matching terminal order.
  INSERT INTO public.orders(reference,customer_name,phone,city,address,neighborhood,items,subtotal,shipping,total,
    coupon_id,coupon_code,coupon_discount_total,payment_method,payment_status,transaction_id)
  VALUES(v_coupon_ref,'Comprador sintético',v_coupon_phone,'Ciudad Scratch','Dirección Scratch','',v_items,20000,5000,20000,
    v_coupon_id,'RETRY5',5000,'wompi','ERROR','TX-COUPON-001');
  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at,
    transaction_id,terminal_at)
  VALUES(v_coupon_ref,v_coupon_phone_hash,repeat('b',64),'terminal_grace',now()-interval '1 minute',
    'TX-COUPON-001',now()-interval '16 minutes');
  INSERT INTO public.storefront_wompi_payment_attempts(attempt_reference,wompi_reference,is_legacy,order_reference,attempt_number,environment,
    amount_in_cents,currency,cart_hash,customer_phone_hash,status,transaction_id,verified_at,terminal_at)
  VALUES('SW-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','SW-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',false,v_coupon_ref,1,'prod',2000000,'COP',repeat('b',64),v_coupon_phone_hash,'ERROR',
    'TX-COUPON-001',now()-interval '16 minutes',now()-interval '16 minutes');
  INSERT INTO public.storefront_coupon_redemptions(coupon_id,code,channel,reference,customer_hash,discount_total,status,
    expires_at)
  VALUES(v_coupon_id,'RETRY5','wompi',v_coupon_ref,v_coupon_hash,5000,'reserved',now()+interval '10 minutes');
  v_result:=public.release_storefront_wompi_coupon_redemption_for_attempt(v_coupon_ref,
    'SW-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  IF v_result->>'success'<>'true' OR v_result->>'status'<>'released' THEN
    RAISE EXCEPTION 'verified attempt did not release its coupon with provenance: %',v_result;
  END IF;
  v_result:=public.reserve_storefront_coupon_redemption('RETRY5','wompi',v_coupon_ref,
    'buyer@example.test',v_coupon_phone,5000,now()+interval '10 minutes');
  IF v_result->>'success'<>'true' OR v_result->>'status'<>'reserved' OR v_result->>'reopened_after_terminal'<>'true' THEN
    RAISE EXCEPTION 'verified terminal coupon was not reopened: %',v_result;
  END IF;
  INSERT INTO public.storefront_coupon_redemptions(coupon_id,code,channel,reference,customer_hash,discount_total,status,expires_at)
  VALUES(v_coupon_id,'RETRY5','wompi','WOMPI-UNVERIFIED-COUPON',v_coupon_hash,5000,'released',now()-interval '1 minute');
  v_result:=public.reserve_storefront_coupon_redemption('RETRY5','wompi','WOMPI-UNVERIFIED-COUPON',
    'buyer@example.test',v_coupon_phone,5000,now()+interval '10 minutes');
  IF v_result->>'success'<>'false' OR v_result->>'code'<>'COUPON_REFERENCE_RELEASED' THEN
    RAISE EXCEPTION 'unverified released coupon was reopened: %',v_result;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.storefront_wompi_payment_attempts'::regclass) THEN
    RAISE EXCEPTION 'attempt table RLS is not enabled';
  END IF;
  IF has_table_privilege('public','public.storefront_wompi_payment_attempts','SELECT')
     OR has_table_privilege('anon','public.storefront_wompi_payment_attempts','SELECT')
     OR has_table_privilege('authenticated','public.storefront_wompi_payment_attempts','SELECT')
     OR has_table_privilege('public','public.storefront_wompi_payment_attempts','INSERT')
     OR has_table_privilege('anon','public.storefront_wompi_payment_attempts','INSERT')
     OR has_table_privilege('authenticated','public.storefront_wompi_payment_attempts','INSERT')
     OR has_table_privilege('service_role','public.storefront_wompi_payment_attempts','INSERT')
     OR has_table_privilege('service_role','public.storefront_wompi_payment_attempts','UPDATE')
     OR has_table_privilege('service_role','public.storefront_wompi_payment_attempts','DELETE') THEN
    RAISE EXCEPTION 'attempt ledger table grants are not least-privilege';
  END IF;
  IF NOT has_table_privilege('service_role','public.storefront_wompi_payment_attempts','SELECT') THEN
    RAISE EXCEPTION 'service_role cannot read attempt ledger';
  END IF;
  IF has_function_privilege('public','public.prepare_storefront_wompi_retry_lock(text,text,text,integer)','EXECUTE')
     OR has_function_privilege('anon','public.prepare_storefront_wompi_retry_lock(text,text,text,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.prepare_storefront_wompi_retry_lock(text,text,text,integer)','EXECUTE')
     OR has_function_privilege('public','public.begin_storefront_wompi_payment_attempt(text,text,text,text,text,text,jsonb,text,boolean)','EXECUTE')
     OR has_function_privilege('anon','public.begin_storefront_wompi_payment_attempt(text,text,text,text,text,text,jsonb,text,boolean)','EXECUTE')
     OR has_function_privilege('authenticated','public.begin_storefront_wompi_payment_attempt(text,text,text,text,text,text,jsonb,text,boolean)','EXECUTE')
     OR has_function_privilege('public','public.transition_storefront_wompi_payment_attempt(text,text,text,bigint,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.transition_storefront_wompi_payment_attempt(text,text,text,bigint,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.transition_storefront_wompi_payment_attempt(text,text,text,bigint,text,text)','EXECUTE')
     OR has_function_privilege('public','public.release_storefront_wompi_coupon_redemption_for_attempt(text,text)','EXECUTE')
     OR has_function_privilege('anon','public.release_storefront_wompi_coupon_redemption_for_attempt(text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.release_storefront_wompi_coupon_redemption_for_attempt(text,text)','EXECUTE')
     OR has_function_privilege('service_role','public.prepare_storefront_wompi_retry_lock(text,text,text,integer)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.begin_storefront_wompi_payment_attempt(text,text,text,text,text,text,jsonb,text,boolean)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.transition_storefront_wompi_payment_attempt(text,text,text,bigint,text,text)','EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('service_role','public.release_storefront_wompi_coupon_redemption_for_attempt(text,text)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'attempt RPC grants are not least-privilege';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('prepare_storefront_wompi_retry_lock','begin_storefront_wompi_payment_attempt',
                         'transition_storefront_wompi_payment_attempt','release_storefront_wompi_coupon_redemption_for_attempt',
                         'reserve_storefront_coupon_redemption')
       AND (NOT p.prosecdef OR position('search_path=pg_catalog, public, pg_temp' IN coalesce(array_to_string(p.proconfig,','),''))=0)
  ) THEN
    RAISE EXCEPTION 'a privileged attempt/coupon RPC is missing SECURITY DEFINER or the pinned search_path';
  END IF;
  RAISE NOTICE 'PASS: first attempt, PENDING, terminal cooldown, same-order retry, unique attempt ref, late approval isolation, duplicate APPROVED idempotency, coupon reopen guards, RLS and least-privilege ACLs.';
END $$;
