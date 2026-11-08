-- Enforce the order-state contract server-side while preserving the legacy
-- inventory/reservation side effects in admin_update_web_order_status().
-- Direct table writes are removed only for client roles; reads remain admin-RLS guarded.
-- Legacy client compatibility is temporary: the 2-argument wrapper cannot reject
-- a stale expected state it does not receive. After verifying all clients use v2,
-- apply docs/deployment/restrict_legacy_admin_order_status_after_frontend.sql.

DO $preflight$
DECLARE
  v_id_type oid;
  v_status_type oid;
  v_wrapper_result text;
  v_legacy_result text;
BEGIN
  IF to_regclass('public.web_orders') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.web_orders is required';
  END IF;
  IF to_regprocedure('public.is_store_admin()') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.is_store_admin() is required';
  END IF;
  IF to_regprocedure('public.admin_update_web_order_status(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: legacy admin_update_web_order_status(uuid,text) is required';
  END IF;
  IF to_regprocedure('public.admin_update_web_order_status_secure(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: secure admin_update_web_order_status_secure(uuid,text) is required';
  END IF;

  SELECT a.atttypid INTO v_id_type
  FROM pg_attribute AS a
  WHERE a.attrelid='public.web_orders'::regclass AND a.attname='id'
    AND a.attnum>0 AND NOT a.attisdropped
  LIMIT 1;
  SELECT a.atttypid INTO v_status_type
  FROM pg_attribute AS a
  WHERE a.attrelid='public.web_orders'::regclass AND a.attname='status'
    AND a.attnum>0 AND NOT a.attisdropped
  LIMIT 1;
  IF v_id_type IS DISTINCT FROM 'uuid'::regtype::oid OR v_status_type IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: web_orders.id uuid and a status column are required';
  END IF;

  SELECT pg_get_function_result(to_regprocedure('public.admin_update_web_order_status_secure(uuid,text)'))
    INTO v_wrapper_result;
  SELECT pg_get_function_result(to_regprocedure('public.admin_update_web_order_status(uuid,text)'))
    INTO v_legacy_result;
  IF v_wrapper_result IS DISTINCT FROM 'jsonb' OR v_legacy_result IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'Preflight failed: secure and legacy order-status RPCs must return jsonb';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public._admin_update_web_order_status_guard(
  p_order_id uuid,
  p_expected_status text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_status text;
  v_next_status text;
BEGIN
  IF NOT public.is_store_admin() THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_STATUS_UNAUTHORIZED','message','No tienes autorización para actualizar pedidos.');
  END IF;

  IF p_order_id IS NULL OR NULLIF(btrim(p_status),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_STATUS_INPUT_INVALID','message','El pedido y el nuevo estado son obligatorios.');
  END IF;

  v_next_status:=lower(btrim(p_status));
  IF v_next_status NOT IN ('pendiente','confirmado','enviado','entregado','rechazado','devuelto') THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_STATUS_INVALID','message','El estado solicitado no es válido.');
  END IF;

  SELECT lower(btrim(w.status::text)) INTO v_current_status
  FROM public.web_orders AS w
  WHERE w.id=p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_NOT_FOUND','message','No se encontró el pedido. Actualiza la lista e inténtalo de nuevo.');
  END IF;

  IF v_current_status IS NULL OR v_current_status NOT IN ('pendiente','confirmado','enviado','entregado','rechazado','devuelto') THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_STATUS_STATE_INVALID','message','El estado guardado del pedido no es compatible. No se hizo ningún cambio.');
  END IF;

  IF p_expected_status IS NOT NULL
     AND lower(btrim(p_expected_status)) IS DISTINCT FROM v_current_status THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_STATUS_CONFLICT','message','El pedido cambió en otro dispositivo. Actualiza la lista antes de volver a intentarlo.');
  END IF;

  IF v_next_status=v_current_status THEN
    RETURN jsonb_build_object('success',true,'unchanged',true,'status',v_current_status,'message','El pedido ya tenía ese estado.');
  END IF;

  IF NOT (
       (v_current_status='pendiente' AND v_next_status IN ('confirmado','rechazado'))
    OR (v_current_status='confirmado' AND v_next_status IN ('enviado','rechazado','devuelto'))
    OR (v_current_status='enviado' AND v_next_status IN ('entregado','devuelto'))
    OR (v_current_status='entregado' AND v_next_status='devuelto')
  ) THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_STATUS_TRANSITION_INVALID','message','No se permite esa transición de estado. Actualiza la lista y verifica el pedido.');
  END IF;

  -- Keep the established server-side inventory/reservation behavior.
  RETURN public.admin_update_web_order_status(p_order_id,v_next_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_web_order_status_secure(
  p_order_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Backward-compatible entry point; transitions are validated and row-locked,
  -- but optimistic expected-state checking is v2-only until the post-frontend cutover.
  RETURN public._admin_update_web_order_status_guard(p_order_id,NULL,p_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_web_order_status_secure_v2(
  p_order_id uuid,
  p_expected_status text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NULLIF(btrim(p_expected_status),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','ORDER_STATUS_EXPECTED_REQUIRED','message','Actualiza la lista y vuelve a seleccionar el estado.');
  END IF;
  RETURN public._admin_update_web_order_status_guard(p_order_id,p_expected_status,p_status);
END;
$function$;

REVOKE ALL ON FUNCTION public._admin_update_web_order_status_guard(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_update_web_order_status_secure(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_update_web_order_status_secure_v2(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_update_web_order_status_secure(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_web_order_status_secure_v2(uuid,text,text) TO authenticated;

-- RLS read access remains intact. Client roles can no longer bypass the guarded
-- RPC with UPDATE, nor mutate/delete/truncate COD orders directly.
DO $drop_update_policies$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname='public' AND tablename='web_orders' AND cmd='UPDATE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.web_orders',v_policy.policyname);
  END LOOP;
END;
$drop_update_policies$;

REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON TABLE public.web_orders FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.web_orders TO authenticated;
