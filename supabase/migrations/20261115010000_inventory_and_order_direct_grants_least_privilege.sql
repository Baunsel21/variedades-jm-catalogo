-- Candidate only: least-privilege ACL correction from the 2026-11-10 metadata review.
-- Do not apply to production until the project backup has a verified isolated restore,
-- the target catalog is reconciled, and the caller/scheduler preflight passes.
-- This migration changes privileges only; it does not read or modify business rows.
BEGIN;

DO $preflight$
DECLARE
  v_table_count integer;
  v_definer_count integer;
  v_unsafe_cron boolean := false;
BEGIN
  IF to_regclass('public.orders') IS NULL
     OR to_regclass('public.inventory_reservations') IS NULL
     OR to_regclass('public.product_images') IS NULL THEN
    RAISE EXCEPTION 'ACL candidate prerequisite missing: required public table not found.';
  END IF;

  SELECT count(*) INTO v_table_count
  FROM pg_class AS c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('orders','inventory_reservations','product_images')
    AND c.relrowsecurity;
  IF v_table_count <> 3 THEN
    RAISE EXCEPTION 'ACL candidate prerequisite failed: RLS must be enabled on all three tables.';
  END IF;

  IF to_regprocedure('public.cleanup_inventory_reservations()') IS NULL
     OR to_regprocedure('public.release_expired_inventory_reservations()') IS NULL THEN
    RAISE EXCEPTION 'ACL candidate prerequisite missing: expected reservation cleanup function signature not found.';
  END IF;
  SELECT count(*) INTO v_definer_count
  FROM pg_proc AS p
  WHERE p.oid IN (
    'public.cleanup_inventory_reservations()'::regprocedure,
    'public.release_expired_inventory_reservations()'::regprocedure
  ) AND p.prosecdef;
  IF v_definer_count <> 2 THEN
    RAISE EXCEPTION 'ACL candidate prerequisite failed: cleanup functions must remain SECURITY DEFINER.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies AS p
    WHERE p.schemaname='public' AND p.tablename='product_images'
      AND 'authenticated'::name = ANY(p.roles)
      AND (p.cmd='ALL' OR p.cmd IN ('SELECT','INSERT','UPDATE','DELETE'))
      AND (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'')) ILIKE '%is_store_admin%'
  ) THEN
    RAISE EXCEPTION 'ACL candidate prerequisite failed: authenticated product_images admin policy is missing.';
  END IF;

  -- pg_cron runs as its configured job owner. Abort rather than strand a cleanup
  -- job if an active job explicitly runs as a browser role.
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $cron_check$
      SELECT EXISTS (
        SELECT 1 FROM cron.job
        WHERE active
          AND username IN ('anon','authenticated')
          AND (command ILIKE '%cleanup_inventory_reservations%'
               OR command ILIKE '%release_expired_inventory_reservations%')
      )
    $cron_check$ INTO v_unsafe_cron;
    IF v_unsafe_cron THEN
      RAISE EXCEPTION 'ACL candidate prerequisite failed: active reservation cleanup cron uses a browser role.';
    END IF;
  END IF;
END;
$preflight$;

-- Preserve server-side order/reservation operations before removing browser/PUBLIC grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_images TO service_role;

-- orders and inventory reservations are accessed through trusted RPC/Edge paths only.
REVOKE ALL PRIVILEGES ON TABLE public.orders FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.inventory_reservations FROM PUBLIC, anon, authenticated;

-- The authenticated admin continues to use product_images under its existing
-- is_store_admin()-guarded RLS policy; anonymous direct REST access is removed.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_images TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.product_images FROM PUBLIC, anon;

-- Browser clients must not directly invoke SECURITY DEFINER reservation cleanup.
-- The table owner/cron owner retains owner rights; trusted Edge code uses service_role.
REVOKE ALL PRIVILEGES ON FUNCTION public.cleanup_inventory_reservations() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.release_expired_inventory_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_inventory_reservations() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_expired_inventory_reservations() TO service_role;

COMMIT;
