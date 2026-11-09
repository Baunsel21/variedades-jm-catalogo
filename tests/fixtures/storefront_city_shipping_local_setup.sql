-- Solo para tests/run_storefront_city_shipping_local.sh en un PostgreSQL local temporal.
-- No contiene datos, credenciales ni configuración de producción.
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$function$;

GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

CREATE TABLE public.store_settings(
  id integer PRIMARY KEY,
  admin_user_id uuid REFERENCES auth.users(id)
);
CREATE TABLE public.storefront_shipping_settings(
  id integer PRIMARY KEY,
  national_shipping_cost bigint NOT NULL,
  free_shipping_threshold bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
CREATE TABLE public.products(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  cost_price bigint NOT NULL DEFAULT 0,
  sale_price bigint NOT NULL
);
CREATE TABLE public.storefront_product_combos(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Fixture',
  enabled boolean NOT NULL DEFAULT false,
  start_at timestamptz,
  end_at timestamptz,
  discount_type text NOT NULL DEFAULT 'none',
  rule_type text NOT NULL DEFAULT 'product_pair',
  product_a_id uuid,
  product_b_id uuid,
  category_a text,
  category_b text,
  discount_value numeric,
  combo_price numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.store_settings(id,admin_user_id)
VALUES (1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.storefront_shipping_settings(id,national_shipping_cost,free_shipping_threshold)
VALUES (1,15000,130000);

CREATE OR REPLACE FUNCTION public.is_store_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','auth','pg_temp'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM public.store_settings
    WHERE id=1 AND admin_user_id=auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.sirevya_normalize_combo_category(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT lower(btrim(coalesce(p_value,'')));
$function$;
