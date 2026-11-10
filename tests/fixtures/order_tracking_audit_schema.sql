-- Disposable local fixture only; never run against Supabase or another shared database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END;
$$;
CREATE SCHEMA auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.is_store_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(current_setting('request.jwt.claim.is_admin', true), 'false') = 'true' $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.web_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pendiente'
);
ALTER TABLE public.web_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY web_orders_admin_scratch ON public.web_orders FOR ALL TO authenticated
  USING (public.is_store_admin()) WITH CHECK (public.is_store_admin());
GRANT SELECT, UPDATE ON public.web_orders TO authenticated;
INSERT INTO public.web_orders(id, status)
VALUES ('44444444-4444-4444-8444-444444444444', 'confirmado');
