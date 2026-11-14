-- Archivado reversible y auditable de historiales financieros.
-- No elimina filas, no usa CASCADE y no toca pedidos, pagos, inventario ni reservas.
BEGIN;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS archive_batch_id uuid;

CREATE TABLE IF NOT EXISTS public.expenses_archive_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archived_by uuid NOT NULL REFERENCES auth.users(id),
  archived_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  from_date date,
  to_date date,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0)
);

CREATE TABLE IF NOT EXISTS public.admin_history_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL CHECK (action IN ('preview','archive','restore')),
  module text NOT NULL CHECK (module IN ('sales','expenses')),
  from_date date,
  to_date date,
  affected_count integer NOT NULL DEFAULT 0 CHECK (affected_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS expenses_active_user_date_idx
  ON public.expenses(user_id, expense_date DESC, id DESC)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS expenses_archive_batch_idx
  ON public.expenses(archive_batch_id)
  WHERE archive_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS admin_history_actions_user_created_idx
  ON public.admin_history_actions(user_id, created_at DESC, id DESC);

ALTER TABLE public.expenses_archive_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_history_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.expenses_archive_batches, public.admin_history_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_history_actions TO authenticated;
DROP POLICY IF EXISTS admin_history_actions_admin_read ON public.admin_history_actions;
CREATE POLICY admin_history_actions_admin_read ON public.admin_history_actions FOR SELECT TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid());

CREATE OR REPLACE FUNCTION public._sirevya_history_range_valid(p_from date, p_to date)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT p_from IS NULL OR p_to IS NULL OR p_from <= p_to
$$;

CREATE OR REPLACE FUNCTION public.admin_preview_history_archive(
  p_module text,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user_id uuid := auth.uid(); v_count integer := 0;
BEGIN
  IF NOT public.is_store_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_module NOT IN ('sales','expenses') OR NOT public._sirevya_history_range_valid(p_from,p_to) THEN
    RAISE EXCEPTION 'INVALID_HISTORY_RANGE';
  END IF;
  IF p_module = 'sales' THEN
    SELECT count(*) INTO v_count FROM public.sales
     WHERE user_id=v_user_id AND archived_at IS NULL
       AND (p_from IS NULL OR sale_date >= p_from) AND (p_to IS NULL OR sale_date <= p_to);
  ELSE
    SELECT count(*) INTO v_count FROM public.expenses
     WHERE user_id=v_user_id AND archived_at IS NULL
       AND (p_from IS NULL OR expense_date >= p_from) AND (p_to IS NULL OR expense_date <= p_to);
  END IF;
  INSERT INTO public.admin_history_actions(user_id,action,module,from_date,to_date,affected_count,metadata)
  VALUES(v_user_id,'preview',p_module,p_from,p_to,v_count,jsonb_build_object('safe_default','archive'));
  RETURN jsonb_build_object('success',true,'module',p_module,'from_date',p_from,'to_date',p_to,'affected_count',v_count,'default_action','archive');
END; $$;

CREATE OR REPLACE FUNCTION public.admin_archive_sales(
  p_from date, p_to date, p_confirmation text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user_id uuid := auth.uid(); v_batch_id uuid; v_count integer := 0;
BEGIN
  IF NOT public.is_store_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_confirmation IS DISTINCT FROM 'ARCHIVAR VENTAS' OR NOT public._sirevya_history_range_valid(p_from,p_to) THEN
    RETURN jsonb_build_object('success',false,'message','Confirmación o rango inválido. No se archivó ningún dato.');
  END IF;
  INSERT INTO public.sales_archive_batches(archived_by) VALUES(v_user_id) RETURNING id INTO v_batch_id;
  UPDATE public.sales SET archived_at=now(),archived_by=v_user_id,archive_batch_id=v_batch_id
   WHERE user_id=v_user_id AND archived_at IS NULL
     AND (p_from IS NULL OR sale_date >= p_from) AND (p_to IS NULL OR sale_date <= p_to);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.admin_history_actions(user_id,action,module,from_date,to_date,affected_count,metadata)
  VALUES(v_user_id,'archive','sales',p_from,p_to,v_count,jsonb_build_object('batch_id',v_batch_id));
  UPDATE public.sales_archive_batches SET row_count=v_count WHERE id=v_batch_id;
  RETURN jsonb_build_object('success',true,'archived_count',v_count,'batch_id',v_batch_id);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_archive_expenses(
  p_from date, p_to date, p_confirmation text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user_id uuid := auth.uid(); v_batch_id uuid; v_count integer := 0;
BEGIN
  IF NOT public.is_store_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_confirmation IS DISTINCT FROM 'ARCHIVAR GASTOS' OR NOT public._sirevya_history_range_valid(p_from,p_to) THEN
    RETURN jsonb_build_object('success',false,'message','Confirmación o rango inválido. No se archivó ningún dato.');
  END IF;
  INSERT INTO public.expenses_archive_batches(archived_by,from_date,to_date) VALUES(v_user_id,p_from,p_to) RETURNING id INTO v_batch_id;
  UPDATE public.expenses SET archived_at=now(),archived_by=v_user_id,archive_batch_id=v_batch_id
   WHERE user_id=v_user_id AND archived_at IS NULL
     AND (p_from IS NULL OR expense_date >= p_from) AND (p_to IS NULL OR expense_date <= p_to);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.admin_history_actions(user_id,action,module,from_date,to_date,affected_count,metadata)
  VALUES(v_user_id,'archive','expenses',p_from,p_to,v_count,jsonb_build_object('batch_id',v_batch_id));
  UPDATE public.expenses_archive_batches SET row_count=v_count WHERE id=v_batch_id;
  RETURN jsonb_build_object('success',true,'archived_count',v_count,'batch_id',v_batch_id);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_restore_latest_expenses_archive()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user_id uuid := auth.uid(); v_batch_id uuid; v_count integer := 0;
BEGIN
  IF NOT public.is_store_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  SELECT id INTO v_batch_id FROM public.expenses_archive_batches
   WHERE archived_by=v_user_id AND restored_at IS NULL ORDER BY archived_at DESC LIMIT 1 FOR UPDATE;
  IF v_batch_id IS NULL THEN RETURN jsonb_build_object('success',false,'message','No hay un archivo de gastos pendiente de restaurar.'); END IF;
  UPDATE public.expenses SET archived_at=NULL,archived_by=NULL,archive_batch_id=NULL
   WHERE user_id=v_user_id AND archive_batch_id=v_batch_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.expenses_archive_batches SET restored_at=now() WHERE id=v_batch_id;
  INSERT INTO public.admin_history_actions(user_id,action,module,affected_count,metadata)
  VALUES(v_user_id,'restore','expenses',v_count,jsonb_build_object('batch_id',v_batch_id));
  RETURN jsonb_build_object('success',true,'restored_count',v_count);
END; $$;

REVOKE ALL ON FUNCTION public._sirevya_history_range_valid(date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_preview_history_archive(text,date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_archive_sales(date,date,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_archive_expenses(date,date,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_restore_latest_expenses_archive() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_preview_history_archive(text,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_sales(date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_expenses(date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_latest_expenses_archive() TO authenticated;

COMMIT;
