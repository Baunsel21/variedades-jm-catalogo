-- Disposable local fixture only. Never run against Supabase or another shared database.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'CREATE ROLE anon NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'CREATE ROLE authenticated NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'CREATE ROLE service_role NOLOGIN BYPASSRLS'; END IF;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION public.is_store_admin()
RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT COALESCE(current_setting('test.is_admin', true), 'false') = 'true' $$;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  secret text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
SELECT id, name, secret AS decrypted_secret, created_at FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(p_secret text, p_name text, p_description text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql
AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO vault.secrets(name, secret, description)
  VALUES (p_name, p_secret, p_description)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  customer_name text,
  phone text,
  city text,
  address text,
  neighborhood text,
  items jsonb,
  subtotal bigint,
  discount_total bigint,
  shipping bigint,
  total bigint,
  coupon_code text,
  coupon_discount_total bigint,
  delivery_method text,
  payment_method text,
  payment_status text,
  transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  order_status text
);

CREATE TABLE public.web_orders (
  id uuid PRIMARY KEY,
  customer_name text,
  customer_cedula text,
  customer_phone text,
  customer_email text,
  customer_city text,
  customer_address text,
  customer_neighborhood text,
  note text,
  payment_method text,
  payment_status text,
  subtotal bigint,
  coupon_code text,
  coupon_discount_total bigint,
  shipping bigint,
  total bigint,
  items jsonb,
  status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_reference text,
  inventory_reference text,
  inventory_state text,
  discount_total bigint,
  delivery_method text
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  code text,
  name text,
  category text,
  quantity integer NOT NULL DEFAULT 0,
  cost_price bigint,
  sale_price bigint,
  variants jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_reservations (
  id uuid PRIMARY KEY,
  product_id uuid,
  quantity integer NOT NULL CHECK (quantity > 0),
  reference text,
  status text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  color text,
  size text
);

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY,
  product_id uuid,
  product_code text,
  product_name text,
  type text,
  quantity integer,
  motive text,
  created_at timestamptz NOT NULL DEFAULT now()
);
