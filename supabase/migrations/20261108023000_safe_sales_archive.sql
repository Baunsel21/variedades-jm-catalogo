-- Archivado reversible de ventas. No elimina filas existentes.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS archive_batch_id uuid;

CREATE TABLE IF NOT EXISTS public.sales_archive_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archived_by uuid NOT NULL REFERENCES auth.users(id),
  archived_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0)
);

CREATE INDEX IF NOT EXISTS sales_active_user_created_idx
  ON public.sales(user_id, created_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_archive_batch_idx
  ON public.sales(archive_batch_id)
  WHERE archive_batch_id IS NOT NULL;

ALTER TABLE public.sales_archive_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sales_archive_batches FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_archive_sales(p_confirmation text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_batch_id uuid;
  v_count integer := 0;
BEGIN
  IF NOT public.is_store_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'No tienes autorización para archivar ventas.');
  END IF;
  IF p_confirmation IS DISTINCT FROM 'ARCHIVAR VENTAS' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Confirmación incorrecta. No se archivó ningún dato.');
  END IF;

  INSERT INTO public.sales_archive_batches(archived_by)
  VALUES(v_user_id)
  RETURNING id INTO v_batch_id;

  UPDATE public.sales
     SET archived_at = now(), archived_by = v_user_id, archive_batch_id = v_batch_id
   WHERE user_id = v_user_id
     AND archived_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.sales_archive_batches SET row_count = v_count WHERE id = v_batch_id;
  RETURN jsonb_build_object('success', true, 'batch_id', v_batch_id, 'archived_count', v_count,
    'message', CASE WHEN v_count = 0 THEN 'No había ventas activas para archivar.' ELSE 'Ventas archivadas. Puedes restaurar el último archivo desde el panel.' END);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_restore_latest_sales_archive()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_batch_id uuid;
  v_count integer := 0;
BEGIN
  IF NOT public.is_store_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'No tienes autorización para restaurar ventas.');
  END IF;

  SELECT id INTO v_batch_id
    FROM public.sales_archive_batches
   WHERE archived_by = v_user_id AND restored_at IS NULL
   ORDER BY archived_at DESC
   LIMIT 1
   FOR UPDATE;
  IF v_batch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'No hay un archivo de ventas pendiente de restaurar.');
  END IF;

  UPDATE public.sales
     SET archived_at = NULL, archived_by = NULL, archive_batch_id = NULL
   WHERE user_id = v_user_id AND archive_batch_id = v_batch_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.sales_archive_batches SET restored_at = now() WHERE id = v_batch_id;
  RETURN jsonb_build_object('success', true, 'restored_count', v_count,
    'message', 'Último archivo de ventas restaurado.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_archive_sales(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_restore_latest_sales_archive() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_sales(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_latest_sales_archive() TO authenticated;

-- La antigua ruta de reinicio eliminaba productos, ventas y clientes. Se
-- bloquea mientras se migra cada módulo a archivado reversible.
REVOKE ALL ON FUNCTION public.admin_reset_business_data(text) FROM PUBLIC, anon, authenticated;
