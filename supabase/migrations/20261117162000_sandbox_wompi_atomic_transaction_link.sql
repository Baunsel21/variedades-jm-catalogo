begin;

create or replace function public.link_storefront_wompi_transaction(
  p_reference text,
  p_transaction_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_reference text := btrim(coalesce(p_reference, ''));
  v_transaction_id text := btrim(coalesce(p_transaction_id, ''));
  v_existing text;
  v_rows integer := 0;
begin
  if v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     or v_transaction_id !~ '^[A-Za-z0-9_-]{1,120}$' then
    return jsonb_build_object('success', false, 'code', 'WOMPI_TRANSACTION_LINK_INPUT_INVALID');
  end if;

  perform pg_advisory_xact_lock(hashtext('storefront-wompi-reference:' || v_reference));

  select o.transaction_id
    into v_existing
    from public.orders o
   where o.reference = v_reference
     and lower(o.payment_method) = 'wompi'
   for update;

  if not found then
    return jsonb_build_object('success', false, 'code', 'WOMPI_ORDER_NOT_FOUND');
  end if;

  v_existing := btrim(coalesce(v_existing, ''));

  if v_existing <> '' and v_existing <> v_transaction_id then
    return jsonb_build_object(
      'success', false,
      'code', 'WOMPI_TRANSACTION_LINK_CONFLICT',
      'existing_transaction_id', v_existing
    );
  end if;

  if v_existing = v_transaction_id then
    return jsonb_build_object(
      'success', true,
      'linked', true,
      'idempotent', true,
      'reference', v_reference,
      'transaction_id', v_transaction_id
    );
  end if;

  update public.orders
     set transaction_id = v_transaction_id,
         updated_at = now()
   where reference = v_reference
     and lower(payment_method) = 'wompi'
     and (transaction_id is null or btrim(transaction_id) = '');
  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    return jsonb_build_object('success', false, 'code', 'WOMPI_TRANSACTION_LINK_NOT_APPLIED');
  end if;

  return jsonb_build_object(
    'success', true,
    'linked', true,
    'idempotent', false,
    'reference', v_reference,
    'transaction_id', v_transaction_id
  );
end;
$$;

revoke all on function public.link_storefront_wompi_transaction(text, text) from public;
grant execute on function public.link_storefront_wompi_transaction(text, text) to service_role;

commit;
