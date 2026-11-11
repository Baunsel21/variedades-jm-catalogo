DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END;
$roles$;

CREATE TABLE public.orders (id bigint PRIMARY KEY);
CREATE TABLE public.inventory_reservations (reference text PRIMARY KEY, status text NOT NULL DEFAULT 'active');
CREATE TABLE public.product_images (id bigint PRIMARY KEY, product_id uuid, image_path text);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_reservations_browser_deny ON public.inventory_reservations
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE FUNCTION public.is_store_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$ SELECT true $$;
CREATE POLICY product_images_admin_only ON public.product_images
  FOR ALL TO authenticated USING (public.is_store_admin()) WITH CHECK (public.is_store_admin());

CREATE FUNCTION public.cleanup_inventory_reservations() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.release_expired_inventory_reservations() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$ BEGIN RETURN; END $$;

-- Deliberately over-permissive fixture grants reproduce the catalog finding.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.orders TO PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.inventory_reservations TO PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.product_images TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_inventory_reservations() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_expired_inventory_reservations() TO PUBLIC, anon, authenticated, service_role;
