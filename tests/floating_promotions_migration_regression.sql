-- Solo para tests/run_promotion_calendar_local.sh: mutaciones sintéticas dentro de una transacción revertida.
BEGIN;

INSERT INTO public.products(user_id,code,name,category,quantity,sale_price)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','FIX-CAMP-1','Producto sintético de campaña','Accesorios',0,10000);

DO $test$
DECLARE
  v_initial jsonb;
  v_saved jsonb;
  v_after jsonb;
  v_original_updated_at timestamptz;
  v_payload jsonb := '{
    "enabled":true,
    "interval_seconds":20,
    "visible_seconds":3,
    "buttons":[
      {"key":"best_selling","label":"Más vendido","icon":"👑","background_color":"#fff8e7","text_color":"#5d4012","accent_color":"#c6a15b","appearance":"gold","target_category":"Accesorios","sort_order":1},
      {"key":"trending","label":"Tendencia","icon":"🔥","background_color":"#fff8e7","text_color":"#5d4012","accent_color":"#c6a15b","appearance":"gold","target_category":"Accesorios","sort_order":2},
      {"key":"top_product","label":"Producto Top","icon":"⭐","background_color":"#fff8e7","text_color":"#5d4012","accent_color":"#c6a15b","appearance":"gold","target_category":"Accesorios","sort_order":3}
    ]
  }'::jsonb;
  v_invalid jsonb;
BEGIN
  IF NOT has_function_privilege('anon','public.get_public_storefront_floating_promotions()','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.get_public_storefront_floating_promotions()','EXECUTE') THEN
    RAISE EXCEPTION 'El getter público no tiene los permisos de lectura esperados';
  END IF;
  IF has_function_privilege('anon','public.admin_save_storefront_floating_promotions(jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.admin_save_storefront_floating_promotions(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'El setter admin tiene permisos demasiado amplios o incompletos';
  END IF;

  v_initial := public.get_public_storefront_floating_promotions();
  IF v_initial->>'success' <> 'true'
     OR (v_initial->'campaign'->>'enabled') <> 'false'
     OR (v_initial->'campaign'->>'campaign_version') <> '0'
     OR jsonb_array_length(v_initial->'campaign'->'buttons') <> 3 THEN
    RAISE EXCEPTION 'Los valores iniciales deben incluir tres botones y campaña desactivada';
  END IF;

  SELECT updated_at INTO v_original_updated_at
  FROM public.storefront_promotion_settings WHERE id = 1;
  PERFORM set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  v_saved := public.admin_save_storefront_floating_promotions(v_payload);
  IF v_saved->>'success' <> 'true'
     OR (v_saved->'campaign'->>'enabled') <> 'true'
     OR (v_saved->'campaign'->>'campaign_version') <> '1'
     OR jsonb_array_length(v_saved->'campaign'->'buttons') <> 3
     OR (v_saved->'campaign'->'buttons'->0->>'target_category') <> 'Accesorios' THEN
    RAISE EXCEPTION 'El administrador no pudo guardar la campaña con su versión y destinos';
  END IF;
  v_saved := public.admin_save_storefront_floating_promotions(v_payload);
  IF (v_saved->'campaign'->>'campaign_version') <> '2' THEN
    RAISE EXCEPTION 'Guardar una nueva versión debe incrementar el contador de campaña';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  BEGIN
    PERFORM public.admin_save_storefront_floating_promotions(v_payload);
    RAISE EXCEPTION 'Se aceptó un usuario que no es administrador';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  v_invalid := jsonb_set(v_payload,'{buttons,0,target_category}','"Categoría inexistente"'::jsonb);
  BEGIN
    PERFORM public.admin_save_storefront_floating_promotions(v_invalid);
    RAISE EXCEPTION 'Se aceptó un destino que no existe';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  v_invalid := jsonb_set(v_payload,'{buttons,0,background_color}','"url(javascript:alert(1))"'::jsonb);
  BEGIN
    PERFORM public.admin_save_storefront_floating_promotions(v_invalid);
    RAISE EXCEPTION 'Se aceptó un color HEX inválido';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  v_invalid := jsonb_set(v_payload,'{buttons}','[]'::jsonb);
  BEGIN
    PERFORM public.admin_save_storefront_floating_promotions(v_invalid);
    RAISE EXCEPTION 'Se aceptó una campaña sin exactamente tres botones';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  v_after := public.get_public_storefront_floating_promotions();
  IF (v_after->'campaign'->>'campaign_version') <> '2'
     OR (v_after->'campaign'->'buttons'->0->>'target_category') <> 'Accesorios' THEN
    RAISE EXCEPTION 'Un intento inválido alteró la configuración previamente guardada';
  END IF;
  IF (SELECT style FROM public.storefront_promotion_settings WHERE id = 1) IS DISTINCT FROM 'elegant'
     OR (SELECT title FROM public.storefront_promotion_settings WHERE id = 1) IS DISTINCT FROM ''
     OR (SELECT updated_at FROM public.storefront_promotion_settings WHERE id = 1) IS DISTINCT FROM v_original_updated_at THEN
    RAISE EXCEPTION 'Guardar botones flotantes alteró el popup estacional existente';
  END IF;
END;
$test$;

ROLLBACK;
