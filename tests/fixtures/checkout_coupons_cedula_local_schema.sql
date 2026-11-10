-- Schema sintético mínimo requerido por los candidatos de cédula y cupones.
-- Debe aplicarse después de promotion_calendar_local_setup.sql y antes de sus migraciones.
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL,
  customer_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  neighborhood text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal bigint NOT NULL DEFAULT 0,
  shipping bigint NOT NULL DEFAULT 0,
  total bigint NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'wompi',
  payment_status text NOT NULL DEFAULT 'PENDING',
  transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX orders_reference_uq ON public.orders(reference);

CREATE TABLE public.web_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_reference text NOT NULL UNIQUE,
  payment_method text NOT NULL,
  customer_name text NOT NULL DEFAULT '',
  customer_cedula text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  customer_email text NOT NULL DEFAULT '',
  customer_city text NOT NULL DEFAULT '',
  customer_address text NOT NULL DEFAULT '',
  customer_neighborhood text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  original_subtotal numeric NOT NULL DEFAULT 0,
  discount_total numeric NOT NULL DEFAULT 0,
  shipping numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_reservations (
  reference text PRIMARY KEY,
  status text NOT NULL,
  items jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Registro sintético previo al trigger: permite comprobar que el replay histórico COD
-- con documento vacío no crea otra fila ni altera pedidos existentes.
INSERT INTO public.web_orders(client_reference,payment_method,customer_cedula)
VALUES ('LEGACY-COD-REF','Contra entrega','   ');
