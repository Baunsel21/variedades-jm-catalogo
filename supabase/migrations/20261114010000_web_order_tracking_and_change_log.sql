-- Candidate only; do not apply to production before a verified restore and DDL-history reconciliation.
-- This adds empty tracking/audit tables and triggers for future web_orders only; no backfill or order edits.
DO $$
BEGIN
  IF to_regclass('public.web_orders') IS NULL THEN
    RAISE EXCEPTION 'ORDER_TRACKING_PREFLIGHT_WEB_ORDERS_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='web_orders' AND column_name='id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='web_orders' AND column_name='status' AND data_type='text'
  ) THEN
    RAISE EXCEPTION 'ORDER_TRACKING_PREFLIGHT_WEB_ORDERS_CONTRACT_MISMATCH';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('public.is_store_admin()') IS NULL THEN
    RAISE EXCEPTION 'ORDER_TRACKING_PREFLIGHT_AUTH_HELPER_MISSING';
  END IF;
  IF to_regclass('public.web_order_tracking') IS NOT NULL OR to_regclass('public.storefront_change_log') IS NOT NULL THEN
    RAISE EXCEPTION 'ORDER_TRACKING_PREFLIGHT_OBJECT_ALREADY_EXISTS_RECONCILE';
  END IF;
END;
$$;

CREATE TABLE public.web_order_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  web_order_id uuid NOT NULL UNIQUE REFERENCES public.web_orders(id) ON DELETE RESTRICT,
  carrier_name text NOT NULL CHECK (length(btrim(carrier_name)) BETWEEN 1 AND 120),
  tracking_number text NOT NULL CHECK (length(btrim(tracking_number)) BETWEEN 1 AND 120),
  tracking_url text CHECK (
    tracking_url IS NULL OR (
      octet_length(tracking_url) <= 2048
      AND tracking_url !~ '[[:cntrl:][:space:]]'
      AND tracking_url ~* '^https://[^/@[:space:]?#]+(/[^[:space:]]*)?(\?[^[:space:]]*)?(#[^[:space:]]*)?$'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

CREATE TABLE public.storefront_change_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('web_order', 'web_order_tracking')),
  entity_id uuid NOT NULL REFERENCES public.web_orders(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('order_created', 'status_changed', 'tracking_created', 'tracking_updated')),
  before_status text,
  after_status text,
  before_carrier_name text,
  after_carrier_name text,
  before_tracking_number text,
  after_tracking_number text,
  before_tracking_url text,
  after_tracking_url text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX storefront_change_log_order_time_idx
  ON public.storefront_change_log(entity_id, created_at DESC, id DESC);

ALTER TABLE public.web_order_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY web_order_tracking_admin_read ON public.web_order_tracking
  FOR SELECT TO authenticated USING (public.is_store_admin());
CREATE POLICY storefront_change_log_admin_read ON public.storefront_change_log
  FOR SELECT TO authenticated USING (public.is_store_admin());
REVOKE ALL ON TABLE public.web_order_tracking FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.storefront_change_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.web_order_tracking TO authenticated;
GRANT SELECT ON TABLE public.storefront_change_log TO authenticated;

CREATE OR REPLACE FUNCTION public._log_web_order_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.storefront_change_log(entity_type, entity_id, event_type, after_status, actor_id)
    VALUES ('web_order', NEW.id, 'order_created', NEW.status, auth.uid());
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.storefront_change_log(entity_type, entity_id, event_type, before_status, after_status, actor_id)
    VALUES ('web_order', NEW.id, 'status_changed', OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._log_web_order_tracking_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event text;
  v_before_carrier text;
  v_before_number text;
  v_before_url text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := 'tracking_created';
  ELSE
    IF (NEW.carrier_name, NEW.tracking_number, NEW.tracking_url)
       IS NOT DISTINCT FROM (OLD.carrier_name, OLD.tracking_number, OLD.tracking_url) THEN
      RETURN NEW;
    END IF;
    v_event := 'tracking_updated';
    v_before_carrier := OLD.carrier_name;
    v_before_number := OLD.tracking_number;
    v_before_url := OLD.tracking_url;
  END IF;
  INSERT INTO public.storefront_change_log(
    entity_type, entity_id, event_type,
    before_carrier_name, after_carrier_name,
    before_tracking_number, after_tracking_number,
    before_tracking_url, after_tracking_url, actor_id
  ) VALUES (
    'web_order_tracking', NEW.web_order_id, v_event,
    v_before_carrier, NEW.carrier_name,
    v_before_number, NEW.tracking_number,
    v_before_url, NEW.tracking_url,
    coalesce(auth.uid(), NEW.updated_by)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER web_orders_change_log_after_write
AFTER INSERT OR UPDATE ON public.web_orders
FOR EACH ROW EXECUTE FUNCTION public._log_web_order_change();
CREATE TRIGGER web_order_tracking_change_log_after_write
AFTER INSERT OR UPDATE ON public.web_order_tracking
FOR EACH ROW EXECUTE FUNCTION public._log_web_order_tracking_change();
REVOKE ALL ON FUNCTION public._log_web_order_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._log_web_order_tracking_change() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_web_order_tracking(p_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 1000), 5000));
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.is_store_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ORDER_TRACKING_ADMIN_REQUIRED';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.updated_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT web_order_id, carrier_name, tracking_number, tracking_url, created_at, updated_at
    FROM public.web_order_tracking
    ORDER BY updated_at DESC
    LIMIT v_limit
  ) q;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_web_order_change_history(
  p_order_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.is_store_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ORDER_TRACKING_ADMIN_REQUIRED';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ORDER_TRACKING_ORDER_ID_REQUIRED';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC, q.id DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT id, entity_type, event_type, before_status, after_status,
           before_carrier_name, after_carrier_name,
           before_tracking_number, after_tracking_number,
           before_tracking_url, after_tracking_url, actor_id, created_at
    FROM public.storefront_change_log
    WHERE entity_id = p_order_id
    ORDER BY created_at DESC, id DESC
    LIMIT v_limit
  ) q;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_web_order_tracking(
  p_order_id uuid,
  p_carrier_name text,
  p_tracking_number text,
  p_tracking_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_carrier text := btrim(coalesce(p_carrier_name, ''));
  v_number text := btrim(coalesce(p_tracking_number, ''));
  v_url text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  v_tracking_id uuid;
  v_changed boolean := false;
BEGIN
  IF v_user_id IS NULL OR public.is_store_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ORDER_TRACKING_ADMIN_REQUIRED';
  END IF;
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ORDER_ID_REQUIRED');
  END IF;
  IF v_carrier = '' OR octet_length(v_carrier) > 120 OR v_carrier ~ '[[:cntrl:]]'
     OR v_number = '' OR octet_length(v_number) > 120 OR v_number ~ '[[:cntrl:]]' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TRACKING_FIELDS_INVALID');
  END IF;
  IF v_url IS NOT NULL AND (octet_length(v_url) > 2048 OR v_url ~ '[[:cntrl:][:space:]]'
     OR v_url !~* '^https://[^/@[:space:]?#]+(/[^[:space:]]*)?(\?[^[:space:]]*)?(#[^[:space:]]*)?$') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TRACKING_URL_INVALID');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.web_orders WHERE id = p_order_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WEB_ORDER_NOT_FOUND');
  END IF;

  INSERT INTO public.web_order_tracking(web_order_id, carrier_name, tracking_number, tracking_url, created_by, updated_by)
  VALUES (p_order_id, v_carrier, v_number, v_url, v_user_id, v_user_id)
  ON CONFLICT (web_order_id) DO UPDATE
    SET carrier_name = EXCLUDED.carrier_name,
        tracking_number = EXCLUDED.tracking_number,
        tracking_url = EXCLUDED.tracking_url,
        updated_at = now(),
        updated_by = v_user_id
    WHERE (web_order_tracking.carrier_name, web_order_tracking.tracking_number, web_order_tracking.tracking_url)
          IS DISTINCT FROM (EXCLUDED.carrier_name, EXCLUDED.tracking_number, EXCLUDED.tracking_url)
  RETURNING id INTO v_tracking_id;
  v_changed := FOUND;
  IF NOT v_changed THEN
    SELECT id INTO v_tracking_id FROM public.web_order_tracking WHERE web_order_id = p_order_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'changed', v_changed, 'tracking_id', v_tracking_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_web_order_tracking(integer) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_list_web_order_change_history(uuid, integer) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_set_web_order_tracking(uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_web_order_tracking(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_web_order_change_history(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_web_order_tracking(uuid, text, text, text) TO authenticated;
COMMENT ON TABLE public.web_order_tracking IS 'One current carrier/tracking record per web_order. Writes only through admin RPC.';
COMMENT ON TABLE public.storefront_change_log IS 'Append-only admin-visible web order status and carrier tracking changes; no customer PII snapshots or legacy backfill.';
NOTIFY pgrst, 'reload schema';
