-- Solo para tests/run_promotion_calendar_local.sh en un PostgreSQL local temporal.
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
  id smallint PRIMARY KEY,
  admin_user_id uuid REFERENCES auth.users(id)
);
CREATE TABLE public.storefront_promotion_settings(
  id smallint PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  style text NOT NULL DEFAULT 'elegant',
  eyebrow varchar(48) NOT NULL DEFAULT '',
  title varchar(90) NOT NULL DEFAULT '',
  message varchar(240) NOT NULL DEFAULT '',
  button_label varchar(32) NOT NULL DEFAULT 'Ver catálogo',
  button_url varchar(300) NOT NULL DEFAULT '#catalogo',
  background_color varchar(7) NOT NULL DEFAULT '#17131d',
  accent_color varchar(7) NOT NULL DEFAULT '#d7b779',
  text_color varchar(7) NOT NULL DEFAULT '#ffffff',
  popup_size text NOT NULL DEFAULT 'small',
  popup_shape text NOT NULL DEFAULT 'rounded',
  popup_position text NOT NULL DEFAULT 'center',
  animation_style text NOT NULL DEFAULT 'sparkle',
  animate boolean NOT NULL DEFAULT true,
  delay_ms integer NOT NULL DEFAULT 1600,
  visible_duration_ms integer NOT NULL DEFAULT 3000,
  display_frequency text NOT NULL DEFAULT 'once_per_session',
  start_at timestamptz,
  end_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
CREATE TABLE public.storefront_shipping_settings(
  id smallint PRIMARY KEY,
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
  sale_price numeric NOT NULL
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
  message text,
  button_label text,
  discount_value numeric,
  combo_price numeric,
  display_location text,
  display_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.storefront_promotion_settings(id,updated_by)
VALUES (1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
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

-- Firmas base presentes antes de la migración city; el DDL probado las reemplaza.
CREATE OR REPLACE FUNCTION public.get_storefront_cart_quote(p_items jsonb,p_city text)
RETURNS jsonb
LANGUAGE sql
AS $function$
  SELECT jsonb_build_object('success',true,'items','[]'::jsonb,'original_subtotal',0,
    'discount_total',0,'discounted_subtotal',0,'shipping',0,'total',0,
    'destination_status','fallback','shipping_rule_cost',0,'shipping_rule_threshold',NULL);
$function$;

CREATE OR REPLACE FUNCTION public.get_public_storefront_shipping_settings()
RETURNS jsonb
LANGUAGE sql
AS $function$
  SELECT jsonb_build_object('destination_rules','[]'::jsonb);
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

-- Stub local del RPC legacy: replica firma/retorno y auth para probar solo el wrapper v2.
CREATE OR REPLACE FUNCTION public.admin_save_storefront_product_combo(
  p_combo_id uuid,p_rule_type text,p_product_a_id uuid,p_product_b_id uuid,
  p_category_a text,p_category_b text,p_title text,p_message text,p_button_label text,
  p_enabled boolean,p_start_at timestamptz,p_end_at timestamptz,p_discount_type text,
  p_discount_value numeric,p_combo_price numeric,p_display_location text,p_display_category text
)
RETURNS TABLE(id uuid,enabled boolean,message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','auth','pg_temp'
AS $function$
DECLARE
  v_admin uuid;
  v_id uuid;
BEGIN
  SELECT s.admin_user_id INTO v_admin FROM public.store_settings AS s WHERE s.id=1;
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_admin THEN
    RAISE EXCEPTION 'fixture admin required' USING ERRCODE='42501';
  END IF;
  IF p_combo_id IS NULL THEN
    INSERT INTO public.storefront_product_combos(
      rule_type,product_a_id,product_b_id,category_a,category_b,title,message,button_label,
      enabled,start_at,end_at,discount_type,discount_value,combo_price,display_location,
      display_category,created_at,updated_at,updated_by
    ) VALUES (
      p_rule_type,p_product_a_id,p_product_b_id,p_category_a,p_category_b,p_title,p_message,p_button_label,
      p_enabled,p_start_at,p_end_at,p_discount_type,p_discount_value,p_combo_price,p_display_location,
      p_display_category,now(),now(),auth.uid()
    ) RETURNING storefront_product_combos.id INTO v_id;
  ELSE
    UPDATE public.storefront_product_combos AS c SET
      rule_type=p_rule_type,product_a_id=p_product_a_id,product_b_id=p_product_b_id,
      category_a=p_category_a,category_b=p_category_b,title=p_title,message=p_message,
      button_label=p_button_label,enabled=p_enabled,start_at=p_start_at,end_at=p_end_at,
      discount_type=p_discount_type,discount_value=p_discount_value,combo_price=p_combo_price,
      display_location=p_display_location,display_category=p_display_category,
      updated_at=now(),updated_by=auth.uid()
    WHERE c.id=p_combo_id
    RETURNING c.id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'fixture combo not found'; END IF;
  END IF;
  RETURN QUERY SELECT v_id,p_enabled,'ok'::text;
END;
$function$;
