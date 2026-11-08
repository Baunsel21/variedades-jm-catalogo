-- Mensaje informativo editable para el checkout COD. No cambia elegibilidad, quote,
-- estados de pedido, métodos Wompi ni confirma pagos.
DO $preflight$
BEGIN
  IF to_regprocedure('public.is_store_admin()') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: public.is_store_admin() is required';
  END IF;
  IF to_regclass('public.storefront_cod_notice_settings') IS NOT NULL
     OR to_regprocedure('public.get_public_storefront_cod_notice()') IS NOT NULL
     OR to_regprocedure('public.admin_get_storefront_cod_notice()') IS NOT NULL
     OR to_regprocedure('public.admin_save_storefront_cod_notice(boolean,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: COD notice object name already exists; inspect before migration';
  END IF;
END;
$preflight$;

CREATE TABLE public.storefront_cod_notice_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  enabled boolean NOT NULL DEFAULT false,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (char_length(title)<=120),
  CHECK (char_length(body)<=3000),
  -- Same whitespace set as ECMAScript String.trim(), independent of server locale.
  CHECK (NOT enabled OR (
    char_length(btrim(title,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'))>0
    AND char_length(btrim(body,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'))>0
  ))
);
ALTER TABLE public.storefront_cod_notice_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storefront_cod_notice_settings FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.storefront_cod_notice_settings(id,enabled,title,body)
VALUES(1,false,'','');
COMMENT ON TABLE public.storefront_cod_notice_settings IS
  'Public checkout COD informational copy; accessed only by explicit public/admin RPCs.';

CREATE OR REPLACE FUNCTION public.get_public_storefront_cod_notice()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_enabled boolean;
  v_title text;
  v_body text;
BEGIN
  SELECT s.enabled,s.title,s.body INTO v_enabled,v_title,v_body
  FROM public.storefront_cod_notice_settings AS s WHERE s.id=1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',true,'enabled',false,'title','','body','');
  END IF;
  RETURN jsonb_build_object(
    'success',true,
    'enabled',v_enabled,
    'title',CASE WHEN v_enabled THEN v_title ELSE '' END,
    'body',CASE WHEN v_enabled THEN v_body ELSE '' END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_public_storefront_cod_notice() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_cod_notice() TO anon,authenticated;
COMMENT ON FUNCTION public.get_public_storefront_cod_notice() IS
  'Returns only the enabled plain-text COD checkout notice; it cannot change COD or payment configuration.';

CREATE OR REPLACE FUNCTION public.admin_get_storefront_cod_notice()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_enabled boolean;
  v_title text;
  v_body text;
  v_updated_at timestamptz;
BEGIN
  IF coalesce(public.is_store_admin(),false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'code','COD_NOTICE_UNAUTHORIZED','message','No tienes autorización para administrar este mensaje.');
  END IF;
  SELECT s.enabled,s.title,s.body,s.updated_at INTO v_enabled,v_title,v_body,v_updated_at
  FROM public.storefront_cod_notice_settings AS s WHERE s.id=1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',true,'enabled',false,'title','','body','','updated_at',NULL);
  END IF;
  RETURN jsonb_build_object('success',true,'enabled',v_enabled,'title',v_title,'body',v_body,'updated_at',v_updated_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_get_storefront_cod_notice() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_storefront_cod_notice() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_storefront_cod_notice(
  p_enabled boolean,
  p_title text,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_title text;
  v_body text;
  v_updated_at timestamptz;
  v_trim_chars CONSTANT text:=U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
BEGIN
  IF coalesce(public.is_store_admin(),false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success',false,'code','COD_NOTICE_UNAUTHORIZED','message','No tienes autorización para modificar este mensaje.');
  END IF;
  IF p_enabled IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','COD_NOTICE_INVALID','message','Indica si la información está activada.');
  END IF;

  v_title:=btrim(coalesce(p_title,''),v_trim_chars);
  v_body:=replace(replace(coalesce(p_body,''),chr(13)||chr(10),chr(10)),chr(13),chr(10));
  IF char_length(v_title)>120 OR char_length(v_body)>3000 THEN
    RETURN jsonb_build_object('success',false,'code','COD_NOTICE_TOO_LONG','message','El título permite hasta 120 caracteres y el contenido hasta 3.000.');
  END IF;
  IF coalesce(p_title,'') ~ U&'[\0001-\001f\007f-\009f]' OR regexp_replace(v_body,E'[\n\t]','','g') ~ U&'[\0001-\001f\007f-\009f]' THEN
    RETURN jsonb_build_object('success',false,'code','COD_NOTICE_CONTROL_CHARACTER','message','El texto contiene caracteres de control no permitidos.');
  END IF;
  IF p_enabled AND (v_title='' OR btrim(v_body,v_trim_chars)='') THEN
    RETURN jsonb_build_object('success',false,'code','COD_NOTICE_TEXT_REQUIRED','message','Escribe un título y contenido antes de activar el mensaje.');
  END IF;

  INSERT INTO public.storefront_cod_notice_settings(id,enabled,title,body,updated_at)
  VALUES(1,p_enabled,v_title,v_body,statement_timestamp())
  ON CONFLICT(id) DO UPDATE SET enabled=EXCLUDED.enabled,title=EXCLUDED.title,body=EXCLUDED.body,updated_at=EXCLUDED.updated_at
  RETURNING updated_at INTO v_updated_at;
  RETURN jsonb_build_object('success',true,'enabled',p_enabled,'title',v_title,'body',v_body,'updated_at',v_updated_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_save_storefront_cod_notice(boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_storefront_cod_notice(boolean,text,text) TO authenticated;
