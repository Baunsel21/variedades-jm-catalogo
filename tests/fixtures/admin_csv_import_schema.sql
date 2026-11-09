DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE OR REPLACE FUNCTION public.is_store_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT current_setting('request.jwt.claim.is_admin', true) = 'true' $$;
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Otros',
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  cost_price numeric NOT NULL DEFAULT 0,
  sale_price numeric NOT NULL DEFAULT 0,
  location text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  colors text[] NOT NULL DEFAULT '{}',
  sizes text[] NOT NULL DEFAULT '{}',
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text NOT NULL DEFAULT '',
  size_guide text NOT NULL DEFAULT '',
  size_guide_image text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX products_user_code_idx ON public.products(user_id, code);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products own" ON public.products FOR ALL TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid())
  WITH CHECK (public.is_store_admin() AND user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
