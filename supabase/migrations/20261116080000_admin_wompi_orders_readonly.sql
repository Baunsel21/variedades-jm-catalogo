BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_wompi_orders(
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  reference text,
  created_at timestamptz,
  updated_at timestamptz,
  customer_name text,
  phone text,
  city text,
  address text,
  items jsonb,
  subtotal bigint,
  shipping bigint,
  total bigint,
  payment_method text,
  payment_status text,
  transaction_id text,
  coupon_code text,
  coupon_discount_total bigint,
  wompi_reconciliation_required boolean,
  coupon_reconciliation_required boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF public.is_store_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Administrator authorization required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT o.id, o.reference, o.created_at, o.updated_at,
         o.customer_name, o.phone, o.city, o.address, o.items,
         o.subtotal, o.shipping, o.total, o.payment_method, o.payment_status,
         o.transaction_id, o.coupon_code, o.coupon_discount_total,
         o.wompi_reconciliation_required, o.coupon_reconciliation_required
  FROM public.orders AS o
  WHERE lower(coalesce(o.payment_method, '')) = 'wompi'
  ORDER BY coalesce(o.updated_at, o.created_at) DESC, o.created_at DESC, o.id DESC
  LIMIT least(greatest(coalesce(p_limit, 200), 1), 500)
  OFFSET least(greatest(coalesce(p_offset, 0), 0), 1000000);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_wompi_orders(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_wompi_orders(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_wompi_orders(integer, integer) TO authenticated;

COMMIT;
