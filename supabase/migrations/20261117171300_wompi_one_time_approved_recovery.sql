begin;

create or replace function public.recover_storefront_wompi_approved_payment_once(
  p_order_reference text,
  p_wompi_reference text,
  p_transaction_id text,
  p_checkout_request_id uuid,
  p_amount_in_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_attempt public.storefront_wompi_payment_attempts%rowtype;
  v_lock public.storefront_wompi_checkout_locks%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_product public.products%rowtype;
  v_finalized jsonb;
  v_reconciliation_count integer := 0;
  v_reservation_count integer := 0;
  v_other_transaction_count integer := 0;
  v_expires_at timestamptz := now() + interval '10 minutes';
  v_order_id text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_SERVICE_ROLE_REQUIRED');
  end if;

  -- This function is deliberately single-use and hard-bound to the authorized
  -- production purchase. It cannot become a general payment mutation primitive.
  if p_order_reference is distinct from 'JMRES-09940D9B-D81C-4C3D-BAEC-39E0FD7C39A9'
     or p_wompi_reference is distinct from 'SW-A5AE9363E6F14D4E946F1C4ED0F5A9EA'
     or p_transaction_id is distinct from '1538717-1794948766-44060'
     or p_checkout_request_id is distinct from '15f439d0-a737-4b0d-97db-43c3e20538c1'::uuid
     or p_amount_in_cents is distinct from 200000 then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_TARGET_MISMATCH');
  end if;

  perform pg_advisory_xact_lock(hashtext('storefront-wompi-reference:' || p_order_reference));
  perform pg_advisory_xact_lock(hashtext('wompi-approved-recovery:' || p_transaction_id));

  select * into v_order
    from public.orders
   where reference = p_order_reference
     and lower(payment_method) = 'wompi'
   for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_ORDER_NOT_FOUND');
  end if;
  v_order_id := v_order.id::text;

  -- Idempotent terminal replay: never touch stock or reservation again.
  if upper(coalesce(v_order.payment_status, '')) = 'APPROVED'
     and btrim(coalesce(v_order.transaction_id, '')) = p_transaction_id then
    if exists (
      select 1 from public.inventory_reservations
       where reference = p_order_reference and status = 'CONVERTED'
    ) then
      return jsonb_build_object('success', true, 'already_processed', true,
        'order_id', v_order_id, 'reference', p_order_reference,
        'transaction_id', p_transaction_id, 'inventory_processed', false,
        'telegram_trigger_expected', true);
    end if;
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_APPROVED_WITHOUT_CONVERTED_RESERVATION');
  end if;

  if upper(coalesce(v_order.payment_status, '')) <> 'PENDING'
     or nullif(btrim(coalesce(v_order.transaction_id, '')), '') is not null
     or v_order.wompi_reconciliation_required is distinct from true
     or coalesce(v_order.coupon_reconciliation_required, false) then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_ORDER_STATE_CONFLICT');
  end if;
  if round(v_order.total::numeric * 100)::bigint <> p_amount_in_cents then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_AMOUNT_MISMATCH');
  end if;

  select * into v_attempt
    from public.storefront_wompi_payment_attempts
   where attempt_reference = p_wompi_reference
     and order_reference = p_order_reference
     and checkout_request_id = p_checkout_request_id
     and transaction_id = p_transaction_id
     and status = 'APPROVED'
     and environment = 'prod'
     and currency = 'COP'
     and amount_in_cents = p_amount_in_cents
   for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_ATTEMPT_MISMATCH');
  end if;

  select count(*) into v_other_transaction_count
    from public.storefront_wompi_payment_attempts
   where transaction_id = p_transaction_id
     and attempt_reference <> p_wompi_reference;
  if v_other_transaction_count > 0 then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_TRANSACTION_REUSED');
  end if;

  select * into v_lock
    from public.storefront_wompi_checkout_locks
   where reference = p_order_reference
   for update;
  if not found or v_lock.transaction_id is distinct from p_transaction_id
     or v_lock.reconciliation_required is distinct from true then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_LOCK_CONFLICT');
  end if;

  select count(*) into v_reservation_count
    from public.inventory_reservations
   where reference = p_order_reference;
  if v_reservation_count <> 1 then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_RESERVATION_COUNT_INVALID');
  end if;
  select * into v_reservation
    from public.inventory_reservations
   where reference = p_order_reference
   for update;
  if upper(coalesce(v_reservation.status, '')) <> 'EXPIRED'
     or v_reservation.quantity <> 1 then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_RESERVATION_STATE_CONFLICT');
  end if;
  select * into v_product from public.products where id = v_reservation.product_id for update;
  if not found or v_product.code <> 'COR-038' or coalesce(v_product.quantity, 0) < v_reservation.quantity then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_STOCK_INSUFFICIENT');
  end if;
  if jsonb_typeof(v_order.items) is distinct from 'array'
     or jsonb_array_length(v_order.items) <> 1
     or v_order.items->0->>'id' <> v_product.id::text
     or coalesce((v_order.items->0->>'qty')::integer, (v_order.items->0->>'quantity')::integer, 0) <> 1
     or v_order.items->0->>'code' <> 'COR-038' then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_ORDER_ITEMS_MISMATCH');
  end if;

  -- Renew the same reservation row, then use the existing atomic finalizer.
  update public.inventory_reservations
     set status = 'active', expires_at = v_expires_at
   where id = v_reservation.id
     and status = 'EXPIRED';
  if not found then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_RESERVATION_RENEWAL_RACE');
  end if;

  v_finalized := public.finalize_inventory_reservation(p_order_reference);
  if coalesce((v_finalized->>'success')::boolean, false) is distinct from true then
    raise exception using errcode = 'P0001', message = 'WOMPI_RECOVERY_INVENTORY_FINALIZE_FAILED';
  end if;

  update public.orders
     set payment_status = 'APPROVED',
         transaction_id = p_transaction_id,
         wompi_reconciliation_required = false,
         updated_at = now()
   where reference = p_order_reference
     and upper(payment_status) = 'PENDING'
     and transaction_id is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'WOMPI_RECOVERY_ORDER_UPDATE_RACE';
  end if;

  update public.storefront_wompi_checkout_locks
     set status = 'completed',
         transaction_id = p_transaction_id,
         reconciliation_required = false,
         checkout_claimed_at = null,
         updated_at = now()
   where reference = p_order_reference;

  update public.sirevya_wompi_inventory_reconciliation
     set reconciliation_status = 'RESOLVED',
         resolved_at = now(),
         last_seen_at = now()
   where transaction_id = p_transaction_id
     and reference = p_order_reference
     and verified_wompi_status = 'APPROVED';
  get diagnostics v_reconciliation_count = row_count;
  if v_reconciliation_count <> 1 then
    raise exception using errcode = 'P0001', message = 'WOMPI_RECOVERY_RECONCILIATION_ROW_INVALID';
  end if;

  return jsonb_build_object(
    'success', true,
    'already_processed', false,
    'order_id', v_order_id,
    'reference', p_order_reference,
    'transaction_id', p_transaction_id,
    'inventory_processed', true,
    'reservation_converted', true,
    'reconciliation_resolved', true,
    'telegram_trigger_expected', true
  );
exception when others then
  return jsonb_build_object('success', false, 'code', 'WOMPI_RECOVERY_ROLLED_BACK', 'message', 'No se completó la recuperación; la transacción fue revertida.');
end;
$$;

revoke all on function public.recover_storefront_wompi_approved_payment_once(text, text, text, uuid, bigint) from public;
grant execute on function public.recover_storefront_wompi_approved_payment_once(text, text, text, uuid, bigint) to service_role;

commit;
