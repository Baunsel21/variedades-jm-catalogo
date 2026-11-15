-- Generated from read-only Supabase PostgreSQL catalog metadata and pg_get_functiondef.
-- Production snapshot contained metadata/definitions only; no production rows or personal data were copied.
-- Baseline reflects schema after the already-applied Wompi retry/recovery migrations; apply only candidate 20261116070000 afterward.
SET search_path = pg_catalog, public;
CREATE SCHEMA extensions;
CREATE SCHEMA auth;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth,extensions TO anon,authenticated,service_role;

CREATE TABLE public.inventory_reservations(
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL,
  reference text NOT NULL,
  status text DEFAULT 'PENDING'::text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  color text DEFAULT ''::text NOT NULL,
  size text DEFAULT ''::text NOT NULL
);
CREATE TABLE public.orders(
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  reference text NOT NULL,
  customer_name text,
  phone text,
  city text,
  address text,
  neighborhood text,
  items jsonb DEFAULT '[]'::jsonb NOT NULL,
  subtotal bigint DEFAULT 0 NOT NULL,
  shipping bigint DEFAULT 0 NOT NULL,
  total bigint DEFAULT 0 NOT NULL,
  payment_method text DEFAULT 'wompi'::text NOT NULL,
  payment_status text DEFAULT 'PENDING'::text NOT NULL,
  transaction_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  order_status text DEFAULT 'NUEVO'::text NOT NULL,
  coupon_id uuid,
  coupon_code text,
  coupon_discount_total bigint DEFAULT 0,
  coupon_reconciliation_required boolean DEFAULT false NOT NULL,
  wompi_reconciliation_required boolean DEFAULT false NOT NULL
);
CREATE TABLE public.products(
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  category text DEFAULT 'Otros'::text NOT NULL,
  quantity integer DEFAULT 0 NOT NULL,
  cost_price numeric(12,2) DEFAULT 0 NOT NULL,
  sale_price numeric(12,2) DEFAULT 0 NOT NULL,
  location text,
  image_url text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  colors text[] DEFAULT '{}'::text[] NOT NULL,
  sizes text[] DEFAULT '{}'::text[] NOT NULL,
  variants jsonb DEFAULT '[]'::jsonb NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  size_guide text DEFAULT ''::text NOT NULL,
  size_guide_image text DEFAULT ''::text NOT NULL
);
CREATE TABLE public.store_settings(
  id smallint DEFAULT 1 NOT NULL,
  online_payments_enabled boolean DEFAULT true NOT NULL,
  admin_user_id uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid,
  storefront_coupons_enabled boolean DEFAULT true NOT NULL
);
CREATE TABLE public.storefront_cod_settings(
  id smallint DEFAULT 1 NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  allowed_cities text[] DEFAULT ARRAY['Cali'::text] NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);
CREATE TABLE public.storefront_coupon_redemptions(
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  coupon_id uuid NOT NULL,
  code text NOT NULL,
  channel text NOT NULL,
  reference text NOT NULL,
  customer_hash text NOT NULL,
  discount_total bigint NOT NULL,
  status text DEFAULT 'reserved'::text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  reconciliation_required boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  redeemed_at timestamp with time zone,
  released_at timestamp with time zone,
  released_attempt_reference text
);
CREATE TABLE public.storefront_coupons(
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  discount_type text NOT NULL,
  discount_value bigint NOT NULL,
  minimum_subtotal bigint DEFAULT 0 NOT NULL,
  global_limit integer,
  per_customer_limit integer,
  starts_at timestamp with time zone,
  end_at timestamp with time zone,
  enabled boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);
CREATE TABLE public.storefront_product_combos(
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  product_a_id uuid,
  product_b_id uuid,
  title character varying(90) DEFAULT 'Completa el look'::character varying NOT NULL,
  message character varying(240) DEFAULT 'Combina estos productos para completar tu estilo.'::character varying NOT NULL,
  button_label character varying(32) DEFAULT 'Ver combinación'::character varying NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid,
  rule_type text DEFAULT 'product_pair'::text NOT NULL,
  category_a text,
  category_b text,
  discount_type text DEFAULT 'none'::text NOT NULL,
  discount_value numeric(12,2) DEFAULT 0 NOT NULL,
  combo_price numeric(12,2),
  display_location text DEFAULT 'home'::text NOT NULL,
  display_category text,
  priority integer DEFAULT 0 NOT NULL,
  time_zone text DEFAULT 'America/Bogota'::text NOT NULL
);
CREATE TABLE public.storefront_shipping_rule_destinations(
  rule_id uuid NOT NULL,
  destination text NOT NULL,
  destination_key text NOT NULL
);
CREATE TABLE public.storefront_shipping_rules(
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  scope text NOT NULL,
  name text NOT NULL,
  priority integer DEFAULT 0 NOT NULL,
  shipping_cost bigint NOT NULL,
  free_shipping_threshold bigint,
  enabled boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);
CREATE TABLE public.storefront_shipping_settings(
  id smallint DEFAULT 1 NOT NULL,
  national_shipping_cost bigint DEFAULT 15000 NOT NULL,
  free_shipping_threshold bigint,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);
CREATE TABLE public.storefront_wompi_checkout_locks(
  reference text NOT NULL,
  customer_phone_hash text NOT NULL,
  cart_hash text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  checkout_claimed_at timestamp with time zone,
  transaction_id text,
  terminal_at timestamp with time zone,
  reconciliation_required boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.storefront_wompi_payment_attempts(
  attempt_reference text NOT NULL,
  wompi_reference text NOT NULL,
  is_legacy boolean DEFAULT false NOT NULL,
  order_reference text NOT NULL,
  attempt_number integer NOT NULL,
  environment text DEFAULT 'prod'::text NOT NULL,
  amount_in_cents bigint NOT NULL,
  currency text DEFAULT 'COP'::text NOT NULL,
  cart_hash text NOT NULL,
  customer_phone_hash text NOT NULL,
  status text DEFAULT 'INITIATED'::text NOT NULL,
  transaction_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  verified_at timestamp with time zone,
  terminal_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.web_orders(
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  customer_name text NOT NULL,
  customer_cedula text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text NOT NULL,
  customer_city text NOT NULL,
  customer_address text NOT NULL,
  customer_neighborhood text NOT NULL,
  note text,
  payment_method text DEFAULT 'Contra entrega'::text NOT NULL,
  subtotal numeric(12,2) DEFAULT 0 NOT NULL,
  shipping numeric(12,2) DEFAULT 0 NOT NULL,
  total numeric(12,2) DEFAULT 0 NOT NULL,
  items jsonb DEFAULT '[]'::jsonb NOT NULL,
  status text DEFAULT 'pendiente'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  client_reference text,
  inventory_reference text,
  inventory_state text DEFAULT 'legacy'::text NOT NULL,
  discount_total numeric(12,2) DEFAULT 0 NOT NULL,
  coupon_id uuid,
  coupon_code text,
  coupon_discount_total numeric DEFAULT 0
);

CREATE OR REPLACE FUNCTION public._storefront_coupon_normalized_phone(p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p.phone_digits ~ '^0057[0-9]{10}$' THEN substr(p.phone_digits,5)
    WHEN p.phone_digits ~ '^57[0-9]{10}$' THEN substr(p.phone_digits,3)
    ELSE p.phone_digits
  END
  FROM (SELECT regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') AS phone_digits) AS p;
$function$;
CREATE OR REPLACE FUNCTION public._storefront_coupon_customer_hash(p_email text, p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT encode(
    extensions.digest(
      lower(btrim(coalesce(p_email,''))) || '|' || public._storefront_coupon_normalized_phone(p_phone),
      'sha256'
    ),
    'hex'
  );
$function$;
CREATE OR REPLACE FUNCTION public._storefront_coupons_are_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT coalesce((SELECT s.storefront_coupons_enabled
                     FROM public.store_settings AS s WHERE s.id=1),false);
$function$;
CREATE OR REPLACE FUNCTION public.normalize_storefront_delivery_city(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT btrim(regexp_replace(
    regexp_replace(normalize(lower(btrim(coalesce(p_value,''))),NFD),U&'[\0300-\036f]','','g'),
    '[[:space:],.]+',' ','g'
  ));
$function$;
CREATE OR REPLACE FUNCTION public.sirevya_normalize_combo_category(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT regexp_replace(translate(lower(btrim(coalesce(p_value,''))), 'áéíóúüñ', 'aeiouun'), '[[:space:]]+', ' ', 'g');
$function$;
CREATE OR REPLACE FUNCTION public.is_store_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND auth.uid() = (SELECT s.admin_user_id FROM public.store_settings AS s WHERE s.id = 1);
$function$;

ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_quantity_check CHECK (quantity > 0);
ALTER TABLE public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE public.orders ADD CONSTRAINT orders_reference_key UNIQUE (reference);
ALTER TABLE public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE public.products ADD CONSTRAINT products_quantity_check CHECK (quantity >= 0);
ALTER TABLE public.store_settings ADD CONSTRAINT store_settings_id_check CHECK ((id = 1));
ALTER TABLE public.store_settings ADD CONSTRAINT store_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.storefront_cod_settings ADD CONSTRAINT storefront_cod_settings_id_check CHECK (id = 1);
ALTER TABLE public.storefront_cod_settings ADD CONSTRAINT storefront_cod_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.storefront_coupon_redemptions ADD CONSTRAINT storefront_coupon_redemptions_channel_check CHECK (channel = ANY (ARRAY['wompi'::text, 'cod'::text]));
ALTER TABLE public.storefront_coupon_redemptions ADD CONSTRAINT storefront_coupon_redemptions_channel_reference_uq UNIQUE (channel, reference);
ALTER TABLE public.storefront_coupon_redemptions ADD CONSTRAINT storefront_coupon_redemptions_code_check CHECK (length(code) >= 1 AND length(code) <= 64 AND code = upper(code) AND code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'::text);
ALTER TABLE public.storefront_coupon_redemptions ADD CONSTRAINT storefront_coupon_redemptions_customer_hash_check CHECK (length(customer_hash) = 64);
ALTER TABLE public.storefront_coupon_redemptions ADD CONSTRAINT storefront_coupon_redemptions_discount_check CHECK (discount_total > 0);
ALTER TABLE public.storefront_coupon_redemptions ADD CONSTRAINT storefront_coupon_redemptions_pkey PRIMARY KEY (id);
ALTER TABLE public.storefront_coupon_redemptions ADD CONSTRAINT storefront_coupon_redemptions_reference_check CHECK (length(btrim(reference)) >= 1 AND length(btrim(reference)) <= 200);
ALTER TABLE public.storefront_coupon_redemptions ADD CONSTRAINT storefront_coupon_redemptions_status_check CHECK (status = ANY (ARRAY['reserved'::text, 'redeemed'::text, 'released'::text]));
ALTER TABLE public.storefront_coupons ADD CONSTRAINT storefront_coupons_code_check CHECK (length(code) >= 1 AND length(code) <= 64 AND code = upper(code) AND code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'::text);
ALTER TABLE public.storefront_coupons ADD CONSTRAINT storefront_coupons_discount_type_check CHECK (discount_type = ANY (ARRAY['percent'::text, 'fixed_amount'::text]));
ALTER TABLE public.storefront_coupons ADD CONSTRAINT storefront_coupons_discount_value_check CHECK (discount_type = 'percent'::text AND discount_value >= 1 AND discount_value <= 100 OR discount_type = 'fixed_amount'::text AND discount_value > 0);
ALTER TABLE public.storefront_coupons ADD CONSTRAINT storefront_coupons_global_limit_check CHECK (global_limit IS NULL OR global_limit > 0);
ALTER TABLE public.storefront_coupons ADD CONSTRAINT storefront_coupons_minimum_subtotal_check CHECK (minimum_subtotal >= 0 AND minimum_subtotal <= 500000000);
ALTER TABLE public.storefront_coupons ADD CONSTRAINT storefront_coupons_per_customer_limit_check CHECK (per_customer_limit IS NULL OR per_customer_limit > 0);
ALTER TABLE public.storefront_coupons ADD CONSTRAINT storefront_coupons_pkey PRIMARY KEY (id);
ALTER TABLE public.storefront_coupons ADD CONSTRAINT storefront_coupons_window_check CHECK (end_at IS NULL OR starts_at IS NULL OR end_at > starts_at);
ALTER TABLE public.storefront_product_combos ADD CONSTRAINT storefront_product_combos_dates CHECK (start_at IS NULL OR end_at IS NULL OR start_at < end_at);
ALTER TABLE public.storefront_product_combos ADD CONSTRAINT storefront_product_combos_discount_fields_check CHECK ((discount_type = ANY (ARRAY['none'::text, 'percent'::text, 'fixed_amount'::text, 'combo_price'::text])) AND discount_value >= 0::numeric AND (discount_type <> 'percent'::text OR discount_value <= 100::numeric) AND (discount_type <> 'combo_price'::text OR combo_price IS NOT NULL AND combo_price >= 0::numeric) AND (discount_type = 'combo_price'::text OR combo_price IS NULL));
ALTER TABLE public.storefront_product_combos ADD CONSTRAINT storefront_product_combos_display_location_check CHECK ((display_location = ANY (ARRAY['home'::text, 'category'::text, 'both'::text])) AND (display_location = 'home'::text AND display_category IS NULL OR (display_location = ANY (ARRAY['category'::text, 'both'::text])) AND NULLIF(btrim(display_category), ''::text) IS NOT NULL));
ALTER TABLE public.storefront_product_combos ADD CONSTRAINT storefront_product_combos_distinct_products CHECK (product_a_id <> product_b_id);
ALTER TABLE public.storefront_product_combos ADD CONSTRAINT storefront_product_combos_pkey PRIMARY KEY (id);
ALTER TABLE public.storefront_product_combos ADD CONSTRAINT storefront_product_combos_priority_check CHECK (priority >= 0 AND priority <= 1000);
ALTER TABLE public.storefront_product_combos ADD CONSTRAINT storefront_product_combos_rule_fields_check CHECK (rule_type = 'product_pair'::text AND product_a_id IS NOT NULL AND product_b_id IS NOT NULL AND product_a_id <> product_b_id AND NULLIF(btrim(category_a), ''::text) IS NULL AND NULLIF(btrim(category_b), ''::text) IS NULL OR rule_type = 'category_pair'::text AND product_a_id IS NULL AND product_b_id IS NULL AND NULLIF(btrim(category_a), ''::text) IS NOT NULL AND NULLIF(btrim(category_b), ''::text) IS NOT NULL AND sirevya_normalize_combo_category(category_a) <> sirevya_normalize_combo_category(category_b));
ALTER TABLE public.storefront_product_combos ADD CONSTRAINT storefront_product_combos_time_zone_check CHECK (time_zone = 'America/Bogota'::text);
ALTER TABLE public.storefront_shipping_rule_destinations ADD CONSTRAINT storefront_shipping_rule_destinations_destination_check CHECK (length(btrim(destination)) >= 1 AND length(btrim(destination)) <= 80);
ALTER TABLE public.storefront_shipping_rule_destinations ADD CONSTRAINT storefront_shipping_rule_destinations_destination_key_check CHECK (length(btrim(destination_key)) >= 1 AND length(btrim(destination_key)) <= 80);
ALTER TABLE public.storefront_shipping_rule_destinations ADD CONSTRAINT storefront_shipping_rule_destinations_pkey PRIMARY KEY (rule_id, destination_key);
ALTER TABLE public.storefront_shipping_rules ADD CONSTRAINT storefront_shipping_rules_free_shipping_threshold_check CHECK (free_shipping_threshold IS NULL OR free_shipping_threshold >= 1 AND free_shipping_threshold <= 50000000);
ALTER TABLE public.storefront_shipping_rules ADD CONSTRAINT storefront_shipping_rules_name_check CHECK (length(btrim(name)) >= 1 AND length(btrim(name)) <= 80);
ALTER TABLE public.storefront_shipping_rules ADD CONSTRAINT storefront_shipping_rules_pkey PRIMARY KEY (id);
ALTER TABLE public.storefront_shipping_rules ADD CONSTRAINT storefront_shipping_rules_priority_check CHECK (priority >= 0 AND priority <= 1000);
ALTER TABLE public.storefront_shipping_rules ADD CONSTRAINT storefront_shipping_rules_scope_check CHECK (scope = ANY (ARRAY['city'::text, 'zone'::text]));
ALTER TABLE public.storefront_shipping_rules ADD CONSTRAINT storefront_shipping_rules_shipping_cost_check CHECK (shipping_cost >= 0 AND shipping_cost <= 5000000);
ALTER TABLE public.storefront_shipping_settings ADD CONSTRAINT storefront_shipping_settings_free_shipping_threshold_check CHECK (free_shipping_threshold IS NULL OR free_shipping_threshold >= 1 AND free_shipping_threshold <= 50000000);
ALTER TABLE public.storefront_shipping_settings ADD CONSTRAINT storefront_shipping_settings_id_check CHECK (id = 1);
ALTER TABLE public.storefront_shipping_settings ADD CONSTRAINT storefront_shipping_settings_national_shipping_cost_check CHECK (national_shipping_cost >= 0 AND national_shipping_cost <= 5000000);
ALTER TABLE public.storefront_shipping_settings ADD CONSTRAINT storefront_shipping_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.storefront_wompi_checkout_locks ADD CONSTRAINT storefront_wompi_checkout_cart_hash_check CHECK (cart_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE public.storefront_wompi_checkout_locks ADD CONSTRAINT storefront_wompi_checkout_locks_pkey PRIMARY KEY (reference);
ALTER TABLE public.storefront_wompi_checkout_locks ADD CONSTRAINT storefront_wompi_checkout_phone_hash_check CHECK (customer_phone_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE public.storefront_wompi_checkout_locks ADD CONSTRAINT storefront_wompi_checkout_reference_check CHECK (length(btrim(reference)) >= 1 AND length(btrim(reference)) <= 120);
ALTER TABLE public.storefront_wompi_checkout_locks ADD CONSTRAINT storefront_wompi_checkout_status_check CHECK (status = ANY (ARRAY['active'::text, 'pending'::text, 'terminal_grace'::text, 'completed'::text, 'released'::text, 'expired'::text]));
ALTER TABLE public.storefront_wompi_payment_attempts ADD CONSTRAINT storefront_wompi_attempt_amount_ck CHECK (amount_in_cents > 0);
ALTER TABLE public.storefront_wompi_payment_attempts ADD CONSTRAINT storefront_wompi_attempt_cart_hash_ck CHECK (cart_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE public.storefront_wompi_payment_attempts ADD CONSTRAINT storefront_wompi_attempt_currency_ck CHECK (currency = 'COP'::text);
ALTER TABLE public.storefront_wompi_payment_attempts ADD CONSTRAINT storefront_wompi_attempt_environment_ck CHECK (environment = ANY (ARRAY['prod'::text, 'test'::text]));
ALTER TABLE public.storefront_wompi_payment_attempts ADD CONSTRAINT storefront_wompi_attempt_number_ck CHECK (attempt_number > 0);
ALTER TABLE public.storefront_wompi_payment_attempts ADD CONSTRAINT storefront_wompi_attempt_order_reference_ck CHECK (length(btrim(order_reference)) >= 1 AND length(btrim(order_reference)) <= 120);
ALTER TABLE public.storefront_wompi_payment_attempts ADD CONSTRAINT storefront_wompi_attempt_phone_hash_ck CHECK (customer_phone_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE public.storefront_wompi_payment_attempts ADD CONSTRAINT storefront_wompi_attempt_reference_ck CHECK (attempt_reference ~ '^SW-[A-F0-9]{32}$'::text);
ALTER TABLE public.storefront_wompi_payment_attempts ADD CONSTRAINT storefront_wompi_attempt_status_ck CHECK (status = ANY (ARRAY['INITIATED'::text, 'PENDING'::text, 'APPROVED'::text, 'DECLINED'::text, 'VOIDED'::text, 'ERROR'::text, 'APPROVED_LATE'::text]));
ALTER TABLE public.storefront_wompi_payment_attempts ADD CONSTRAINT storefront_wompi_external_reference_ck CHECK (wompi_reference ~ '^[A-Za-z0-9_-]{1,120}$'::text);
ALTER TABLE public.storefront_wompi_payment_attempts ADD CONSTRAINT storefront_wompi_payment_attempts_pkey PRIMARY KEY (attempt_reference);
ALTER TABLE public.web_orders ADD CONSTRAINT web_orders_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD CONSTRAINT products_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.store_settings ADD CONSTRAINT store_settings_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.store_settings ADD CONSTRAINT store_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.storefront_coupon_redemptions ADD CONSTRAINT storefront_coupon_redemptions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES storefront_coupons(id) ON DELETE RESTRICT;
ALTER TABLE public.storefront_coupons ADD CONSTRAINT storefront_coupons_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.storefront_product_combos ADD CONSTRAINT storefront_product_combos_product_a_id_fkey FOREIGN KEY (product_a_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.storefront_product_combos ADD CONSTRAINT storefront_product_combos_product_b_id_fkey FOREIGN KEY (product_b_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.storefront_product_combos ADD CONSTRAINT storefront_product_combos_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.storefront_shipping_rule_destinations ADD CONSTRAINT storefront_shipping_rule_destinations_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES storefront_shipping_rules(id) ON DELETE CASCADE;
ALTER TABLE public.storefront_shipping_rules ADD CONSTRAINT storefront_shipping_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.storefront_shipping_settings ADD CONSTRAINT storefront_shipping_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_inventory_reservations_expires ON public.inventory_reservations USING btree (expires_at);
CREATE INDEX idx_inventory_reservations_product ON public.inventory_reservations USING btree (product_id);
CREATE INDEX idx_inventory_reservations_reference ON public.inventory_reservations USING btree (reference);
CREATE INDEX inventory_reservations_active_idx ON public.inventory_reservations USING btree (product_id, status, expires_at);
CREATE INDEX inventory_reservations_reference_idx ON public.inventory_reservations USING btree (reference, status);
CREATE INDEX orders_order_status_idx ON public.orders USING btree (order_status);
CREATE INDEX orders_payment_status_idx ON public.orders USING btree (payment_status);
CREATE INDEX orders_reference_idx ON public.orders USING btree (reference);
CREATE INDEX orders_wompi_pending_phone_norm_idx ON public.orders USING btree (_storefront_coupon_normalized_phone(phone), created_at DESC, reference) WHERE ((lower(payment_method) = 'wompi'::text) AND (upper(payment_status) = 'PENDING'::text));
CREATE INDEX orders_wompi_reconciliation_phone_idx ON public.orders USING btree (_storefront_coupon_normalized_phone(phone)) WHERE ((lower(payment_method) = 'wompi'::text) AND ((wompi_reconciliation_required = true) OR (coupon_reconciliation_required = true)));
CREATE UNIQUE INDEX products_user_code_idx ON public.products USING btree (user_id, code);
CREATE INDEX store_settings_admin_user_id_idx ON public.store_settings USING btree (admin_user_id);
CREATE INDEX store_settings_updated_by_idx ON public.store_settings USING btree (updated_by);
CREATE INDEX storefront_coupon_redemptions_coupon_customer_idx ON public.storefront_coupon_redemptions USING btree (coupon_id, customer_hash, status, expires_at);
CREATE INDEX storefront_coupon_redemptions_coupon_status_idx ON public.storefront_coupon_redemptions USING btree (coupon_id, status, expires_at);
CREATE UNIQUE INDEX storefront_coupons_code_ci_uq ON public.storefront_coupons USING btree (lower(code));
CREATE INDEX storefront_coupons_enabled_window_idx ON public.storefront_coupons USING btree (enabled, starts_at, end_at);
CREATE INDEX storefront_product_combos_category_active_idx ON public.storefront_product_combos USING btree (enabled, category_a, category_b, created_at);
CREATE INDEX storefront_product_combos_display_idx ON public.storefront_product_combos USING btree (enabled, display_location, display_category, created_at);
CREATE INDEX storefront_product_combos_priority_calendar_idx ON public.storefront_product_combos USING btree (enabled, priority DESC, start_at, end_at, created_at, id);
CREATE INDEX storefront_product_combos_product_a_idx ON public.storefront_product_combos USING btree (product_a_id, enabled);
CREATE INDEX storefront_product_combos_product_b_idx ON public.storefront_product_combos USING btree (product_b_id);
CREATE INDEX storefront_product_combos_public_idx ON public.storefront_product_combos USING btree (enabled, start_at, end_at);
CREATE INDEX storefront_product_combos_updated_by_idx ON public.storefront_product_combos USING btree (updated_by);
CREATE INDEX storefront_shipping_rule_destinations_key_idx ON public.storefront_shipping_rule_destinations USING btree (destination_key, rule_id);
CREATE INDEX storefront_shipping_rules_enabled_priority_idx ON public.storefront_shipping_rules USING btree (enabled, scope, priority DESC, id);
CREATE UNIQUE INDEX storefront_wompi_attempt_current_wompi_reference_uq ON public.storefront_wompi_payment_attempts USING btree (wompi_reference) WHERE (is_legacy = false);
CREATE INDEX storefront_wompi_attempt_latest_idx ON public.storefront_wompi_payment_attempts USING btree (order_reference, attempt_number DESC);
CREATE INDEX storefront_wompi_attempt_legacy_reference_tx_idx ON public.storefront_wompi_payment_attempts USING btree (wompi_reference, transaction_id) WHERE (is_legacy = true);
CREATE UNIQUE INDEX storefront_wompi_attempt_open_order_uq ON public.storefront_wompi_payment_attempts USING btree (order_reference) WHERE (status = ANY (ARRAY['INITIATED'::text, 'PENDING'::text]));
CREATE UNIQUE INDEX storefront_wompi_attempt_order_number_uq ON public.storefront_wompi_payment_attempts USING btree (order_reference, attempt_number);
CREATE UNIQUE INDEX storefront_wompi_attempt_transaction_uq ON public.storefront_wompi_payment_attempts USING btree (transaction_id) WHERE (transaction_id IS NOT NULL);
CREATE UNIQUE INDEX storefront_wompi_checkout_active_phone_uq ON public.storefront_wompi_checkout_locks USING btree (customer_phone_hash) WHERE (status = ANY (ARRAY['active'::text, 'pending'::text, 'terminal_grace'::text]));
CREATE INDEX storefront_wompi_checkout_expiry_idx ON public.storefront_wompi_checkout_locks USING btree (expires_at) WHERE (status = ANY (ARRAY['active'::text, 'terminal_grace'::text]));
CREATE UNIQUE INDEX web_orders_client_reference_uq ON public.web_orders USING btree (client_reference) WHERE (client_reference IS NOT NULL);

ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_cod_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_product_combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_shipping_rule_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_shipping_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_shipping_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_wompi_checkout_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_wompi_payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory reservations none" ON public.inventory_reservations AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "products own" ON public.products AS PERMISSIVE FOR ALL TO authenticated USING ((( SELECT is_store_admin() AS is_store_admin
 LIMIT 1) AND (user_id = ( SELECT auth.uid() AS uid
 LIMIT 1)))) WITH CHECK ((( SELECT is_store_admin() AS is_store_admin
 LIMIT 1) AND (user_id = ( SELECT auth.uid() AS uid
 LIMIT 1))));
CREATE POLICY "web_orders_authenticated_read" ON public.web_orders AS PERMISSIVE FOR SELECT TO authenticated USING (is_store_admin());
CREATE POLICY "web_orders_authenticated_update" ON public.web_orders AS PERMISSIVE FOR UPDATE TO authenticated USING (is_store_admin()) WITH CHECK (is_store_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO service_role;
GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storefront_cod_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storefront_product_combos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storefront_shipping_settings TO service_role;
GRANT SELECT ON public.storefront_wompi_payment_attempts TO service_role;
GRANT SELECT, UPDATE, DELETE ON public.web_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.web_orders TO service_role;

CREATE OR REPLACE FUNCTION public.storefront_cod_city_allowed(p_city text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_enabled boolean;v_cities text[];v_city text;v_key text;v_known text[]:=ARRAY['cali','bogota','medellin','barranquilla','cartagena','bucaramanga','pereira','armenia','manizales','cucuta','pasto']::text[];
BEGIN
 SELECT c.enabled,c.allowed_cities INTO v_enabled,v_cities FROM public.storefront_cod_settings c WHERE c.id=1;
 IF NOT coalesce(v_enabled,false) THEN RETURN false; END IF;
 v_city:=lower(regexp_replace(translate(trim(coalesce(p_city,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'),'[,.]+',' ','g'));
 v_key:=regexp_replace(v_city,'[[:space:]]+',' ','g');
 IF v_key IN ('santiago de cali','cali valle del cauca') THEN v_key:='cali'; END IF;
 IF '*'=ANY(coalesce(v_cities,ARRAY[]::text[])) THEN RETURN v_key<>''; END IF;
 IF EXISTS(SELECT 1 FROM unnest(coalesce(v_cities,ARRAY[]::text[])) c WHERE lower(regexp_replace(translate(trim(c),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'),'[,.]+',' ','g'))=v_key) THEN RETURN true; END IF;
 RETURN '__other__'=ANY(coalesce(v_cities,ARRAY[]::text[])) AND v_key<>'' AND NOT(v_key=ANY(v_known));
END $function$;
CREATE OR REPLACE FUNCTION public.get_storefront_cart_quote(p_items jsonb, p_city text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_input jsonb; v_product public.products%ROWTYPE; v_line_count integer:=0; v_qty integer;
  v_owner_id uuid; v_city text:=btrim(coalesce(p_city,'')); v_base numeric(14,2):=0;
  v_discount numeric(14,2):=0; v_subtotal numeric(14,2):=0; v_shipping numeric(14,2):=0; v_total numeric(14,2):=0;
  v_ids uuid[]:=ARRAY[]::uuid[]; v_names text[]:=ARRAY[]::text[]; v_codes text[]:=ARRAY[]::text[];
  v_categories text[]:=ARRAY[]::text[]; v_prices numeric[]:=ARRAY[]::numeric[]; v_qtys integer[]:=ARRAY[]::integer[];
  v_remaining integer[]:=ARRAY[]::integer[]; v_line_discounts numeric[]:=ARRAY[]::numeric[];
  v_colors text[]:=ARRAY[]::text[]; v_sizes text[]:=ARRAY[]::text[];
  v_rule record; v_n integer; i integer; j integer; v_is_a boolean; v_is_b boolean; v_units integer;
  v_pair_total numeric(14,2); v_save_per_pair numeric(14,2); v_share_a numeric(14,2); v_share_b numeric(14,2);
  v_rule_units integer; v_rule_discount numeric(14,2); v_applied jsonb:='[]'::jsonb; v_item_json jsonb:='[]'::jsonb;
  v_original_line numeric(14,2); v_net_line numeric(14,2); v_normalized_city text;
  v_national_shipping_cost bigint; v_free_shipping_threshold bigint;
  v_shipping_rule_id uuid; v_shipping_rule_scope text; v_shipping_rule_name text;
  v_destination_status text; v_resolved_shipping_cost bigint; v_resolved_threshold bigint; v_rule_city_key text;
BEGIN
  SELECT s.admin_user_id INTO v_owner_id FROM public.store_settings AS s WHERE s.id=1;
  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'message','La tienda no tiene administrador configurado.');
  END IF;
  IF v_city='' THEN
    RETURN jsonb_build_object('success',false,'message','Selecciona tu ciudad para calcular el envío correctamente.');
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)<1 OR jsonb_array_length(p_items)>50 THEN
    RETURN jsonb_build_object('success',false,'message','El carrito debe contener de 1 a 50 líneas.');
  END IF;
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_items) AS x(value) LOOP
    IF coalesce(btrim(v_input->>'id'),'')='' THEN RETURN jsonb_build_object('success',false,'message','Una línea no contiene identificador de producto.'); END IF;
    v_qty:=coalesce((v_input->>'qty')::integer,0);
    IF v_qty<1 OR v_qty>100 THEN RETURN jsonb_build_object('success',false,'message','La cantidad de una línea no es válida.'); END IF;
    SELECT * INTO v_product FROM public.products p WHERE p.id=(v_input->>'id')::uuid AND p.user_id=v_owner_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','Uno de los productos ya no existe.'); END IF;
    IF coalesce(v_product.sale_price,0)<0 THEN RETURN jsonb_build_object('success',false,'message','El precio guardado de un producto no es válido.'); END IF;
    v_ids:=array_append(v_ids,v_product.id);v_names:=array_append(v_names,coalesce(v_product.name,'Producto'));
    v_codes:=array_append(v_codes,coalesce(v_product.code,''));v_categories:=array_append(v_categories,coalesce(v_product.category,''));
    v_prices:=array_append(v_prices,coalesce(v_product.sale_price,0)::numeric);v_qtys:=array_append(v_qtys,v_qty);v_remaining:=array_append(v_remaining,v_qty);
    v_line_discounts:=array_append(v_line_discounts,0::numeric);v_colors:=array_append(v_colors,btrim(coalesce(v_input->>'color','')));v_sizes:=array_append(v_sizes,btrim(coalesce(v_input->>'size','')));
    v_base:=v_base+(coalesce(v_product.sale_price,0)::numeric*v_qty);v_line_count:=v_line_count+1;
  END LOOP;
  v_n:=array_length(v_ids,1);
  FOR v_rule IN
    SELECT c.* FROM public.storefront_product_combos c
    WHERE c.enabled=true AND c.discount_type<>'none'
      AND (c.start_at IS NULL OR c.start_at<=now()) AND (c.end_at IS NULL OR c.end_at>now())
    ORDER BY c.created_at ASC,c.id ASC
  LOOP
    v_rule_units:=0;v_rule_discount:=0;
    FOR i IN 1..v_n LOOP
      IF v_remaining[i]<=0 THEN CONTINUE; END IF;
      IF v_rule.rule_type='product_pair' THEN v_is_a:=v_ids[i]=v_rule.product_a_id;
      ELSE v_is_a:=public.sirevya_normalize_combo_category(v_categories[i])=public.sirevya_normalize_combo_category(v_rule.category_a); END IF;
      IF NOT v_is_a THEN CONTINUE; END IF;
      FOR j IN 1..v_n LOOP
        IF i=j OR v_remaining[j]<=0 THEN CONTINUE; END IF;
        IF v_rule.rule_type='product_pair' THEN v_is_b:=v_ids[j]=v_rule.product_b_id;
        ELSE v_is_b:=public.sirevya_normalize_combo_category(v_categories[j])=public.sirevya_normalize_combo_category(v_rule.category_b); END IF;
        IF NOT v_is_b THEN CONTINUE; END IF;
        v_pair_total:=v_prices[i]+v_prices[j];
        IF v_pair_total<=0 THEN CONTINUE; END IF;
        IF v_rule.discount_type='percent' THEN v_save_per_pair:=round(v_pair_total*least(100,coalesce(v_rule.discount_value,0))/100,0);
        ELSIF v_rule.discount_type='fixed_amount' THEN v_save_per_pair:=least(v_pair_total,coalesce(v_rule.discount_value,0));
        ELSIF v_rule.discount_type='combo_price' THEN v_save_per_pair:=greatest(0,v_pair_total-coalesce(v_rule.combo_price,0));
        ELSE v_save_per_pair:=0; END IF;
        v_save_per_pair:=least(v_pair_total,greatest(0,v_save_per_pair));
        IF v_save_per_pair<=0 THEN CONTINUE; END IF;
        v_units:=least(v_remaining[i],v_remaining[j]);
        v_share_a:=round(v_save_per_pair*v_prices[i]/v_pair_total,0);
        v_share_b:=v_save_per_pair-v_share_a;
        v_line_discounts[i]:=v_line_discounts[i]+v_share_a*v_units;
        v_line_discounts[j]:=v_line_discounts[j]+v_share_b*v_units;
        v_remaining[i]:=v_remaining[i]-v_units;v_remaining[j]:=v_remaining[j]-v_units;
        v_rule_units:=v_rule_units+v_units;v_rule_discount:=v_rule_discount+(v_save_per_pair*v_units);
      END LOOP;
    END LOOP;
    IF v_rule_discount>0 THEN
      v_applied:=v_applied||jsonb_build_array(jsonb_build_object(
        'id',v_rule.id,'title',v_rule.title,'rule_type',v_rule.rule_type,'category_a',v_rule.category_a,'category_b',v_rule.category_b,
        'discount_type',v_rule.discount_type,'discount_value',v_rule.discount_value,'combo_price',v_rule.combo_price,
        'units',v_rule_units,'discount_total',v_rule_discount));
    END IF;
  END LOOP;
  FOR i IN 1..v_n LOOP
    v_original_line:=v_prices[i]*v_qtys[i];v_line_discounts[i]:=least(v_original_line,greatest(0,v_line_discounts[i]));
    v_net_line:=greatest(0,v_original_line-v_line_discounts[i]);v_discount:=v_discount+v_line_discounts[i];
    v_item_json:=v_item_json||jsonb_build_array(jsonb_build_object(
      'id',v_ids[i]::text,'name',v_names[i],'code',v_codes[i],'category',v_categories[i],
      'qty',v_qtys[i],'price',v_prices[i],'color',v_colors[i],'size',v_sizes[i],
      'original_subtotal',v_original_line,'discount_total',v_line_discounts[i],'net_subtotal',v_net_line));
  END LOOP;
  v_subtotal:=greatest(0,v_base-v_discount);
  v_normalized_city:=public.normalize_storefront_delivery_city(v_city);
  v_rule_city_key:=CASE WHEN v_normalized_city IN ('cali','santiago de cali','cali valle del cauca') THEN 'cali' ELSE v_normalized_city END;

  -- La fila singleton sincroniza las ediciones de tarifa con cotizaciones COD.
  SELECT s.national_shipping_cost,s.free_shipping_threshold
    INTO v_national_shipping_cost,v_free_shipping_threshold
    FROM public.storefront_shipping_settings AS s WHERE s.id=1 FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','La configuración de envíos no está disponible.');
  END IF;

  SELECT r.id,r.scope,r.name,r.shipping_cost,r.free_shipping_threshold
    INTO v_shipping_rule_id,v_shipping_rule_scope,v_shipping_rule_name,v_resolved_shipping_cost,v_resolved_threshold
    FROM public.storefront_shipping_rule_destinations AS d
    JOIN public.storefront_shipping_rules AS r ON r.id=d.rule_id
   WHERE d.destination_key=v_rule_city_key AND r.enabled=true
   ORDER BY CASE WHEN r.scope='city' THEN 0 ELSE 1 END,r.priority DESC,r.id
   LIMIT 1
   FOR SHARE OF r;

  IF FOUND THEN
    v_destination_status:='matched_'||v_shipping_rule_scope;
  ELSIF v_normalized_city IN ('cali','santiago de cali','cali valle del cauca') THEN
    v_shipping:=0;
    v_destination_status:='cali_free';
    v_shipping_rule_name:='Envío gratis en Cali';
    v_resolved_shipping_cost:=0;
    v_resolved_threshold:=NULL;
  ELSE
    v_destination_status:='fallback';
    v_shipping_rule_name:='Tarifa general';
    v_resolved_shipping_cost:=v_national_shipping_cost;
    v_resolved_threshold:=v_free_shipping_threshold;
  END IF;

  IF v_destination_status<>'cali_free' THEN
    IF v_resolved_threshold IS NOT NULL AND v_subtotal>=v_resolved_threshold THEN
      v_shipping:=0;
    ELSE
      v_shipping:=v_resolved_shipping_cost;
    END IF;
  END IF;

  v_total:=v_subtotal+v_shipping;
  RETURN jsonb_build_object(
    'success',true,'original_subtotal',v_base,'discount_total',v_discount,'discounted_subtotal',v_subtotal,
    'shipping',v_shipping,'total',v_total,'items',v_item_json,'discounts',v_applied,'currency','COP',
    'normalized_city',v_normalized_city,'destination_status',v_destination_status,
    'shipping_rule_id',v_shipping_rule_id,'shipping_rule_scope',v_shipping_rule_scope,
    'shipping_rule_name',v_shipping_rule_name,'shipping_rule_cost',v_resolved_shipping_cost,
    'shipping_rule_threshold',v_resolved_threshold
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success',false,'message','El carrito contiene un identificador o una cantidad no válida.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success',false,'message','No se pudo calcular el total del carrito. Verifica los productos y las promociones.');
END
$function$;
CREATE OR REPLACE FUNCTION public.get_storefront_cart_quote_with_coupon(p_items jsonb, p_city text, p_coupon_code text, p_customer_email text, p_customer_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_legacy_quote jsonb;
  v_items jsonb;
  v_discounts jsonb;
  v_coupon public.storefront_coupons%ROWTYPE;
  v_coupon_code text:=upper(btrim(coalesce(p_coupon_code,'')));
  v_normalized_city text;
  v_input jsonb;
  v_line jsonb;
  v_line_out jsonb;
  v_item_count integer;
  v_index integer:=0;
  v_combo_total numeric:=0;
  v_original_subtotal numeric:=0;
  v_subtotal numeric:=0;
  v_coupon_discount numeric:=0;
  v_total_discount numeric:=0;
  v_shipping numeric:=0;
  v_total numeric:=0;
  v_line_net_total numeric:=0;
  v_line_original numeric;
  v_line_combo numeric;
  v_line_net numeric;
  v_share numeric;
  v_remaining_coupon numeric;
  v_remaining_base numeric;
  v_last_positive_index integer:=0;
  v_rule_cost numeric;
  v_rule_threshold numeric;
  v_destination_status text;
  v_message text;
BEGIN
  IF v_coupon_code<>'' AND NOT public._storefront_coupons_are_enabled() THEN
    RETURN jsonb_build_object('success',false,'code','COUPONS_DISABLED','message','Los cupones están temporalmente desactivados.');
  END IF;

  IF v_coupon_code='' THEN
    v_legacy_quote:=public.get_storefront_cart_quote(p_items,p_city);
    IF coalesce((v_legacy_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN
      RETURN v_legacy_quote||jsonb_build_object('coupon_id',NULL,'coupon_code',NULL,'coupon_discount_total',0,'coupon',NULL);
    END IF;
    v_items:='[]'::jsonb;
    FOR v_input IN SELECT value FROM jsonb_array_elements(coalesce(v_legacy_quote->'items','[]'::jsonb)) AS x(value) LOOP
      v_items:=v_items||(v_input||jsonb_build_object('coupon_discount_total',0));
    END LOOP;
    RETURN v_legacy_quote||jsonb_build_object(
      'items',v_items,'coupon_id',NULL,'coupon_code',NULL,'coupon_discount_total',0,'coupon',NULL
    );
  END IF;

  IF v_coupon_code !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_INVALID','message','El código del cupón no es válido.');
  END IF;
  v_legacy_quote:=public.get_storefront_cart_quote(p_items,p_city);
  IF coalesce((v_legacy_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN
    RETURN v_legacy_quote||jsonb_build_object('code','QUOTE_INVALID');
  END IF;
  IF (v_legacy_quote->>'discount_total') IS NULL
     OR (v_legacy_quote->>'original_subtotal') IS NULL
     OR (v_legacy_quote->>'discounted_subtotal') IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización legacy está incompleta.');
  END IF;
  IF round((v_legacy_quote->>'discount_total')::numeric,0)>0 THEN
    RETURN jsonb_build_object(
      'success',false,'code','COUPON_COMBO_CONFLICT',
      'message','Este cupón no se puede combinar con descuentos de combo.'
    );
  END IF;

  SELECT c.* INTO v_coupon
    FROM public.storefront_coupons AS c
   WHERE c.code=v_coupon_code
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_INVALID','message','El cupón no existe.');
  END IF;
  IF NOT v_coupon.enabled THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_DISABLED','message','El cupón no está activo.');
  END IF;
  IF v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at>now() THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_NOT_STARTED','message','El cupón todavía no está vigente.');
  END IF;
  IF v_coupon.end_at IS NOT NULL AND v_coupon.end_at<=now() THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_EXPIRED','message','El cupón ya no está vigente.');
  END IF;

  v_original_subtotal:=round((v_legacy_quote->>'original_subtotal')::numeric,0);
  v_subtotal:=round((v_legacy_quote->>'discounted_subtotal')::numeric,0);
  IF v_subtotal<v_coupon.minimum_subtotal THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_MINIMUM_NOT_MET','message','El subtotal no alcanza el mínimo requerido para este cupón.');
  END IF;
  IF lower(v_coupon.discount_type)='percent' THEN
    v_coupon_discount:=round(v_subtotal*v_coupon.discount_value/100,0);
  ELSE
    v_coupon_discount:=least(v_subtotal,v_coupon.discount_value);
  END IF;
  v_coupon_discount:=least(v_subtotal,greatest(0,v_coupon_discount));
  IF v_coupon_discount<=0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_ZERO_DISCOUNT','message','El cupón no produce un descuento sobre este subtotal.');
  END IF;

  v_items:='[]'::jsonb;
  v_item_count:=jsonb_array_length(coalesce(v_legacy_quote->'items','[]'::jsonb));
  IF v_item_count<1 THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización legacy no contiene líneas.');
  END IF;
  SELECT coalesce(max(x.ordinality),0)::integer INTO v_last_positive_index
    FROM jsonb_array_elements(coalesce(v_legacy_quote->'items','[]'::jsonb)) WITH ORDINALITY AS x(value,ordinality)
   WHERE greatest(0,round(coalesce((x.value->>'net_subtotal')::numeric,
     coalesce((x.value->>'original_subtotal')::numeric,0)-coalesce((x.value->>'discount_total')::numeric,0)),0))>0;
  IF v_last_positive_index=0 THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización no contiene una línea elegible para distribuir el cupón.');
  END IF;
  v_remaining_coupon:=v_coupon_discount;
  v_remaining_base:=v_subtotal;
  FOR v_input IN
    SELECT value FROM jsonb_array_elements(coalesce(v_legacy_quote->'items','[]'::jsonb)) WITH ORDINALITY AS x(value,ordinality)
    ORDER BY ordinality
  LOOP
    v_index:=v_index+1;
    v_line_original:=round(coalesce((v_input->>'original_subtotal')::numeric,0),0);
    v_line_combo:=round(coalesce((v_input->>'discount_total')::numeric,0),0);
    v_line_net:=greatest(0,round(coalesce((v_input->>'net_subtotal')::numeric,v_line_original-v_line_combo),0));
    v_combo_total:=v_combo_total+v_line_combo;
    v_line_net_total:=v_line_net_total+v_line_net;
    IF v_index=v_last_positive_index THEN
      v_share:=v_remaining_coupon;
    ELSIF v_remaining_coupon<=0 OR v_line_net<=0 OR v_remaining_base<=0 THEN
      v_share:=0;
    ELSE
      v_share:=least(v_line_net,greatest(0,round(v_remaining_coupon*v_line_net/v_remaining_base,0)));
    END IF;
    v_share:=least(v_line_net,greatest(0,v_share));
    v_remaining_coupon:=greatest(0,v_remaining_coupon-v_share);
    v_remaining_base:=greatest(0,v_remaining_base-v_line_net);
    v_line_out:=v_input||jsonb_build_object(
      'discount_total',v_line_combo+v_share,
      'coupon_discount_total',v_share,
      'net_subtotal',greatest(0,v_line_net-v_share)
    );
    v_items:=v_items||v_line_out;
  END LOOP;
  IF v_remaining_coupon<>0 THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','No se pudo distribuir exactamente el descuento del cupón.');
  END IF;
  IF round(v_combo_total,0)<>round((v_legacy_quote->>'discount_total')::numeric,0) THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La distribución de descuentos legacy no concilia.');
  END IF;
  IF round(v_line_net_total,0)<>round((v_legacy_quote->>'discounted_subtotal')::numeric,0) THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','Los subtotales por línea no concilian con el subtotal del servidor.');
  END IF;

  v_total_discount:=v_combo_total+v_coupon_discount;
  v_subtotal:=greatest(0,v_original_subtotal-v_total_discount);
  v_destination_status:=v_legacy_quote->>'destination_status';
  IF v_destination_status IS NULL
     OR v_destination_status NOT IN ('matched_city','matched_zone','cali_free','fallback')
     OR v_legacy_quote->>'shipping_rule_cost' IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','SHIPPING_UNAVAILABLE','message','La cotización de ciudad/zona no incluye una regla verificable.');
  END IF;
  v_normalized_city:=v_legacy_quote->>'normalized_city';
  v_rule_cost:=round((v_legacy_quote->>'shipping_rule_cost')::numeric,0);
  v_rule_threshold:=nullif(v_legacy_quote->>'shipping_rule_threshold','')::numeric;
  IF v_destination_status='cali_free' THEN
    -- Envío gratuito de Cali solo es fallback cuando el quote legacy no encontró regla.
    v_shipping:=0;
  ELSIF v_rule_threshold IS NOT NULL AND v_subtotal>=v_rule_threshold THEN
    v_shipping:=0;
  ELSE
    v_shipping:=v_rule_cost;
  END IF;
  v_total:=v_subtotal+v_shipping;
  v_discounts:=coalesce(v_legacy_quote->'discounts','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
    'id',v_coupon.id,'code',v_coupon.code,'discount_type',v_coupon.discount_type,
    'discount_value',v_coupon.discount_value,'minimum_subtotal',v_coupon.minimum_subtotal,
    'discount_total',v_coupon_discount,'coupon_discount_total',v_coupon_discount
  ));
  RETURN jsonb_build_object(
    'success',true,'original_subtotal',v_original_subtotal,'discount_total',v_total_discount,
    'discounted_subtotal',v_subtotal,'shipping',v_shipping,'total',v_total,
    'items',v_items,'discounts',v_discounts,'currency','COP',
    'coupon_id',v_coupon.id,'coupon_code',v_coupon.code,'coupon_discount_total',v_coupon_discount,
    'normalized_city',v_normalized_city,'destination_status',v_destination_status,
    'shipping_rule_id',v_legacy_quote->>'shipping_rule_id',
    'shipping_rule_scope',v_legacy_quote->>'shipping_rule_scope',
    'shipping_rule_name',v_legacy_quote->>'shipping_rule_name',
    'shipping_rule_cost',v_rule_cost,'shipping_rule_threshold',v_rule_threshold,
    'coupon',jsonb_build_object(
      'id',v_coupon.id,'code',v_coupon.code,'discount_type',v_coupon.discount_type,
      'discount_value',v_coupon.discount_value,'minimum_subtotal',v_coupon.minimum_subtotal,
      'global_limit',v_coupon.global_limit,'per_customer_limit',v_coupon.per_customer_limit,
      'starts_at',v_coupon.starts_at,'end_at',v_coupon.end_at,'enabled',v_coupon.enabled
    )
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','El carrito o el cupón contienen un valor no válido.');
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    RETURN jsonb_build_object('success',false,'code','COUPON_QUOTE_FAILED','message','No se pudo verificar el cupón y la cotización.');
END;
$function$;
CREATE OR REPLACE FUNCTION public.cleanup_inventory_reservations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_product public.products%ROWTYPE;
  v_variants jsonb;
  v_new_variants jsonb;
  v_total integer;
  v_found boolean;
BEGIN
  UPDATE public.inventory_reservations
  SET status = 'EXPIRED'
  WHERE lower(COALESCE(status, '')) = 'active'
    AND expires_at <= now();
  FOR r IN
    SELECT ir.id, ir.product_id, ir.quantity, ir.color, ir.size
    FROM public.inventory_reservations ir
    WHERE upper(COALESCE(ir.status, '')) IN ('PENDING', 'WHATSAPP_RESERVED')
      AND ir.expires_at <= now()
    ORDER BY ir.product_id, ir.id
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO v_product FROM public.products p WHERE p.id = r.product_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_variants := COALESCE(v_product.variants, '[]'::jsonb);
    v_found := false;
    IF jsonb_typeof(v_variants) = 'array'
       AND jsonb_array_length(v_variants) > 0
       AND (COALESCE(trim(r.color), '') <> '' OR COALESCE(trim(r.size), '') <> '') THEN
      SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_variants) x(value)
        WHERE lower(trim(COALESCE(x.value->>'color', ''))) = lower(trim(COALESCE(r.color, '')))
          AND lower(trim(COALESCE(x.value->>'size', ''))) = lower(trim(COALESCE(r.size, '')))
      ) INTO v_found;
      IF NOT v_found THEN CONTINUE; END IF;
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN lower(trim(COALESCE(x.value->>'color', ''))) = lower(trim(COALESCE(r.color, '')))
           AND lower(trim(COALESCE(x.value->>'size', ''))) = lower(trim(COALESCE(r.size, '')))
          THEN jsonb_set(x.value, '{stock}', to_jsonb(GREATEST(0, COALESCE((x.value->>'stock')::integer, 0) + r.quantity)), true)
          ELSE x.value
        END ORDER BY x.ordinality), '[]'::jsonb)
      INTO v_new_variants
      FROM jsonb_array_elements(v_variants) WITH ORDINALITY x(value, ordinality);
      SELECT COALESCE(SUM(GREATEST(0, COALESCE((x.value->>'stock')::integer, 0))), 0)::integer
      INTO v_total FROM jsonb_array_elements(v_new_variants) x(value);
      UPDATE public.products SET variants = v_new_variants, quantity = v_total WHERE id = r.product_id;
    ELSE
      UPDATE public.products
      SET quantity = GREATEST(0, COALESCE(quantity, 0)) + GREATEST(0, r.quantity)
      WHERE id = r.product_id;
    END IF;
    UPDATE public.inventory_reservations
    SET status = 'EXPIRED'
    WHERE id = r.id
      AND upper(COALESCE(status, '')) IN ('PENDING', 'WHATSAPP_RESERVED');
  END LOOP;
END;
$function$;
CREATE OR REPLACE FUNCTION public.release_inventory_reservation(p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.inventory_reservations
     set status = 'RELEASED'
   where reference = p_reference
     and lower(coalesce(status,'')) = 'active';
end;
$function$;
CREATE OR REPLACE FUNCTION public.reserve_inventory(p_reference text, p_items jsonb, p_minutes integer DEFAULT 10)
 RETURNS TABLE(success boolean, message text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exp timestamptz := now() + make_interval(mins => GREATEST(1, LEAST(COALESCE(p_minutes, 10), 10)));
  v_existing_exp timestamptz;
  r record;
  v_product public.products%ROWTYPE;
  v_reserved integer := 0;
  v_qty integer := 0;
  v_total_stock integer := 0;
  v_variant_count integer := 0;
  v_variant_stock integer := 0;
  v_variant_available integer := 0;
  v_color_key text;
  v_size_key text;
BEGIN
  IF COALESCE(trim(p_reference), '') = '' OR length(p_reference) > 200 THEN
    RETURN QUERY SELECT false, 'Falta una referencia de reserva válida.', NULL::timestamptz;
    RETURN;
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RETURN QUERY SELECT false, 'El carrito debe ser una lista de productos.', NULL::timestamptz;
    RETURN;
  END IF;
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50 THEN
    RETURN QUERY SELECT false, 'El carrito debe contener entre 1 y 50 líneas de productos.', NULL::timestamptz;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS j(value)
     WHERE COALESCE(trim(j.value->>'id'), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR COALESCE(j.value->>'qty', '') !~ '^[0-9]+$'
        OR length(COALESCE(j.value->>'qty', '')) > 3
  ) THEN
    RETURN QUERY SELECT false, 'Una línea del carrito tiene un producto o una cantidad no válidos.', NULL::timestamptz;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS j(value)
     WHERE (j.value->>'qty')::integer < 1 OR (j.value->>'qty')::integer > 100
  ) THEN
    RETURN QUERY SELECT false, 'Cada cantidad debe estar entre 1 y 100 unidades.', NULL::timestamptz;
    RETURN;
  END IF;

  PERFORM public.cleanup_inventory_reservations();
  -- Dos intentos con la misma referencia no pueden reservar dos veces en paralelo.
  PERFORM pg_advisory_xact_lock(hashtext('jm_inventory_reservation:' || p_reference));
  SELECT MAX(ir.expires_at) INTO v_existing_exp
    FROM public.inventory_reservations AS ir
   WHERE ir.reference = p_reference
     AND ((ir.expires_at > now() AND (lower(COALESCE(ir.status, '')) = 'active' OR upper(COALESCE(ir.status, '')) IN ('PENDING','WHATSAPP_RESERVED'))) OR upper(COALESCE(ir.status, '')) = 'WHATSAPP_CONFIRMED');
  IF v_existing_exp IS NOT NULL THEN
    -- No reutilizar una referencia para un carrito distinto. Comparar la suma por
    -- producto/color/talla; si no coincide, devolver error sin insertar reservas.
    IF EXISTS (
      WITH wanted AS (
        SELECT (j.value->>'id')::uuid AS product_id,
               CASE WHEN lower(trim(COALESCE(j.value->>'color',''))) IN ('','sin color') THEN '' ELSE lower(trim(j.value->>'color')) END AS color_key,
               CASE WHEN lower(trim(COALESCE(j.value->>'size',''))) IN ('','unica','única') THEN '' ELSE lower(trim(j.value->>'size')) END AS size_key,
               SUM((j.value->>'qty')::integer)::integer AS qty
          FROM jsonb_array_elements(p_items) AS j(value)
         GROUP BY (j.value->>'id')::uuid,
                  CASE WHEN lower(trim(COALESCE(j.value->>'color',''))) IN ('','sin color') THEN '' ELSE lower(trim(j.value->>'color')) END,
                  CASE WHEN lower(trim(COALESCE(j.value->>'size',''))) IN ('','unica','única') THEN '' ELSE lower(trim(j.value->>'size')) END
      ), held AS (
        SELECT ir.product_id,
               CASE WHEN lower(trim(COALESCE(ir.color,''))) IN ('','sin color') THEN '' ELSE lower(trim(ir.color)) END AS color_key,
               CASE WHEN lower(trim(COALESCE(ir.size,''))) IN ('','unica','única') THEN '' ELSE lower(trim(ir.size)) END AS size_key,
               SUM(ir.quantity)::integer AS qty
          FROM public.inventory_reservations AS ir
         WHERE ir.reference = p_reference
           AND ir.expires_at > now()
           AND lower(COALESCE(ir.status,'')) = 'active'
         GROUP BY ir.product_id,
                  CASE WHEN lower(trim(COALESCE(ir.color,''))) IN ('','sin color') THEN '' ELSE lower(trim(ir.color)) END,
                  CASE WHEN lower(trim(COALESCE(ir.size,''))) IN ('','unica','única') THEN '' ELSE lower(trim(ir.size)) END
      )
      SELECT 1
        FROM wanted AS w
        FULL JOIN held AS h
          ON h.product_id = w.product_id
         AND h.color_key = w.color_key
         AND h.size_key = w.size_key
       WHERE w.product_id IS NULL
          OR h.product_id IS NULL
          OR w.qty <> h.qty
    ) THEN
      RETURN QUERY SELECT false, 'Esta referencia ya tiene una reserva activa para otro carrito. Inicia una nueva reserva.', NULL::timestamptz;
      RETURN;
    END IF;

    -- Si solo existe una reserva heredada para la referencia, nunca crear otra encima.
    IF EXISTS (
      SELECT 1 FROM public.inventory_reservations AS ir
       WHERE ir.reference = p_reference
         AND ir.expires_at > now()
         AND upper(COALESCE(ir.status,'')) IN ('PENDING','WHATSAPP_RESERVED','WHATSAPP_CONFIRMED')
    ) THEN
      RETURN QUERY SELECT false, 'Esta referencia pertenece a una reserva anterior. Inicia un nuevo intento de compra.', NULL::timestamptz;
      RETURN;
    END IF;

    RETURN QUERY SELECT true, 'La reserva existente sigue activa; no se duplicó.', v_existing_exp;
    RETURN;
  END IF;

  -- No crear una reserva nueva encima de una reserva heredada de la misma referencia.
  IF EXISTS (
    SELECT 1 FROM public.inventory_reservations AS ir
     WHERE ir.reference = p_reference
       AND ir.expires_at > now()
       AND upper(COALESCE(ir.status,'')) IN ('PENDING','WHATSAPP_RESERVED','WHATSAPP_CONFIRMED')
  ) THEN
    RETURN QUERY SELECT false, 'Esta referencia pertenece a una reserva anterior. Inicia un nuevo intento de compra.', NULL::timestamptz;
    RETURN;
  END IF;

  -- Bloquear productos siempre en orden de UUID para reducir interbloqueos.
  FOR r IN
    SELECT DISTINCT (j.value->>'id')::uuid AS product_id
      FROM jsonb_array_elements(p_items) AS j(value)
     ORDER BY product_id
  LOOP
    SELECT p.* INTO v_product
      FROM public.products AS p
     WHERE p.id = r.product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'Uno de los productos ya no existe.', NULL::timestamptz;
      RETURN;
    END IF;
  END LOOP;

  -- Primero se valida el agregado total del producto, considerando todas sus variantes
  -- y todas las reservas activas, para que las reservas antiguas/genéricas tampoco permitan sobreventa.
  FOR r IN
    SELECT (j.value->>'id')::uuid AS product_id,
           SUM((j.value->>'qty')::integer)::integer AS requested_qty
      FROM jsonb_array_elements(p_items) AS j(value)
     GROUP BY (j.value->>'id')::uuid
     ORDER BY product_id
  LOOP
    SELECT p.* INTO v_product FROM public.products AS p WHERE p.id = r.product_id;
    SELECT COALESCE(SUM(ir.quantity), 0)::integer INTO v_reserved
      FROM public.inventory_reservations AS ir
     WHERE ir.product_id = r.product_id AND ((ir.expires_at > now() AND (lower(COALESCE(ir.status, '')) = 'active' OR upper(COALESCE(ir.status, '')) IN ('PENDING','WHATSAPP_RESERVED'))) OR upper(COALESCE(ir.status, '')) = 'WHATSAPP_CONFIRMED');

    IF jsonb_typeof(COALESCE(v_product.variants, '[]'::jsonb)) = 'array'
       AND jsonb_array_length(COALESCE(v_product.variants, '[]'::jsonb)) > 0 THEN
      SELECT COALESCE(SUM(GREATEST(0, COALESCE((v.value->>'stock')::integer, 0))), 0)::integer
        INTO v_total_stock
        FROM jsonb_array_elements(v_product.variants) AS v(value);
    ELSE
      v_total_stock := GREATEST(0, COALESCE(v_product.quantity, 0));
    END IF;

    IF GREATEST(0, v_total_stock - v_reserved) < r.requested_qty THEN
      RETURN QUERY SELECT false, 'No hay suficientes unidades disponibles; una parte del producto está reservada por otro pedido.', NULL::timestamptz;
      RETURN;
    END IF;
  END LOOP;

  -- Validar cada combinación por separado. Las reservas ambiguas antiguas (color/talla vacíos)
  -- se asignan de forma determinista al stock visible, sin descontar todos los colores a la vez.
  FOR r IN
    SELECT (j.value->>'id')::uuid AS product_id,
           MAX(trim(COALESCE(j.value->>'color', ''))) AS color,
           MAX(trim(COALESCE(j.value->>'size', ''))) AS size,
           CASE WHEN lower(trim(COALESCE(j.value->>'color', ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(j.value->>'color')) END AS color_key,
           CASE WHEN lower(trim(COALESCE(j.value->>'size', ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(j.value->>'size')) END AS size_key,
           SUM((j.value->>'qty')::integer)::integer AS requested_qty
      FROM jsonb_array_elements(p_items) AS j(value)
     GROUP BY (j.value->>'id')::uuid,
              CASE WHEN lower(trim(COALESCE(j.value->>'color', ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(j.value->>'color')) END,
              CASE WHEN lower(trim(COALESCE(j.value->>'size', ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(j.value->>'size')) END
     ORDER BY product_id, color_key, size_key
  LOOP
    SELECT p.* INTO v_product FROM public.products AS p WHERE p.id = r.product_id;
    IF jsonb_typeof(COALESCE(v_product.variants, '[]'::jsonb)) = 'array'
       AND jsonb_array_length(COALESCE(v_product.variants, '[]'::jsonb)) > 0 THEN
      WITH variant_base AS (
        SELECT v.value AS variant, v.ordinality,
               CASE WHEN lower(trim(COALESCE(v.value->>'color', ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(v.value->>'color')) END AS color_key,
               CASE WHEN lower(trim(COALESCE(v.value->>'size', ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(v.value->>'size')) END AS size_key,
               GREATEST(0, COALESCE((v.value->>'stock')::integer, 0) - COALESCE(sr.reserved_qty, 0))::integer AS stock_after_specific
          FROM jsonb_array_elements(v_product.variants) WITH ORDINALITY AS v(value, ordinality)
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
              FROM public.inventory_reservations AS ir
             WHERE ir.product_id = r.product_id AND ((ir.expires_at > now() AND (lower(COALESCE(ir.status, '')) = 'active' OR upper(COALESCE(ir.status, '')) IN ('PENDING','WHATSAPP_RESERVED'))) OR upper(COALESCE(ir.status, '')) = 'WHATSAPP_CONFIRMED')
               AND NOT (COALESCE(trim(ir.color), '') = '' AND COALESCE(trim(ir.size), '') = '')
               AND (CASE WHEN lower(trim(COALESCE(ir.color, ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(ir.color)) END) =
                   (CASE WHEN lower(trim(COALESCE(v.value->>'color', ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(v.value->>'color')) END)
               AND (CASE WHEN lower(trim(COALESCE(ir.size, ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(ir.size)) END) =
                   (CASE WHEN lower(trim(COALESCE(v.value->>'size', ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(v.value->>'size')) END)
          ) AS sr ON true
      ), variant_available AS (
        SELECT vb.*,
               GREATEST(0, vb.stock_after_specific - LEAST(
                 vb.stock_after_specific,
                 GREATEST(0, COALESCE(gr.reserved_qty, 0) - COALESCE(SUM(vb.stock_after_specific) OVER (
                   ORDER BY vb.ordinality ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                 ), 0))
               ))::integer AS available_stock
          FROM variant_base AS vb
          CROSS JOIN LATERAL (
            SELECT COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
              FROM public.inventory_reservations AS ir
             WHERE ir.product_id = r.product_id AND ((ir.expires_at > now() AND (lower(COALESCE(ir.status, '')) = 'active' OR upper(COALESCE(ir.status, '')) IN ('PENDING','WHATSAPP_RESERVED'))) OR upper(COALESCE(ir.status, '')) = 'WHATSAPP_CONFIRMED')
               AND COALESCE(trim(ir.color), '') = '' AND COALESCE(trim(ir.size), '') = ''
          ) AS gr
      )
      SELECT COUNT(*)::integer, COALESCE(MAX(va.available_stock), 0)::integer
        INTO v_variant_count, v_variant_available
        FROM variant_available AS va
       WHERE va.color_key = r.color_key AND va.size_key = r.size_key;

      IF v_variant_count = 0 THEN
        RETURN QUERY SELECT false, 'La combinación de color/talla ya no existe. Recarga el catálogo y vuelve a intentarlo.', NULL::timestamptz;
        RETURN;
      ELSIF v_variant_count > 1 THEN
        RETURN QUERY SELECT false, 'Hay variantes duplicadas con el mismo color/talla. Revisa el inventario antes de vender.', NULL::timestamptz;
        RETURN;
      ELSIF v_variant_available < r.requested_qty THEN
        RETURN QUERY SELECT false, 'Esa talla/color está agotada o reservada por otro cliente.', NULL::timestamptz;
        RETURN;
      END IF;
    END IF;
  END LOOP;

  -- Una fila por combinación seleccionada, no una reserva general por producto.
  INSERT INTO public.inventory_reservations(reference, product_id, quantity, color, size, expires_at, status)
  SELECT p_reference,
         (j.value->>'id')::uuid,
         SUM((j.value->>'qty')::integer)::integer,
         MAX(trim(COALESCE(j.value->>'color', ''))),
         MAX(trim(COALESCE(j.value->>'size', ''))),
         v_exp,
         'active'
    FROM jsonb_array_elements(p_items) AS j(value)
   GROUP BY (j.value->>'id')::uuid,
            CASE WHEN lower(trim(COALESCE(j.value->>'color', ''))) IN ('', 'sin color') THEN '' ELSE lower(trim(j.value->>'color')) END,
            CASE WHEN lower(trim(COALESCE(j.value->>'size', ''))) IN ('', 'unica', 'única') THEN '' ELSE lower(trim(j.value->>'size')) END;

  RETURN QUERY SELECT true, 'Inventario reservado durante 10 minutos por color/talla.', v_exp;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, 'No se pudo reservar el inventario: ' || SQLERRM, NULL::timestamptz;
END;
$function$;
CREATE OR REPLACE FUNCTION public.reserve_order_inventory(p_reference text, p_items jsonb, p_minutes integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_success boolean;
    v_message text;
    v_exp timestamptz;
BEGIN
    SELECT x.success, x.message, x.expires_at
      INTO v_success, v_message, v_exp
      FROM public.reserve_inventory(p_reference, p_items, p_minutes) AS x;

    RETURN jsonb_build_object(
        'success', COALESCE(v_success, false),
        'message', v_message,
        'reference', p_reference,
        'expires_at', v_exp
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.reserve_storefront_coupon_redemption(p_coupon_code text, p_channel text, p_reference text, p_customer_email text, p_customer_phone text, p_discount_total bigint, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_code text:=upper(btrim(coalesce(p_coupon_code,'')));
  v_channel text:=lower(btrim(coalesce(p_channel,'')));
  v_reference text:=btrim(coalesce(p_reference,''));
  v_normalized_email text;
  v_normalized_phone text;
  v_customer_hash text;
  v_coupon public.storefront_coupons%ROWTYPE;
  v_existing public.storefront_coupon_redemptions%ROWTYPE;
  v_global_count bigint;
  v_customer_count bigint;
  v_id uuid;
  v_reopen_terminal boolean:=false;
  v_expires_at timestamptz:=now()+interval '10 minutes';
BEGIN
  IF v_channel NOT IN ('wompi','cod') OR v_reference='' OR length(v_reference)>200 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_INPUT_INVALID','message','La reserva del cupón no tiene un canal o referencia válidos.');
  END IF;
  IF v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' OR p_discount_total IS NULL OR p_discount_total<=0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_INPUT_INVALID','message','La reserva del cupón no tiene código o descuento válidos.');
  END IF;
  IF p_expires_at IS NOT NULL THEN
    IF p_expires_at<=now() OR p_expires_at>now()+interval '10 minutes' THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_EXPIRY_INVALID','message','La expiración del cupón no coincide con la reserva segura de inventario.');
    END IF;
    v_expires_at:=p_expires_at;
  END IF;
  v_normalized_email:=lower(btrim(coalesce(p_customer_email,'')));
  v_normalized_phone:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_customer_hash:=public._storefront_coupon_customer_hash(v_normalized_email,v_normalized_phone);
  PERFORM pg_advisory_xact_lock(hashtext('storefront-coupon-reference:'||v_channel||':'||v_reference));
  SELECT r.* INTO v_existing FROM public.storefront_coupon_redemptions r
   WHERE r.channel=v_channel AND r.reference=v_reference FOR UPDATE;
  IF FOUND THEN
    IF v_existing.code IS DISTINCT FROM v_code OR v_existing.customer_hash IS DISTINCT FROM v_customer_hash
       OR v_existing.discount_total IS DISTINCT FROM p_discount_total THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_CONFLICT','message','La referencia ya existe con otros datos de cupón.');
    END IF;
    IF v_existing.status='released' THEN
      SELECT EXISTS (
        SELECT 1
          FROM public.storefront_wompi_payment_attempts a
          JOIN public.orders o ON o.reference=a.order_reference
         WHERE a.order_reference=v_reference
           AND a.attempt_number=(SELECT max(ax.attempt_number) FROM public.storefront_wompi_payment_attempts ax WHERE ax.order_reference=v_reference)
           AND a.attempt_reference=v_existing.released_attempt_reference
           AND a.status IN ('ERROR','DECLINED','VOIDED') AND a.environment='prod' AND a.currency='COP'
           AND a.transaction_id=o.transaction_id AND a.transaction_id IS NOT NULL
           AND a.terminal_at IS NOT NULL AND a.terminal_at+interval '15 minutes'<=now()
           AND upper(coalesce(o.payment_status,''))=a.status AND lower(o.payment_method)='wompi'
           AND o.coupon_id=v_existing.coupon_id AND upper(coalesce(o.coupon_code,''))=v_code
           AND coalesce(o.coupon_discount_total,0)=p_discount_total
           AND o.wompi_reconciliation_required=false AND o.coupon_reconciliation_required=false
           AND v_existing.reconciliation_required=false
      ) INTO v_reopen_terminal;
      IF v_channel<>'wompi' OR NOT v_reopen_terminal THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_RELEASED','message','La referencia ya liberó su reserva y no puede reutilizarse.');
      END IF;
    END IF;

    IF (v_existing.status='reserved' AND v_existing.expires_at<=now()) OR v_reopen_terminal THEN
      IF v_channel='cod' AND EXISTS (SELECT 1 FROM public.web_orders w WHERE w.client_reference=v_reference) THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_ALREADY_USED','message','La referencia COD ya tiene un pedido y no puede renovar el cupón.');
      END IF;
      SELECT c.* INTO v_coupon FROM public.storefront_coupons c WHERE c.id=v_existing.coupon_id FOR UPDATE;
      IF NOT FOUND OR NOT v_coupon.enabled OR (v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at>now())
         OR (v_coupon.end_at IS NOT NULL AND v_coupon.end_at<=now()) THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_NOT_ACTIVE','message','El cupón ya no está vigente.');
      END IF;
      IF v_coupon.per_customer_limit IS NOT NULL
         AND (length(v_normalized_email)>254 OR v_normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
              OR v_normalized_phone !~ '^[0-9]{10}$') THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_REQUIRED','message','Este cupón requiere correo y teléfono para validar su límite por cliente.');
      END IF;
      SELECT count(*) INTO v_global_count FROM public.storefront_coupon_redemptions r
       WHERE r.coupon_id=v_coupon.id AND r.id<>v_existing.id
         AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
      IF v_coupon.global_limit IS NOT NULL AND v_global_count>=v_coupon.global_limit THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_GLOBAL_LIMIT','message','El cupón alcanzó su límite de usos.');
      END IF;
      SELECT count(*) INTO v_customer_count FROM public.storefront_coupon_redemptions r
       WHERE r.coupon_id=v_coupon.id AND r.id<>v_existing.id AND r.customer_hash=v_customer_hash
         AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
      IF v_coupon.per_customer_limit IS NOT NULL AND v_customer_count>=v_coupon.per_customer_limit THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_LIMIT','message','Ya alcanzaste el límite de uso de este cupón.');
      END IF;
      UPDATE public.storefront_coupon_redemptions r
         SET status='reserved',expires_at=v_expires_at,reconciliation_required=false,
             released_attempt_reference=NULL,updated_at=now()
       WHERE r.id=v_existing.id;
      RETURN jsonb_build_object('success',true,'id',v_existing.id,'coupon_id',v_existing.coupon_id,
        'coupon_code',v_existing.code,'channel',v_existing.channel,'reference',v_existing.reference,
        'discount_total',v_existing.discount_total,'status','reserved','expires_at',v_expires_at,
        'reconciliation_required',false,'idempotent',true,
        'renewed_after_expiry',v_existing.status='reserved' AND v_existing.expires_at<=now(),
        'reopened_after_terminal',v_reopen_terminal);
    END IF;
    IF v_existing.status='reserved' AND p_expires_at IS NOT NULL AND v_existing.expires_at IS DISTINCT FROM v_expires_at THEN
      UPDATE public.storefront_coupon_redemptions r SET expires_at=v_expires_at,updated_at=now() WHERE r.id=v_existing.id;
    END IF;
    RETURN jsonb_build_object('success',true,'id',v_existing.id,'coupon_id',v_existing.coupon_id,
      'coupon_code',v_existing.code,'channel',v_existing.channel,'reference',v_existing.reference,
      'discount_total',v_existing.discount_total,'status',v_existing.status,
      'expires_at',CASE WHEN v_existing.status='reserved' AND p_expires_at IS NOT NULL THEN v_expires_at ELSE v_existing.expires_at END,
      'reconciliation_required',v_existing.reconciliation_required,'idempotent',true);
  END IF;

  SELECT c.* INTO v_coupon FROM public.storefront_coupons c WHERE c.code=v_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','COUPON_INVALID','message','El cupón no existe.'); END IF;
  IF NOT v_coupon.enabled OR (v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at>now())
     OR (v_coupon.end_at IS NOT NULL AND v_coupon.end_at<=now()) THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_NOT_ACTIVE','message','El cupón no está vigente.');
  END IF;
  IF v_coupon.per_customer_limit IS NOT NULL
     AND (length(v_normalized_email)>254 OR v_normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          OR v_normalized_phone !~ '^[0-9]{10}$') THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_REQUIRED','message','Este cupón requiere correo y teléfono para validar su límite por cliente.');
  END IF;
  SELECT count(*) INTO v_global_count FROM public.storefront_coupon_redemptions r
   WHERE r.coupon_id=v_coupon.id AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
  IF v_coupon.global_limit IS NOT NULL AND v_global_count>=v_coupon.global_limit THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_GLOBAL_LIMIT','message','El cupón alcanzó su límite de usos.');
  END IF;
  SELECT count(*) INTO v_customer_count FROM public.storefront_coupon_redemptions r
   WHERE r.coupon_id=v_coupon.id AND r.customer_hash=v_customer_hash
     AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
  IF v_coupon.per_customer_limit IS NOT NULL AND v_customer_count>=v_coupon.per_customer_limit THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_LIMIT','message','Ya alcanzaste el límite de uso de este cupón.');
  END IF;
  INSERT INTO public.storefront_coupon_redemptions(coupon_id,code,channel,reference,customer_hash,discount_total,status,expires_at,
    reconciliation_required,created_at,updated_at)
  VALUES(v_coupon.id,v_coupon.code,v_channel,v_reference,v_customer_hash,p_discount_total,'reserved',v_expires_at,false,now(),now())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id,'coupon_id',v_coupon.id,'coupon_code',v_coupon.code,
    'channel',v_channel,'reference',v_reference,'discount_total',p_discount_total,'status','reserved',
    'expires_at',v_expires_at,'reconciliation_required',false,'idempotent',false);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_CONFLICT','message','La referencia ya fue reservada en otra transacción.');
END;
$function$;
CREATE OR REPLACE FUNCTION public.release_storefront_coupon_redemption(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.storefront_coupon_redemptions%ROWTYPE;
BEGIN
  SELECT r.* INTO v_row
    FROM public.storefront_coupon_redemptions AS r
   WHERE r.channel='wompi' AND r.reference=btrim(coalesce(p_reference,''))
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_NOT_FOUND','message','No existe una reserva Wompi para esa referencia.');
  END IF;
  IF v_row.status='redeemed' THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_ALREADY_REDEEMED','message','El cupón ya fue consumido; no se puede liberar.');
  END IF;
  IF v_row.status='released' THEN
    RETURN jsonb_build_object('success',true,'id',v_row.id,'reference',v_row.reference,'status','released','idempotent',true);
  END IF;
  UPDATE public.storefront_coupon_redemptions AS r
     SET status='released',released_at=coalesce(r.released_at,now()),updated_at=now()
   WHERE r.id=v_row.id;
  RETURN jsonb_build_object('success',true,'id',v_row.id,'reference',v_row.reference,'status','released','idempotent',false);
END;
$function$;
CREATE OR REPLACE FUNCTION public.expire_storefront_coupon_redemption(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_row public.storefront_coupon_redemptions%ROWTYPE;
BEGIN
  IF v_reference='' THEN RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_INVALID'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-coupon-reference:wompi:'||v_reference));
  SELECT r.* INTO v_row FROM public.storefront_coupon_redemptions AS r
   WHERE r.channel='wompi' AND r.reference=v_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'found',false); END IF;
  IF v_row.status='redeemed' OR v_row.status='released' THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_FINAL','status',v_row.status);
  END IF;
  UPDATE public.storefront_coupon_redemptions AS r
     SET expires_at=now(),updated_at=now()
   WHERE r.id=v_row.id AND r.status='reserved';
  RETURN jsonb_build_object('success',true,'found',true,'status','reserved','expires_at',now());
END;
$function$;
CREATE OR REPLACE FUNCTION public.confirm_storefront_coupon_redemption(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.storefront_coupon_redemptions%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_reconciliation boolean;
BEGIN
  SELECT r.* INTO v_row
    FROM public.storefront_coupon_redemptions AS r
   WHERE r.channel='wompi' AND r.reference=btrim(coalesce(p_reference,''))
   FOR UPDATE;
  IF NOT FOUND THEN
    SELECT o.* INTO v_order
      FROM public.orders AS o
     WHERE o.reference=btrim(coalesce(p_reference,''))
       AND lower(coalesce(o.payment_method,''))='wompi'
       AND o.coupon_id IS NOT NULL
       AND o.coupon_code IS NOT NULL
       AND coalesce(o.coupon_discount_total,0)>0
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_NOT_FOUND','message','No existe una reserva Wompi ni un pedido con cupón para esa referencia.');
    END IF;
    INSERT INTO public.storefront_coupon_redemptions(
      coupon_id,code,channel,reference,customer_hash,discount_total,status,expires_at,
      reconciliation_required,created_at,updated_at,redeemed_at
    ) VALUES (
      v_order.coupon_id,upper(btrim(v_order.coupon_code)),'wompi',btrim(p_reference),
      encode(extensions.digest('missing-ledger:'||btrim(p_reference),'sha256'),'hex'),
      round(v_order.coupon_discount_total)::bigint,'redeemed',now(),true,now(),now(),now()
    ) ON CONFLICT (channel,reference) DO NOTHING;
    SELECT r.* INTO v_row FROM public.storefront_coupon_redemptions AS r
     WHERE r.channel='wompi' AND r.reference=btrim(coalesce(p_reference,'')) FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_NOT_FOUND','message','No se pudo registrar la redención de conciliación.');
    END IF;
  END IF;
  IF v_row.status='redeemed' THEN
    RETURN jsonb_build_object('success',true,'id',v_row.id,'reference',v_row.reference,'status','redeemed',
      'discount_total',v_row.discount_total,'reconciliation_required',v_row.reconciliation_required,'idempotent',true);
  END IF;
  -- Wompi already verified a successful payment. Honor it even if a terminal
  -- webhook had released the hold; the over-limit exception is reviewable.
  v_reconciliation:=v_row.status='released' OR v_row.expires_at<=now();
  UPDATE public.storefront_coupon_redemptions AS r
     SET status='redeemed',redeemed_at=coalesce(r.redeemed_at,now()),updated_at=now(),
         reconciliation_required=r.reconciliation_required OR v_reconciliation,
         released_at=CASE WHEN v_row.status='released' THEN r.released_at ELSE NULL END
   WHERE r.id=v_row.id;
  RETURN jsonb_build_object(
    'success',true,'id',v_row.id,'reference',v_row.reference,'status','redeemed',
    'discount_total',v_row.discount_total,'reconciliation_required',v_row.reconciliation_required OR v_reconciliation,
    'expired_reservation',v_reconciliation,'idempotent',false
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.release_storefront_wompi_coupon_redemption_for_attempt(p_order_reference text, p_attempt_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_order_reference text;
  v_phone_hash text;
  v_latest integer;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_attempt public.storefront_wompi_payment_attempts%ROWTYPE;
  v_updated integer;
BEGIN
  SELECT a.order_reference,a.customer_phone_hash INTO v_order_reference,v_phone_hash
    FROM public.storefront_wompi_payment_attempts a
   WHERE a.attempt_reference=p_attempt_reference AND a.order_reference=p_order_reference;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_ATTEMPT_REQUIRED'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_order_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l
   WHERE l.reference=v_order_reference FOR UPDATE;
  IF NOT FOUND OR v_lock.customer_phone_hash<>v_phone_hash
     OR v_lock.transaction_id IS DISTINCT FROM (SELECT a.transaction_id FROM public.storefront_wompi_payment_attempts a WHERE a.attempt_reference=p_attempt_reference) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_LOCK_NOT_FOUND');
  END IF;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_order_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_ORDER_NOT_FOUND'); END IF;
  SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a
   WHERE a.attempt_reference=p_attempt_reference AND a.order_reference=p_order_reference FOR UPDATE;
  IF NOT FOUND OR v_attempt.environment<>'prod' OR v_attempt.status NOT IN ('ERROR','DECLINED','VOIDED')
     OR v_attempt.transaction_id IS NULL OR v_attempt.terminal_at IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_ATTEMPT_REQUIRED');
  END IF;
  SELECT max(a.attempt_number) INTO v_latest FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=p_order_reference;
  IF v_latest IS DISTINCT FROM v_attempt.attempt_number THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_NOT_CURRENT');
  END IF;
  IF lower(v_order.payment_method)<>'wompi'
     OR upper(v_order.payment_status) NOT IN ('PENDING',v_attempt.status)
     OR v_order.transaction_id IS DISTINCT FROM v_attempt.transaction_id
     OR v_order.wompi_reconciliation_required=true OR v_order.coupon_reconciliation_required=true THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_STATE_CONFLICT');
  END IF;
  UPDATE public.storefront_coupon_redemptions r
     SET status='released',released_attempt_reference=p_attempt_reference,updated_at=now()
   WHERE r.channel='wompi' AND r.reference=p_order_reference AND r.status='reserved'
     AND r.coupon_id=v_order.coupon_id AND r.code=upper(coalesce(v_order.coupon_code,''))
     AND r.discount_total=coalesce(v_order.coupon_discount_total,0)
  RETURNING 1 INTO v_updated;
  IF v_updated IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.storefront_coupon_redemptions r
        WHERE r.channel='wompi' AND r.reference=p_order_reference AND r.status='released'
          AND r.released_attempt_reference=p_attempt_reference) THEN
      RETURN jsonb_build_object('success',true,'idempotent',true,'status','released');
    END IF;
    RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('success',true,'status','released','attempt_reference',p_attempt_reference);
END;
$function$;
CREATE OR REPLACE FUNCTION public.reserve_storefront_wompi_checkout_lock(p_reference text, p_customer_phone text, p_cart_hash text, p_minutes integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_phone_hash text;
  v_row public.storefront_wompi_checkout_locks%ROWTYPE;
  v_expires_at timestamptz;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR v_phone !~ '^[0-9]{10}$'
     OR p_cart_hash IS NULL OR p_cart_hash !~ '^[0-9a-fA-F]{64}$'
     OR p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LOCK_INPUT_INVALID','message','No se pudo validar el intento de checkout.');
  END IF;
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  v_expires_at:=now()+make_interval(mins=>p_minutes);
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.reconciliation_required=true
   LIMIT 1 FOR UPDATE;
  IF FOUND OR EXISTS (
    SELECT 1 FROM public.orders AS o
     WHERE lower(o.payment_method)='wompi'
       AND (o.wompi_reconciliation_required=true OR o.coupon_reconciliation_required=true)
       AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
  ) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED','message','Existe un pago que requiere revisión manual antes de iniciar otro checkout.');
  END IF;

  UPDATE public.storefront_wompi_checkout_locks AS l
     SET status='pending',expires_at='infinity',updated_at=now()
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='active' AND l.transaction_id IS NOT NULL;
  UPDATE public.storefront_wompi_checkout_locks AS l
     SET status='expired',updated_at=now()
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='active' AND l.expires_at<=now() AND l.transaction_id IS NULL;
  UPDATE public.storefront_wompi_checkout_locks AS l
     SET status='released',expires_at=now(),updated_at=now()
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='terminal_grace' AND l.terminal_at+interval '15 minutes'<=now();

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='terminal_grace' LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_GRACE','existing_reference',v_row.reference,'expires_at',v_row.terminal_at+interval '15 minutes','message','El intento anterior terminó. Espera unos minutos antes de volver a iniciar un pago para evitar una aprobación tardía duplicada.');
  END IF;

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='pending' LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_PENDING','existing_reference',v_row.reference,'message','Hay una transacción Wompi pendiente para este teléfono; espera su confirmación antes de iniciar otro pago.');
  END IF;

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='active' AND l.expires_at>now() LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_row.reference<>v_reference THEN
      IF v_row.cart_hash=lower(p_cart_hash) THEN
        RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_RESERVATION','existing_reference',v_row.reference,'expires_at',v_row.expires_at,'message','Ya existe una reserva activa para este carrito.');
      END IF;
      RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART','existing_reference',v_row.reference,'expires_at',v_row.expires_at,'message','Ya hay un checkout activo para este teléfono con otro carrito.');
    END IF;
    IF v_row.checkout_claimed_at IS NOT NULL AND v_row.checkout_claimed_at>now()-make_interval(mins=>p_minutes) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_ALREADY_PREPARED','existing_reference',v_row.reference,'expires_at',v_row.expires_at,'message','Este intento ya preparó una sesión Wompi. Espera a que venza antes de volver a iniciarla.');
    END IF;
    UPDATE public.storefront_wompi_checkout_locks AS l SET expires_at=v_expires_at,checkout_claimed_at=NULL,updated_at=now() WHERE l.reference=v_reference;
    RETURN jsonb_build_object('success',true,'reference',v_reference,'expires_at',v_expires_at,'idempotent',true);
  END IF;

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l WHERE l.reference=v_reference FOR UPDATE;
  IF FOUND THEN
    IF v_row.customer_phone_hash<>v_phone_hash OR v_row.cart_hash<>lower(p_cart_hash) OR v_row.status IN ('pending','completed') OR v_row.transaction_id IS NOT NULL THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT','message','La referencia ya está asociada a otro intento o transacción.');
    END IF;
    UPDATE public.storefront_wompi_checkout_locks AS l SET customer_phone_hash=v_phone_hash,cart_hash=lower(p_cart_hash),status='active',expires_at=v_expires_at,checkout_claimed_at=NULL,transaction_id=NULL,updated_at=now() WHERE l.reference=v_reference;
    RETURN jsonb_build_object('success',true,'reference',v_reference,'expires_at',v_expires_at,'renewed',true);
  END IF;

  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at)
  VALUES(v_reference,v_phone_hash,lower(p_cart_hash),'active',v_expires_at);
  RETURN jsonb_build_object('success',true,'reference',v_reference,'expires_at',v_expires_at,'idempotent',false);
EXCEPTION WHEN unique_violation THEN
  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l WHERE l.customer_phone_hash=v_phone_hash AND l.status IN ('active','pending','terminal_grace') LIMIT 1;
  IF FOUND AND v_row.status='pending' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_PENDING','existing_reference',v_row.reference);
  ELSIF FOUND AND v_row.status='terminal_grace' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_GRACE','existing_reference',v_row.reference,'expires_at',v_row.terminal_at+interval '15 minutes');
  ELSIF FOUND AND v_row.status='active' AND v_row.cart_hash=lower(p_cart_hash) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_RESERVATION','existing_reference',v_row.reference,'expires_at',v_row.expires_at);
  ELSIF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART','existing_reference',v_row.reference,'expires_at',v_row.expires_at);
  END IF;
  RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT','message','No se pudo reservar una referencia única para el checkout.');
END;
$function$;
CREATE OR REPLACE FUNCTION public.claim_storefront_wompi_checkout(p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_row public.storefront_wompi_checkout_locks%ROWTYPE;
BEGIN
  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.reference=v_reference FOR UPDATE;
  IF NOT FOUND OR v_row.status<>'active' OR v_row.expires_at<=now() OR v_row.transaction_id IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LOCK_NOT_ACTIVE');
  END IF;
  IF v_row.checkout_claimed_at IS NOT NULL AND v_row.checkout_claimed_at>now()-interval '10 minutes' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_ALREADY_PREPARED');
  END IF;
  UPDATE public.storefront_wompi_checkout_locks AS l
     SET checkout_claimed_at=now(),updated_at=now()
   WHERE l.reference=v_reference;
  RETURN jsonb_build_object('success',true,'reference',v_reference,'claimed_at',now());
END;
$function$;
CREATE OR REPLACE FUNCTION public.prepare_storefront_wompi_retry_lock(p_reference text, p_customer_phone text, p_cart_hash text, p_minutes integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_phone_hash text;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_attempt public.storefront_wompi_payment_attempts%ROWTYPE;
  v_other_reference text;
  v_expires_at timestamptz;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$' OR v_phone !~ '^[0-9]{10}$'
     OR p_cart_hash IS NULL OR p_cart_hash !~ '^[0-9a-fA-F]{64}$'
     OR p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RETRY_INPUT_INVALID');
  END IF;
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  v_expires_at:=now()+make_interval(mins=>p_minutes);
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));

  IF EXISTS (
    SELECT 1 FROM public.storefront_wompi_checkout_locks l
     WHERE l.customer_phone_hash=v_phone_hash AND l.reconciliation_required=true
  ) OR EXISTS (
    SELECT 1 FROM public.orders o
     WHERE lower(o.payment_method)='wompi'
       AND (o.wompi_reconciliation_required=true OR o.coupon_reconciliation_required=true)
       AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
  ) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED');
  END IF;

  SELECT l.* INTO v_lock
    FROM public.storefront_wompi_checkout_locks l
   WHERE l.customer_phone_hash=v_phone_hash
     AND l.cart_hash=lower(p_cart_hash)
     AND l.status IN ('terminal_grace','released')
     AND l.transaction_id IS NOT NULL
   ORDER BY l.terminal_at DESC NULLS LAST,l.updated_at DESC
   LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_NO_RETRYABLE_ORDER');
  END IF;
  IF v_lock.reconciliation_required THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED');
  END IF;
  IF v_lock.terminal_at IS NULL OR v_lock.terminal_at+interval '15 minutes'>now() THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_GRACE',
      'existing_reference',v_lock.reference,'expires_at',v_lock.terminal_at+interval '15 minutes');
  END IF;

  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.reference=v_lock.reference AND lower(o.payment_method)='wompi'
   FOR UPDATE;
  IF NOT FOUND OR v_order.transaction_id IS DISTINCT FROM v_lock.transaction_id
     OR upper(coalesce(v_order.payment_status,'')) NOT IN ('ERROR','DECLINED','VOIDED')
     OR v_order.wompi_reconciliation_required=true OR v_order.coupon_reconciliation_required=true THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED');
  END IF;

  SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=v_lock.reference
   ORDER BY a.attempt_number DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_attempt.transaction_id IS DISTINCT FROM v_order.transaction_id
     OR v_attempt.status IS DISTINCT FROM upper(v_order.payment_status)
     OR v_attempt.status NOT IN ('ERROR','DECLINED','VOIDED')
     OR v_attempt.environment<>'prod' OR v_attempt.currency<>'COP'
     OR v_attempt.customer_phone_hash<>v_phone_hash
     OR v_attempt.amount_in_cents<>round(v_order.total::numeric*100)::bigint
     OR v_attempt.terminal_at IS NULL OR v_attempt.terminal_at+interval '15 minutes'>now() THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_HISTORY_REQUIRED');
  END IF;

  SELECT l.reference INTO v_other_reference
    FROM public.storefront_wompi_checkout_locks l
   WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_lock.reference
     AND l.status IN ('active','pending','terminal_grace')
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART','existing_reference',v_other_reference);
  END IF;

  IF v_reference<>v_lock.reference THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REUSE_EXISTING_ORDER',
      'existing_reference',v_lock.reference,'message','Se reutilizará el pedido anterior; no se creará otro pedido para este carrito.');
  END IF;

  UPDATE public.storefront_wompi_checkout_locks l
     SET status='active',expires_at=v_expires_at,checkout_claimed_at=NULL,
         transaction_id=NULL,terminal_at=NULL,updated_at=now()
   WHERE l.reference=v_lock.reference;
  RETURN jsonb_build_object('success',true,'reference',v_lock.reference,'expires_at',v_expires_at,
    'retry_after_terminal',true,'attempt_number',v_attempt.attempt_number+1);
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_storefront_wompi_checkout_state(p_reference text, p_state text, p_transaction_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_state text:=lower(btrim(coalesce(p_state,'')));
  v_transaction_id text:=nullif(btrim(coalesce(p_transaction_id,'')),'');
  v_other_reference text;
  v_phone text;
  v_phone_hash text;
  v_new_expires_at timestamptz;
  v_found boolean;
  v_row public.storefront_wompi_checkout_locks%ROWTYPE;
BEGIN
  IF v_state NOT IN ('pending','terminal_grace','completed','released') OR v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR (v_transaction_id IS NOT NULL AND v_transaction_id !~ '^[A-Za-z0-9_-]{1,120}$')
     OR (v_state IN ('pending','terminal_grace','completed') AND v_transaction_id IS NULL) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LOCK_STATE_INVALID');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_reference));
  SELECT l.customer_phone_hash INTO v_phone_hash
    FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.reference=v_reference;
  v_found:=FOUND;
  IF v_found THEN
    PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  END IF;
  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.reference=v_reference FOR UPDATE;
  v_found:=FOUND;
  IF NOT v_found AND v_state IN ('pending','terminal_grace') THEN
    SELECT public._storefront_coupon_normalized_phone(o.phone) INTO v_phone
      FROM public.orders AS o
     WHERE o.reference=v_reference AND lower(o.payment_method)='wompi'
     LIMIT 1;
    IF v_phone ~ '^[0-9]{10}$' THEN
      v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
      PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
      v_new_expires_at:=CASE WHEN v_state='pending' THEN 'infinity'::timestamptz ELSE now()+interval '15 minutes' END;
      BEGIN
        INSERT INTO public.storefront_wompi_checkout_locks(
          reference,customer_phone_hash,cart_hash,status,expires_at,transaction_id,terminal_at
        ) VALUES(
          v_reference,v_phone_hash,repeat('0',64),v_state,v_new_expires_at,v_transaction_id,
          CASE WHEN v_state='terminal_grace' THEN now() ELSE NULL END
        );
        RETURN jsonb_build_object('success',true,'found',true,'state',v_state,'legacy_lock_created',true);
      EXCEPTION WHEN unique_violation THEN
        -- Another checkout may already own this phone. Preserve a tombstone so a
        -- later APPROVED event can be reconciled without violating the phone index.
        INSERT INTO public.storefront_wompi_checkout_locks(
          reference,customer_phone_hash,cart_hash,status,expires_at,transaction_id,terminal_at,reconciliation_required
        ) VALUES(
          v_reference,v_phone_hash,repeat('0',64),'released',now(),v_transaction_id,
          CASE WHEN v_state='terminal_grace' THEN now() ELSE NULL END,v_state='pending'
        ) ON CONFLICT (reference) DO NOTHING;
        SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
         WHERE l.reference=v_reference;
        v_found:=FOUND;
        IF v_found THEN
          SELECT l.reference INTO v_other_reference
            FROM public.storefront_wompi_checkout_locks AS l
           WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_reference
             AND l.status IN ('active','pending','terminal_grace')
           LIMIT 1;
          RETURN jsonb_build_object('success',true,'found',true,'state',v_row.status,
            'late_approval_conflict',v_state='pending' AND v_other_reference IS NOT NULL,
            'terminal_lock_conflict',v_state='terminal_grace' AND v_other_reference IS NOT NULL,
            'other_reference',v_other_reference);
        END IF;
      END;
    END IF;
  END IF;
  IF NOT v_found THEN RETURN jsonb_build_object('success',true,'found',false,'state',v_state); END IF;
  IF v_row.transaction_id IS NOT NULL AND v_transaction_id IS NOT NULL
     AND v_row.transaction_id<>v_transaction_id THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_LOCK_CONFLICT');
  END IF;
  IF v_row.transaction_id IS NOT NULL AND v_transaction_id IS NULL AND v_state='released' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_LOCK_CONFLICT');
  END IF;
  IF v_state='terminal_grace' AND v_row.status<>'completed' AND v_row.terminal_at IS NOT NULL
     AND v_row.terminal_at+interval '15 minutes'<=now() THEN
    UPDATE public.storefront_wompi_checkout_locks AS l
       SET status='released',expires_at=now(),transaction_id=coalesce(v_transaction_id,l.transaction_id),updated_at=now()
     WHERE l.reference=v_reference;
    RETURN jsonb_build_object('success',true,'found',true,'state','released','grace_expired',true);
  END IF;
  IF v_state='pending' AND v_row.status IN ('released','expired') THEN
    SELECT l.reference INTO v_other_reference
      FROM public.storefront_wompi_checkout_locks AS l
     WHERE l.customer_phone_hash=v_row.customer_phone_hash
       AND l.reference<>v_reference AND l.status IN ('active','pending','terminal_grace')
     LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.storefront_wompi_checkout_locks AS l
         SET transaction_id=coalesce(v_transaction_id,l.transaction_id),
             reconciliation_required=true,updated_at=now()
       WHERE l.reference=v_reference;
      RETURN jsonb_build_object(
        'success',true,'found',true,'state',v_row.status,'late_approval_conflict',true,
        'other_reference',v_other_reference
      );
    END IF;
  END IF;
  IF v_state='terminal_grace' AND v_row.status IN ('released','expired') THEN
    SELECT l.reference INTO v_other_reference
      FROM public.storefront_wompi_checkout_locks AS l
     WHERE l.customer_phone_hash=v_row.customer_phone_hash
       AND l.reference<>v_reference AND l.status IN ('active','pending','terminal_grace')
     LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.storefront_wompi_checkout_locks AS l
         SET transaction_id=coalesce(v_transaction_id,l.transaction_id),
             terminal_at=coalesce(l.terminal_at,now()),updated_at=now()
       WHERE l.reference=v_reference;
      RETURN jsonb_build_object(
        'success',true,'found',true,'state',v_row.status,'terminal_lock_conflict',true,
        'other_reference',v_other_reference
      );
    END IF;
  END IF;
  IF v_row.reconciliation_required=true AND v_state IN ('completed','released','terminal_grace') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED',
      'state',v_row.status,'reconciliation_required',true);
  END IF;
  IF v_row.status='completed' AND v_state<>'completed' THEN
    RETURN jsonb_build_object('success',true,'found',true,'idempotent',true,'state','completed');
  END IF;
  UPDATE public.storefront_wompi_checkout_locks AS l
     SET status=v_state,
         transaction_id=coalesce(v_transaction_id,l.transaction_id),
         terminal_at=CASE WHEN v_state='terminal_grace' THEN coalesce(l.terminal_at,now()) ELSE l.terminal_at END,
         expires_at=CASE
           WHEN v_state='pending' THEN 'infinity'::timestamptz
           WHEN v_state='terminal_grace' THEN coalesce(l.terminal_at,now())+interval '15 minutes'
           ELSE now()
         END,
         updated_at=now()
   WHERE l.reference=v_reference;
  RETURN jsonb_build_object('success',true,'found',true,'state',v_state);
END;
$function$;
CREATE OR REPLACE FUNCTION public.prepare_storefront_wompi_checkout(p_reference text, p_items jsonb, p_city text, p_coupon_code text, p_customer_email text, p_customer_phone text, p_expected_quote jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_code text:=upper(btrim(coalesce(p_coupon_code,'')));
  v_quote jsonb;
  v_inventory jsonb;
  v_coupon_reservation jsonb;
  v_expires_at timestamptz;
  v_total numeric;
  v_expected_total numeric;
  v_discount_total numeric;
  v_expected_discount_total numeric;
  v_coupon_discount_total numeric;
  v_expected_coupon_discount_total numeric;
  v_shipping numeric;
  v_expected_shipping numeric;
  v_original_subtotal numeric;
  v_expected_original_subtotal numeric;
  v_discounted_subtotal numeric;
  v_expected_discounted_subtotal numeric;
  v_product_lock_id public.products.id%TYPE;
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_phone_hash text;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR v_code !~ '^(|[A-Z0-9][A-Z0-9_-]{0,63})$'
     OR v_phone !~ '^[0-9]{10}$' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_INPUT_INVALID','message','No se pudo validar la referencia, carrito o cupón.');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_INPUT_INVALID','message','El carrito debe ser una lista JSON válida.');
  END IF;
  IF jsonb_array_length(p_items)=0 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_INPUT_INVALID','message','El carrito está vacío.');
  END IF;
  IF p_expected_quote IS NULL OR jsonb_typeof(p_expected_quote) IS DISTINCT FROM 'object'
     OR p_expected_quote->>'success' IS DISTINCT FROM 'true'
     OR p_expected_quote->>'original_subtotal' IS NULL
     OR p_expected_quote->>'discounted_subtotal' IS NULL
     OR p_expected_quote->>'discount_total' IS NULL
     OR p_expected_quote->>'coupon_discount_total' IS NULL
     OR p_expected_quote->>'shipping' IS NULL
     OR p_expected_quote->>'total' IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID','message','La cotización inicial está incompleta. No se reservó inventario ni cupón.');
  END IF;
  IF jsonb_typeof(p_expected_quote->'items') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID','message','La cotización inicial no contiene líneas válidas. No se reservó inventario ni cupón.');
  END IF;
  IF jsonb_array_length(p_expected_quote->'items')=0 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID','message','La cotización inicial no contiene productos. No se reservó inventario ni cupón.');
  END IF;

  -- Serialize against the phone-level reconciliation marker before pricing locks.
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  IF EXISTS (
    SELECT 1 FROM public.orders AS o
     WHERE lower(o.payment_method)='wompi'
       AND (o.wompi_reconciliation_required=true OR o.coupon_reconciliation_required=true)
       AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
  ) OR EXISTS (
    SELECT 1 FROM public.storefront_wompi_checkout_locks AS l
     WHERE l.customer_phone_hash=v_phone_hash AND l.reconciliation_required=true
  ) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED',
      'message','Existe un pago que requiere revisión manual antes de iniciar otro checkout.');
  END IF;

  -- Then lock settings, combo/shipping tables, sorted products, and finally the coupon.
  PERFORM 1 FROM public.storefront_shipping_settings AS s WHERE s.id=1 FOR SHARE;
  LOCK TABLE public.storefront_product_combos IN SHARE MODE;
  LOCK TABLE public.storefront_shipping_rules IN SHARE MODE;
  LOCK TABLE public.storefront_shipping_rule_destinations IN SHARE MODE;
  FOR v_product_lock_id IN
    SELECT DISTINCT p.id
      FROM public.products AS p
      JOIN jsonb_array_elements(p_items) AS requested(item)
        ON p.id::text=requested.item->>'id'
     ORDER BY p.id
  LOOP
    PERFORM 1 FROM public.products AS p
     WHERE p.id=v_product_lock_id
     FOR NO KEY UPDATE OF p;
  END LOOP;
  IF v_code<>'' THEN
    PERFORM 1 FROM public.storefront_coupons AS c WHERE c.code=v_code FOR UPDATE;
  END IF;

  -- Identity is deliberately blank for the public quote. The reservation RPC hashes it server-side.
  v_quote:=public.get_storefront_cart_quote_with_coupon(p_items,p_city,v_code,'','');
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true
     OR v_quote->'items' IS NULL OR jsonb_typeof(v_quote->'items') IS DISTINCT FROM 'array'
     OR v_quote->>'original_subtotal' IS NULL OR v_quote->>'discounted_subtotal' IS NULL
     OR v_quote->>'discount_total' IS NULL OR v_quote->>'coupon_discount_total' IS NULL
     OR v_quote->>'shipping' IS NULL OR v_quote->>'total' IS NULL THEN
    RETURN jsonb_build_object('success',false,'code',coalesce(v_quote->>'code','WOMPI_QUOTE_INVALID'),
      'message',coalesce(v_quote->>'message','No se pudo validar el total vigente del carrito.'),'quote',v_quote);
  END IF;

  v_original_subtotal:=round((v_quote->>'original_subtotal')::numeric,0);
  v_discounted_subtotal:=round((v_quote->>'discounted_subtotal')::numeric,0);
  v_discount_total:=round((v_quote->>'discount_total')::numeric,0);
  v_coupon_discount_total:=round((v_quote->>'coupon_discount_total')::numeric,0);
  v_shipping:=round((v_quote->>'shipping')::numeric,0);
  v_total:=round((v_quote->>'total')::numeric,0);
  v_expected_original_subtotal:=round((p_expected_quote->>'original_subtotal')::numeric,0);
  v_expected_discounted_subtotal:=round((p_expected_quote->>'discounted_subtotal')::numeric,0);
  v_expected_discount_total:=round((p_expected_quote->>'discount_total')::numeric,0);
  v_expected_coupon_discount_total:=round((p_expected_quote->>'coupon_discount_total')::numeric,0);
  v_expected_shipping:=round((p_expected_quote->>'shipping')::numeric,0);
  v_expected_total:=round((p_expected_quote->>'total')::numeric,0);

  IF v_original_subtotal<>v_expected_original_subtotal
     OR v_discounted_subtotal<>v_expected_discounted_subtotal
     OR v_discount_total<>v_expected_discount_total
     OR v_coupon_discount_total<>v_expected_coupon_discount_total
     OR v_shipping<>v_expected_shipping
     OR v_total<>v_expected_total
     OR v_quote->'items' IS DISTINCT FROM p_expected_quote->'items'
     OR v_quote->'discounts' IS DISTINCT FROM p_expected_quote->'discounts'
     OR v_quote->'coupon_id' IS DISTINCT FROM p_expected_quote->'coupon_id'
     OR v_quote->'coupon_code' IS DISTINCT FROM p_expected_quote->'coupon_code'
     OR coalesce(v_quote->>'currency','COP') IS DISTINCT FROM coalesce(p_expected_quote->>'currency','COP') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_CHANGED','message','El precio, descuento, cupón o envío cambió durante la preparación. Revisa el nuevo total antes de confirmar.',
      'quote',v_quote,'total',v_total,'shipping',v_shipping,'discount_total',v_discount_total,'coupon_discount_total',v_coupon_discount_total);
  END IF;
  IF v_total<=0 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TOTAL_NOT_POSITIVE','message','Wompi no admite un total de cero. No se reservó inventario ni cupón.','quote',v_quote);
  END IF;
  IF v_total<>v_discounted_subtotal+v_shipping
     OR v_discounted_subtotal<>v_original_subtotal-v_discount_total
     OR v_discount_total<0 OR v_discount_total>v_original_subtotal
     OR v_coupon_discount_total<0 OR v_coupon_discount_total>v_discount_total THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID','message','La cotización vigente no concilia sus importes. No se reservó inventario ni cupón.');
  END IF;
  IF v_code<>'' AND v_coupon_discount_total<=0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_NO_DISCOUNT','message','El cupón no genera un descuento aplicable a este carrito.');
  END IF;

  v_inventory:=public.reserve_order_inventory(v_reference,p_items,10);
  IF coalesce((v_inventory->>'success')::boolean,false) IS DISTINCT FROM true THEN
    PERFORM public.release_inventory_reservation(v_reference);
    RETURN jsonb_build_object('success',false,'code',coalesce(v_inventory->>'code','WOMPI_INVENTORY_RESERVATION_FAILED'),
      'message',coalesce(v_inventory->>'message','No hay suficientes unidades disponibles.'));
  END IF;
  v_expires_at:=nullif(v_inventory->>'expires_at','')::timestamptz;
  IF v_expires_at IS NULL OR v_expires_at<=now()+interval '5 seconds' OR v_expires_at>now()+interval '10 minutes' THEN
    PERFORM public.release_inventory_reservation(v_reference);
    RETURN jsonb_build_object('success',false,'code','WOMPI_INVENTORY_EXPIRY_INVALID','message','La reserva de inventario no tiene una expiración válida.');
  END IF;

  IF v_code<>'' THEN
    v_coupon_reservation:=public.reserve_storefront_coupon_redemption(
      v_code,'wompi',v_reference,p_customer_email,p_customer_phone,v_coupon_discount_total::bigint,v_expires_at
    );
    IF coalesce((v_coupon_reservation->>'success')::boolean,false) IS DISTINCT FROM true
       OR v_coupon_reservation->>'status' IS DISTINCT FROM 'reserved'
       OR coalesce((v_coupon_reservation->>'discount_total')::numeric,-1)<>v_coupon_discount_total THEN
      PERFORM public.release_inventory_reservation(v_reference);
      RETURN coalesce(v_coupon_reservation,'{}'::jsonb)||jsonb_build_object('success',false);
    END IF;
  END IF;

  RETURN jsonb_build_object('success',true,'reference',v_reference,'quote',v_quote,'expires_at',v_expires_at,
    'coupon_reserved',v_code<>'');
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_storefront_wompi_pending_order(p_reference text, p_customer_name text, p_phone text, p_city text, p_address text, p_neighborhood text, p_items jsonb, p_subtotal bigint, p_shipping bigint, p_total bigint, p_coupon_id uuid, p_coupon_code text, p_coupon_discount_total bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF btrim(coalesce(p_reference,'')) !~ '^[A-Za-z0-9_-]{1,120}$'
     OR p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR p_subtotal IS NULL OR p_subtotal < 0
     OR p_shipping IS NULL OR p_shipping < 0
     OR p_total IS NULL OR p_total <= 0
     OR p_coupon_discount_total IS NULL OR p_coupon_discount_total < 0 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_INPUT_INVALID');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wompi-order-reference:' || btrim(p_reference)));
  IF EXISTS (SELECT 1 FROM public.orders WHERE reference=btrim(p_reference)) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT');
  END IF;

  INSERT INTO public.orders(
    reference, customer_name, phone, city, address, neighborhood, items,
    subtotal, shipping, total, coupon_id, coupon_code, coupon_discount_total,
    payment_method, payment_status
  ) VALUES (
    btrim(p_reference), p_customer_name, p_phone, p_city, p_address, p_neighborhood, p_items,
    p_subtotal, p_shipping, p_total, p_coupon_id, p_coupon_code, p_coupon_discount_total,
    'wompi', 'PENDING'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'order_id',v_id,'reference',btrim(p_reference));
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT');
END;
$function$;
CREATE OR REPLACE FUNCTION public.begin_storefront_wompi_payment_attempt(p_order_reference text, p_customer_name text, p_customer_phone text, p_city text, p_address text, p_neighborhood text, p_expected_quote jsonb, p_cart_hash text, p_is_new_order boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_order_reference,''));
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_phone_hash text;
  v_order public.orders%ROWTYPE;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_last public.storefront_wompi_payment_attempts%ROWTYPE;
  v_found boolean;
  v_attempt_number integer;
  v_attempt_reference text;
  v_now timestamptz:=now();
  v_quote_total numeric;
  v_quote_subtotal numeric;
  v_quote_shipping numeric;
  v_quote_coupon_discount numeric;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$' OR v_phone !~ '^[0-9]{10}$'
     OR p_cart_hash IS NULL OR p_cart_hash !~ '^[0-9a-fA-F]{64}$'
     OR p_expected_quote IS NULL OR jsonb_typeof(p_expected_quote) IS DISTINCT FROM 'object'
     OR p_expected_quote->>'success' IS DISTINCT FROM 'true'
     OR jsonb_typeof(p_expected_quote->'items') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_INPUT_INVALID');
  END IF;
  IF coalesce(p_expected_quote->>'total','') !~ '^[0-9]+$'
     OR coalesce(p_expected_quote->>'original_subtotal','') !~ '^[0-9]+$'
     OR coalesce(p_expected_quote->>'shipping','') !~ '^[0-9]+$'
     OR coalesce(p_expected_quote->>'coupon_discount_total','0') !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID');
  END IF;
  v_quote_total:=(p_expected_quote->>'total')::numeric;
  v_quote_subtotal:=(p_expected_quote->>'original_subtotal')::numeric;
  v_quote_shipping:=(p_expected_quote->>'shipping')::numeric;
  v_quote_coupon_discount:=coalesce((p_expected_quote->>'coupon_discount_total')::numeric,0);
  IF v_quote_total<=0 OR v_quote_total<>trunc(v_quote_total) OR v_quote_subtotal<0 OR v_quote_subtotal<>trunc(v_quote_subtotal)
     OR v_quote_shipping<0 OR v_quote_shipping<>trunc(v_quote_shipping)
     OR v_quote_coupon_discount<0 OR v_quote_coupon_discount<>trunc(v_quote_coupon_discount)
     OR v_quote_total*100>9223372036854775807 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID');
  END IF;

  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l
   WHERE l.reference=v_reference FOR UPDATE;
  IF NOT FOUND OR ltrim(v_lock.status)<> 'active' OR v_lock.customer_phone_hash<>v_phone_hash
     OR v_lock.cart_hash<>lower(p_cart_hash) OR v_lock.transaction_id IS NOT NULL
     OR v_lock.expires_at<=v_now OR v_lock.checkout_claimed_at IS NULL
     OR v_lock.checkout_claimed_at<v_now-interval '10 minutes' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LOCK_NOT_ACTIVE');
  END IF;

  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_reference FOR UPDATE;
  IF FOUND AND (v_order.wompi_reconciliation_required=true OR v_order.coupon_reconciliation_required=true) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED');
  END IF;
  IF NOT FOUND OR lower(coalesce(v_order.payment_method,''))<>'wompi'
     OR lower(btrim(coalesce(v_order.customer_name,'')))<>lower(btrim(coalesce(p_customer_name,'')))
     OR public._storefront_coupon_normalized_phone(v_order.phone)<>v_phone
     OR lower(btrim(coalesce(v_order.city,'')))<>lower(btrim(coalesce(p_city,'')))
     OR btrim(coalesce(v_order.address,''))<>btrim(coalesce(p_address,''))
     OR btrim(coalesce(v_order.neighborhood,''))<>btrim(coalesce(p_neighborhood,''))
     OR v_order.items IS DISTINCT FROM p_expected_quote->'items'
     OR v_order.total::numeric<>v_quote_total
     OR v_order.subtotal::numeric<>v_quote_subtotal
     OR v_order.shipping::numeric<>v_quote_shipping
     OR coalesce(v_order.coupon_discount_total,0)::numeric<>v_quote_coupon_discount
     OR upper(coalesce(v_order.coupon_code,''))<>upper(coalesce(p_expected_quote->>'coupon_code',''))
     OR coalesce(v_order.coupon_id::text,'')<>coalesce(p_expected_quote->>'coupon_id','') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_MISMATCH',
      'message','Los datos del comprador, carrito, ciudad o importe no coinciden con el pedido original.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_reservations r
      WHERE r.reference=v_reference AND lower(coalesce(r.status,''))='active' AND r.expires_at>v_now) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_INVENTORY_RESERVATION_MISSING');
  END IF;
  IF upper(coalesce(p_expected_quote->>'coupon_code',''))<>'' AND NOT EXISTS (
      SELECT 1 FROM public.storefront_coupon_redemptions r
       WHERE r.channel='wompi' AND r.reference=v_reference AND r.status='reserved'
         AND r.expires_at>v_now AND r.code=upper(p_expected_quote->>'coupon_code')
         AND r.coupon_id=v_order.coupon_id AND r.discount_total=v_order.coupon_discount_total
  ) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_COUPON_RESERVATION_MISSING');
  END IF;

  SELECT a.* INTO v_last FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=v_reference ORDER BY a.attempt_number DESC LIMIT 1 FOR UPDATE;
  v_found:=FOUND;
  IF NOT v_found THEN
    IF NOT p_is_new_order OR upper(coalesce(v_order.payment_status,''))<>'PENDING'
       OR nullif(btrim(coalesce(v_order.transaction_id,'')),'') IS NOT NULL
       OR v_order.created_at<v_now-interval '10 minutes' THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_HISTORY_REQUIRED',
        'message','No existe un intento verificado que permita reabrir esta orden.');
    END IF;
    v_attempt_number:=1;
  ELSE
    IF p_is_new_order THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT');
    END IF;
    IF v_last.status IN ('INITIATED','PENDING') THEN
      RETURN jsonb_build_object('success',false,'code',CASE WHEN v_last.status='PENDING' THEN 'WOMPI_TRANSACTION_PENDING' ELSE 'WOMPI_ATTEMPT_UNRESOLVED' END);
    ELSIF v_last.status IN ('APPROVED','APPROVED_LATE') THEN
      RETURN jsonb_build_object('success',false,'code',CASE WHEN v_last.status='APPROVED' THEN 'WOMPI_ALREADY_APPROVED' ELSE 'WOMPI_RECONCILIATION_REQUIRED' END);
    ELSIF v_last.status NOT IN ('ERROR','DECLINED','VOIDED') OR v_last.terminal_at IS NULL
       OR v_last.terminal_at+interval '15 minutes'>v_now
       OR v_last.transaction_id IS DISTINCT FROM v_order.transaction_id
       OR upper(coalesce(v_order.payment_status,'')) IS DISTINCT FROM v_last.status
       OR v_last.environment<>'prod' OR v_last.currency<>'COP'
       OR v_last.amount_in_cents<>v_quote_total*100
       OR v_last.cart_hash<>lower(p_cart_hash) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_GRACE');
    END IF;
    v_attempt_number:=v_last.attempt_number+1;
  END IF;

  v_attempt_reference:='SW-'||upper(replace(gen_random_uuid()::text,'-',''));
  IF v_found THEN
    UPDATE public.orders SET payment_status='PENDING',transaction_id=NULL,updated_at=v_now
     WHERE reference=v_reference AND transaction_id=v_last.transaction_id
       AND upper(payment_status)=v_last.status;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_STATE_CONFLICT'); END IF;
  END IF;
  INSERT INTO public.storefront_wompi_payment_attempts(
    attempt_reference,wompi_reference,is_legacy,order_reference,attempt_number,environment,amount_in_cents,currency,cart_hash,customer_phone_hash,status
  ) VALUES (
    v_attempt_reference,v_attempt_reference,false,v_reference,v_attempt_number,'prod',(v_quote_total*100)::bigint,'COP',lower(p_cart_hash),v_phone_hash,'INITIATED'
  );
  RETURN jsonb_build_object('success',true,'order_reference',v_reference,
    'attempt_reference',v_attempt_reference,'attempt_number',v_attempt_number,
    'environment','prod','currency','COP','amount_in_cents',(v_quote_total*100)::bigint,'status','INITIATED');
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_ALREADY_EXISTS');
END;
$function$;
CREATE OR REPLACE FUNCTION public.transition_storefront_wompi_payment_attempt(p_attempt_reference text, p_transaction_id text, p_status text, p_amount_in_cents bigint, p_currency text, p_environment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempt public.storefront_wompi_payment_attempts%ROWTYPE;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_order_reference text;
  v_phone_hash text;
  v_status text:=upper(btrim(coalesce(p_status,'')));
  v_final_status text;
  v_latest integer;
  v_is_current boolean;
  v_late_approval boolean:=false;
  v_idempotent boolean:=false;
BEGIN
  IF p_attempt_reference IS NULL OR p_attempt_reference !~ '^SW-[A-F0-9]{32}$'
     OR p_transaction_id IS NULL OR btrim(p_transaction_id) !~ '^[A-Za-z0-9_-]{1,120}$'
     OR v_status NOT IN ('PENDING','APPROVED','DECLINED','VOIDED','ERROR')
     OR p_amount_in_cents IS NULL OR p_amount_in_cents<=0 OR upper(coalesce(p_currency,''))<>'COP'
     OR lower(coalesce(p_environment,''))<>'prod' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_EVENT_INVALID');
  END IF;

  -- Stable identity is read first; follow the installed webhook lock order:
  -- reference -> phone -> lock row -> order row -> attempt row.
  SELECT a.order_reference,a.customer_phone_hash INTO v_order_reference,v_phone_hash
    FROM public.storefront_wompi_payment_attempts a WHERE a.attempt_reference=p_attempt_reference;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_NOT_FOUND'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_order_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l
   WHERE l.reference=v_order_reference FOR UPDATE;
  IF NOT FOUND OR v_lock.customer_phone_hash<>v_phone_hash THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_LOCK_NOT_FOUND');
  END IF;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.reference=v_order_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_ORDER_NOT_FOUND'); END IF;
  SELECT a.* INTO v_attempt FROM public.storefront_wompi_payment_attempts a
   WHERE a.attempt_reference=p_attempt_reference FOR UPDATE;
  IF NOT FOUND OR v_attempt.order_reference<>v_order_reference OR v_attempt.customer_phone_hash<>v_phone_hash THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_IDENTITY_CONFLICT');
  END IF;
  IF v_attempt.environment<>'prod' OR v_attempt.currency<>'COP'
     OR v_attempt.amount_in_cents<>p_amount_in_cents THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_AMOUNT_OR_ENVIRONMENT_MISMATCH');
  END IF;
  IF v_attempt.transaction_id IS NOT NULL AND v_attempt.transaction_id<>btrim(p_transaction_id) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_TRANSACTION_CONFLICT');
  END IF;

  SELECT max(a.attempt_number) INTO v_latest FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=v_attempt.order_reference;
  v_is_current:=v_attempt.attempt_number=v_latest;
  v_final_status:=v_attempt.status;

  IF NOT v_is_current THEN
    IF v_status='APPROVED' THEN
      UPDATE public.storefront_wompi_payment_attempts SET status='APPROVED_LATE',
        transaction_id=btrim(p_transaction_id),verified_at=now(),updated_at=now()
       WHERE attempt_reference=p_attempt_reference AND status<>'APPROVED_LATE';
      UPDATE public.orders SET wompi_reconciliation_required=true,
        coupon_reconciliation_required=CASE WHEN coupon_id IS NOT NULL OR coalesce(coupon_code,'')<>''
          THEN true ELSE coupon_reconciliation_required END
       WHERE reference=v_order_reference;
      UPDATE public.storefront_wompi_checkout_locks SET reconciliation_required=true,updated_at=now()
       WHERE reference=v_order_reference;
      -- If another order for this phone already has a live lock, prevent its
      -- checkout/webhook from fulfilling while the old approval is reconciled.
      UPDATE public.storefront_wompi_checkout_locks l SET reconciliation_required=true,updated_at=now()
       WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_order_reference
         AND l.status IN ('active','pending','terminal_grace');
      UPDATE public.orders o SET wompi_reconciliation_required=true,
        coupon_reconciliation_required=CASE WHEN o.coupon_id IS NOT NULL OR coalesce(o.coupon_code,'')<>''
          THEN true ELSE o.coupon_reconciliation_required END
       FROM public.storefront_wompi_checkout_locks l
       WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_order_reference
         AND l.status IN ('active','pending','terminal_grace') AND o.reference=l.reference;
      v_final_status:='APPROVED_LATE';
      v_late_approval:=true;
    ELSE
      v_idempotent:=true;
    END IF;
  ELSIF v_attempt.status IN ('ERROR','DECLINED','VOIDED') AND v_status='APPROVED' THEN
    UPDATE public.storefront_wompi_payment_attempts SET status='APPROVED_LATE',
      transaction_id=btrim(p_transaction_id),verified_at=now(),updated_at=now()
     WHERE attempt_reference=p_attempt_reference;
    UPDATE public.orders SET wompi_reconciliation_required=true,
      coupon_reconciliation_required=CASE WHEN coupon_id IS NOT NULL OR coalesce(coupon_code,'')<>''
        THEN true ELSE coupon_reconciliation_required END
     WHERE reference=v_order_reference;
    UPDATE public.storefront_wompi_checkout_locks SET reconciliation_required=true,updated_at=now()
     WHERE reference=v_order_reference;
    UPDATE public.storefront_wompi_checkout_locks l SET reconciliation_required=true,updated_at=now()
     WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_order_reference
       AND l.status IN ('active','pending','terminal_grace');
    UPDATE public.orders o SET wompi_reconciliation_required=true,
      coupon_reconciliation_required=CASE WHEN o.coupon_id IS NOT NULL OR coalesce(o.coupon_code,'')<>''
        THEN true ELSE o.coupon_reconciliation_required END
     FROM public.storefront_wompi_checkout_locks l
     WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_order_reference
       AND l.status IN ('active','pending','terminal_grace') AND o.reference=l.reference;
    v_final_status:='APPROVED_LATE';
    v_late_approval:=true;
  ELSIF v_attempt.status='APPROVED' THEN
    v_final_status:='APPROVED';
    v_idempotent:=true;
  ELSIF v_attempt.status='APPROVED_LATE' THEN
    UPDATE public.orders SET wompi_reconciliation_required=true,
      coupon_reconciliation_required=CASE WHEN coupon_id IS NOT NULL OR coalesce(coupon_code,'')<>''
        THEN true ELSE coupon_reconciliation_required END
     WHERE reference=v_order_reference;
    UPDATE public.storefront_wompi_checkout_locks SET reconciliation_required=true,updated_at=now()
     WHERE reference=v_order_reference;
    v_final_status:='APPROVED_LATE';
    v_late_approval:=true;
    v_idempotent:=true;
  ELSIF v_attempt.status IN ('ERROR','DECLINED','VOIDED') AND v_status='PENDING' THEN
    v_idempotent:=true;
  ELSE
    v_idempotent:=v_attempt.status=v_status AND v_attempt.transaction_id=btrim(p_transaction_id);
    UPDATE public.storefront_wompi_payment_attempts SET
      status=v_status,
      transaction_id=btrim(p_transaction_id),
      verified_at=now(),
      terminal_at=CASE WHEN v_status IN ('ERROR','DECLINED','VOIDED') THEN coalesce(terminal_at,now()) ELSE terminal_at END,
      updated_at=now()
     WHERE attempt_reference=p_attempt_reference;
    v_final_status:=v_status;
  END IF;

  RETURN jsonb_build_object('success',true,'order_reference',v_attempt.order_reference,
    'attempt_reference',p_attempt_reference,'transaction_id',btrim(p_transaction_id),
    'status',v_final_status,'is_current',v_is_current,'late_approval',v_late_approval,
    'reconciliation_required',v_late_approval,'idempotent',v_idempotent);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'code','WOMPI_ATTEMPT_TRANSACTION_CONFLICT');
END;
$function$;
CREATE OR REPLACE FUNCTION public.list_pending_wompi_orders_for_phone(p_customer_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_orders jsonb;
BEGIN
  IF v_phone !~ '^[0-9]{10}$' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_PHONE_INVALID');
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.reference),'[]'::jsonb)
    INTO v_orders
    FROM (
      SELECT o.reference,o.created_at,o.total,o.subtotal,o.shipping,o.city,o.items,
             o.payment_status,o.transaction_id,o.customer_name,o.phone,o.address,o.neighborhood,
             o.coupon_id,o.coupon_code,o.coupon_discount_total
        FROM public.orders AS o
       WHERE lower(o.payment_method)='wompi'
         AND upper(o.payment_status)='PENDING'
         AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
       ORDER BY o.created_at DESC,o.reference
       LIMIT 1001
    ) AS q;
  IF jsonb_array_length(v_orders)>1000 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_PENDING_LIMIT');
  END IF;
  RETURN jsonb_build_object('success',true,'orders',v_orders);
END;
$function$;
CREATE OR REPLACE FUNCTION public.mark_storefront_wompi_reconciliation(p_reference text, p_transaction_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_transaction_id text:=btrim(coalesce(p_transaction_id,''));
  v_phone text;
  v_phone_hash text;
  v_order_rows integer:=0;
  v_lock_rows integer:=0;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR v_transaction_id !~ '^[A-Za-z0-9_-]{1,120}$' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_INPUT_INVALID');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_reference));
  SELECT public._storefront_coupon_normalized_phone(o.phone) INTO v_phone
    FROM public.orders AS o
   WHERE o.reference=v_reference AND lower(o.payment_method)='wompi'
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_NOT_FOUND');
  END IF;
  IF v_phone ~ '^[0-9]{10}$' THEN
    v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
    PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  END IF;

  UPDATE public.orders AS o
     SET wompi_reconciliation_required=true,updated_at=now()
   WHERE o.reference=v_reference AND lower(o.payment_method)='wompi';
  GET DIAGNOSTICS v_order_rows = ROW_COUNT;

  UPDATE public.storefront_wompi_checkout_locks AS l
     SET reconciliation_required=true,updated_at=now()
   WHERE l.reference=v_reference;
  GET DIAGNOSTICS v_lock_rows = ROW_COUNT;

  RETURN jsonb_build_object('success',v_order_rows=1,'reference',v_reference,
    'order_flag_updated',v_order_rows=1,'lock_flag_updated',v_lock_rows=1,
    'lock_missing',v_lock_rows=0);
END;
$function$;
CREATE OR REPLACE FUNCTION public.recover_storefront_wompi_legacy_order(p_order_reference text, p_cart_hash text, p_customer_email text, p_verified_attempts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_order_reference,''));
  v_order public.orders%ROWTYPE;
  v_lock public.storefront_wompi_checkout_locks%ROWTYPE;
  v_phone text;
  v_phone_hash text;
  v_email text:=lower(btrim(coalesce(p_customer_email,'')));
  v_coupon_code text;
  v_quote jsonb;
  v_inventory jsonb;
  v_prepared jsonb;
  v_attempt record;
  v_attempt_number integer:=0;
  v_tx1 text;
  v_tx2 text;
  v_terminal1 timestamptz;
  v_terminal2 timestamptz;
  v_terminal_at timestamptz;
  v_attempt_ref1 text;
  v_attempt_ref2 text;
  v_amount bigint;
  v_expected_amount bigint;
  v_existing_count integer;
  v_existing_match_count integer;
  v_other_reference text;
  v_product_lock_id public.products.id%TYPE;
  v_expires_at timestamptz;
  v_already_recovered boolean:=false;
  v_message text;
  v_detail text;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR p_cart_hash IS NULL OR p_cart_hash !~ '^[0-9a-fA-F]{64}$'
     OR p_verified_attempts IS NULL OR jsonb_typeof(p_verified_attempts) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_verified_attempts)<>2 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_INPUT_INVALID');
  END IF;

  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.reference=v_reference AND lower(o.payment_method)='wompi';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_ORDER_NOT_FOUND'); END IF;
  v_phone:=public._storefront_coupon_normalized_phone(v_order.phone);
  IF v_phone !~ '^[0-9]{10}$' THEN RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_PHONE_INVALID'); END IF;
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  v_expected_amount:=round(v_order.total::numeric*100)::bigint;
  v_coupon_code:=upper(btrim(coalesce(v_order.coupon_code,'')));
  IF v_expected_amount<=0 OR (v_coupon_code<>'' AND
      (length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_ORDER_SNAPSHOT_INVALID');
  END IF;

  -- Canonical order: reference -> phone, matching the installed webhook lock RPCs.
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_reference));
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.reference=v_reference AND lower(o.payment_method)='wompi' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_ORDER_NOT_FOUND'); END IF;
  IF v_order.wompi_reconciliation_required=true OR v_order.coupon_reconciliation_required=true THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED');
  END IF;

  FOR v_attempt IN
    SELECT value,ordinality FROM jsonb_array_elements(p_verified_attempts) WITH ORDINALITY AS x(value,ordinality)
     ORDER BY ordinality
  LOOP
    IF jsonb_typeof(v_attempt.value) IS DISTINCT FROM 'object'
       OR coalesce(v_attempt.value->>'transaction_id','') !~ '^[A-Za-z0-9_-]{1,120}$'
       OR coalesce(v_attempt.value->>'reference','') IS DISTINCT FROM v_reference
       OR upper(coalesce(v_attempt.value->>'status','')) IS DISTINCT FROM 'ERROR'
       OR upper(coalesce(v_attempt.value->>'currency','')) IS DISTINCT FROM 'COP'
       OR lower(coalesce(v_attempt.value->>'environment','')) IS DISTINCT FROM 'prod'
       OR coalesce(v_attempt.value->>'amount_in_cents','') !~ '^[0-9]+$'
       OR coalesce(v_attempt.value->>'terminal_at','')='' THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_TRANSACTION_MISMATCH');
    END IF;
    v_amount:=(v_attempt.value->>'amount_in_cents')::bigint;
    IF v_amount<>v_expected_amount THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_AMOUNT_MISMATCH');
    END IF;
    IF v_attempt.ordinality=1 THEN
      v_tx1:=v_attempt.value->>'transaction_id';
      v_terminal1:=(v_attempt.value->>'terminal_at')::timestamptz;
    ELSE
      v_tx2:=v_attempt.value->>'transaction_id';
      v_terminal2:=(v_attempt.value->>'terminal_at')::timestamptz;
    END IF;
  END LOOP;
  IF v_tx1 IS NULL OR v_tx2 IS NULL OR v_tx1=v_tx2 OR v_terminal1 IS NULL OR v_terminal2 IS NULL
     OR v_terminal1>v_terminal2 OR v_terminal1>now()-interval '15 minutes'
     OR v_terminal2>now()-interval '15 minutes' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_TERMINAL_GRACE');
  END IF;
  v_terminal_at:=v_terminal2;

  -- All pricing/source locks and current quote verification occur before writes.
  PERFORM 1 FROM public.storefront_shipping_settings s WHERE s.id=1 FOR SHARE;
  LOCK TABLE public.storefront_product_combos IN SHARE MODE;
  LOCK TABLE public.storefront_shipping_rules IN SHARE MODE;
  LOCK TABLE public.storefront_shipping_rule_destinations IN SHARE MODE;
  FOR v_product_lock_id IN
    SELECT DISTINCT p.id FROM public.products p
      JOIN jsonb_array_elements(v_order.items) requested(item) ON p.id::text=requested.item->>'id'
     ORDER BY p.id
  LOOP
    PERFORM 1 FROM public.products p WHERE p.id=v_product_lock_id FOR NO KEY UPDATE OF p;
  END LOOP;
  IF v_coupon_code<>'' THEN
    PERFORM 1 FROM public.storefront_coupons c WHERE c.code=v_coupon_code FOR UPDATE;
  END IF;
  v_quote:=public.get_storefront_cart_quote_with_coupon(v_order.items,v_order.city,v_coupon_code,'','');
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true
     OR jsonb_typeof(v_quote->'items') IS DISTINCT FROM 'array'
     OR v_quote->'items' IS DISTINCT FROM v_order.items
     OR round((v_quote->>'original_subtotal')::numeric,0)<>round(v_order.subtotal::numeric,0)
     OR round((v_quote->>'shipping')::numeric,0)<>round(v_order.shipping::numeric,0)
     OR round((v_quote->>'total')::numeric,0)<>round(v_order.total::numeric,0)
     OR round(coalesce((v_quote->>'coupon_discount_total')::numeric,0),0)<>round(coalesce(v_order.coupon_discount_total,0)::numeric,0)
     OR coalesce(nullif(v_quote->>'coupon_id',''),'')<>coalesce(v_order.coupon_id::text,'')
     OR upper(coalesce(v_quote->>'coupon_code',''))<>v_coupon_code
     OR upper(coalesce(v_quote->>'currency','COP'))<>'COP' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_QUOTE_CHANGED');
  END IF;
  IF round((v_quote->>'total')::numeric*100)::bigint<>v_expected_amount THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_AMOUNT_MISMATCH');
  END IF;

  SELECT l.* INTO v_lock FROM public.storefront_wompi_checkout_locks l
   WHERE l.reference=v_reference FOR UPDATE;
  IF FOUND THEN
    IF v_lock.customer_phone_hash<>v_phone_hash
       OR (v_lock.cart_hash<>lower(p_cart_hash) AND v_lock.cart_hash<>repeat('0',64))
       OR v_lock.reconciliation_required=true
       OR v_lock.status='completed'
       OR (v_lock.transaction_id IS NOT NULL AND v_lock.transaction_id NOT IN (v_tx1,v_tx2)) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_LOCK_CONFLICT');
    END IF;
    IF v_lock.status IN ('active','pending') AND v_lock.expires_at>now()
       AND v_lock.checkout_claimed_at>now()-interval '10 minutes' THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_ALREADY_PREPARED');
    END IF;
    IF v_lock.status='terminal_grace' AND v_lock.terminal_at IS NOT NULL THEN
      v_terminal_at:=greatest(v_terminal_at,v_lock.terminal_at);
      IF v_terminal_at>now()-interval '15 minutes' THEN
        RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_TERMINAL_GRACE');
      END IF;
    END IF;
  END IF;
  SELECT l.reference INTO v_other_reference FROM public.storefront_wompi_checkout_locks l
   WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_reference
     AND l.status IN ('active','pending','terminal_grace') LIMIT 1 FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART'); END IF;

  SELECT count(*) INTO v_existing_count FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=v_reference;
  SELECT count(*) INTO v_existing_match_count FROM public.storefront_wompi_payment_attempts a
   WHERE a.order_reference=v_reference AND a.is_legacy=true AND a.wompi_reference=v_reference
     AND a.environment='prod' AND a.currency='COP' AND a.amount_in_cents=v_expected_amount
     AND a.cart_hash=lower(p_cart_hash) AND a.customer_phone_hash=v_phone_hash
     AND a.status='ERROR' AND a.terminal_at IS NOT NULL
     AND ((a.attempt_number=1 AND a.transaction_id=v_tx1 AND a.terminal_at=v_terminal1)
       OR (a.attempt_number=2 AND a.transaction_id=v_tx2 AND a.terminal_at=v_terminal2));
  IF v_existing_count=0 THEN
    IF upper(coalesce(v_order.payment_status,''))<>'PENDING'
       OR nullif(btrim(coalesce(v_order.transaction_id,'')),'') IS NOT NULL THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_ORDER_STATE_CONFLICT');
    END IF;
  ELSIF v_existing_count=2 AND v_existing_match_count=2 THEN
    IF upper(coalesce(v_order.payment_status,''))<>'ERROR' OR v_order.transaction_id IS DISTINCT FROM v_tx2 THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_ORDER_STATE_CONFLICT');
    END IF;
    v_already_recovered:=true;
    SELECT a.attempt_reference INTO v_attempt_ref2 FROM public.storefront_wompi_payment_attempts a
     WHERE a.order_reference=v_reference AND a.is_legacy=true AND a.transaction_id=v_tx2;
    SELECT a.attempt_reference INTO v_attempt_ref1 FROM public.storefront_wompi_payment_attempts a
     WHERE a.order_reference=v_reference AND a.is_legacy=true AND a.transaction_id=v_tx1;
  ELSE
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_HISTORY_CONFLICT');
  END IF;

  IF v_coupon_code<>'' THEN
    IF v_email='' THEN RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_COUPON_EMAIL_REQUIRED'); END IF;
    IF EXISTS (SELECT 1 FROM public.storefront_coupon_redemptions r
        WHERE r.channel='wompi' AND r.reference=v_reference AND r.status='released'
          AND (r.coupon_id IS DISTINCT FROM v_order.coupon_id OR r.code IS DISTINCT FROM v_coupon_code
            OR r.discount_total IS DISTINCT FROM coalesce(v_order.coupon_discount_total,0))) THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_COUPON_CONFLICT');
    END IF;
  ELSIF coalesce(v_order.coupon_discount_total,0)<>0 OR v_order.coupon_id IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_COUPON_SNAPSHOT_INVALID');
  END IF;

  -- All mutations are inside this subtransaction. Any quote, stock, coupon, lock,
  -- uniqueness or RPC failure rolls back the entire recovery before returning.
  BEGIN
    IF NOT v_already_recovered THEN
      v_attempt_ref1:='SW-'||upper(replace(gen_random_uuid()::text,'-',''));
      v_attempt_ref2:='SW-'||upper(replace(gen_random_uuid()::text,'-',''));
      INSERT INTO public.storefront_wompi_payment_attempts(
        attempt_reference,wompi_reference,is_legacy,order_reference,attempt_number,environment,
        amount_in_cents,currency,cart_hash,customer_phone_hash,status,transaction_id,verified_at,terminal_at
      ) VALUES
        (v_attempt_ref1,v_reference,true,v_reference,1,'prod',v_expected_amount,'COP',lower(p_cart_hash),v_phone_hash,'ERROR',v_tx1,now(),v_terminal1),
        (v_attempt_ref2,v_reference,true,v_reference,2,'prod',v_expected_amount,'COP',lower(p_cart_hash),v_phone_hash,'ERROR',v_tx2,now(),v_terminal2);
      UPDATE public.orders SET payment_status='ERROR',transaction_id=v_tx2,updated_at=now()
       WHERE reference=v_reference AND payment_method ILIKE 'wompi'
         AND upper(payment_status)='PENDING' AND transaction_id IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECOVERY_ABORT',DETAIL='WOMPI_LEGACY_ORDER_STATE_CONFLICT'; END IF;
    END IF;

    IF v_coupon_code<>'' THEN
      UPDATE public.storefront_coupon_redemptions r
         SET released_attempt_reference=v_attempt_ref2,updated_at=now()
       WHERE r.channel='wompi' AND r.reference=v_reference AND r.status='released'
         AND r.coupon_id=v_order.coupon_id AND r.code=v_coupon_code
         AND r.discount_total=coalesce(v_order.coupon_discount_total,0)
         AND r.customer_hash=public._storefront_coupon_customer_hash(v_email,v_order.phone);
      IF EXISTS (SELECT 1 FROM public.storefront_coupon_redemptions r
          WHERE r.channel='wompi' AND r.reference=v_reference AND r.status='released'
            AND (r.coupon_id IS DISTINCT FROM v_order.coupon_id OR r.code IS DISTINCT FROM v_coupon_code
              OR r.discount_total IS DISTINCT FROM coalesce(v_order.coupon_discount_total,0)
              OR r.customer_hash IS DISTINCT FROM public._storefront_coupon_customer_hash(v_email,v_order.phone))) THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECOVERY_ABORT',DETAIL='WOMPI_LEGACY_COUPON_CONFLICT';
      END IF;
    END IF;

    v_prepared:=public.prepare_storefront_wompi_checkout(
      v_reference,v_order.items,v_order.city,v_coupon_code,v_email,v_order.phone,v_quote
    );
    IF coalesce((v_prepared->>'success')::boolean,false) IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECOVERY_ABORT',
        DETAIL=coalesce(v_prepared->>'code','WOMPI_LEGACY_PREPARATION_FAILED');
    END IF;
    v_expires_at:=nullif(v_prepared->>'expires_at','')::timestamptz;
    IF v_expires_at IS NULL OR v_expires_at<=now()+interval '5 seconds'
       OR v_expires_at>now()+interval '10 minutes' THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECOVERY_ABORT',DETAIL='WOMPI_LEGACY_RESERVATION_EXPIRY_INVALID';
    END IF;

    IF v_lock.reference IS NULL THEN
      INSERT INTO public.storefront_wompi_checkout_locks(
        reference,customer_phone_hash,cart_hash,status,expires_at,checkout_claimed_at,
        transaction_id,terminal_at,reconciliation_required,updated_at
      ) VALUES(v_reference,v_phone_hash,lower(p_cart_hash),'terminal_grace',v_expires_at,NULL,
        v_tx2,v_terminal_at,false,now());
    ELSE
      UPDATE public.storefront_wompi_checkout_locks SET customer_phone_hash=v_phone_hash,
        cart_hash=lower(p_cart_hash),status='terminal_grace',expires_at=v_expires_at,
        checkout_claimed_at=NULL,transaction_id=v_tx2,terminal_at=v_terminal_at,
        reconciliation_required=false,updated_at=now()
       WHERE reference=v_reference;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT,v_detail=PG_EXCEPTION_DETAIL;
    RETURN jsonb_build_object('success',false,'code',coalesce(nullif(v_detail,''),'WOMPI_LEGACY_RECOVERY_FAILED'),
      'message','No se realizó la recuperación; las escrituras parciales fueron revertidas.');
  END;

  RETURN jsonb_build_object('success',true,'reference',v_reference,'order_reused',true,
    'legacy_attempts_registered',2,'reservation_expires_at',v_expires_at,
    'payment_started',false,'order_created',false,'idempotent',v_already_recovered);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'code','WOMPI_LEGACY_RECOVERY_VALIDATION_FAILED',
    'message','No se pudo validar el pedido y las dos transacciones; no se modificó ningún dato.');
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_contra_delivery_order_unpriced_20261015(p_client_reference text, p_customer_name text, p_customer_cedula text, p_customer_phone text, p_customer_email text, p_customer_city text, p_customer_address text, p_customer_neighborhood text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing public.web_orders%ROWTYPE;
  v_existing_found boolean := false;
  v_existing_lines jsonb := '[]'::jsonb;
  v_requested_lines jsonb := '[]'::jsonb;
  v_input jsonb;
  v_product public.products%ROWTYPE;
  v_order_items jsonb := '[]'::jsonb;
  v_reserve_result record;
  v_client_reference text := trim(coalesce(p_client_reference, ''));
  v_inventory_reference text := 'JMCOD-' || gen_random_uuid()::text;
  v_name text := trim(coalesce(p_customer_name, ''));
  v_cedula text := trim(coalesce(p_customer_cedula, ''));
  v_phone text := trim(coalesce(p_customer_phone, ''));
  v_email text := trim(coalesce(p_customer_email, ''));
  v_city text := trim(coalesce(p_customer_city, ''));
  v_city_normalized text;
  v_address text := trim(coalesce(p_customer_address, ''));
  v_neighborhood text := trim(coalesce(p_customer_neighborhood, ''));
  v_qty integer;
  v_color text;
  v_size text;
  v_subtotal numeric(12,2) := 0;
  v_order_id uuid;
  v_owner_id uuid;
  v_reservation_count integer := 0;
BEGIN
  -- Normalize accents, capitalization and repeated spaces before validating or comparing the city.
  v_city_normalized := lower(regexp_replace(
    regexp_replace(
      translate(trim(v_city), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'),
      '[,.]+', ' ', 'g'
    ),
    '[[:space:]]+', ' ', 'g'
  ));
  IF v_city_normalized IN ('cali', 'santiago de cali', 'cali valle del cauca') THEN
    v_city := 'Cali';
  END IF;

  IF v_client_reference = '' OR length(v_client_reference) > 100 THEN
    RETURN jsonb_build_object('success', false, 'message', 'La referencia del pedido no es válida.');
  END IF;

  -- Idempotencia: si el servidor guardó el pedido pero la respuesta se perdió,
  -- un reintento devuelve el pedido anterior y no vuelve a apartar unidades.
  SELECT * INTO v_existing
    FROM public.web_orders
   WHERE client_reference = v_client_reference
     AND payment_method = 'Contra entrega'
   FOR UPDATE;
  v_existing_found := FOUND;

  IF v_name = '' OR v_phone = '' OR v_email = '' OR v_city = '' OR v_address = '' OR v_neighborhood = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Faltan datos obligatorios del cliente o de la dirección.');
  END IF;
  IF length(v_name) > 160 OR length(v_cedula) > 60 OR length(v_phone) > 60 OR
     length(v_email) > 254 OR length(v_city) > 100 OR length(v_address) > 300 OR length(v_neighborhood) > 200 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Uno de los datos del pedido es demasiado largo.');
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN
    RETURN jsonb_build_object('success', false, 'message', 'El correo electrónico no es válido.');
  END IF;
  -- Contraentrega y envío gratis aplican únicamente a destinos en Cali.
  IF NOT public.storefront_cod_city_allowed(v_city) THEN
    RETURN jsonb_build_object('success', false,
      'message', 'El pago contraentrega no está habilitado para esta ciudad.');
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success', false, 'message', 'El pedido debe incluir entre 1 y 50 líneas de productos.');
  END IF;
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50 THEN
    RETURN jsonb_build_object('success', false, 'message', 'El pedido debe incluir entre 1 y 50 líneas de productos.');
  END IF;

  FOR v_input IN SELECT value FROM jsonb_array_elements(p_items) AS j(value)
                   ORDER BY (value->>'id')::uuid, coalesce(value->>'color',''), coalesce(value->>'size','')
  LOOP
    IF coalesce(trim(v_input->>'id'), '') = '' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Una línea del pedido no tiene identificador de producto.');
    END IF;
    v_qty := coalesce((v_input->>'qty')::integer, 0);
    IF v_qty < 1 OR v_qty > 100 THEN
      RETURN jsonb_build_object('success', false, 'message', 'La cantidad de una línea no es válida.');
    END IF;
    v_color := trim(coalesce(v_input->>'color', ''));
    v_size := trim(coalesce(v_input->>'size', ''));

    SELECT * INTO v_product
      FROM public.products AS p
     WHERE p.id = (v_input->>'id')::uuid
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'message', 'Uno de los productos ya no está disponible. Recarga el catálogo.');
    END IF;
    IF v_owner_id IS NULL THEN
      v_owner_id := v_product.user_id;
    ELSIF v_product.user_id IS DISTINCT FROM v_owner_id THEN
      RETURN jsonb_build_object('success', false, 'message', 'El pedido contiene artículos de tiendas diferentes. Debes hacer pedidos por separado.');
    END IF;
    IF coalesce(v_product.sale_price, 0) < 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'El precio guardado de un producto no es válido.');
    END IF;

    v_subtotal := v_subtotal + (coalesce(v_product.sale_price, 0) * v_qty);
    v_order_items := v_order_items || jsonb_build_array(jsonb_build_object(
      'id', v_product.id::text,
      'name', v_product.name,
      'code', v_product.code,
      'qty', v_qty,
      'price', coalesce(v_product.sale_price, 0),
      'color', v_color,
      'size', v_size
    ));
  END LOOP;

  -- Si se perdió la respuesta del primer intento, reutilizar su pedido solo si
  -- coinciden cliente/dirección y las cantidades/variantes. Si cambiaron los datos,
  -- fallar de forma segura: nunca crear un segundo pedido con la misma referencia.
  IF v_existing_found THEN
    IF v_existing.customer_name IS DISTINCT FROM v_name
       OR v_existing.customer_cedula IS DISTINCT FROM v_cedula
       OR v_existing.customer_phone IS DISTINCT FROM v_phone
       OR v_existing.customer_email IS DISTINCT FROM v_email
       OR v_existing.customer_city IS DISTINCT FROM v_city
       OR v_existing.customer_address IS DISTINCT FROM v_address
       OR v_existing.customer_neighborhood IS DISTINCT FROM v_neighborhood THEN
      RETURN jsonb_build_object('success', false, 'conflict', true,
        'message', 'Ya existe un pedido con esta referencia pero los datos del cliente/dirección cambiaron. No se creó otro pedido para evitar duplicados; revisa el pedido anterior con la tienda.');
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.product_id, 'qty', x.qty, 'color', x.color, 'size', x.size)
                              ORDER BY x.product_id, x.color, x.size), '[]'::jsonb)
      INTO v_existing_lines
      FROM (
        SELECT item.value->>'id' AS product_id,
               sum(greatest(1, coalesce((item.value->>'qty')::integer, 1)))::integer AS qty,
               trim(coalesce(item.value->>'color', '')) AS color,
               trim(coalesce(item.value->>'size', '')) AS size
          FROM jsonb_array_elements(coalesce(v_existing.items, '[]'::jsonb)) AS item(value)
         GROUP BY item.value->>'id', trim(coalesce(item.value->>'color', '')), trim(coalesce(item.value->>'size', ''))
      ) AS x;

    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.product_id, 'qty', x.qty, 'color', x.color, 'size', x.size)
                              ORDER BY x.product_id, x.color, x.size), '[]'::jsonb)
      INTO v_requested_lines
      FROM (
        SELECT item.value->>'id' AS product_id,
               sum(greatest(1, coalesce((item.value->>'qty')::integer, 1)))::integer AS qty,
               trim(coalesce(item.value->>'color', '')) AS color,
               trim(coalesce(item.value->>'size', '')) AS size
          FROM jsonb_array_elements(coalesce(v_order_items, '[]'::jsonb)) AS item(value)
         GROUP BY item.value->>'id', trim(coalesce(item.value->>'color', '')), trim(coalesce(item.value->>'size', ''))
      ) AS x;

    IF v_existing_lines IS DISTINCT FROM v_requested_lines THEN
      RETURN jsonb_build_object('success', false, 'conflict', true,
        'message', 'Ya existe un pedido con esta referencia pero el carrito/las variantes cambiaron. No se creó otro pedido para evitar apartar unidades dos veces; revisa el pedido anterior con la tienda.');
    END IF;
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'order_id', v_existing.id,
      'total', v_existing.total, 'message', 'El pedido ya estaba registrado; no se volvió a reservar inventario.');
  END IF;

  -- Usa la misma función atómica de reserva que protege las compras Wompi; si
  -- cualquier variante está agotada o retenida por otro cliente, no se crea el pedido.
  SELECT * INTO v_reserve_result
    FROM public.reserve_inventory(v_inventory_reference, p_items, 10);
  IF coalesce(v_reserve_result.success, false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success', false,
      'message', coalesce(v_reserve_result.message, 'No fue posible apartar el inventario. Vuelve a revisar la disponibilidad.'));
  END IF;

  -- Contraentrega y envío gratis solo aplican a Cali. La retención se
  -- conserva hasta que el administrador entregue o rechace el pedido.
  -- Compatibilidad con las dos generaciones de reservas que existen en la base:
  -- la nueva usa 'active'; la anterior puede usar 'PENDING' o 'WHATSAPP_RESERVED'.
  -- La referencia se acaba de generar aquí y es única para este intento de pedido.
  -- No cambiamos el estado: solo prolongamos la reserva hasta gestionar contraentrega.
  UPDATE public.inventory_reservations
     SET expires_at = 'infinity'::timestamptz
   WHERE reference = v_inventory_reference
     AND upper(coalesce(status, '')) IN ('ACTIVE', 'PENDING', 'WHATSAPP_RESERVED');
  GET DIAGNOSTICS v_reservation_count = ROW_COUNT;
  IF v_reservation_count = 0 THEN
    RAISE EXCEPTION 'La reserva fue aceptada por reserve_inventory, pero no se encontró ninguna fila activa/PENDING para la referencia generada. Verifica la definición instalada de reserve_inventory y el estado que inserta.';
  END IF;

  INSERT INTO public.web_orders(
    customer_name, customer_cedula, customer_phone, customer_email,
    customer_city, customer_address, customer_neighborhood, note,
    payment_method, subtotal, shipping, total, items, status,
    client_reference, inventory_reference, inventory_state
  ) VALUES (
    v_name, v_cedula, v_phone, v_email, v_city, v_address, v_neighborhood, '',
    'Contra entrega', v_subtotal, 0, v_subtotal, v_order_items, 'pendiente',
    v_client_reference, v_inventory_reference, 'reserved'
  ) RETURNING id INTO v_order_id;

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_subtotal,
    'message', 'Pedido registrado y unidades apartadas hasta gestionar el pedido.');
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing
      FROM public.web_orders
     WHERE client_reference = v_client_reference
       AND payment_method = 'Contra entrega';
    IF FOUND THEN
      IF v_existing.customer_name IS DISTINCT FROM v_name
         OR v_existing.customer_cedula IS DISTINCT FROM v_cedula
         OR v_existing.customer_phone IS DISTINCT FROM v_phone
         OR v_existing.customer_email IS DISTINCT FROM v_email
         OR v_existing.customer_city IS DISTINCT FROM v_city
         OR v_existing.customer_address IS DISTINCT FROM v_address
         OR v_existing.customer_neighborhood IS DISTINCT FROM v_neighborhood THEN
        RETURN jsonb_build_object('success', false, 'conflict', true,
          'message', 'Ya existe un pedido con esta referencia pero los datos del cliente/dirección cambiaron. No se creó otro pedido para evitar duplicados; revisa el pedido anterior con la tienda.');
      END IF;

      SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.product_id, 'qty', x.qty, 'color', x.color, 'size', x.size)
                                ORDER BY x.product_id, x.color, x.size), '[]'::jsonb)
        INTO v_existing_lines
        FROM (
          SELECT item.value->>'id' AS product_id,
                 sum(greatest(1, coalesce((item.value->>'qty')::integer, 1)))::integer AS qty,
                 trim(coalesce(item.value->>'color', '')) AS color,
                 trim(coalesce(item.value->>'size', '')) AS size
            FROM jsonb_array_elements(coalesce(v_existing.items, '[]'::jsonb)) AS item(value)
           GROUP BY item.value->>'id', trim(coalesce(item.value->>'color', '')), trim(coalesce(item.value->>'size', ''))
        ) AS x;

      SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.product_id, 'qty', x.qty, 'color', x.color, 'size', x.size)
                                ORDER BY x.product_id, x.color, x.size), '[]'::jsonb)
        INTO v_requested_lines
        FROM (
          SELECT item.value->>'id' AS product_id,
                 sum(greatest(1, coalesce((item.value->>'qty')::integer, 1)))::integer AS qty,
                 trim(coalesce(item.value->>'color', '')) AS color,
                 trim(coalesce(item.value->>'size', '')) AS size
            FROM jsonb_array_elements(coalesce(v_order_items, '[]'::jsonb)) AS item(value)
           GROUP BY item.value->>'id', trim(coalesce(item.value->>'color', '')), trim(coalesce(item.value->>'size', ''))
        ) AS x;

      IF v_existing_lines IS DISTINCT FROM v_requested_lines THEN
        RETURN jsonb_build_object('success', false, 'conflict', true,
          'message', 'Ya existe un pedido con esta referencia pero el carrito/las variantes cambiaron. No se creó otro pedido para evitar apartar unidades dos veces; revisa el pedido anterior con la tienda.');
      END IF;
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'order_id', v_existing.id,
        'total', v_existing.total, 'message', 'El pedido ya estaba registrado; no se volvió a reservar inventario.');
    END IF;
    RETURN jsonb_build_object('success', false, 'message', 'La referencia ya fue usada. Actualiza el catálogo y vuelve a intentarlo.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_contra_delivery_order(p_client_reference text, p_customer_name text, p_customer_cedula text, p_customer_phone text, p_customer_email text, p_customer_city text, p_customer_address text, p_customer_neighborhood text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb;v_quote jsonb;v_order_id uuid;v_duplicate boolean:=false;
BEGIN
 v_result:=public.create_contra_delivery_order_unpriced_20261015(
   p_client_reference,p_customer_name,p_customer_cedula,p_customer_phone,p_customer_email,
   p_customer_city,p_customer_address,p_customer_neighborhood,p_items);
 IF coalesce((v_result->>'success')::boolean,false) IS DISTINCT FROM true THEN RETURN v_result; END IF;
 v_duplicate:=coalesce((v_result->>'duplicate')::boolean,false);
 IF v_duplicate THEN RETURN v_result; END IF;
 v_order_id:=nullif(v_result->>'order_id','')::uuid;
 IF v_order_id IS NULL THEN RAISE EXCEPTION 'El pedido se guardó sin un identificador recuperable; se revirtió la transacción.'; END IF;
 v_quote:=public.get_storefront_cart_quote(p_items,p_customer_city);
 IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'No se pudo calcular el precio promocional: %',coalesce(v_quote->>'message','respuesta no válida'); END IF;
 UPDATE public.web_orders
 SET subtotal=coalesce((v_quote->>'original_subtotal')::numeric,0),
     discount_total=coalesce((v_quote->>'discount_total')::numeric,0),
     shipping=coalesce((v_quote->>'shipping')::numeric,0),
     total=coalesce((v_quote->>'total')::numeric,0),
     items=coalesce(v_quote->'items','[]'::jsonb)
 WHERE id=v_order_id AND payment_method='Contra entrega';
 IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el pedido contraentrega que se acaba de crear; se revirtió la transacción.'; END IF;
 RETURN v_result||jsonb_build_object(
   'subtotal',v_quote->'original_subtotal','discount_total',v_quote->'discount_total',
   'shipping',v_quote->'shipping','total',v_quote->'total','discounts',v_quote->'discounts',
   'message','Pedido registrado. El descuento de la combinación se aplicó al total y las unidades quedaron apartadas.');
END $function$;
CREATE OR REPLACE FUNCTION public.create_contra_delivery_order_with_quote(p_client_reference text, p_customer_name text, p_customer_cedula text, p_customer_phone text, p_customer_email text, p_customer_city text, p_customer_address text, p_customer_neighborhood text, p_items jsonb, p_expected_total numeric, p_expected_discount_total numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_quote jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_existing_total numeric;
  v_existing_discount_total numeric;
  v_existing_shipping numeric;
BEGIN
  IF p_expected_total IS NULL OR p_expected_total<0 OR p_expected_total<>round(p_expected_total,0)
     OR p_expected_discount_total IS NULL OR p_expected_discount_total<0
     OR p_expected_discount_total<>round(p_expected_discount_total,0) THEN
    RETURN jsonb_build_object('success',false,'message','La cotización enviada no es válida. Vuelve a revisar el total.');
  END IF;

  -- Evita que la tarifa cambie mientras el pedido transaccional vuelve a cotizar.
  PERFORM 1 FROM public.storefront_shipping_settings WHERE id=1 FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','La configuración de envíos no está disponible.');
  END IF;

  v_quote:=public.get_storefront_cart_quote(p_items,p_customer_city);
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'message',coalesce(v_quote->>'message','No se pudo verificar el pedido.'));
  END IF;
  IF v_quote->>'total' IS NULL OR v_quote->>'discount_total' IS NULL OR v_quote->>'shipping' IS NULL THEN
    RETURN jsonb_build_object('success',false,'message','La cotización está incompleta. Vuelve a cargar el catálogo antes de confirmar.');
  END IF;
  IF round((v_quote->>'total')::numeric,0)<>round(p_expected_total,0)
     OR round((v_quote->>'discount_total')::numeric,0)<>round(p_expected_discount_total,0) THEN
    RETURN jsonb_build_object(
      'success',false,'quote_changed',true,
      'message','El envío o el descuento cambió. Revisa el total actualizado y vuelve a confirmar; no se creó ningún pedido.',
      'shipping',v_quote->'shipping','total',v_quote->'total',
      'discount_total',v_quote->'discount_total'
    );
  END IF;

  v_result:=public.create_contra_delivery_order(
    p_client_reference,p_customer_name,p_customer_cedula,p_customer_phone,p_customer_email,
    p_customer_city,p_customer_address,p_customer_neighborhood,p_items
  );
  IF v_result IS NULL OR jsonb_typeof(v_result) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_result->'success') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'La respuesta COD es nula o incompleta; la transacción fue revertida. Vuelve a intentar más tarde.';
  END IF;
  IF (v_result->>'success')::boolean IS NOT TRUE THEN
    RETURN v_result;
  END IF;
  IF coalesce((v_result->>'duplicate')::boolean,false) THEN
    v_order_id:=nullif(v_result->>'order_id','')::uuid;
    IF v_order_id IS NULL THEN
      RETURN jsonb_build_object('success',false,'message','Ya existe un pedido previo, pero no se pudo verificar su total. Contacta a la tienda antes de volver a confirmar.');
    END IF;
    SELECT w.total,w.discount_total,w.shipping
      INTO v_existing_total,v_existing_discount_total,v_existing_shipping
      FROM public.web_orders AS w
     WHERE w.id=v_order_id AND w.client_reference=btrim(p_client_reference)
       AND w.payment_method='Contra entrega'
     FOR SHARE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'message','Ya existe un pedido previo, pero no se pudo verificarlo. Contacta a la tienda antes de volver a confirmar.');
    END IF;
    IF v_existing_total IS NULL OR v_existing_discount_total IS NULL OR v_existing_shipping IS NULL
       OR round(v_existing_total,0)<>round(p_expected_total,0)
       OR round(v_existing_discount_total,0)<>round(p_expected_discount_total,0)
       OR round(v_existing_shipping,0)<>round((v_quote->>'shipping')::numeric,0) THEN
      RETURN jsonb_build_object(
        'success',false,'duplicate',true,'quote_changed',true,'existing_order_id',v_order_id,
        'existing_total',v_existing_total,'existing_discount_total',v_existing_discount_total,
        'shipping',v_quote->'shipping','total',v_quote->'total','discount_total',v_quote->'discount_total',
        'message','Ya existe un pedido anterior con otro total. No se creó otro pedido; contacta a la tienda para revisar el pedido previo.'
      );
    END IF;
    IF (v_result->>'total' IS NOT NULL
        AND round((v_result->>'total')::numeric,0)<>round(v_existing_total,0))
       OR (v_result->>'discount_total' IS NOT NULL
        AND round((v_result->>'discount_total')::numeric,0)<>round(v_existing_discount_total,0))
       OR (v_result->>'shipping' IS NOT NULL
        AND round((v_result->>'shipping')::numeric,0)<>round(v_existing_shipping,0)) THEN
      RETURN jsonb_build_object(
        'success',false,'duplicate',true,'quote_changed',true,'existing_order_id',v_order_id,
        'existing_total',v_existing_total,'existing_discount_total',v_existing_discount_total,
        'shipping',v_quote->'shipping','total',v_quote->'total','discount_total',v_quote->'discount_total',
        'message','La respuesta del pedido anterior no coincide con sus importes guardados. No se creó otro pedido; contacta a la tienda.'
      );
    END IF;
    RETURN v_result||jsonb_build_object(
      'success',true,'duplicate',true,'order_id',v_order_id,
      'total',v_existing_total,'discount_total',v_existing_discount_total,'shipping',v_existing_shipping,
      'message',coalesce(v_result->>'message','El pedido ya estaba registrado; no se volvió a reservar inventario.')
    );
  END IF;

  -- Si cambió precio/promoción durante la transacción, la excepción revierte el
  -- pedido y la reserva creados por la función COD existente.
  v_order_id:=nullif(v_result->>'order_id','')::uuid;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'La respuesta COD no contiene un identificador de pedido; la transacción fue revertida.';
  END IF;
  IF v_result->>'total' IS NULL OR v_result->>'discount_total' IS NULL OR v_result->>'shipping' IS NULL THEN
    RAISE EXCEPTION 'La respuesta COD no contiene todos los importes; la transacción fue revertida. Vuelve a revisar el pedido.';
  END IF;
  IF round((v_result->>'total')::numeric,0)<>round(p_expected_total,0)
     OR round((v_result->>'discount_total')::numeric,0)<>round(p_expected_discount_total,0)
     OR round((v_result->>'shipping')::numeric,0)<>round((v_quote->>'shipping')::numeric,0) THEN
    RAISE EXCEPTION 'La cotización cambió durante la creación del pedido; la transacción fue revertida. Vuelve a revisar el total.';
  END IF;
  RETURN v_result;
END $function$;
CREATE OR REPLACE FUNCTION public.create_contra_delivery_order_with_coupon(p_client_reference text, p_customer_name text, p_customer_cedula text, p_customer_phone text, p_customer_email text, p_customer_city text, p_customer_address text, p_customer_neighborhood text, p_items jsonb, p_coupon_code text, p_expected_total numeric, p_expected_discount_total numeric, p_expected_coupon_discount_total numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_code text:=upper(btrim(coalesce(p_coupon_code,'')));
  v_quote jsonb;
  v_legacy_quote jsonb;
  v_verified_quote jsonb;
  v_result jsonb;
  v_existing record;
  v_coupon_id uuid;
  v_order_id uuid;
  v_reservation jsonb;
  v_ledger public.storefront_coupon_redemptions%ROWTYPE;
  v_existing_item_key jsonb;
  v_input_item_key jsonb;
  v_product_lock_id uuid;
BEGIN
  IF btrim(coalesce(p_client_reference,''))='' OR length(btrim(p_client_reference))>200 THEN
    RETURN jsonb_build_object('success',false,'code','COD_REFERENCE_INVALID','message','La referencia del pedido no es válida.');
  END IF;
  IF p_expected_total IS NULL OR p_expected_total<0 OR p_expected_total<>round(p_expected_total,0)
     OR p_expected_discount_total IS NULL OR p_expected_discount_total<0 OR p_expected_discount_total<>round(p_expected_discount_total,0)
     OR p_expected_coupon_discount_total IS NULL OR p_expected_coupon_discount_total<0
     OR p_expected_coupon_discount_total<>round(p_expected_coupon_discount_total,0) THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización enviada no es válida. Vuelve a revisar el total.');
  END IF;
  IF p_expected_coupon_discount_total>p_expected_discount_total THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','El descuento del cupón no concilia con el descuento total.');
  END IF;
  IF v_code<>'' AND v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_INVALID','message','El código del cupón no es válido.');
  END IF;

  -- Serializa reintentos COD del mismo client_reference antes de buscar una fila;
  -- un SELECT FOR UPDATE no bloquea la ausencia de la fila en la primera compra.
  PERFORM pg_advisory_xact_lock(hashtext('storefront-cod-coupon-reference:'||btrim(p_client_reference)));

  -- La idempotencia se decide antes de volver a cotizar: nunca se agrega un cupón
  -- retroactivamente a un pedido COD legacy que ya existe.
  IF v_code<>'' THEN
    SELECT c.id INTO v_coupon_id FROM public.storefront_coupons AS c WHERE c.code=v_code LIMIT 1;
  END IF;
  SELECT w.id,w.total,w.discount_total,w.shipping,w.items,w.coupon_id,w.coupon_code,w.coupon_discount_total,
         w.payment_method,w.client_reference,w.customer_name,w.customer_cedula,w.customer_phone,
         w.customer_email,w.customer_city,w.customer_address,w.customer_neighborhood
    INTO v_existing
    FROM public.web_orders AS w
   WHERE w.client_reference=btrim(p_client_reference)
     AND w.payment_method='Contra entrega'
   LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',coalesce(x.value->>'id',x.value->>'product_id',''),
      'qty',coalesce(x.value->>'qty',''),
      'color',coalesce(x.value->>'color',''),
      'size',coalesce(x.value->>'size','')
    ) ORDER BY x.ordinality),'[]'::jsonb)
      INTO v_existing_item_key
      FROM jsonb_array_elements(coalesce(v_existing.items,'[]'::jsonb)) WITH ORDINALITY AS x(value,ordinality);
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',coalesce(x.value->>'id',x.value->>'product_id',''),
      'qty',coalesce(x.value->>'qty',''),
      'color',coalesce(x.value->>'color',''),
      'size',coalesce(x.value->>'size','')
    ) ORDER BY x.ordinality),'[]'::jsonb)
      INTO v_input_item_key
      FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) WITH ORDINALITY AS x(value,ordinality);
    IF coalesce(v_existing.coupon_code,'')<>v_code
       OR v_existing.coupon_id IS DISTINCT FROM v_coupon_id
       OR v_existing_item_key IS DISTINCT FROM v_input_item_key
       OR lower(btrim(coalesce(v_existing.customer_name,''))) IS DISTINCT FROM lower(btrim(coalesce(p_customer_name,'')))
       OR btrim(coalesce(v_existing.customer_cedula,'')) IS DISTINCT FROM btrim(coalesce(p_customer_cedula,''))
       OR public._storefront_coupon_normalized_phone(v_existing.customer_phone) IS DISTINCT FROM public._storefront_coupon_normalized_phone(p_customer_phone)
       OR lower(btrim(coalesce(v_existing.customer_email,''))) IS DISTINCT FROM lower(btrim(coalesce(p_customer_email,'')))
       OR public.normalize_storefront_delivery_city(v_existing.customer_city) IS DISTINCT FROM public.normalize_storefront_delivery_city(p_customer_city)
       OR lower(btrim(coalesce(v_existing.customer_address,''))) IS DISTINCT FROM lower(btrim(coalesce(p_customer_address,'')))
       OR lower(btrim(coalesce(v_existing.customer_neighborhood,''))) IS DISTINCT FROM lower(btrim(coalesce(p_customer_neighborhood,'')))
       OR round(coalesce(v_existing.coupon_discount_total,0),0)<>round(p_expected_coupon_discount_total,0)
       OR round(v_existing.discount_total,0)<>round(p_expected_discount_total,0)
       OR round(v_existing.total,0)<>round(p_expected_total,0) THEN
      RETURN jsonb_build_object(
        'success',false,'duplicate',true,'code','COD_REFERENCE_CONFLICT',
        'existing_order_id',v_existing.id,'existing_total',v_existing.total,
        'existing_discount_total',v_existing.discount_total,
        'existing_coupon_discount_total',v_existing.coupon_discount_total,
        'message','Ya existe un pedido COD con otros datos, cupón o importe. No se modificó ni duplicó el pedido anterior.'
      );
    END IF;
    IF v_code<>'' THEN
      SELECT r.* INTO v_ledger
        FROM public.storefront_coupon_redemptions AS r
       WHERE r.channel='cod' AND r.reference=btrim(p_client_reference)
       LIMIT 1
       FOR SHARE;
      IF NOT FOUND OR v_ledger.status<>'redeemed'
         OR v_ledger.coupon_id IS DISTINCT FROM v_existing.coupon_id
         OR v_ledger.code IS DISTINCT FROM v_code
         OR v_ledger.discount_total IS DISTINCT FROM round(p_expected_coupon_discount_total,0)::bigint THEN
        RETURN jsonb_build_object('success',false,'duplicate',true,'code','COD_COUPON_LEDGER_MISMATCH',
          'existing_order_id',v_existing.id,'message','El pedido COD existe, pero su ledger de cupón no coincide; no se modificó.');
      END IF;
    END IF;
    RETURN jsonb_build_object(
      'success',true,'duplicate',true,'order_id',v_existing.id,'total',v_existing.total,
      'discount_total',v_existing.discount_total,'coupon_discount_total',coalesce(v_existing.coupon_discount_total,0),
      'shipping',v_existing.shipping,'coupon_id',v_existing.coupon_id,'coupon_code',v_existing.coupon_code,
      'message','El pedido ya estaba registrado; no se volvió a reservar inventario ni cupón.'
    );
  END IF;

  PERFORM 1 FROM public.storefront_shipping_settings WHERE id=1 FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','SHIPPING_UNAVAILABLE','message','La configuración de envíos no está disponible.');
  END IF;
  -- Freeze mutable inputs through the legacy call. Shared table locks serialize
  -- combo/shipping-rule edits; ordered row locks serialize price changes for
  -- products in this cart without blocking unrelated catalog updates.
  LOCK TABLE public.storefront_product_combos,
             public.storefront_shipping_rules,
             public.storefront_shipping_rule_destinations IN SHARE MODE;
  IF jsonb_typeof(p_items)='array' THEN
    FOR v_product_lock_id IN
      SELECT DISTINCT coalesce(x.value->>'id',x.value->>'product_id')::uuid
        FROM jsonb_array_elements(p_items) AS x(value)
       WHERE coalesce(x.value->>'id',x.value->>'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ORDER BY 1
    LOOP
      PERFORM 1 FROM public.products AS p WHERE p.id=v_product_lock_id FOR NO KEY UPDATE OF p;
    END LOOP;
  END IF;
  v_quote:=public.get_storefront_cart_quote_with_coupon(
    p_items,p_customer_city,v_code,p_customer_email,p_customer_phone
  );
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN
    RETURN v_quote;
  END IF;
  IF v_quote->>'total' IS NULL OR v_quote->>'discount_total' IS NULL
     OR v_quote->>'coupon_discount_total' IS NULL OR v_quote->>'shipping' IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización con cupón está incompleta. Vuelve a cargar el catálogo.');
  END IF;
  IF round((v_quote->>'total')::numeric,0)<>round(p_expected_total,0)
     OR round((v_quote->>'discount_total')::numeric,0)<>round(p_expected_discount_total,0)
     OR round((v_quote->>'coupon_discount_total')::numeric,0)<>round(p_expected_coupon_discount_total,0) THEN
    RETURN jsonb_build_object(
      'success',false,'quote_changed',true,'code','QUOTE_CHANGED',
      'message','El envío o el descuento cambió. Revisa el total actualizado y vuelve a confirmar; no se creó ningún pedido.',
      'shipping',v_quote->'shipping','total',v_quote->'total',
      'discount_total',v_quote->'discount_total','coupon_discount_total',v_quote->'coupon_discount_total'
    );
  END IF;

  IF v_code<>'' THEN
    v_reservation:=public.reserve_storefront_coupon_redemption(
      v_code,'cod',btrim(p_client_reference),p_customer_email,p_customer_phone,
      round((v_quote->>'coupon_discount_total')::numeric,0)::bigint
    );
    IF coalesce((v_reservation->>'success')::boolean,false) IS DISTINCT FROM true THEN
      RETURN v_reservation;
    END IF;
    IF coalesce((v_reservation->>'status'),'')<>'reserved' THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_CONFLICT','message','La referencia ya tiene una reserva incompatible.');
    END IF;
  END IF;

  v_result:=public.create_contra_delivery_order(
    p_client_reference,p_customer_name,p_customer_cedula,p_customer_phone,p_customer_email,
    p_customer_city,p_customer_address,p_customer_neighborhood,p_items
  );
  IF v_result IS NULL OR jsonb_typeof(v_result) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_result->'success') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'La respuesta COD es nula o incompleta; la transacción fue revertida.';
  END IF;
  IF (v_result->>'success')::boolean IS NOT TRUE THEN
    IF v_code<>'' THEN
      IF EXISTS (
        SELECT 1 FROM public.web_orders AS w
         WHERE w.client_reference=btrim(p_client_reference)
      ) THEN
        RAISE EXCEPTION 'La RPC COD informó fallo pero dejó un pedido; se revierte para evitar una reserva inconsistente.';
      END IF;
      UPDATE public.storefront_coupon_redemptions
         SET expires_at=now(),updated_at=now()
       WHERE channel='cod' AND reference=btrim(p_client_reference) AND status='reserved';
    END IF;
    RETURN v_result;
  END IF;
  IF coalesce((v_result->>'duplicate')::boolean,false) THEN
    RAISE EXCEPTION 'El COD legacy devolvió duplicado después de la comprobación; la transacción fue revertida para revalidar el pedido existente.';
  END IF;
  v_order_id:=nullif(v_result->>'order_id','')::uuid;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'La respuesta COD no contiene un identificador de pedido; la transacción fue revertida.';
  END IF;
  IF v_result->>'total' IS NULL OR v_result->>'discount_total' IS NULL OR v_result->>'shipping' IS NULL THEN
    RAISE EXCEPTION 'La respuesta COD no contiene todos los importes; la transacción fue revertida.';
  END IF;
  -- Comprueba que la cotización que devolvió/guardó el RPC legacy corresponde
  -- a los mismos productos/combos/ajustes y que la cotización con cupón no cambió
  -- durante su ejecución. Cualquier TOCTOU revierte pedido, reserva y ledger.
  v_legacy_quote:=public.get_storefront_cart_quote(p_items,p_customer_city);
  IF coalesce((v_legacy_quote->>'success')::boolean,false) IS DISTINCT FROM true
     OR v_legacy_quote->>'total' IS NULL OR v_legacy_quote->>'discount_total' IS NULL
     OR v_legacy_quote->>'shipping' IS NULL
     OR round((v_result->>'total')::numeric,0)<>round((v_legacy_quote->>'total')::numeric,0)
     OR round((v_result->>'discount_total')::numeric,0)<>round((v_legacy_quote->>'discount_total')::numeric,0)
     OR round((v_result->>'shipping')::numeric,0)<>round((v_legacy_quote->>'shipping')::numeric,0) THEN
    RAISE EXCEPTION 'La cotización COD legacy no coincide con el quote actual sin cupón; se revierte la transacción.';
  END IF;
  v_verified_quote:=public.get_storefront_cart_quote_with_coupon(
    p_items,p_customer_city,v_code,p_customer_email,p_customer_phone
  );
  IF coalesce((v_verified_quote->>'success')::boolean,false) IS DISTINCT FROM true
     OR v_verified_quote->>'original_subtotal' IS NULL
     OR v_verified_quote->>'discount_total' IS NULL
     OR v_verified_quote->>'coupon_discount_total' IS NULL
     OR v_verified_quote->>'shipping' IS NULL OR v_verified_quote->>'total' IS NULL
     OR v_verified_quote->'items' IS DISTINCT FROM v_quote->'items'
     OR v_verified_quote->'discounts' IS DISTINCT FROM v_quote->'discounts'
     OR v_verified_quote->'coupon_id' IS DISTINCT FROM v_quote->'coupon_id'
     OR v_verified_quote->>'original_subtotal' IS DISTINCT FROM v_quote->>'original_subtotal'
     OR v_verified_quote->>'discount_total' IS DISTINCT FROM v_quote->>'discount_total'
     OR v_verified_quote->>'coupon_discount_total' IS DISTINCT FROM v_quote->>'coupon_discount_total'
     OR v_verified_quote->>'shipping' IS DISTINCT FROM v_quote->>'shipping'
     OR v_verified_quote->>'total' IS DISTINCT FROM v_quote->>'total' THEN
    RAISE EXCEPTION 'La cotización con cupón cambió durante el alta del pedido; se revierte la transacción.';
  END IF;

  UPDATE public.web_orders AS w
     SET original_subtotal=round((v_quote->>'original_subtotal')::numeric,0),
         discount_total=round((v_quote->>'discount_total')::numeric,0),
         shipping=round((v_quote->>'shipping')::numeric,0),
         total=round((v_quote->>'total')::numeric,0),
         items=v_quote->'items',
         coupon_id=nullif(v_quote->>'coupon_id','')::uuid,
         coupon_code=nullif(v_quote->>'coupon_code',''),
         coupon_discount_total=round(coalesce((v_quote->>'coupon_discount_total')::numeric,0),0)
   WHERE w.id=v_order_id AND w.client_reference=btrim(p_client_reference)
     AND w.payment_method='Contra entrega';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el pedido COD recién creado para persistir el cupón; la transacción fue revertida.';
  END IF;
  IF v_code<>'' THEN
    UPDATE public.storefront_coupon_redemptions AS r
       SET status='redeemed',redeemed_at=coalesce(r.redeemed_at,now()),updated_at=now()
     WHERE r.channel='cod' AND r.reference=btrim(p_client_reference)
       AND r.status='reserved' AND r.coupon_id=nullif(v_quote->>'coupon_id','')::uuid
       AND r.code=v_code AND r.discount_total=round((v_quote->>'coupon_discount_total')::numeric,0)::bigint;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se pudo consumir el ledger COD del cupón; la transacción fue revertida.';
    END IF;
  END IF;
  RETURN v_result||jsonb_build_object(
    'total',v_quote->'total','discount_total',v_quote->'discount_total',
    'coupon_id',v_quote->'coupon_id','coupon_code',v_quote->'coupon_code',
    'coupon_discount_total',v_quote->'coupon_discount_total',
    'shipping',v_quote->'shipping','items',v_quote->'items','quote',v_quote
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.enforce_cod_customer_cedula_20261109()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_method text := lower(btrim(coalesce(NEW.payment_method, '')));
  v_cedula text := btrim(coalesce(NEW.customer_cedula, ''));
BEGIN
  IF v_method = 'contra entrega' THEN
    IF v_cedula = '' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'CUSTOMER_CEDULA_REQUIRED';
    END IF;
    IF char_length(v_cedula) > 60 OR v_cedula ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'CUSTOMER_CEDULA_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public._storefront_coupon_customer_hash(text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._storefront_coupon_normalized_phone(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._storefront_coupons_are_enabled() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.begin_storefront_wompi_payment_attempt(p_order_reference text, p_customer_name text, p_customer_phone text, p_city text, p_address text, p_neighborhood text, p_expected_quote jsonb, p_cart_hash text, p_is_new_order boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_storefront_wompi_payment_attempt(p_order_reference text, p_customer_name text, p_customer_phone text, p_city text, p_address text, p_neighborhood text, p_expected_quote jsonb, p_cart_hash text, p_is_new_order boolean) TO service_role;
REVOKE ALL ON FUNCTION public.begin_storefront_wompi_payment_attempt(text,text,text,text,text,text,jsonb,text,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_storefront_wompi_payment_attempt(text,text,text,text,text,text,jsonb,text,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.claim_storefront_wompi_checkout(p_reference text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_wompi_checkout(p_reference text) TO service_role;
REVOKE ALL ON FUNCTION public.claim_storefront_wompi_checkout(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_wompi_checkout(text) TO service_role;
REVOKE ALL ON FUNCTION public.cleanup_inventory_reservations() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_inventory_reservations() TO service_role;
REVOKE ALL ON FUNCTION public.confirm_storefront_coupon_redemption(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_storefront_coupon_redemption(text) TO service_role;
REVOKE ALL ON FUNCTION public.create_contra_delivery_order(text,text,text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order(text,text,text,text,text,text,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.create_contra_delivery_order_unpriced_20261015(text,text,text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_unpriced_20261015(text,text,text,text,text,text,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.create_contra_delivery_order_with_coupon(p_client_reference text, p_customer_name text, p_customer_cedula text, p_customer_phone text, p_customer_email text, p_customer_city text, p_customer_address text, p_customer_neighborhood text, p_items jsonb, p_coupon_code text, p_expected_total numeric, p_expected_discount_total numeric, p_expected_coupon_discount_total numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_coupon(p_client_reference text, p_customer_name text, p_customer_cedula text, p_customer_phone text, p_customer_email text, p_customer_city text, p_customer_address text, p_customer_neighborhood text, p_items jsonb, p_coupon_code text, p_expected_total numeric, p_expected_discount_total numeric, p_expected_coupon_discount_total numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_coupon(p_client_reference text, p_customer_name text, p_customer_cedula text, p_customer_phone text, p_customer_email text, p_customer_city text, p_customer_address text, p_customer_neighborhood text, p_items jsonb, p_coupon_code text, p_expected_total numeric, p_expected_discount_total numeric, p_expected_coupon_discount_total numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_coupon(p_client_reference text, p_customer_name text, p_customer_cedula text, p_customer_phone text, p_customer_email text, p_customer_city text, p_customer_address text, p_customer_neighborhood text, p_items jsonb, p_coupon_code text, p_expected_total numeric, p_expected_discount_total numeric, p_expected_coupon_discount_total numeric) TO service_role;
REVOKE ALL ON FUNCTION public.create_contra_delivery_order_with_coupon(text,text,text,text,text,text,text,text,jsonb,text,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_coupon(text,text,text,text,text,text,text,text,jsonb,text,numeric,numeric,numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_coupon(text,text,text,text,text,text,text,text,jsonb,text,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_coupon(text,text,text,text,text,text,text,text,jsonb,text,numeric,numeric,numeric) TO service_role;
REVOKE ALL ON FUNCTION public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric) TO service_role;
REVOKE ALL ON FUNCTION public.create_storefront_wompi_pending_order(p_reference text, p_customer_name text, p_phone text, p_city text, p_address text, p_neighborhood text, p_items jsonb, p_subtotal bigint, p_shipping bigint, p_total bigint, p_coupon_id uuid, p_coupon_code text, p_coupon_discount_total bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_storefront_wompi_pending_order(p_reference text, p_customer_name text, p_phone text, p_city text, p_address text, p_neighborhood text, p_items jsonb, p_subtotal bigint, p_shipping bigint, p_total bigint, p_coupon_id uuid, p_coupon_code text, p_coupon_discount_total bigint) TO service_role;
REVOKE ALL ON FUNCTION public.create_storefront_wompi_pending_order(text,text,text,text,text,text,jsonb,bigint,bigint,bigint,uuid,text,bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_storefront_wompi_pending_order(text,text,text,text,text,text,jsonb,bigint,bigint,bigint,uuid,text,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.enforce_cod_customer_cedula_20261109() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_cod_customer_cedula_20261109() TO service_role;
REVOKE ALL ON FUNCTION public.expire_storefront_coupon_redemption(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_storefront_coupon_redemption(text) TO service_role;
REVOKE ALL ON FUNCTION public.get_storefront_cart_quote(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote(jsonb,text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote(jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote(jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.get_storefront_cart_quote(p_items jsonb, p_city text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote(p_items jsonb, p_city text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote(p_items jsonb, p_city text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote(p_items jsonb, p_city text) TO service_role;
REVOKE ALL ON FUNCTION public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.get_storefront_cart_quote_with_coupon(p_items jsonb, p_city text, p_coupon_code text, p_customer_email text, p_customer_phone text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote_with_coupon(p_items jsonb, p_city text, p_coupon_code text, p_customer_email text, p_customer_phone text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote_with_coupon(p_items jsonb, p_city text, p_coupon_code text, p_customer_email text, p_customer_phone text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote_with_coupon(p_items jsonb, p_city text, p_coupon_code text, p_customer_email text, p_customer_phone text) TO service_role;
REVOKE ALL ON FUNCTION public.is_store_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_store_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_store_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_store_admin() TO service_role;
REVOKE ALL ON FUNCTION public.list_pending_wompi_orders_for_phone(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_pending_wompi_orders_for_phone(text) TO service_role;
REVOKE ALL ON FUNCTION public.mark_storefront_wompi_reconciliation(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_storefront_wompi_reconciliation(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.normalize_storefront_delivery_city(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_storefront_wompi_checkout(p_reference text, p_items jsonb, p_city text, p_coupon_code text, p_customer_email text, p_customer_phone text, p_expected_quote jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_storefront_wompi_checkout(p_reference text, p_items jsonb, p_city text, p_coupon_code text, p_customer_email text, p_customer_phone text, p_expected_quote jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_storefront_wompi_checkout(text,jsonb,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_storefront_wompi_checkout(text,jsonb,text,text,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_storefront_wompi_retry_lock(p_reference text, p_customer_phone text, p_cart_hash text, p_minutes integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_storefront_wompi_retry_lock(p_reference text, p_customer_phone text, p_cart_hash text, p_minutes integer) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_storefront_wompi_retry_lock(text,text,text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_storefront_wompi_retry_lock(text,text,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.recover_storefront_wompi_legacy_order(p_order_reference text, p_cart_hash text, p_customer_email text, p_verified_attempts jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recover_storefront_wompi_legacy_order(p_order_reference text, p_cart_hash text, p_customer_email text, p_verified_attempts jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recover_storefront_wompi_legacy_order(text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recover_storefront_wompi_legacy_order(text,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.release_inventory_reservation(p_reference text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_inventory_reservation(p_reference text) TO service_role;
REVOKE ALL ON FUNCTION public.release_inventory_reservation(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_inventory_reservation(text) TO service_role;
REVOKE ALL ON FUNCTION public.release_storefront_coupon_redemption(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_storefront_coupon_redemption(text) TO service_role;
REVOKE ALL ON FUNCTION public.release_storefront_wompi_coupon_redemption_for_attempt(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_storefront_wompi_coupon_redemption_for_attempt(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_inventory(p_reference text, p_items jsonb, p_minutes integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_inventory(p_reference text, p_items jsonb, p_minutes integer) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_inventory(text,jsonb,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_inventory(text,jsonb,integer) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_order_inventory(p_reference text, p_items jsonb, p_minutes integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_order_inventory(p_reference text, p_items jsonb, p_minutes integer) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_order_inventory(text,jsonb,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_order_inventory(text,jsonb,integer) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_storefront_coupon_redemption(text,text,text,text,text,bigint,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_coupon_redemption(text,text,text,text,text,bigint,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_storefront_wompi_checkout_lock(p_reference text, p_customer_phone text, p_cart_hash text, p_minutes integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_wompi_checkout_lock(p_reference text, p_customer_phone text, p_cart_hash text, p_minutes integer) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_storefront_wompi_checkout_lock(text,text,text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_wompi_checkout_lock(text,text,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.set_storefront_wompi_checkout_state(text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_storefront_wompi_checkout_state(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.sirevya_normalize_combo_category(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sirevya_normalize_combo_category(text) TO anon;
GRANT EXECUTE ON FUNCTION public.sirevya_normalize_combo_category(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sirevya_normalize_combo_category(text) TO service_role;
REVOKE ALL ON FUNCTION public.storefront_cod_city_allowed(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storefront_cod_city_allowed(text) TO service_role;
REVOKE ALL ON FUNCTION public.transition_storefront_wompi_payment_attempt(p_attempt_reference text, p_transaction_id text, p_status text, p_amount_in_cents bigint, p_currency text, p_environment text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_storefront_wompi_payment_attempt(p_attempt_reference text, p_transaction_id text, p_status text, p_amount_in_cents bigint, p_currency text, p_environment text) TO service_role;
REVOKE ALL ON FUNCTION public.transition_storefront_wompi_payment_attempt(text,text,text,bigint,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_storefront_wompi_payment_attempt(text,text,text,bigint,text,text) TO service_role;

CREATE TRIGGER enforce_cod_customer_cedula_20261109 BEFORE INSERT OR UPDATE OF customer_cedula, payment_method ON public.web_orders FOR EACH ROW EXECUTE FUNCTION public.enforce_cod_customer_cedula_20261109();
