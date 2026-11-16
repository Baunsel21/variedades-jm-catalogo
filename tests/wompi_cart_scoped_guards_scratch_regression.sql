-- Synthetic-only regression for 20261116092000_wompi_cart_scoped_checkout_guards.sql.
-- Must run only after the scratch setup plus migrations 20261116070000 and 20261116090000.
DO $test$
DECLARE
  v_result jsonb;
  v_phone text;
  v_phone_hash text;
  v_cart_a text := repeat('a',64);
  v_cart_b text := repeat('b',64);
  v_cart_c text := repeat('c',64);
  v_cart_d text := repeat('d',64);
  v_cart_e text := repeat('e',64);
  v_tx text;
  v_terminal_at timestamptz := now()-interval '30 minutes';
  v_function regprocedure;
  v_is_definer boolean;
  v_config text[];
BEGIN
  -- A live lock for cart A must not block a distinct cart for the same phone,
  -- while a second reference for cart A remains blocked.
  v_phone := '3000000071';
  v_result := public.reserve_storefront_wompi_checkout_lock('SCRATCH-ACTIVE-CART-A',v_phone,v_cart_a,10);
  IF coalesce((v_result->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: initial active lock was not created: %',v_result;
  END IF;
  v_result := public.reserve_storefront_wompi_checkout_lock('SCRATCH-ACTIVE-CART-B',v_phone,v_cart_b,10);
  IF coalesce((v_result->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: a live different-cart lock blocked the same customer: %',v_result;
  END IF;
  v_result := public.reserve_storefront_wompi_checkout_lock('SCRATCH-ACTIVE-CART-A-2',v_phone,v_cart_a,10);
  IF coalesce((v_result->>'success')::boolean,false) OR v_result->>'code'<>'WOMPI_ACTIVE_OTHER_CART' THEN
    RAISE EXCEPTION 'FAIL: active lock for the same cart did not block a second reference: %',v_result;
  END IF;

  -- A separate pending order/attempt on cart C is ignored for cart D but remains
  -- protected for cart C, even when its lease expires.
  v_phone := '3000000072';
  v_phone_hash := encode(extensions.digest(v_phone,'sha256'),'hex');
  v_tx := 'TX-SCRATCH-PENDING-CART-C';
  INSERT INTO public.orders(reference,phone,payment_method,payment_status,transaction_id,items,subtotal,shipping,total)
  VALUES('SCRATCH-PENDING-CART-C',v_phone,'wompi','PENDING',v_tx,
    '[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-000000000001","qty":1,"color":"azul","size":"s"}]'::jsonb,1000,0,1000);
  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at,transaction_id)
  VALUES('SCRATCH-PENDING-CART-C',v_phone_hash,v_cart_c,'pending',now()-interval '1 minute',v_tx);
  INSERT INTO public.storefront_wompi_payment_attempts(
    attempt_reference,wompi_reference,order_reference,attempt_number,environment,amount_in_cents,currency,
    cart_hash,customer_phone_hash,status,transaction_id
  ) VALUES('SW-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC','SW-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    'SCRATCH-PENDING-CART-C',1,'prod',100000,'COP',v_cart_c,v_phone_hash,'PENDING',v_tx);
  v_result := public.reserve_storefront_wompi_checkout_lock('SCRATCH-NEW-CART-D',v_phone,v_cart_d,10);
  IF coalesce((v_result->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: different cart was blocked by an older pending order/attempt: %',v_result;
  END IF;
  v_result := public.reserve_storefront_wompi_checkout_lock('SCRATCH-RETRY-CART-C',v_phone,v_cart_c,10);
  IF coalesce((v_result->>'success')::boolean,false) OR v_result->>'code'<>'WOMPI_TRANSACTION_PENDING' THEN
    RAISE EXCEPTION 'FAIL: same-cart pending transaction did not remain protected: %',v_result;
  END IF;

  -- Reconciliation flags on another known cart do not block this new cart, but
  -- continue to block the exact cart needing reconciliation.
  v_phone := '3000000073';
  v_phone_hash := encode(extensions.digest(v_phone,'sha256'),'hex');
  INSERT INTO public.orders(reference,phone,payment_method,payment_status,transaction_id,items,subtotal,shipping,total,wompi_reconciliation_required)
  VALUES('SCRATCH-RECON-CART-E',v_phone,'wompi','PENDING','TX-SCRATCH-RECON-E',
    '[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-000000000002","qty":1,"color":"rojo","size":"m"}]'::jsonb,1000,0,1000,true);
  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at,transaction_id,reconciliation_required)
  VALUES('SCRATCH-RECON-CART-E',v_phone_hash,v_cart_e,'pending',now()-interval '1 minute','TX-SCRATCH-RECON-E',true);
  v_result := public.reserve_storefront_wompi_checkout_lock('SCRATCH-RECON-NEW-CART-D',v_phone,v_cart_d,10);
  IF coalesce((v_result->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: reconciliation of a different cart blocked a separate purchase: %',v_result;
  END IF;
  v_result := public.reserve_storefront_wompi_checkout_lock('SCRATCH-RECON-SAME-CART-E',v_phone,v_cart_e,10);
  IF coalesce((v_result->>'success')::boolean,false) OR v_result->>'code'<>'WOMPI_RECONCILIATION_REQUIRED' THEN
    RAISE EXCEPTION 'FAIL: same-cart reconciliation was not preserved: %',v_result;
  END IF;

  -- APPROVED payment history on another known cart remains recorded and does not
  -- block a separate purchase; APPROVED on the exact cart still blocks duplicates.
  v_phone := '3000000075';
  v_phone_hash := encode(extensions.digest(v_phone,'sha256'),'hex');
  v_tx := 'TX-SCRATCH-APPROVED-CART-A';
  INSERT INTO public.orders(reference,phone,payment_method,payment_status,transaction_id,items,subtotal,shipping,total)
  VALUES('SCRATCH-APPROVED-CART-A',v_phone,'wompi','APPROVED',v_tx,
    '[{"id":"cccccccc-cccc-4ccc-8ccc-000000000003","qty":1,"color":"negro","size":"m"}]'::jsonb,1000,0,1000);
  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at,transaction_id)
  VALUES('SCRATCH-APPROVED-CART-A',v_phone_hash,v_cart_a,'completed',now(),v_tx);
  INSERT INTO public.storefront_wompi_payment_attempts(
    attempt_reference,wompi_reference,order_reference,attempt_number,environment,amount_in_cents,currency,
    cart_hash,customer_phone_hash,status,transaction_id
  ) VALUES('SW-EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE','SW-EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
    'SCRATCH-APPROVED-CART-A',1,'prod',100000,'COP',v_cart_a,v_phone_hash,'APPROVED',v_tx);
  v_result := public.reserve_storefront_wompi_checkout_lock('SCRATCH-APPROVED-NEW-CART-B',v_phone,v_cart_b,10);
  IF coalesce((v_result->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: APPROVED order on another cart blocked a separate purchase: %',v_result;
  END IF;
  v_result := public.reserve_storefront_wompi_checkout_lock('SCRATCH-APPROVED-SAME-CART-A-2',v_phone,v_cart_a,10);
  IF coalesce((v_result->>'success')::boolean,false) OR v_result->>'code'<>'WOMPI_ALREADY_APPROVED' THEN
    RAISE EXCEPTION 'FAIL: APPROVED order on the same cart did not block a duplicate payment: %',v_result;
  END IF;

  -- A verified terminal retry is still tied to its original order/cart; an active
  -- lock for another cart of the same customer does not prevent the retry.
  v_phone := '3000000074';
  v_phone_hash := encode(extensions.digest(v_phone,'sha256'),'hex');
  v_tx := 'TX-SCRATCH-TERMINAL-A';
  INSERT INTO public.orders(reference,phone,payment_method,payment_status,transaction_id,items,subtotal,shipping,total)
  VALUES('SCRATCH-TERMINAL-CART-A',v_phone,'wompi','ERROR',v_tx,
    '[{"id":"cccccccc-cccc-4ccc-8ccc-000000000003","qty":1,"color":"negro","size":"m"}]'::jsonb,1000,0,1000);
  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at,transaction_id,terminal_at)
  VALUES('SCRATCH-TERMINAL-CART-A',v_phone_hash,v_cart_a,'released',v_terminal_at,v_tx,v_terminal_at);
  INSERT INTO public.storefront_wompi_payment_attempts(
    attempt_reference,wompi_reference,order_reference,attempt_number,environment,amount_in_cents,currency,
    cart_hash,customer_phone_hash,status,transaction_id,verified_at,terminal_at
  ) VALUES('SW-DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD','SW-DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    'SCRATCH-TERMINAL-CART-A',1,'prod',100000,'COP',v_cart_a,v_phone_hash,'ERROR',v_tx,v_terminal_at,v_terminal_at);
  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at)
  VALUES('SCRATCH-OTHER-ACTIVE-CART-B',v_phone_hash,v_cart_b, 'active',now()+interval '10 minutes');
  v_result := public.prepare_storefront_wompi_retry_lock('SCRATCH-TERMINAL-CART-A',v_phone,v_cart_a,10);
  IF coalesce((v_result->>'success')::boolean,false) IS NOT TRUE
     OR v_result->>'reference'<>'SCRATCH-TERMINAL-CART-A' THEN
    RAISE EXCEPTION 'FAIL: verified terminal retry was blocked by a separate cart: %',v_result;
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.reserve_storefront_wompi_checkout_lock(text,text,text,integer)'::regprocedure,
    'public.prepare_storefront_wompi_retry_lock(text,text,text,integer)'::regprocedure
  ] LOOP
    SELECT p.prosecdef,p.proconfig INTO v_is_definer,v_config FROM pg_catalog.pg_proc p WHERE p.oid=v_function;
    IF v_is_definer IS NOT TRUE OR NOT coalesce(array_to_string(v_config,',') LIKE '%search_path=pg_catalog, public, pg_temp%',false) THEN
      RAISE EXCEPTION 'FAIL: SECURITY DEFINER/search_path changed for %: %, %',v_function,v_is_definer,v_config;
    END IF;
    IF has_function_privilege('anon',v_function,'EXECUTE') OR
       has_function_privilege('authenticated',v_function,'EXECUTE') OR
       NOT has_function_privilege('service_role',v_function,'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: unexpected function ACL for %',v_function;
    END IF;
  END LOOP;
END;
$test$;

SELECT 'PASS: different carts for same phone are isolated; same-cart pending/APPROVED/reconciliation/active locks remain blocked; verified retry reuses the original order and ignores unrelated active carts; SECURITY DEFINER/search_path/service_role ACL preserved.' AS result;
