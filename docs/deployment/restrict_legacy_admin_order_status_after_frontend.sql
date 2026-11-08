-- MANUAL POST-FRONTEND ONLY. NOT AN AUTOMATIC MIGRATION.
-- 1. Apply/test 20261108110000 in isolated staging.
-- 2. Publish/verify admin.html clients call secure_v2 with p_expected_status.
-- 3. Confirm no integration still depends on either 2-argument legacy RPC.
-- 4. Only then apply this transaction in an authorized rollout.
-- The legacy signatures/functions remain for trusted internal compatibility.
-- Their row locks/state matrix do not supply optimistic concurrency: a legacy
-- caller cannot express the state that it previously observed.
BEGIN;
DO $preflight$
BEGIN
  IF to_regprocedure('public.admin_update_web_order_status_secure_v2(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'v2 status RPC is required before revoking legacy client access';
  END IF;
  IF has_function_privilege('authenticated','public.admin_update_web_order_status_secure_v2(uuid,text,text)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Authenticated v2 execution must already be available';
  END IF;
END;
$preflight$;
REVOKE ALL ON FUNCTION public.admin_update_web_order_status_secure(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_update_web_order_status(uuid,text) FROM PUBLIC,anon,authenticated;
DO $verify$
BEGIN
  IF has_function_privilege('authenticated','public.admin_update_web_order_status_secure(uuid,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.admin_update_web_order_status(uuid,text)','EXECUTE')
     OR has_function_privilege('anon','public.admin_update_web_order_status_secure(uuid,text)','EXECUTE')
     OR has_function_privilege('anon','public.admin_update_web_order_status(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Legacy status RPC client grants remain; rollback required';
  END IF;
  IF has_function_privilege('authenticated','public.admin_update_web_order_status_secure_v2(uuid,text,text)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v2 execution must remain available';
  END IF;
END;
$verify$;
COMMIT;
