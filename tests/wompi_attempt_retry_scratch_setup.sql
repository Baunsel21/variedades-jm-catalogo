-- Fixtures mínimos solo para una base PostgreSQL scratch temporal.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.orders (
  reference text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  customer_name text NOT NULL,
  phone text NOT NULL,
  city text NOT NULL,
  address text NOT NULL,
  neighborhood text NOT NULL DEFAULT '',
  items jsonb NOT NULL,
  subtotal bigint NOT NULL,
  shipping bigint NOT NULL,
  total bigint NOT NULL,
  coupon_id uuid,
  coupon_code text,
  coupon_discount_total bigint NOT NULL DEFAULT 0,
  payment_method text NOT NULL,
  payment_status text NOT NULL DEFAULT 'PENDING',
  transaction_id text,
  wompi_reconciliation_required boolean NOT NULL DEFAULT false,
  coupon_reconciliation_required boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.storefront_wompi_checkout_locks (
  reference text PRIMARY KEY,
  customer_phone_hash text NOT NULL,
  cart_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  checkout_claimed_at timestamptz,
  transaction_id text,
  terminal_at timestamptz,
  reconciliation_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX storefront_wompi_checkout_active_phone_uq
  ON public.storefront_wompi_checkout_locks(customer_phone_hash) WHERE status IN ('active','pending','terminal_grace');
CREATE TABLE public.storefront_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  end_at timestamptz,
  global_limit integer,
  per_customer_limit integer
);
CREATE TABLE public.storefront_coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL,
  code text NOT NULL,
  channel text NOT NULL,
  reference text NOT NULL,
  customer_hash text NOT NULL,
  discount_total bigint NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  reconciliation_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel,reference)
);
CREATE TABLE public.web_orders (client_reference text);
CREATE TABLE public.inventory_reservations (
  reference text NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL,
  color text,
  size text,
  expires_at timestamptz NOT NULL,
  status text NOT NULL
);
CREATE OR REPLACE FUNCTION public._storefront_coupon_normalized_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT right(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),10)
$$;
CREATE OR REPLACE FUNCTION public._storefront_coupon_customer_hash(p_email text,p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(extensions.digest(lower(btrim(coalesce(p_email,'')))||'|'||public._storefront_coupon_normalized_phone(p_phone),'sha256'),'hex')
$$;
