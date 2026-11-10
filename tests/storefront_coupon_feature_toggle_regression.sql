BEGIN;

DO $test_coupon_feature_toggle$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT has_function_privilege('anon','public.get_public_storefront_coupon_settings()','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.get_public_storefront_coupon_settings()','EXECUTE')
     OR has_function_privilege('anon','public.admin_set_storefront_coupons_enabled(boolean)','EXECUTE')
     OR has_function_privilege('service_role','public.admin_set_storefront_coupons_enabled(boolean)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.admin_set_storefront_coupons_enabled(boolean)','EXECUTE')
     OR has_function_privilege('anon','public._storefront_coupons_are_enabled()','EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: permisos públicos/admin/helper del toggle no cumplen el contrato mínimo';
  END IF;

  v_result:=public.get_public_storefront_coupon_settings();
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR v_result->>'coupons_enabled' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'TEST FAILED: el valor inicial no conserva cupones activos: %',v_result;
  END IF;

  PERFORM set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  v_result:=public.admin_set_storefront_coupons_enabled(false);
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR v_result->>'code' IS DISTINCT FROM 'ADMIN_AUTH_INVALID' THEN
    RAISE EXCEPTION 'TEST FAILED: un usuario no-admin cambió el ajuste: %',v_result;
  END IF;

  PERFORM set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','role','authenticated')::text,true);
  v_result:=public.admin_set_storefront_coupons_enabled(false);
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR v_result->>'coupons_enabled' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'TEST FAILED: el admin no pudo desactivar nuevas aplicaciones: %',v_result;
  END IF;
  v_result:=public.get_public_storefront_coupon_settings();
  IF v_result->>'coupons_enabled' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'TEST FAILED: el cambio no persistió en la lectura pública: %',v_result;
  END IF;
  v_result:=public.get_storefront_cart_quote_with_coupon('[]'::jsonb,'Cali','TEST-TOGGLE','','');
  IF v_result->>'success' IS DISTINCT FROM 'false'
     OR v_result->>'code' IS DISTINCT FROM 'COUPONS_DISABLED' THEN
    RAISE EXCEPTION 'TEST FAILED: la cotización pública no bloqueó el cupón desactivado: %',v_result;
  END IF;

  v_result:=public.admin_set_storefront_coupons_enabled(true);
  IF v_result->>'success' IS DISTINCT FROM 'true'
     OR v_result->>'coupons_enabled' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'TEST FAILED: el admin no pudo volver a habilitar nuevas aplicaciones: %',v_result;
  END IF;
  v_result:=public.get_public_storefront_coupon_settings();
  IF v_result->>'coupons_enabled' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'TEST FAILED: el estado activado no persistió hasta reload: %',v_result;
  END IF;
END;
$test_coupon_feature_toggle$;

ROLLBACK;
