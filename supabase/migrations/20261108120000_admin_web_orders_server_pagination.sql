-- Server-side paging for the administrative COD list. This RPC does not join Wompi,
-- sales or inventory and does not mutate orders or reservations.
DO $preflight$
DECLARE
  v_missing text[];
  v_id_type oid;
  v_status_type oid;
  v_created_at_type oid;
  v_orders_rls_enabled boolean;
  v_admin_read_policy boolean;
  v_unsafe_read_policy boolean;
BEGIN
  IF to_regclass('public.web_orders') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.web_orders is required';
  END IF;
  IF to_regprocedure('public.is_store_admin()') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.is_store_admin() is required';
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO v_missing
  FROM (VALUES
    ('id'),('status'),('created_at'),('customer_name'),('customer_phone'),('customer_email'),
    ('customer_city'),('customer_address'),('customer_neighborhood'),('payment_method'),
    ('subtotal'),('shipping'),('total'),('items')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute AS a
    WHERE a.attrelid='public.web_orders'::regclass
      AND a.attname=required.column_name AND a.attnum>0 AND NOT a.attisdropped
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.web_orders is missing required columns: %',array_to_string(v_missing,', ');
  END IF;

  SELECT a.atttypid INTO v_id_type FROM pg_attribute AS a
   WHERE a.attrelid='public.web_orders'::regclass AND a.attname='id'
     AND a.attnum>0 AND NOT a.attisdropped LIMIT 1;
  SELECT a.atttypid INTO v_status_type FROM pg_attribute AS a
   WHERE a.attrelid='public.web_orders'::regclass AND a.attname='status'
     AND a.attnum>0 AND NOT a.attisdropped LIMIT 1;
  SELECT a.atttypid INTO v_created_at_type FROM pg_attribute AS a
   WHERE a.attrelid='public.web_orders'::regclass AND a.attname='created_at'
     AND a.attnum>0 AND NOT a.attisdropped LIMIT 1;
  IF v_id_type IS DISTINCT FROM 'uuid'::regtype::oid
     OR v_status_type IS DISTINCT FROM 'text'::regtype::oid
     OR v_created_at_type IS DISTINCT FROM 'timestamptz'::regtype::oid THEN
    RAISE EXCEPTION 'Preflight failed: web_orders requires id uuid, status text and created_at timestamptz';
  END IF;

  SELECT c.relrowsecurity INTO v_orders_rls_enabled
  FROM pg_class AS c WHERE c.oid='public.web_orders'::regclass LIMIT 1;
  SELECT EXISTS(
    SELECT 1 FROM pg_policies AS p
    WHERE p.schemaname='public' AND p.tablename='web_orders' AND p.cmd='SELECT'
      AND p.roles @> ARRAY['authenticated']::name[]
      AND position('is_store_admin' IN coalesce(p.qual,''))>0
  ) INTO v_admin_read_policy;
  SELECT EXISTS(
    SELECT 1 FROM pg_policies AS p
    WHERE p.schemaname='public' AND p.tablename='web_orders' AND p.cmd='SELECT'
      AND (p.roles @> ARRAY['public']::name[] OR p.roles @> ARRAY['anon']::name[] OR p.roles @> ARRAY['authenticated']::name[])
      AND (p.qual IS NULL OR position('is_store_admin' IN p.qual)=0)
  ) INTO v_unsafe_read_policy;
  IF v_orders_rls_enabled IS DISTINCT FROM true
     OR v_admin_read_policy IS DISTINCT FROM true
     OR v_unsafe_read_policy IS DISTINCT FROM false
     OR has_table_privilege('authenticated','public.web_orders','SELECT') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Preflight failed: legacy web_orders SELECT must remain granted to authenticated but protected by admin-only RLS';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.sirevya_normalize_web_order_filter(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT btrim(regexp_replace(
    regexp_replace(normalize(lower(btrim(coalesce(p_value,''))),NFD),U&'[\0300-\036f]','','g'),
    '[[:space:]]+',' ','g'
  ));
$function$;
REVOKE ALL ON FUNCTION public.sirevya_normalize_web_order_filter(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_list_web_orders_page_v1(
  p_search text DEFAULT '',
  p_status text DEFAULT '',
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_city text DEFAULT '',
  p_payment text DEFAULT '',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_search text;
  v_status text;
  v_city text;
  v_payment text;
  v_page_size integer;
  v_requested_page integer;
  v_result jsonb;
BEGIN
  IF coalesce(public.is_store_admin(),false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'code','ORDERS_PAGE_UNAUTHORIZED','message','No tienes autorización para consultar pedidos.');
  END IF;

  v_search:=public.sirevya_normalize_web_order_filter(p_search);
  v_status:=public.sirevya_normalize_web_order_filter(p_status);
  v_city:=public.sirevya_normalize_web_order_filter(p_city);
  v_payment:=public.sirevya_normalize_web_order_filter(p_payment);
  IF char_length(v_search)>120 OR char_length(v_status)>24 OR char_length(v_city)>120 OR char_length(v_payment)>80 THEN
    RETURN jsonb_build_object('success',false,'code','ORDERS_PAGE_FILTER_INVALID','message','Uno de los filtros supera el tamaño permitido.');
  END IF;
  IF v_status NOT IN ('','pendiente','confirmado','enviado','entregado','rechazado','devuelto') THEN
    RETURN jsonb_build_object('success',false,'code','ORDERS_PAGE_FILTER_INVALID','message','El estado solicitado no es válido.');
  END IF;
  IF p_page_size IS NULL OR p_page_size NOT IN (20,50,100) THEN
    RETURN jsonb_build_object('success',false,'code','ORDERS_PAGE_SIZE_INVALID','message','El tamaño de página debe ser 20, 50 o 100.');
  END IF;

  v_page_size:=p_page_size;
  v_requested_page:=greatest(coalesce(p_page,1),1);

  WITH base AS MATERIALIZED (
    SELECT w.id,w.customer_name,w.customer_phone,w.customer_email,w.customer_city,
           w.customer_address,w.customer_neighborhood,w.payment_method,w.subtotal,
           w.shipping,w.total,w.items,w.status,w.created_at
    FROM public.web_orders AS w
  ), filtered AS MATERIALIZED (
    SELECT b.* FROM base AS b
    WHERE (v_status='' OR public.sirevya_normalize_web_order_filter(b.status)=v_status)
      AND (v_city='' OR public.sirevya_normalize_web_order_filter(b.customer_city)=v_city)
      AND (v_payment='' OR public.sirevya_normalize_web_order_filter(b.payment_method)=v_payment)
      AND (p_from_date IS NULL OR b.created_at >= (p_from_date::timestamp AT TIME ZONE 'America/Bogota'))
      AND (p_to_date IS NULL OR b.created_at < ((p_to_date+1)::timestamp AT TIME ZONE 'America/Bogota'))
      AND (v_search='' OR strpos(public.sirevya_normalize_web_order_filter(concat_ws(' ',b.customer_name,b.customer_phone,b.customer_email,b.customer_city,b.customer_address,b.payment_method,b.status,b.id::text)),v_search)>0)
  ), filtered_count AS (
    SELECT count(*)::bigint AS total FROM filtered
  ), page_bounds AS (
    SELECT total,
           greatest(1,ceil(total::numeric/v_page_size)::integer) AS total_pages,
           least(v_requested_page,greatest(1,ceil(total::numeric/v_page_size)::integer)) AS page
    FROM filtered_count
  ), page_rows AS (
    SELECT f.* FROM filtered AS f CROSS JOIN page_bounds AS bounds
    ORDER BY f.created_at DESC NULLS LAST,f.id ASC
    LIMIT v_page_size
    OFFSET ((bounds.page-1)::bigint*v_page_size)
  ), global_counts AS (
    SELECT count(*)::bigint AS total,
           count(*) FILTER (WHERE public.sirevya_normalize_web_order_filter(b.status)='pendiente')::bigint AS pending,
           count(*) FILTER (WHERE public.sirevya_normalize_web_order_filter(b.status)='confirmado')::bigint AS confirmed,
           count(*) FILTER (WHERE public.sirevya_normalize_web_order_filter(b.status)='entregado')::bigint AS delivered
    FROM base AS b
  ), city_values AS (
    SELECT public.sirevya_normalize_web_order_filter(b.customer_city) AS value,
           min(btrim(b.customer_city)) AS label
    FROM base AS b WHERE nullif(btrim(b.customer_city),'') IS NOT NULL
    GROUP BY public.sirevya_normalize_web_order_filter(b.customer_city)
  ), city_facets AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('value',limited.value,'label',limited.label) ORDER BY limited.value,limited.label),'[]'::jsonb) AS items,
           (SELECT count(*)>200 FROM city_values) AS truncated
    FROM (SELECT value,label FROM city_values ORDER BY value,label LIMIT 200) AS limited
  ), payment_values AS (
    SELECT public.sirevya_normalize_web_order_filter(b.payment_method) AS value,
           min(btrim(b.payment_method)) AS label
    FROM base AS b WHERE nullif(btrim(b.payment_method),'') IS NOT NULL
    GROUP BY public.sirevya_normalize_web_order_filter(b.payment_method)
  ), payment_facets AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('value',limited.value,'label',limited.label) ORDER BY limited.value,limited.label),'[]'::jsonb) AS items,
           (SELECT count(*)>50 FROM payment_values) AS truncated
    FROM (SELECT value,label FROM payment_values ORDER BY value,label LIMIT 50) AS limited
  )
  SELECT jsonb_build_object(
    'success',true,
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY page_rows.created_at DESC NULLS LAST,page_rows.id ASC) FROM page_rows),'[]'::jsonb),
    'total',(SELECT total FROM page_bounds),
    'page',(SELECT page FROM page_bounds),
    'page_size',v_page_size,
    'total_pages',(SELECT total_pages FROM page_bounds),
    'counts',(SELECT jsonb_build_object('total',total,'pending',pending,'confirmed',confirmed,'delivered',delivered) FROM global_counts),
    'cities',(SELECT items FROM city_facets),
    'cities_truncated',(SELECT truncated FROM city_facets),
    'payments',(SELECT items FROM payment_facets),
    'payments_truncated',(SELECT truncated FROM payment_facets),
    'generated_at',statement_timestamp()
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_web_orders_page_v1(text,text,date,date,text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_web_orders_page_v1(text,text,date,date,text,text,integer,integer) TO authenticated;
COMMENT ON FUNCTION public.admin_list_web_orders_page_v1(text,text,date,date,text,text,integer,integer) IS
  'Admin-only server-side page and filters for COD web_orders; returns only order-card fields, global status counts and city/payment facets. No Wompi join, reconciliation or writes.';
