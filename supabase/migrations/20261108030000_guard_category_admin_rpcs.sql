-- Las categorías son globales para el catálogo; solo el administrador de la tienda
-- puede modificarlas. No se cambian categorías ni productos existentes.
CREATE OR REPLACE FUNCTION public.admin_add_category(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_order integer;
BEGIN
  IF NOT public.is_store_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'No tienes autorización para modificar categorías.');
  END IF;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Debes iniciar sesión nuevamente.');
  END IF;
  IF v_name = '' OR length(v_name) > 40 THEN
    RETURN jsonb_build_object('success', false, 'message', 'El nombre de la categoría debe tener entre 1 y 40 caracteres.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('jm_categories_order_lock'));
  IF EXISTS (SELECT 1 FROM public.categories c WHERE lower(trim(c.name)) = lower(v_name)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ya existe una categoría con ese nombre.');
  END IF;
  SELECT coalesce(max(c.sort_order), 0) + 1 INTO v_order FROM public.categories c;
  INSERT INTO public.categories(name, sort_order) VALUES (v_name, v_order);
  RETURN jsonb_build_object('success', true, 'message', 'Categoría creada.', 'name', v_name, 'sort_order', v_order);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_category(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_category_id public.categories.id%TYPE;
BEGIN
  IF NOT public.is_store_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'No tienes autorización para modificar categorías.');
  END IF;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Debes iniciar sesión nuevamente.');
  END IF;
  IF coalesce(trim(p_name), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Falta el nombre de la categoría.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('jm_categories_order_lock'));
  SELECT c.id INTO v_category_id FROM public.categories AS c WHERE c.name = p_name FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'No se encontró la categoría.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.products AS p
     WHERE lower(trim(coalesce(p.category, ''))) = lower(trim(p_name))
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'No puedes eliminar esta categoría porque todavía tiene productos. Primero cambia esos productos de categoría.');
  END IF;
  DELETE FROM public.categories WHERE id = v_category_id;
  RETURN jsonb_build_object('success', true, 'message', 'Categoría eliminada.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_rename_category(p_old_name text, p_new_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_category_id public.categories.id%TYPE;
  v_updated integer := 0;
BEGIN
  IF NOT public.is_store_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'No tienes autorización para modificar categorías.');
  END IF;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Debes iniciar sesión nuevamente.');
  END IF;
  IF coalesce(trim(p_old_name), '') = '' OR coalesce(trim(p_new_name), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Falta el nombre actual o el nuevo nombre.');
  END IF;
  IF length(trim(p_new_name)) > 40 THEN
    RETURN jsonb_build_object('success', false, 'message', 'El nombre nuevo no puede superar 40 caracteres.');
  END IF;
  IF lower(trim(p_old_name)) = lower(trim(p_new_name)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'El nombre nuevo es igual al actual.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('jm_categories_order_lock'));
  SELECT c.id INTO v_category_id FROM public.categories AS c WHERE c.name = p_old_name FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'No se encontró la categoría en Supabase.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.categories AS c
     WHERE lower(trim(c.name)) = lower(trim(p_new_name)) AND c.id <> v_category_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ya existe una categoría con ese nombre.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.products AS p
     WHERE p.category = p_old_name AND p.user_id IS DISTINCT FROM v_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Esta categoría también se usa en productos de otra cuenta. No se cambió nada para proteger ese catálogo.');
  END IF;
  UPDATE public.categories SET name = trim(p_new_name) WHERE id = v_category_id;
  UPDATE public.products SET category = trim(p_new_name)
   WHERE category = p_old_name AND user_id = v_user_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'message', 'Categoría renombrada y productos sincronizados.', 'products_updated', v_updated);
END;
$function$;
