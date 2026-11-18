begin;

create or replace function public.record_storefront_wompi_inventory_reconciliation(
  p_transaction_id text,
  p_reference text,
  p_amount_in_cents bigint,
  p_reconciliation_status text,
  p_reason text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_transaction_id text := btrim(coalesce(p_transaction_id, ''));
  v_reference text := btrim(coalesce(p_reference, ''));
  v_status text := upper(btrim(coalesce(p_reconciliation_status, '')));
  v_existing_reference text;
  v_inserted boolean := false;
  v_resolved_at timestamptz;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if v_transaction_id !~ '^[A-Za-z0-9_-]{1,120}$'
     or v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     or p_amount_in_cents is null
     or p_amount_in_cents < 0
     or v_status not in ('NEEDS_REVIEW', 'RESOLVED') then
    return jsonb_build_object('success', false, 'code', 'WOMPI_RECONCILIATION_INPUT_INVALID');
  end if;

  perform pg_advisory_xact_lock(hashtext('wompi-reconciliation-transaction:' || v_transaction_id));

  select r.reference
    into v_existing_reference
    from public.sirevya_wompi_inventory_reconciliation r
   where r.transaction_id = v_transaction_id
   for update;

  if found and v_existing_reference <> v_reference then
    return jsonb_build_object(
      'success', false,
      'code', 'WOMPI_RECONCILIATION_TRANSACTION_REFERENCE_CONFLICT',
      'transaction_id', v_transaction_id,
      'existing_reference', v_existing_reference
    );
  end if;

  if v_status = 'RESOLVED' then
    v_resolved_at := now();
  end if;

  insert into public.sirevya_wompi_inventory_reconciliation (
    transaction_id, reference, amount_in_cents, currency,
    verified_wompi_status, reconciliation_status, reason, details,
    first_seen_at, last_seen_at, resolved_at
  ) values (
    v_transaction_id, v_reference, p_amount_in_cents, 'COP',
    'APPROVED', v_status, left(coalesce(p_reason, ''), 1000), coalesce(p_details, '{}'::jsonb),
    now(), now(), v_resolved_at
  )
  on conflict (transaction_id) do update
    set reference = excluded.reference,
        amount_in_cents = excluded.amount_in_cents,
        currency = excluded.currency,
        verified_wompi_status = excluded.verified_wompi_status,
        reconciliation_status = excluded.reconciliation_status,
        reason = excluded.reason,
        details = coalesce(public.sirevya_wompi_inventory_reconciliation.details, '{}'::jsonb) || excluded.details,
        last_seen_at = now(),
        resolved_at = case when excluded.reconciliation_status = 'RESOLVED' then now() else public.sirevya_wompi_inventory_reconciliation.resolved_at end;

  v_inserted := v_existing_reference is null;

  return jsonb_build_object(
    'success', true,
    'inserted', v_inserted,
    'idempotent', not v_inserted,
    'transaction_id', v_transaction_id,
    'reference', v_reference,
    'reconciliation_status', v_status
  );
end;
$$;

revoke all on function public.record_storefront_wompi_inventory_reconciliation(text, text, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_storefront_wompi_inventory_reconciliation(text, text, bigint, text, text, jsonb) to service_role;

commit;
