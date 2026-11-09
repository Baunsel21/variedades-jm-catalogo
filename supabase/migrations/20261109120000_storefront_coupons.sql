-- Fase 4: cupones de storefront.
-- No cambia firmas legacy. La quote/wrapper nuevos fallan cerrado si los contratos
-- instalados que necesitan no existen o devuelven un tipo incompatible.

DO $preflight_storefront_coupons$
DECLARE
  v_oid oid;
  v_result text;
  v_definition text;
  v_finalizer_oid oid;
  v_reserver_oid oid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    RAISE EXCEPTION 'Cupones requieren los roles Supabase anon, authenticated y service_role.';
  END IF;
  IF has_schema_privilege('anon','public','CREATE')
     OR has_schema_privilege('authenticated','public','CREATE')
     OR has_schema_privilege('service_role','public','CREATE') THEN
    RAISE EXCEPTION 'No se crea el esquema public mientras roles no confiables puedan crear objetos; use un search_path y ACL seguros.';
  END IF;
  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren extensions.digest(bytea,text); no se instalará pgcrypto automáticamente.';
  END IF;
  IF to_regclass('public.orders') IS NULL OR to_regclass('public.web_orders') IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren previamente las tablas public.orders y public.web_orders.';
  END IF;
  IF to_regclass('public.storefront_coupons') IS NOT NULL
     OR to_regclass('public.storefront_coupon_redemptions') IS NOT NULL
     OR to_regclass('public.storefront_wompi_checkout_locks') IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe una relación candidata de cupones; inspeccione su contrato en vez de aceptar un CREATE IF NOT EXISTS.';
  END IF;

  v_oid := to_regprocedure('public.get_storefront_cart_quote(jsonb,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren public.get_storefront_cart_quote(jsonb,text).';
  END IF;
  SELECT pg_get_function_result(p.oid),pg_get_functiondef(p.oid)
    INTO v_result,v_definition FROM pg_proc AS p WHERE p.oid=v_oid;
  IF v_result IS DISTINCT FROM 'jsonb'
     OR position('destination_status' IN v_definition)=0
     OR position('shipping_rule_cost' IN v_definition)=0
     OR position('shipping_rule_threshold' IN v_definition)=0 THEN
    RAISE EXCEPTION 'Contrato incompatible de get_storefront_cart_quote: se requiere jsonb city-aware con metadata de regla explícita.';
  END IF;

  v_oid := to_regprocedure('public.create_contra_delivery_order(text,text,text,text,text,text,text,text,jsonb)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren public.create_contra_delivery_order(text,text,text,text,text,text,text,text,jsonb).';
  END IF;
  SELECT pg_get_function_result(p.oid) INTO v_result FROM pg_proc AS p WHERE p.oid=v_oid;
  IF v_result IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'Contrato incompatible de create_contra_delivery_order: se esperaba jsonb y se encontró %.',v_result;
  END IF;

  v_oid := to_regprocedure('public.create_contra_delivery_order_with_quote(text,text,text,text,text,text,text,text,jsonb,numeric,numeric)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren preservar public.create_contra_delivery_order_with_quote(...) ya instalado.';
  END IF;
  SELECT pg_get_function_result(p.oid) INTO v_result FROM pg_proc AS p WHERE p.oid=v_oid;
  IF v_result IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'Contrato incompatible de create_contra_delivery_order_with_quote: se esperaba jsonb y se encontró %.',v_result;
  END IF;

  v_oid := to_regprocedure('public.get_public_storefront_shipping_settings()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren public.get_public_storefront_shipping_settings().';
  END IF;
  SELECT pg_get_function_result(p.oid) INTO v_result FROM pg_proc AS p WHERE p.oid=v_oid;
  IF v_result IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'Contrato incompatible de get_public_storefront_shipping_settings: se esperaba jsonb y se encontró %.',v_result;
  END IF;
  IF to_regclass('public.storefront_shipping_rules') IS NULL
     OR to_regclass('public.storefront_shipping_rule_destinations') IS NULL
     OR to_regprocedure('public.normalize_storefront_delivery_city(text)') IS NULL
     OR position('destination_rules' IN pg_get_functiondef(v_oid))=0 THEN
    RAISE EXCEPTION 'Cupones requieren primero la migración Fase 2 de tarifas por ciudad/zona.';
  END IF;

  IF to_regprocedure('public.sirevya_normalize_combo_category(text)') IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren el normalizador legacy public.sirevya_normalize_combo_category(text).';
  END IF;
  IF to_regclass('public.products') IS NULL OR to_regclass('public.storefront_product_combos') IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren las tablas de productos y combos para bloquear precios/beneficios durante COD.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_index AS i
      JOIN pg_class AS t ON t.oid=i.indrelid
      JOIN pg_namespace AS n ON n.oid=t.relnamespace
      JOIN pg_attribute AS a ON a.attrelid=t.oid AND a.attname='reference' AND a.attnum>0
     WHERE n.nspname='public' AND t.relname='orders'
       AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
       AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum
  ) THEN
    RAISE EXCEPTION 'Cupones requieren un índice único válido sobre public.orders(reference) para evitar pedidos Wompi duplicados.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute AS a
     WHERE a.attrelid=to_regclass('public.orders') AND a.attname='created_at'
       AND a.attnum>0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Cupones requieren public.orders.created_at para respetar el vencimiento de sesiones Wompi sin transacción vinculada.';
  END IF;

  v_oid := to_regprocedure('public.confirm_inventory_reservation(text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren public.confirm_inventory_reservation(text).';
  END IF;
  SELECT pg_get_function_result(p.oid),pg_get_functiondef(p.oid)
    INTO v_result,v_definition FROM pg_proc AS p WHERE p.oid=v_oid;
  IF v_result IS DISTINCT FROM 'jsonb'
     OR position('finalize_inventory_reservation' IN v_definition)=0 THEN
    RAISE EXCEPTION 'El confirmador de inventario debe delegar al finalizador transaccional jsonb.';
  END IF;
  IF has_function_privilege('anon',v_oid,'EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated',v_oid,'EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role',v_oid,'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'confirm_inventory_reservation debe ser privado para anon/authenticated y ejecutable por service_role.';
  END IF;

  v_finalizer_oid := to_regprocedure('public.finalize_inventory_reservation(text)');
  IF v_finalizer_oid IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren public.finalize_inventory_reservation(text).';
  END IF;
  SELECT pg_get_function_result(p.oid),pg_get_functiondef(p.oid)
    INTO v_result,v_definition FROM pg_proc AS p WHERE p.oid=v_finalizer_oid;
  IF v_result IS DISTINCT FROM 'jsonb'
     OR position('pg_advisory_xact_lock' IN v_definition)=0
     OR position('FOR UPDATE' IN v_definition)=0
     OR position('CONVERTED' IN v_definition)=0
     OR position('already_finalized' IN v_definition)=0 THEN
    RAISE EXCEPTION 'El finalizador de inventario no cumple el contrato idempotente por referencia requerido para webhooks duplicados.';
  END IF;
  IF has_function_privilege('anon',v_finalizer_oid,'EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated',v_finalizer_oid,'EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role',v_finalizer_oid,'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'finalize_inventory_reservation debe ser privado para anon/authenticated y ejecutable por service_role.';
  END IF;

  v_reserver_oid := to_regprocedure('public.reserve_order_inventory(text,jsonb,integer)');
  IF v_reserver_oid IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren public.reserve_order_inventory(text,jsonb,integer).';
  END IF;
  SELECT pg_get_function_result(p.oid) INTO v_result FROM pg_proc AS p WHERE p.oid=v_reserver_oid;
  IF v_result IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'Contrato incompatible de reserve_order_inventory: se esperaba jsonb.';
  END IF;
  IF has_function_privilege('anon',v_reserver_oid,'EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated',v_reserver_oid,'EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role',v_reserver_oid,'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'reserve_order_inventory debe ser privado para anon/authenticated y ejecutable por service_role.';
  END IF;
  v_oid := to_regprocedure('public.release_inventory_reservation(text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Cupones requieren public.release_inventory_reservation(text).';
  END IF;
  SELECT pg_get_function_result(p.oid) INTO v_result FROM pg_proc AS p WHERE p.oid=v_oid;
  IF v_result IS DISTINCT FROM 'void' THEN
    RAISE EXCEPTION 'Contrato incompatible de release_inventory_reservation: se esperaba void.';
  END IF;
  IF has_function_privilege('anon',v_oid,'EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('authenticated',v_oid,'EXECUTE') IS DISTINCT FROM false
     OR has_function_privilege('service_role',v_oid,'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'release_inventory_reservation debe ser ejecutable únicamente por service_role antes de instalar cupones.';
  END IF;
END;
$preflight_storefront_coupons$;

CREATE TABLE public.storefront_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  discount_type text NOT NULL,
  discount_value bigint NOT NULL,
  minimum_subtotal bigint NOT NULL DEFAULT 0,
  global_limit integer,
  per_customer_limit integer,
  starts_at timestamptz,
  end_at timestamptz,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT storefront_coupons_code_check CHECK (
    length(code) BETWEEN 1 AND 64 AND code=upper(code) AND code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'
  ),
  CONSTRAINT storefront_coupons_discount_type_check CHECK (
    discount_type IN ('percent','fixed_amount')
  ),
  CONSTRAINT storefront_coupons_discount_value_check CHECK (
    (discount_type='percent' AND discount_value BETWEEN 1 AND 100)
    OR (discount_type='fixed_amount' AND discount_value>0)
  ),
  CONSTRAINT storefront_coupons_minimum_subtotal_check CHECK (
    minimum_subtotal BETWEEN 0 AND 500000000
  ),
  CONSTRAINT storefront_coupons_global_limit_check CHECK (
    global_limit IS NULL OR global_limit>0
  ),
  CONSTRAINT storefront_coupons_per_customer_limit_check CHECK (
    per_customer_limit IS NULL OR per_customer_limit>0
  ),
  CONSTRAINT storefront_coupons_window_check CHECK (
    end_at IS NULL OR starts_at IS NULL OR end_at>starts_at
  )
);

CREATE UNIQUE INDEX storefront_coupons_code_ci_uq
  ON public.storefront_coupons (lower(code));
CREATE INDEX storefront_coupons_enabled_window_idx
  ON public.storefront_coupons (enabled,starts_at,end_at);

CREATE TABLE public.storefront_coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.storefront_coupons(id) ON DELETE RESTRICT,
  code text NOT NULL,
  channel text NOT NULL,
  reference text NOT NULL,
  customer_hash text NOT NULL,
  discount_total bigint NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  expires_at timestamptz NOT NULL,
  reconciliation_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  released_at timestamptz,
  CONSTRAINT storefront_coupon_redemptions_channel_check CHECK (channel IN ('wompi','cod')),
  CONSTRAINT storefront_coupon_redemptions_status_check CHECK (status IN ('reserved','redeemed','released')),
  CONSTRAINT storefront_coupon_redemptions_discount_check CHECK (discount_total>0),
  CONSTRAINT storefront_coupon_redemptions_code_check CHECK (
    length(code) BETWEEN 1 AND 64 AND code=upper(code) AND code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'
  ),
  CONSTRAINT storefront_coupon_redemptions_reference_check CHECK (length(btrim(reference)) BETWEEN 1 AND 200),
  CONSTRAINT storefront_coupon_redemptions_customer_hash_check CHECK (length(customer_hash)=64),
  CONSTRAINT storefront_coupon_redemptions_channel_reference_uq UNIQUE (channel,reference)
);

CREATE INDEX storefront_coupon_redemptions_coupon_status_idx
  ON public.storefront_coupon_redemptions (coupon_id,status,expires_at);
CREATE INDEX storefront_coupon_redemptions_coupon_customer_idx
  ON public.storefront_coupon_redemptions (coupon_id,customer_hash,status,expires_at);
COMMENT ON COLUMN public.storefront_coupon_redemptions.customer_hash IS
  'Hash SHA-256 calculado en servidor a partir de correo normalizado y dígitos telefónicos; no guarda PII en claro. Un ledger reconstruido tras pago tardío usa hash sintético de referencia y queda marcado para conciliación.';

CREATE TABLE public.storefront_wompi_checkout_locks (
  reference text PRIMARY KEY,
  customer_phone_hash text NOT NULL,
  cart_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  checkout_claimed_at timestamptz,
  transaction_id text,
  terminal_at timestamptz,
  reconciliation_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storefront_wompi_checkout_reference_check CHECK (length(btrim(reference)) BETWEEN 1 AND 120),
  CONSTRAINT storefront_wompi_checkout_phone_hash_check CHECK (customer_phone_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT storefront_wompi_checkout_cart_hash_check CHECK (cart_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT storefront_wompi_checkout_status_check CHECK (status IN ('active','pending','terminal_grace','completed','released','expired'))
);
CREATE UNIQUE INDEX storefront_wompi_checkout_active_phone_uq
  ON public.storefront_wompi_checkout_locks(customer_phone_hash) WHERE status IN ('active','pending','terminal_grace');
CREATE INDEX storefront_wompi_checkout_expiry_idx
  ON public.storefront_wompi_checkout_locks(expires_at) WHERE status IN ('active','terminal_grace');
COMMENT ON COLUMN public.storefront_wompi_checkout_locks.customer_phone_hash IS
  'Hash seudónimo server-side de teléfono colombiano normalizado; no es anónimo ni contiene PII en claro.';
COMMENT ON COLUMN public.storefront_wompi_checkout_locks.cart_hash IS
  'Hash SHA-256 del carrito canónico; permite diferenciar un reintento del mismo pedido sin almacenar sus datos personales.';

ALTER TABLE public.storefront_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_wompi_checkout_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storefront_coupons,public.storefront_coupon_redemptions,public.storefront_wompi_checkout_locks
  FROM PUBLIC,anon,authenticated,service_role;

-- Los pedidos conservan sus tipos legacy: Wompi usa bigint COP y COD numeric COP.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS coupon_id uuid,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS coupon_discount_total bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_reconciliation_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wompi_reconciliation_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.web_orders
  ADD COLUMN IF NOT EXISTS coupon_id uuid,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS coupon_discount_total numeric DEFAULT 0;

DO $coupon_order_columns_contract$
DECLARE
  v_expected record;
  v_type text;
  v_not_null boolean;
  v_default text;
  v_default_normalized text;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('orders','coupon_id','uuid',false,NULL::text),
      ('orders','coupon_code','text',false,NULL::text),
      ('orders','coupon_discount_total','bigint',false,'0'),
      ('orders','coupon_reconciliation_required','boolean',true,'false'),
      ('orders','wompi_reconciliation_required','boolean',true,'false'),
      ('web_orders','coupon_id','uuid',false,NULL::text),
      ('web_orders','coupon_code','text',false,NULL::text),
      ('web_orders','coupon_discount_total','numeric',false,'0')
    ) AS expected(table_name,column_name,type_name,not_null,default_value)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)
      INTO v_type,v_not_null,v_default
      FROM pg_attribute AS a
      LEFT JOIN pg_attrdef AS d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE a.attrelid=to_regclass(format('public.%I',v_expected.table_name))
       AND a.attname=v_expected.column_name AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND OR v_type IS DISTINCT FROM v_expected.type_name
       OR v_not_null IS DISTINCT FROM v_expected.not_null THEN
      RAISE EXCEPTION 'Contrato incompatible para public.%.%: tipo/NULL esperado %, %.',
        v_expected.table_name,v_expected.column_name,v_expected.type_name,v_expected.not_null;
    END IF;
    IF v_expected.default_value IS NOT NULL THEN
      v_default_normalized:=lower(regexp_replace(coalesce(v_default,''),'::[a-z0-9_ .]+','','g'));
      v_default_normalized:=replace(v_default_normalized,chr(39),'');
      IF v_default_normalized IS DISTINCT FROM v_expected.default_value THEN
        RAISE EXCEPTION 'Contrato incompatible para public.%.%: default esperado %, actual %.',
          v_expected.table_name,v_expected.column_name,v_expected.default_value,v_default;
      END IF;
    END IF;
  END LOOP;
END;
$coupon_order_columns_contract$;

CREATE OR REPLACE FUNCTION public._storefront_coupon_normalized_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
  SELECT CASE
    WHEN p.phone_digits ~ '^0057[0-9]{10}$' THEN substr(p.phone_digits,5)
    WHEN p.phone_digits ~ '^57[0-9]{10}$' THEN substr(p.phone_digits,3)
    ELSE p.phone_digits
  END
  FROM (SELECT regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') AS phone_digits) AS p;
$function$;
REVOKE ALL ON FUNCTION public._storefront_coupon_normalized_phone(text)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE INDEX orders_wompi_pending_phone_norm_idx
  ON public.orders(public._storefront_coupon_normalized_phone(phone),created_at DESC,reference)
  WHERE lower(payment_method)='wompi' AND upper(payment_status)='PENDING';
CREATE INDEX orders_wompi_reconciliation_phone_idx
  ON public.orders(public._storefront_coupon_normalized_phone(phone))
  WHERE lower(payment_method)='wompi'
    AND (wompi_reconciliation_required=true OR coupon_reconciliation_required=true);

CREATE OR REPLACE FUNCTION public.list_pending_wompi_orders_for_phone(p_customer_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_orders jsonb;
BEGIN
  IF v_phone !~ '^[0-9]{10}$' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_PHONE_INVALID');
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.reference),'[]'::jsonb)
    INTO v_orders
    FROM (
      SELECT o.reference,o.created_at,o.total,o.subtotal,o.shipping,o.city,o.items,
             o.payment_status,o.transaction_id,o.customer_name,o.phone,o.address,o.neighborhood,
             o.coupon_id,o.coupon_code,o.coupon_discount_total
        FROM public.orders AS o
       WHERE lower(o.payment_method)='wompi'
         AND upper(o.payment_status)='PENDING'
         AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
       ORDER BY o.created_at DESC,o.reference
       LIMIT 1001
    ) AS q;
  IF jsonb_array_length(v_orders)>1000 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_PENDING_LIMIT');
  END IF;
  RETURN jsonb_build_object('success',true,'orders',v_orders);
END;
$function$;
REVOKE ALL ON FUNCTION public.list_pending_wompi_orders_for_phone(text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_pending_wompi_orders_for_phone(text) TO service_role;

CREATE OR REPLACE FUNCTION public._storefront_coupon_customer_hash(
  p_email text,
  p_phone text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
  SELECT encode(
    extensions.digest(
      lower(btrim(coalesce(p_email,''))) || '|' || public._storefront_coupon_normalized_phone(p_phone),
      'sha256'
    ),
    'hex'
  );
$function$;
REVOKE ALL ON FUNCTION public._storefront_coupon_customer_hash(text,text)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._storefront_coupon_normalized_city(p_city text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_city text:=btrim(coalesce(p_city,''));
  v_normalized text;
BEGIN
  IF to_regprocedure('public.normalize_storefront_delivery_city(text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.normalize_storefront_delivery_city($1)' INTO v_normalized USING v_city;
  ELSE
    EXECUTE 'SELECT public.sirevya_normalize_combo_category($1)' INTO v_normalized USING v_city;
  END IF;
  RETURN btrim(coalesce(v_normalized,''));
END;
$function$;
REVOKE ALL ON FUNCTION public._storefront_coupon_normalized_city(text)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_list_storefront_coupons()
RETURNS TABLE(
  id uuid,
  code text,
  discount_type text,
  discount_value bigint,
  minimum_subtotal bigint,
  global_limit integer,
  per_customer_limit integer,
  starts_at timestamptz,
  end_at timestamptz,
  enabled boolean,
  redeemed_count bigint,
  active_reservations_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM (SELECT s.admin_user_id FROM public.store_settings AS s WHERE s.id=1) THEN
    RAISE EXCEPTION 'Este usuario no está autorizado para consultar los cupones.' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT c.id,c.code,c.discount_type,c.discount_value,c.minimum_subtotal,
         c.global_limit,c.per_customer_limit,c.starts_at,c.end_at,c.enabled,
         (SELECT count(*) FROM public.storefront_coupon_redemptions AS r
           WHERE r.coupon_id=c.id AND r.status='redeemed'),
         (SELECT count(*) FROM public.storefront_coupon_redemptions AS r
           WHERE r.coupon_id=c.id AND r.status='reserved' AND r.expires_at>now())
    FROM public.storefront_coupons AS c
   ORDER BY c.created_at DESC,c.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_storefront_coupons()
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_storefront_coupons() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_storefront_coupon(
  p_coupon_id uuid,
  p_code text,
  p_discount_type text,
  p_discount_value bigint,
  p_minimum_subtotal bigint,
  p_global_limit integer,
  p_per_customer_limit integer,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_code text:=upper(btrim(coalesce(p_code,'')));
  v_type text:=lower(btrim(coalesce(p_discount_type,'')));
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM (SELECT s.admin_user_id FROM public.store_settings AS s WHERE s.id=1) THEN
    RAISE EXCEPTION 'Este usuario no está autorizado para modificar los cupones.' USING ERRCODE='42501';
  END IF;
  IF v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_CODE_INVALID','message','El código solo puede contener letras, números, guion y guion bajo.');
  END IF;
  IF v_type NOT IN ('percent','fixed_amount') THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_TYPE_INVALID','message','El tipo de descuento no es válido.');
  END IF;
  IF (v_type='percent' AND (p_discount_value IS NULL OR p_discount_value NOT BETWEEN 1 AND 100))
     OR (v_type='fixed_amount' AND (p_discount_value IS NULL OR p_discount_value<=0)) THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_VALUE_INVALID','message','El valor del descuento no es válido.');
  END IF;
  IF p_minimum_subtotal IS NULL OR p_minimum_subtotal NOT BETWEEN 0 AND 500000000 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_MINIMUM_INVALID','message','El mínimo de compra no es válido.');
  END IF;
  IF p_global_limit IS NOT NULL AND p_global_limit<=0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_LIMIT_INVALID','message','El límite global debe ser positivo o quedar vacío.');
  END IF;
  IF p_per_customer_limit IS NOT NULL AND p_per_customer_limit<=0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_LIMIT_INVALID','message','El límite por cliente debe ser positivo o quedar vacío.');
  END IF;
  IF p_end_at IS NOT NULL AND p_start_at IS NOT NULL AND p_end_at<=p_start_at THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_WINDOW_INVALID','message','La fecha final debe ser posterior a la fecha inicial.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.storefront_coupons AS c WHERE lower(c.code)=lower(v_code) AND c.id IS DISTINCT FROM p_coupon_id) THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_CODE_EXISTS','message','Ya existe un cupón con ese código.');
  END IF;
  IF p_coupon_id IS NULL THEN
    INSERT INTO public.storefront_coupons(
      code,discount_type,discount_value,minimum_subtotal,global_limit,per_customer_limit,
      starts_at,end_at,enabled,created_at,updated_at,updated_by
    ) VALUES (
      v_code,v_type,p_discount_value,p_minimum_subtotal,p_global_limit,p_per_customer_limit,
      p_start_at,p_end_at,coalesce(p_enabled,false),now(),now(),auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.storefront_coupons AS c
       SET code=v_code,discount_type=v_type,discount_value=p_discount_value,
           minimum_subtotal=p_minimum_subtotal,global_limit=p_global_limit,
           per_customer_limit=p_per_customer_limit,starts_at=p_start_at,end_at=p_end_at,
           enabled=coalesce(p_enabled,false),updated_at=now(),updated_by=auth.uid()
     WHERE c.id=p_coupon_id
     RETURNING c.id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_NOT_FOUND','message','El cupón que intentas editar ya no existe.');
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'success',true,'id',v_id,'code',v_code,'discount_type',v_type,
    'discount_value',p_discount_value,'minimum_subtotal',p_minimum_subtotal,
    'global_limit',p_global_limit,'per_customer_limit',p_per_customer_limit,
    'starts_at',p_start_at,'end_at',p_end_at,'enabled',coalesce(p_enabled,false)
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_CODE_EXISTS','message','Ya existe un cupón con ese código.');
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_save_storefront_coupon(uuid,text,text,bigint,bigint,integer,integer,timestamptz,timestamptz,boolean)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_storefront_coupon(uuid,text,text,bigint,bigint,integer,integer,timestamptz,timestamptz,boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_storefront_cart_quote_with_coupon(
  p_items jsonb,
  p_city text,
  p_coupon_code text,
  p_customer_email text,
  p_customer_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_legacy_quote jsonb;
  v_items jsonb;
  v_discounts jsonb;
  v_coupon public.storefront_coupons%ROWTYPE;
  v_coupon_code text:=upper(btrim(coalesce(p_coupon_code,'')));
  v_normalized_city text;
  v_input jsonb;
  v_line jsonb;
  v_line_out jsonb;
  v_item_count integer;
  v_index integer:=0;
  v_combo_total numeric:=0;
  v_original_subtotal numeric:=0;
  v_subtotal numeric:=0;
  v_coupon_discount numeric:=0;
  v_total_discount numeric:=0;
  v_shipping numeric:=0;
  v_total numeric:=0;
  v_line_net_total numeric:=0;
  v_line_original numeric;
  v_line_combo numeric;
  v_line_net numeric;
  v_share numeric;
  v_remaining_coupon numeric;
  v_remaining_base numeric;
  v_last_positive_index integer:=0;
  v_rule_cost numeric;
  v_rule_threshold numeric;
  v_destination_status text;
  v_message text;
BEGIN
  IF v_coupon_code='' THEN
    v_legacy_quote:=public.get_storefront_cart_quote(p_items,p_city);
    IF coalesce((v_legacy_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN
      RETURN v_legacy_quote||jsonb_build_object('coupon_id',NULL,'coupon_code',NULL,'coupon_discount_total',0,'coupon',NULL);
    END IF;
    v_items:='[]'::jsonb;
    FOR v_input IN SELECT value FROM jsonb_array_elements(coalesce(v_legacy_quote->'items','[]'::jsonb)) AS x(value) LOOP
      v_items:=v_items||(v_input||jsonb_build_object('coupon_discount_total',0));
    END LOOP;
    RETURN v_legacy_quote||jsonb_build_object(
      'items',v_items,'coupon_id',NULL,'coupon_code',NULL,'coupon_discount_total',0,'coupon',NULL
    );
  END IF;

  IF v_coupon_code !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_INVALID','message','El código del cupón no es válido.');
  END IF;
  v_legacy_quote:=public.get_storefront_cart_quote(p_items,p_city);
  IF coalesce((v_legacy_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN
    RETURN v_legacy_quote||jsonb_build_object('code','QUOTE_INVALID');
  END IF;
  IF (v_legacy_quote->>'discount_total') IS NULL
     OR (v_legacy_quote->>'original_subtotal') IS NULL
     OR (v_legacy_quote->>'discounted_subtotal') IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización legacy está incompleta.');
  END IF;
  IF round((v_legacy_quote->>'discount_total')::numeric,0)>0 THEN
    RETURN jsonb_build_object(
      'success',false,'code','COUPON_COMBO_CONFLICT',
      'message','Este cupón no se puede combinar con descuentos de combo.'
    );
  END IF;

  SELECT c.* INTO v_coupon
    FROM public.storefront_coupons AS c
   WHERE c.code=v_coupon_code
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_INVALID','message','El cupón no existe.');
  END IF;
  IF NOT v_coupon.enabled THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_DISABLED','message','El cupón no está activo.');
  END IF;
  IF v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at>now() THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_NOT_STARTED','message','El cupón todavía no está vigente.');
  END IF;
  IF v_coupon.end_at IS NOT NULL AND v_coupon.end_at<=now() THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_EXPIRED','message','El cupón ya no está vigente.');
  END IF;

  v_original_subtotal:=round((v_legacy_quote->>'original_subtotal')::numeric,0);
  v_subtotal:=round((v_legacy_quote->>'discounted_subtotal')::numeric,0);
  IF v_subtotal<v_coupon.minimum_subtotal THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_MINIMUM_NOT_MET','message','El subtotal no alcanza el mínimo requerido para este cupón.');
  END IF;
  IF lower(v_coupon.discount_type)='percent' THEN
    v_coupon_discount:=round(v_subtotal*v_coupon.discount_value/100,0);
  ELSE
    v_coupon_discount:=least(v_subtotal,v_coupon.discount_value);
  END IF;
  v_coupon_discount:=least(v_subtotal,greatest(0,v_coupon_discount));
  IF v_coupon_discount<=0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_ZERO_DISCOUNT','message','El cupón no produce un descuento sobre este subtotal.');
  END IF;

  v_items:='[]'::jsonb;
  v_item_count:=jsonb_array_length(coalesce(v_legacy_quote->'items','[]'::jsonb));
  IF v_item_count<1 THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización legacy no contiene líneas.');
  END IF;
  SELECT coalesce(max(x.ordinality),0)::integer INTO v_last_positive_index
    FROM jsonb_array_elements(coalesce(v_legacy_quote->'items','[]'::jsonb)) WITH ORDINALITY AS x(value,ordinality)
   WHERE greatest(0,round(coalesce((x.value->>'net_subtotal')::numeric,
     coalesce((x.value->>'original_subtotal')::numeric,0)-coalesce((x.value->>'discount_total')::numeric,0)),0))>0;
  IF v_last_positive_index=0 THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización no contiene una línea elegible para distribuir el cupón.');
  END IF;
  v_remaining_coupon:=v_coupon_discount;
  v_remaining_base:=v_subtotal;
  FOR v_input IN
    SELECT value FROM jsonb_array_elements(coalesce(v_legacy_quote->'items','[]'::jsonb)) WITH ORDINALITY AS x(value,ordinality)
    ORDER BY ordinality
  LOOP
    v_index:=v_index+1;
    v_line_original:=round(coalesce((v_input->>'original_subtotal')::numeric,0),0);
    v_line_combo:=round(coalesce((v_input->>'discount_total')::numeric,0),0);
    v_line_net:=greatest(0,round(coalesce((v_input->>'net_subtotal')::numeric,v_line_original-v_line_combo),0));
    v_combo_total:=v_combo_total+v_line_combo;
    v_line_net_total:=v_line_net_total+v_line_net;
    IF v_index=v_last_positive_index THEN
      v_share:=v_remaining_coupon;
    ELSIF v_remaining_coupon<=0 OR v_line_net<=0 OR v_remaining_base<=0 THEN
      v_share:=0;
    ELSE
      v_share:=least(v_line_net,greatest(0,round(v_remaining_coupon*v_line_net/v_remaining_base,0)));
    END IF;
    v_share:=least(v_line_net,greatest(0,v_share));
    v_remaining_coupon:=greatest(0,v_remaining_coupon-v_share);
    v_remaining_base:=greatest(0,v_remaining_base-v_line_net);
    v_line_out:=v_input||jsonb_build_object(
      'discount_total',v_line_combo+v_share,
      'coupon_discount_total',v_share,
      'net_subtotal',greatest(0,v_line_net-v_share)
    );
    v_items:=v_items||v_line_out;
  END LOOP;
  IF v_remaining_coupon<>0 THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','No se pudo distribuir exactamente el descuento del cupón.');
  END IF;
  IF round(v_combo_total,0)<>round((v_legacy_quote->>'discount_total')::numeric,0) THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La distribución de descuentos legacy no concilia.');
  END IF;
  IF round(v_line_net_total,0)<>round((v_legacy_quote->>'discounted_subtotal')::numeric,0) THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','Los subtotales por línea no concilian con el subtotal del servidor.');
  END IF;

  v_total_discount:=v_combo_total+v_coupon_discount;
  v_subtotal:=greatest(0,v_original_subtotal-v_total_discount);
  v_destination_status:=v_legacy_quote->>'destination_status';
  IF v_destination_status IS NULL
     OR v_destination_status NOT IN ('matched_city','matched_zone','cali_free','fallback')
     OR v_legacy_quote->>'shipping_rule_cost' IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','SHIPPING_UNAVAILABLE','message','La cotización de ciudad/zona no incluye una regla verificable.');
  END IF;
  v_normalized_city:=v_legacy_quote->>'normalized_city';
  v_rule_cost:=round((v_legacy_quote->>'shipping_rule_cost')::numeric,0);
  v_rule_threshold:=nullif(v_legacy_quote->>'shipping_rule_threshold','')::numeric;
  IF v_destination_status='cali_free' THEN
    -- Envío gratuito de Cali solo es fallback cuando el quote legacy no encontró regla.
    v_shipping:=0;
  ELSIF v_rule_threshold IS NOT NULL AND v_subtotal>=v_rule_threshold THEN
    v_shipping:=0;
  ELSE
    v_shipping:=v_rule_cost;
  END IF;
  v_total:=v_subtotal+v_shipping;
  v_discounts:=coalesce(v_legacy_quote->'discounts','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
    'id',v_coupon.id,'code',v_coupon.code,'discount_type',v_coupon.discount_type,
    'discount_value',v_coupon.discount_value,'minimum_subtotal',v_coupon.minimum_subtotal,
    'discount_total',v_coupon_discount,'coupon_discount_total',v_coupon_discount
  ));
  RETURN jsonb_build_object(
    'success',true,'original_subtotal',v_original_subtotal,'discount_total',v_total_discount,
    'discounted_subtotal',v_subtotal,'shipping',v_shipping,'total',v_total,
    'items',v_items,'discounts',v_discounts,'currency','COP',
    'coupon_id',v_coupon.id,'coupon_code',v_coupon.code,'coupon_discount_total',v_coupon_discount,
    'normalized_city',v_normalized_city,'destination_status',v_destination_status,
    'shipping_rule_id',v_legacy_quote->>'shipping_rule_id',
    'shipping_rule_scope',v_legacy_quote->>'shipping_rule_scope',
    'shipping_rule_name',v_legacy_quote->>'shipping_rule_name',
    'shipping_rule_cost',v_rule_cost,'shipping_rule_threshold',v_rule_threshold,
    'coupon',jsonb_build_object(
      'id',v_coupon.id,'code',v_coupon.code,'discount_type',v_coupon.discount_type,
      'discount_value',v_coupon.discount_value,'minimum_subtotal',v_coupon.minimum_subtotal,
      'global_limit',v_coupon.global_limit,'per_customer_limit',v_coupon.per_customer_limit,
      'starts_at',v_coupon.starts_at,'end_at',v_coupon.end_at,'enabled',v_coupon.enabled
    )
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','El carrito o el cupón contienen un valor no válido.');
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    RETURN jsonb_build_object('success',false,'code','COUPON_QUOTE_FAILED','message','No se pudo verificar el cupón y la cotización.');
END;
$function$;
REVOKE ALL ON FUNCTION public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote_with_coupon(jsonb,text,text,text,text)
  TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.reserve_storefront_coupon_redemption(
  p_coupon_code text,
  p_channel text,
  p_reference text,
  p_customer_email text,
  p_customer_phone text,
  p_discount_total bigint,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_code text:=upper(btrim(coalesce(p_coupon_code,'')));
  v_channel text:=lower(btrim(coalesce(p_channel,'')));
  v_reference text:=btrim(coalesce(p_reference,''));
  v_normalized_email text;
  v_normalized_phone text;
  v_customer_hash text;
  v_coupon public.storefront_coupons%ROWTYPE;
  v_existing public.storefront_coupon_redemptions%ROWTYPE;
  v_global_count bigint;
  v_customer_count bigint;
  v_id uuid;
  v_expires_at timestamptz:=now()+interval '10 minutes';
BEGIN
  IF v_channel NOT IN ('wompi','cod') OR v_reference='' OR length(v_reference)>200 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_INPUT_INVALID','message','La reserva del cupón no tiene un canal o referencia válidos.');
  END IF;
  IF v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' OR p_discount_total IS NULL OR p_discount_total<=0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_INPUT_INVALID','message','La reserva del cupón no tiene código o descuento válidos.');
  END IF;
  IF p_expires_at IS NOT NULL THEN
    IF p_expires_at<=now() OR p_expires_at>now()+interval '10 minutes' THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_EXPIRY_INVALID','message','La expiración del cupón no coincide con la reserva segura de inventario.');
    END IF;
    v_expires_at:=p_expires_at;
  END IF;
  v_normalized_email:=lower(btrim(coalesce(p_customer_email,'')));
  v_normalized_phone:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_customer_hash:=public._storefront_coupon_customer_hash(v_normalized_email,v_normalized_phone);
  PERFORM pg_advisory_xact_lock(hashtext('storefront-coupon-reference:'||v_channel||':'||v_reference));
  SELECT r.* INTO v_existing
    FROM public.storefront_coupon_redemptions AS r
   WHERE r.channel=v_channel AND r.reference=v_reference
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.code IS DISTINCT FROM v_code
       OR v_existing.customer_hash IS DISTINCT FROM v_customer_hash
       OR v_existing.discount_total IS DISTINCT FROM p_discount_total THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_CONFLICT','message','La referencia ya existe con otros datos de cupón.');
    END IF;
    IF v_existing.status='released' THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_RELEASED','message','La referencia ya liberó su reserva y no puede reutilizarse.');
    END IF;
    IF v_existing.status='reserved' AND v_existing.expires_at<=now() THEN
      IF v_channel='cod' AND EXISTS (
        SELECT 1 FROM public.web_orders AS w WHERE w.client_reference=v_reference
      ) THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_ALREADY_USED','message','La referencia COD ya tiene un pedido y no puede renovar el cupón.');
      END IF;
      SELECT c.* INTO v_coupon FROM public.storefront_coupons AS c WHERE c.id=v_existing.coupon_id FOR UPDATE;
      IF NOT FOUND OR NOT v_coupon.enabled
         OR (v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at>now())
         OR (v_coupon.end_at IS NOT NULL AND v_coupon.end_at<=now()) THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_NOT_ACTIVE','message','El cupón ya no está vigente.');
      END IF;
      IF v_coupon.per_customer_limit IS NOT NULL
         AND (length(v_normalized_email)>254 OR v_normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
              OR v_normalized_phone !~ '^[0-9]{10}$') THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_REQUIRED','message','Este cupón requiere correo y teléfono para validar su límite por cliente.');
      END IF;
      SELECT count(*) INTO v_global_count
        FROM public.storefront_coupon_redemptions AS r
       WHERE r.coupon_id=v_coupon.id AND r.id<>v_existing.id
         AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
      IF v_coupon.global_limit IS NOT NULL AND v_global_count>=v_coupon.global_limit THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_GLOBAL_LIMIT','message','El cupón alcanzó su límite de usos.');
      END IF;
      SELECT count(*) INTO v_customer_count
        FROM public.storefront_coupon_redemptions AS r
       WHERE r.coupon_id=v_coupon.id AND r.id<>v_existing.id AND r.customer_hash=v_customer_hash
         AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
      IF v_coupon.per_customer_limit IS NOT NULL AND v_customer_count>=v_coupon.per_customer_limit THEN
        RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_LIMIT','message','Ya alcanzaste el límite de uso de este cupón.');
      END IF;
      UPDATE public.storefront_coupon_redemptions AS r
         SET expires_at=v_expires_at,updated_at=now()
       WHERE r.id=v_existing.id;
      RETURN jsonb_build_object(
        'success',true,'id',v_existing.id,'coupon_id',v_existing.coupon_id,'coupon_code',v_existing.code,
        'channel',v_existing.channel,'reference',v_existing.reference,'discount_total',v_existing.discount_total,
        'status','reserved','expires_at',v_expires_at,'reconciliation_required',v_existing.reconciliation_required,
        'idempotent',true,'renewed_after_expiry',true
      );
    END IF;
    IF v_existing.status='reserved' AND p_expires_at IS NOT NULL AND v_existing.expires_at IS DISTINCT FROM v_expires_at THEN
      UPDATE public.storefront_coupon_redemptions AS r SET expires_at=v_expires_at,updated_at=now() WHERE r.id=v_existing.id;
    END IF;
    RETURN jsonb_build_object(
      'success',true,'id',v_existing.id,'coupon_id',v_existing.coupon_id,'coupon_code',v_existing.code,
      'channel',v_existing.channel,'reference',v_existing.reference,'discount_total',v_existing.discount_total,
      'status',v_existing.status,'expires_at',CASE WHEN v_existing.status='reserved' AND p_expires_at IS NOT NULL THEN v_expires_at ELSE v_existing.expires_at END,
      'reconciliation_required',v_existing.reconciliation_required,'idempotent',true
    );
  END IF;

  SELECT c.* INTO v_coupon
    FROM public.storefront_coupons AS c
   WHERE c.code=v_code
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_INVALID','message','El cupón no existe.');
  END IF;
  IF NOT v_coupon.enabled
     OR (v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at>now())
     OR (v_coupon.end_at IS NOT NULL AND v_coupon.end_at<=now()) THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_NOT_ACTIVE','message','El cupón no está vigente.');
  END IF;
  IF v_coupon.per_customer_limit IS NOT NULL
     AND (length(v_normalized_email)>254 OR v_normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          OR v_normalized_phone !~ '^[0-9]{10}$') THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_REQUIRED','message','Este cupón requiere correo y teléfono para validar su límite por cliente.');
  END IF;
  SELECT count(*) INTO v_global_count
    FROM public.storefront_coupon_redemptions AS r
   WHERE r.coupon_id=v_coupon.id
     AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
  IF v_coupon.global_limit IS NOT NULL AND v_global_count>=v_coupon.global_limit THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_GLOBAL_LIMIT','message','El cupón alcanzó su límite de usos.');
  END IF;
  SELECT count(*) INTO v_customer_count
    FROM public.storefront_coupon_redemptions AS r
   WHERE r.coupon_id=v_coupon.id AND r.customer_hash=v_customer_hash
     AND (r.status='redeemed' OR (r.status='reserved' AND r.expires_at>now()));
  IF v_coupon.per_customer_limit IS NOT NULL AND v_customer_count>=v_coupon.per_customer_limit THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_CUSTOMER_LIMIT','message','Ya alcanzaste el límite de uso de este cupón.');
  END IF;
  INSERT INTO public.storefront_coupon_redemptions(
    coupon_id,code,channel,reference,customer_hash,discount_total,status,expires_at,
    reconciliation_required,created_at,updated_at
  ) VALUES (
    v_coupon.id,v_coupon.code,v_channel,v_reference,v_customer_hash,p_discount_total,'reserved',v_expires_at,
    false,now(),now()
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object(
    'success',true,'id',v_id,'coupon_id',v_coupon.id,'coupon_code',v_coupon.code,
    'channel',v_channel,'reference',v_reference,'discount_total',p_discount_total,
    'status','reserved','expires_at',v_expires_at,'reconciliation_required',false,'idempotent',false
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_CONFLICT','message','La referencia ya fue reservada en otra transacción.');
END;
$function$;
REVOKE ALL ON FUNCTION public.reserve_storefront_coupon_redemption(text,text,text,text,text,bigint,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_coupon_redemption(text,text,text,text,text,bigint,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_storefront_coupon_redemption(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_row public.storefront_coupon_redemptions%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_reconciliation boolean;
BEGIN
  SELECT r.* INTO v_row
    FROM public.storefront_coupon_redemptions AS r
   WHERE r.channel='wompi' AND r.reference=btrim(coalesce(p_reference,''))
   FOR UPDATE;
  IF NOT FOUND THEN
    SELECT o.* INTO v_order
      FROM public.orders AS o
     WHERE o.reference=btrim(coalesce(p_reference,''))
       AND lower(coalesce(o.payment_method,''))='wompi'
       AND o.coupon_id IS NOT NULL
       AND o.coupon_code IS NOT NULL
       AND coalesce(o.coupon_discount_total,0)>0
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_NOT_FOUND','message','No existe una reserva Wompi ni un pedido con cupón para esa referencia.');
    END IF;
    INSERT INTO public.storefront_coupon_redemptions(
      coupon_id,code,channel,reference,customer_hash,discount_total,status,expires_at,
      reconciliation_required,created_at,updated_at,redeemed_at
    ) VALUES (
      v_order.coupon_id,upper(btrim(v_order.coupon_code)),'wompi',btrim(p_reference),
      encode(extensions.digest('missing-ledger:'||btrim(p_reference),'sha256'),'hex'),
      round(v_order.coupon_discount_total)::bigint,'redeemed',now(),true,now(),now(),now()
    ) ON CONFLICT (channel,reference) DO NOTHING;
    SELECT r.* INTO v_row FROM public.storefront_coupon_redemptions AS r
     WHERE r.channel='wompi' AND r.reference=btrim(coalesce(p_reference,'')) FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_NOT_FOUND','message','No se pudo registrar la redención de conciliación.');
    END IF;
  END IF;
  IF v_row.status='redeemed' THEN
    RETURN jsonb_build_object('success',true,'id',v_row.id,'reference',v_row.reference,'status','redeemed',
      'discount_total',v_row.discount_total,'reconciliation_required',v_row.reconciliation_required,'idempotent',true);
  END IF;
  -- Wompi already verified a successful payment. Honor it even if a terminal
  -- webhook had released the hold; the over-limit exception is reviewable.
  v_reconciliation:=v_row.status='released' OR v_row.expires_at<=now();
  UPDATE public.storefront_coupon_redemptions AS r
     SET status='redeemed',redeemed_at=coalesce(r.redeemed_at,now()),updated_at=now(),
         reconciliation_required=r.reconciliation_required OR v_reconciliation,
         released_at=CASE WHEN v_row.status='released' THEN r.released_at ELSE NULL END
   WHERE r.id=v_row.id;
  RETURN jsonb_build_object(
    'success',true,'id',v_row.id,'reference',v_row.reference,'status','redeemed',
    'discount_total',v_row.discount_total,'reconciliation_required',v_row.reconciliation_required OR v_reconciliation,
    'expired_reservation',v_reconciliation,'idempotent',false
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.confirm_storefront_coupon_redemption(text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_storefront_coupon_redemption(text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_storefront_coupon_redemption(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_row public.storefront_coupon_redemptions%ROWTYPE;
BEGIN
  SELECT r.* INTO v_row
    FROM public.storefront_coupon_redemptions AS r
   WHERE r.channel='wompi' AND r.reference=btrim(coalesce(p_reference,''))
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REDEMPTION_NOT_FOUND','message','No existe una reserva Wompi para esa referencia.');
  END IF;
  IF v_row.status='redeemed' THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_ALREADY_REDEEMED','message','El cupón ya fue consumido; no se puede liberar.');
  END IF;
  IF v_row.status='released' THEN
    RETURN jsonb_build_object('success',true,'id',v_row.id,'reference',v_row.reference,'status','released','idempotent',true);
  END IF;
  UPDATE public.storefront_coupon_redemptions AS r
     SET status='released',released_at=coalesce(r.released_at,now()),updated_at=now()
   WHERE r.id=v_row.id;
  RETURN jsonb_build_object('success',true,'id',v_row.id,'reference',v_row.reference,'status','released','idempotent',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.release_storefront_coupon_redemption(text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.release_storefront_coupon_redemption(text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_contra_delivery_order_with_coupon(
  p_client_reference text,
  p_customer_name text,
  p_customer_cedula text,
  p_customer_phone text,
  p_customer_email text,
  p_customer_city text,
  p_customer_address text,
  p_customer_neighborhood text,
  p_items jsonb,
  p_coupon_code text,
  p_expected_total numeric,
  p_expected_discount_total numeric,
  p_expected_coupon_discount_total numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_code text:=upper(btrim(coalesce(p_coupon_code,'')));
  v_quote jsonb;
  v_legacy_quote jsonb;
  v_verified_quote jsonb;
  v_result jsonb;
  v_existing record;
  v_coupon_id uuid;
  v_order_id uuid;
  v_reservation jsonb;
  v_ledger public.storefront_coupon_redemptions%ROWTYPE;
  v_existing_item_key jsonb;
  v_input_item_key jsonb;
  v_product_lock_id uuid;
BEGIN
  IF btrim(coalesce(p_client_reference,''))='' OR length(btrim(p_client_reference))>200 THEN
    RETURN jsonb_build_object('success',false,'code','COD_REFERENCE_INVALID','message','La referencia del pedido no es válida.');
  END IF;
  IF p_expected_total IS NULL OR p_expected_total<0 OR p_expected_total<>round(p_expected_total,0)
     OR p_expected_discount_total IS NULL OR p_expected_discount_total<0 OR p_expected_discount_total<>round(p_expected_discount_total,0)
     OR p_expected_coupon_discount_total IS NULL OR p_expected_coupon_discount_total<0
     OR p_expected_coupon_discount_total<>round(p_expected_coupon_discount_total,0) THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización enviada no es válida. Vuelve a revisar el total.');
  END IF;
  IF p_expected_coupon_discount_total>p_expected_discount_total THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','El descuento del cupón no concilia con el descuento total.');
  END IF;
  IF v_code<>'' AND v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_INVALID','message','El código del cupón no es válido.');
  END IF;

  -- Serializa reintentos COD del mismo client_reference antes de buscar una fila;
  -- un SELECT FOR UPDATE no bloquea la ausencia de la fila en la primera compra.
  PERFORM pg_advisory_xact_lock(hashtext('storefront-cod-coupon-reference:'||btrim(p_client_reference)));

  -- La idempotencia se decide antes de volver a cotizar: nunca se agrega un cupón
  -- retroactivamente a un pedido COD legacy que ya existe.
  IF v_code<>'' THEN
    SELECT c.id INTO v_coupon_id FROM public.storefront_coupons AS c WHERE c.code=v_code LIMIT 1;
  END IF;
  SELECT w.id,w.total,w.discount_total,w.shipping,w.items,w.coupon_id,w.coupon_code,w.coupon_discount_total,
         w.payment_method,w.client_reference,w.customer_name,w.customer_cedula,w.customer_phone,
         w.customer_email,w.customer_city,w.customer_address,w.customer_neighborhood
    INTO v_existing
    FROM public.web_orders AS w
   WHERE w.client_reference=btrim(p_client_reference)
     AND w.payment_method='Contra entrega'
   LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',coalesce(x.value->>'id',x.value->>'product_id',''),
      'qty',coalesce(x.value->>'qty',''),
      'color',coalesce(x.value->>'color',''),
      'size',coalesce(x.value->>'size','')
    ) ORDER BY x.ordinality),'[]'::jsonb)
      INTO v_existing_item_key
      FROM jsonb_array_elements(coalesce(v_existing.items,'[]'::jsonb)) WITH ORDINALITY AS x(value,ordinality);
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',coalesce(x.value->>'id',x.value->>'product_id',''),
      'qty',coalesce(x.value->>'qty',''),
      'color',coalesce(x.value->>'color',''),
      'size',coalesce(x.value->>'size','')
    ) ORDER BY x.ordinality),'[]'::jsonb)
      INTO v_input_item_key
      FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) WITH ORDINALITY AS x(value,ordinality);
    IF coalesce(v_existing.coupon_code,'')<>v_code
       OR v_existing.coupon_id IS DISTINCT FROM v_coupon_id
       OR v_existing_item_key IS DISTINCT FROM v_input_item_key
       OR lower(btrim(coalesce(v_existing.customer_name,''))) IS DISTINCT FROM lower(btrim(coalesce(p_customer_name,'')))
       OR btrim(coalesce(v_existing.customer_cedula,'')) IS DISTINCT FROM btrim(coalesce(p_customer_cedula,''))
       OR public._storefront_coupon_normalized_phone(v_existing.customer_phone) IS DISTINCT FROM public._storefront_coupon_normalized_phone(p_customer_phone)
       OR lower(btrim(coalesce(v_existing.customer_email,''))) IS DISTINCT FROM lower(btrim(coalesce(p_customer_email,'')))
       OR public.normalize_storefront_delivery_city(v_existing.customer_city) IS DISTINCT FROM public.normalize_storefront_delivery_city(p_customer_city)
       OR lower(btrim(coalesce(v_existing.customer_address,''))) IS DISTINCT FROM lower(btrim(coalesce(p_customer_address,'')))
       OR lower(btrim(coalesce(v_existing.customer_neighborhood,''))) IS DISTINCT FROM lower(btrim(coalesce(p_customer_neighborhood,'')))
       OR round(coalesce(v_existing.coupon_discount_total,0),0)<>round(p_expected_coupon_discount_total,0)
       OR round(v_existing.discount_total,0)<>round(p_expected_discount_total,0)
       OR round(v_existing.total,0)<>round(p_expected_total,0) THEN
      RETURN jsonb_build_object(
        'success',false,'duplicate',true,'code','COD_REFERENCE_CONFLICT',
        'existing_order_id',v_existing.id,'existing_total',v_existing.total,
        'existing_discount_total',v_existing.discount_total,
        'existing_coupon_discount_total',v_existing.coupon_discount_total,
        'message','Ya existe un pedido COD con otros datos, cupón o importe. No se modificó ni duplicó el pedido anterior.'
      );
    END IF;
    IF v_code<>'' THEN
      SELECT r.* INTO v_ledger
        FROM public.storefront_coupon_redemptions AS r
       WHERE r.channel='cod' AND r.reference=btrim(p_client_reference)
       LIMIT 1
       FOR SHARE;
      IF NOT FOUND OR v_ledger.status<>'redeemed'
         OR v_ledger.coupon_id IS DISTINCT FROM v_existing.coupon_id
         OR v_ledger.code IS DISTINCT FROM v_code
         OR v_ledger.discount_total IS DISTINCT FROM round(p_expected_coupon_discount_total,0)::bigint THEN
        RETURN jsonb_build_object('success',false,'duplicate',true,'code','COD_COUPON_LEDGER_MISMATCH',
          'existing_order_id',v_existing.id,'message','El pedido COD existe, pero su ledger de cupón no coincide; no se modificó.');
      END IF;
    END IF;
    RETURN jsonb_build_object(
      'success',true,'duplicate',true,'order_id',v_existing.id,'total',v_existing.total,
      'discount_total',v_existing.discount_total,'coupon_discount_total',coalesce(v_existing.coupon_discount_total,0),
      'shipping',v_existing.shipping,'coupon_id',v_existing.coupon_id,'coupon_code',v_existing.coupon_code,
      'message','El pedido ya estaba registrado; no se volvió a reservar inventario ni cupón.'
    );
  END IF;

  PERFORM 1 FROM public.storefront_shipping_settings WHERE id=1 FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','SHIPPING_UNAVAILABLE','message','La configuración de envíos no está disponible.');
  END IF;
  -- Freeze mutable inputs through the legacy call. Shared table locks serialize
  -- combo/shipping-rule edits; ordered row locks serialize price changes for
  -- products in this cart without blocking unrelated catalog updates.
  LOCK TABLE public.storefront_product_combos,
             public.storefront_shipping_rules,
             public.storefront_shipping_rule_destinations IN SHARE MODE;
  IF jsonb_typeof(p_items)='array' THEN
    FOR v_product_lock_id IN
      SELECT DISTINCT coalesce(x.value->>'id',x.value->>'product_id')::uuid
        FROM jsonb_array_elements(p_items) AS x(value)
       WHERE coalesce(x.value->>'id',x.value->>'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ORDER BY 1
    LOOP
      PERFORM 1 FROM public.products AS p WHERE p.id=v_product_lock_id FOR NO KEY UPDATE OF p;
    END LOOP;
  END IF;
  v_quote:=public.get_storefront_cart_quote_with_coupon(
    p_items,p_customer_city,v_code,p_customer_email,p_customer_phone
  );
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true THEN
    RETURN v_quote;
  END IF;
  IF v_quote->>'total' IS NULL OR v_quote->>'discount_total' IS NULL
     OR v_quote->>'coupon_discount_total' IS NULL OR v_quote->>'shipping' IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','QUOTE_INVALID','message','La cotización con cupón está incompleta. Vuelve a cargar el catálogo.');
  END IF;
  IF round((v_quote->>'total')::numeric,0)<>round(p_expected_total,0)
     OR round((v_quote->>'discount_total')::numeric,0)<>round(p_expected_discount_total,0)
     OR round((v_quote->>'coupon_discount_total')::numeric,0)<>round(p_expected_coupon_discount_total,0) THEN
    RETURN jsonb_build_object(
      'success',false,'quote_changed',true,'code','QUOTE_CHANGED',
      'message','El envío o el descuento cambió. Revisa el total actualizado y vuelve a confirmar; no se creó ningún pedido.',
      'shipping',v_quote->'shipping','total',v_quote->'total',
      'discount_total',v_quote->'discount_total','coupon_discount_total',v_quote->'coupon_discount_total'
    );
  END IF;

  IF v_code<>'' THEN
    v_reservation:=public.reserve_storefront_coupon_redemption(
      v_code,'cod',btrim(p_client_reference),p_customer_email,p_customer_phone,
      round((v_quote->>'coupon_discount_total')::numeric,0)::bigint
    );
    IF coalesce((v_reservation->>'success')::boolean,false) IS DISTINCT FROM true THEN
      RETURN v_reservation;
    END IF;
    IF coalesce((v_reservation->>'status'),'')<>'reserved' THEN
      RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_CONFLICT','message','La referencia ya tiene una reserva incompatible.');
    END IF;
  END IF;

  v_result:=public.create_contra_delivery_order(
    p_client_reference,p_customer_name,p_customer_cedula,p_customer_phone,p_customer_email,
    p_customer_city,p_customer_address,p_customer_neighborhood,p_items
  );
  IF v_result IS NULL OR jsonb_typeof(v_result) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_result->'success') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'La respuesta COD es nula o incompleta; la transacción fue revertida.';
  END IF;
  IF (v_result->>'success')::boolean IS NOT TRUE THEN
    IF v_code<>'' THEN
      IF EXISTS (
        SELECT 1 FROM public.web_orders AS w
         WHERE w.client_reference=btrim(p_client_reference)
      ) THEN
        RAISE EXCEPTION 'La RPC COD informó fallo pero dejó un pedido; se revierte para evitar una reserva inconsistente.';
      END IF;
      UPDATE public.storefront_coupon_redemptions
         SET expires_at=now(),updated_at=now()
       WHERE channel='cod' AND reference=btrim(p_client_reference) AND status='reserved';
    END IF;
    RETURN v_result;
  END IF;
  IF coalesce((v_result->>'duplicate')::boolean,false) THEN
    RAISE EXCEPTION 'El COD legacy devolvió duplicado después de la comprobación; la transacción fue revertida para revalidar el pedido existente.';
  END IF;
  v_order_id:=nullif(v_result->>'order_id','')::uuid;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'La respuesta COD no contiene un identificador de pedido; la transacción fue revertida.';
  END IF;
  IF v_result->>'total' IS NULL OR v_result->>'discount_total' IS NULL OR v_result->>'shipping' IS NULL THEN
    RAISE EXCEPTION 'La respuesta COD no contiene todos los importes; la transacción fue revertida.';
  END IF;
  -- Comprueba que la cotización que devolvió/guardó el RPC legacy corresponde
  -- a los mismos productos/combos/ajustes y que la cotización con cupón no cambió
  -- durante su ejecución. Cualquier TOCTOU revierte pedido, reserva y ledger.
  v_legacy_quote:=public.get_storefront_cart_quote(p_items,p_customer_city);
  IF coalesce((v_legacy_quote->>'success')::boolean,false) IS DISTINCT FROM true
     OR v_legacy_quote->>'total' IS NULL OR v_legacy_quote->>'discount_total' IS NULL
     OR v_legacy_quote->>'shipping' IS NULL
     OR round((v_result->>'total')::numeric,0)<>round((v_legacy_quote->>'total')::numeric,0)
     OR round((v_result->>'discount_total')::numeric,0)<>round((v_legacy_quote->>'discount_total')::numeric,0)
     OR round((v_result->>'shipping')::numeric,0)<>round((v_legacy_quote->>'shipping')::numeric,0) THEN
    RAISE EXCEPTION 'La cotización COD legacy no coincide con el quote actual sin cupón; se revierte la transacción.';
  END IF;
  v_verified_quote:=public.get_storefront_cart_quote_with_coupon(
    p_items,p_customer_city,v_code,p_customer_email,p_customer_phone
  );
  IF coalesce((v_verified_quote->>'success')::boolean,false) IS DISTINCT FROM true
     OR v_verified_quote->>'original_subtotal' IS NULL
     OR v_verified_quote->>'discount_total' IS NULL
     OR v_verified_quote->>'coupon_discount_total' IS NULL
     OR v_verified_quote->>'shipping' IS NULL OR v_verified_quote->>'total' IS NULL
     OR v_verified_quote->'items' IS DISTINCT FROM v_quote->'items'
     OR v_verified_quote->'discounts' IS DISTINCT FROM v_quote->'discounts'
     OR v_verified_quote->'coupon_id' IS DISTINCT FROM v_quote->'coupon_id'
     OR v_verified_quote->>'original_subtotal' IS DISTINCT FROM v_quote->>'original_subtotal'
     OR v_verified_quote->>'discount_total' IS DISTINCT FROM v_quote->>'discount_total'
     OR v_verified_quote->>'coupon_discount_total' IS DISTINCT FROM v_quote->>'coupon_discount_total'
     OR v_verified_quote->>'shipping' IS DISTINCT FROM v_quote->>'shipping'
     OR v_verified_quote->>'total' IS DISTINCT FROM v_quote->>'total' THEN
    RAISE EXCEPTION 'La cotización con cupón cambió durante el alta del pedido; se revierte la transacción.';
  END IF;

  UPDATE public.web_orders AS w
     SET original_subtotal=round((v_quote->>'original_subtotal')::numeric,0),
         discount_total=round((v_quote->>'discount_total')::numeric,0),
         shipping=round((v_quote->>'shipping')::numeric,0),
         total=round((v_quote->>'total')::numeric,0),
         items=v_quote->'items',
         coupon_id=nullif(v_quote->>'coupon_id','')::uuid,
         coupon_code=nullif(v_quote->>'coupon_code',''),
         coupon_discount_total=round(coalesce((v_quote->>'coupon_discount_total')::numeric,0),0)
   WHERE w.id=v_order_id AND w.client_reference=btrim(p_client_reference)
     AND w.payment_method='Contra entrega';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el pedido COD recién creado para persistir el cupón; la transacción fue revertida.';
  END IF;
  IF v_code<>'' THEN
    UPDATE public.storefront_coupon_redemptions AS r
       SET status='redeemed',redeemed_at=coalesce(r.redeemed_at,now()),updated_at=now()
     WHERE r.channel='cod' AND r.reference=btrim(p_client_reference)
       AND r.status='reserved' AND r.coupon_id=nullif(v_quote->>'coupon_id','')::uuid
       AND r.code=v_code AND r.discount_total=round((v_quote->>'coupon_discount_total')::numeric,0)::bigint;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se pudo consumir el ledger COD del cupón; la transacción fue revertida.';
    END IF;
  END IF;
  RETURN v_result||jsonb_build_object(
    'total',v_quote->'total','discount_total',v_quote->'discount_total',
    'coupon_id',v_quote->'coupon_id','coupon_code',v_quote->'coupon_code',
    'coupon_discount_total',v_quote->'coupon_discount_total',
    'shipping',v_quote->'shipping','items',v_quote->'items','quote',v_quote
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.create_contra_delivery_order_with_coupon(
  text,text,text,text,text,text,text,text,jsonb,text,numeric,numeric,numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_contra_delivery_order_with_coupon(
  text,text,text,text,text,text,text,text,jsonb,text,numeric,numeric,numeric
) TO anon,authenticated;

COMMENT ON TABLE public.storefront_coupons IS 'Cupones públicos; el ledger no expone identidades de clientes.';
COMMENT ON TABLE public.storefront_coupon_redemptions IS 'Reserva/consumo server-side; customer_hash nunca se devuelve a RPC administrativas.';
COMMENT ON COLUMN public.storefront_coupon_redemptions.customer_hash IS 'Hash SHA-256 server-side de email normalizado y teléfono reducido a dígitos; no contiene PII en claro.';

CREATE OR REPLACE FUNCTION public.reserve_storefront_wompi_checkout_lock(
  p_reference text,
  p_customer_phone text,
  p_cart_hash text,
  p_minutes integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_phone_hash text;
  v_row public.storefront_wompi_checkout_locks%ROWTYPE;
  v_expires_at timestamptz;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR v_phone !~ '^[0-9]{10}$'
     OR p_cart_hash IS NULL OR p_cart_hash !~ '^[0-9a-fA-F]{64}$'
     OR p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LOCK_INPUT_INVALID','message','No se pudo validar el intento de checkout.');
  END IF;
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  v_expires_at:=now()+make_interval(mins=>p_minutes+1);
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));

  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.reconciliation_required=true
   LIMIT 1 FOR UPDATE;
  IF FOUND OR EXISTS (
    SELECT 1 FROM public.orders AS o
     WHERE lower(o.payment_method)='wompi'
       AND (o.wompi_reconciliation_required=true OR o.coupon_reconciliation_required=true)
       AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
  ) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED',
      'message','Existe un pago que requiere revisión manual antes de iniciar otro checkout.');
  END IF;

  UPDATE public.storefront_wompi_checkout_locks AS l
     SET status='pending',expires_at='infinity',updated_at=now()
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='active' AND l.transaction_id IS NOT NULL;
  UPDATE public.storefront_wompi_checkout_locks AS l
     SET status='expired',updated_at=now()
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='active'
     AND l.expires_at<=now() AND l.transaction_id IS NULL;
  UPDATE public.storefront_wompi_checkout_locks AS l
     SET status='released',expires_at=now(),updated_at=now()
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='terminal_grace'
     AND l.terminal_at+interval '15 minutes'<=now();

  SELECT l.* INTO v_row
    FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='terminal_grace'
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success',false,'code','WOMPI_TERMINAL_GRACE','existing_reference',v_row.reference,
      'expires_at',v_row.terminal_at+interval '15 minutes',
      'message','El intento anterior terminó. Espera unos minutos antes de volver a iniciar un pago para evitar una aprobación tardía duplicada.'
    );
  END IF;

  SELECT l.* INTO v_row
    FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='pending'
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success',false,'code','WOMPI_TRANSACTION_PENDING','existing_reference',v_row.reference,
      'message','Hay una transacción Wompi pendiente para este teléfono; espera su confirmación antes de iniciar otro pago.'
    );
  END IF;

  SELECT l.* INTO v_row
    FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.status='active' AND l.expires_at>now()
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_row.reference<>v_reference THEN
      IF v_row.cart_hash=lower(p_cart_hash) THEN
        RETURN jsonb_build_object(
          'success',false,'code','WOMPI_ACTIVE_RESERVATION','existing_reference',v_row.reference,
          'expires_at',v_row.expires_at,'message','Ya existe una reserva activa para este carrito.'
        );
      END IF;
      RETURN jsonb_build_object(
        'success',false,'code','WOMPI_ACTIVE_OTHER_CART','existing_reference',v_row.reference,
        'expires_at',v_row.expires_at,'message','Ya hay un checkout activo para este teléfono con otro carrito.'
      );
    END IF;
    IF v_row.checkout_claimed_at IS NOT NULL AND v_row.checkout_claimed_at>now()-make_interval(mins=>p_minutes) THEN
      RETURN jsonb_build_object(
        'success',false,'code','WOMPI_CHECKOUT_ALREADY_PREPARED','existing_reference',v_row.reference,
        'expires_at',v_row.expires_at,'message','Este intento ya preparó una sesión Wompi. Espera a que venza antes de volver a iniciarla.'
      );
    END IF;
    UPDATE public.storefront_wompi_checkout_locks AS l
       SET expires_at=v_expires_at,checkout_claimed_at=NULL,updated_at=now()
     WHERE l.reference=v_reference;
    RETURN jsonb_build_object('success',true,'reference',v_reference,'expires_at',v_expires_at,'idempotent',true);
  END IF;

  SELECT l.* INTO v_row
    FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.reference=v_reference
   FOR UPDATE;
  IF FOUND THEN
    IF v_row.customer_phone_hash<>v_phone_hash OR v_row.cart_hash<>lower(p_cart_hash)
       OR v_row.status IN ('pending','completed') OR v_row.transaction_id IS NOT NULL THEN
      RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT','message','La referencia ya está asociada a otro intento o transacción.');
    END IF;
    UPDATE public.storefront_wompi_checkout_locks AS l
       SET customer_phone_hash=v_phone_hash,cart_hash=lower(p_cart_hash),status='active',expires_at=v_expires_at,
           checkout_claimed_at=NULL,transaction_id=NULL,updated_at=now()
     WHERE l.reference=v_reference;
    RETURN jsonb_build_object('success',true,'reference',v_reference,'expires_at',v_expires_at,'renewed',true);
  END IF;

  INSERT INTO public.storefront_wompi_checkout_locks(reference,customer_phone_hash,cart_hash,status,expires_at)
  VALUES(v_reference,v_phone_hash,lower(p_cart_hash),'active',v_expires_at);
  RETURN jsonb_build_object('success',true,'reference',v_reference,'expires_at',v_expires_at,'idempotent',false);
EXCEPTION WHEN unique_violation THEN
  SELECT l.* INTO v_row
    FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.customer_phone_hash=v_phone_hash AND l.status IN ('active','pending','terminal_grace')
   LIMIT 1;
  IF FOUND AND v_row.status='pending' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_PENDING','existing_reference',v_row.reference);
  ELSIF FOUND AND v_row.status='terminal_grace' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TERMINAL_GRACE','existing_reference',v_row.reference,'expires_at',v_row.terminal_at+interval '15 minutes');
  ELSIF FOUND AND v_row.status='active' AND v_row.cart_hash=lower(p_cart_hash) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_RESERVATION','existing_reference',v_row.reference,'expires_at',v_row.expires_at);
  ELSIF FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ACTIVE_OTHER_CART','existing_reference',v_row.reference,'expires_at',v_row.expires_at);
  END IF;
  RETURN jsonb_build_object('success',false,'code','WOMPI_REFERENCE_CONFLICT','message','No se pudo reservar una referencia única para el checkout.');
END;
$function$;
REVOKE ALL ON FUNCTION public.reserve_storefront_wompi_checkout_lock(text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_wompi_checkout_lock(text,text,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_storefront_wompi_checkout(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_row public.storefront_wompi_checkout_locks%ROWTYPE;
BEGIN
  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.reference=v_reference FOR UPDATE;
  IF NOT FOUND OR v_row.status<>'active' OR v_row.expires_at<=now() OR v_row.transaction_id IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LOCK_NOT_ACTIVE');
  END IF;
  IF v_row.checkout_claimed_at IS NOT NULL AND v_row.checkout_claimed_at>now()-interval '10 minutes' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_ALREADY_PREPARED');
  END IF;
  UPDATE public.storefront_wompi_checkout_locks AS l
     SET checkout_claimed_at=now(),updated_at=now()
   WHERE l.reference=v_reference;
  RETURN jsonb_build_object('success',true,'reference',v_reference,'claimed_at',now());
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_storefront_wompi_checkout(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_storefront_wompi_checkout(text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_storefront_wompi_checkout_state(
  p_reference text,
  p_state text,
  p_transaction_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_state text:=lower(btrim(coalesce(p_state,'')));
  v_transaction_id text:=nullif(btrim(coalesce(p_transaction_id,'')),'');
  v_other_reference text;
  v_phone text;
  v_phone_hash text;
  v_new_expires_at timestamptz;
  v_found boolean;
  v_row public.storefront_wompi_checkout_locks%ROWTYPE;
BEGIN
  IF v_state NOT IN ('pending','terminal_grace','completed','released') OR v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR (v_transaction_id IS NOT NULL AND v_transaction_id !~ '^[A-Za-z0-9_-]{1,120}$')
     OR (v_state IN ('pending','terminal_grace','completed') AND v_transaction_id IS NULL) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_LOCK_STATE_INVALID');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_reference));
  SELECT l.customer_phone_hash INTO v_phone_hash
    FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.reference=v_reference;
  v_found:=FOUND;
  IF v_found THEN
    PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  END IF;
  SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
   WHERE l.reference=v_reference FOR UPDATE;
  v_found:=FOUND;
  IF NOT v_found AND v_state IN ('pending','terminal_grace') THEN
    SELECT public._storefront_coupon_normalized_phone(o.phone) INTO v_phone
      FROM public.orders AS o
     WHERE o.reference=v_reference AND lower(o.payment_method)='wompi'
     LIMIT 1;
    IF v_phone ~ '^[0-9]{10}$' THEN
      v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
      PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
      v_new_expires_at:=CASE WHEN v_state='pending' THEN 'infinity'::timestamptz ELSE now()+interval '15 minutes' END;
      BEGIN
        INSERT INTO public.storefront_wompi_checkout_locks(
          reference,customer_phone_hash,cart_hash,status,expires_at,transaction_id,terminal_at
        ) VALUES(
          v_reference,v_phone_hash,repeat('0',64),v_state,v_new_expires_at,v_transaction_id,
          CASE WHEN v_state='terminal_grace' THEN now() ELSE NULL END
        );
        RETURN jsonb_build_object('success',true,'found',true,'state',v_state,'legacy_lock_created',true);
      EXCEPTION WHEN unique_violation THEN
        -- Another checkout may already own this phone. Preserve a tombstone so a
        -- later APPROVED event can be reconciled without violating the phone index.
        INSERT INTO public.storefront_wompi_checkout_locks(
          reference,customer_phone_hash,cart_hash,status,expires_at,transaction_id,terminal_at,reconciliation_required
        ) VALUES(
          v_reference,v_phone_hash,repeat('0',64),'released',now(),v_transaction_id,
          CASE WHEN v_state='terminal_grace' THEN now() ELSE NULL END,v_state='pending'
        ) ON CONFLICT (reference) DO NOTHING;
        SELECT l.* INTO v_row FROM public.storefront_wompi_checkout_locks AS l
         WHERE l.reference=v_reference;
        v_found:=FOUND;
        IF v_found THEN
          SELECT l.reference INTO v_other_reference
            FROM public.storefront_wompi_checkout_locks AS l
           WHERE l.customer_phone_hash=v_phone_hash AND l.reference<>v_reference
             AND l.status IN ('active','pending','terminal_grace')
           LIMIT 1;
          RETURN jsonb_build_object('success',true,'found',true,'state',v_row.status,
            'late_approval_conflict',v_state='pending' AND v_other_reference IS NOT NULL,
            'terminal_lock_conflict',v_state='terminal_grace' AND v_other_reference IS NOT NULL,
            'other_reference',v_other_reference);
        END IF;
      END;
    END IF;
  END IF;
  IF NOT v_found THEN RETURN jsonb_build_object('success',true,'found',false,'state',v_state); END IF;
  IF v_row.transaction_id IS NOT NULL AND v_transaction_id IS NOT NULL
     AND v_row.transaction_id<>v_transaction_id THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_LOCK_CONFLICT');
  END IF;
  IF v_row.transaction_id IS NOT NULL AND v_transaction_id IS NULL AND v_state='released' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TRANSACTION_LOCK_CONFLICT');
  END IF;
  IF v_state='terminal_grace' AND v_row.status<>'completed' AND v_row.terminal_at IS NOT NULL
     AND v_row.terminal_at+interval '15 minutes'<=now() THEN
    UPDATE public.storefront_wompi_checkout_locks AS l
       SET status='released',expires_at=now(),transaction_id=coalesce(v_transaction_id,l.transaction_id),updated_at=now()
     WHERE l.reference=v_reference;
    RETURN jsonb_build_object('success',true,'found',true,'state','released','grace_expired',true);
  END IF;
  IF v_state='pending' AND v_row.status IN ('released','expired') THEN
    SELECT l.reference INTO v_other_reference
      FROM public.storefront_wompi_checkout_locks AS l
     WHERE l.customer_phone_hash=v_row.customer_phone_hash
       AND l.reference<>v_reference AND l.status IN ('active','pending','terminal_grace')
     LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.storefront_wompi_checkout_locks AS l
         SET transaction_id=coalesce(v_transaction_id,l.transaction_id),
             reconciliation_required=true,updated_at=now()
       WHERE l.reference=v_reference;
      RETURN jsonb_build_object(
        'success',true,'found',true,'state',v_row.status,'late_approval_conflict',true,
        'other_reference',v_other_reference
      );
    END IF;
  END IF;
  IF v_state='terminal_grace' AND v_row.status IN ('released','expired') THEN
    SELECT l.reference INTO v_other_reference
      FROM public.storefront_wompi_checkout_locks AS l
     WHERE l.customer_phone_hash=v_row.customer_phone_hash
       AND l.reference<>v_reference AND l.status IN ('active','pending','terminal_grace')
     LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.storefront_wompi_checkout_locks AS l
         SET transaction_id=coalesce(v_transaction_id,l.transaction_id),
             terminal_at=coalesce(l.terminal_at,now()),updated_at=now()
       WHERE l.reference=v_reference;
      RETURN jsonb_build_object(
        'success',true,'found',true,'state',v_row.status,'terminal_lock_conflict',true,
        'other_reference',v_other_reference
      );
    END IF;
  END IF;
  IF v_row.reconciliation_required=true AND v_state IN ('completed','released','terminal_grace') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED',
      'state',v_row.status,'reconciliation_required',true);
  END IF;
  IF v_row.status='completed' AND v_state<>'completed' THEN
    RETURN jsonb_build_object('success',true,'found',true,'idempotent',true,'state','completed');
  END IF;
  UPDATE public.storefront_wompi_checkout_locks AS l
     SET status=v_state,
         transaction_id=coalesce(v_transaction_id,l.transaction_id),
         terminal_at=CASE WHEN v_state='terminal_grace' THEN coalesce(l.terminal_at,now()) ELSE l.terminal_at END,
         expires_at=CASE
           WHEN v_state='pending' THEN 'infinity'::timestamptz
           WHEN v_state='terminal_grace' THEN coalesce(l.terminal_at,now())+interval '15 minutes'
           ELSE now()
         END,
         updated_at=now()
   WHERE l.reference=v_reference;
  RETURN jsonb_build_object('success',true,'found',true,'state',v_state);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_storefront_wompi_checkout_state(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_storefront_wompi_checkout_state(text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_storefront_wompi_reconciliation(
  p_reference text,
  p_transaction_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_transaction_id text:=btrim(coalesce(p_transaction_id,''));
  v_phone text;
  v_phone_hash text;
  v_order_rows integer:=0;
  v_lock_rows integer:=0;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR v_transaction_id !~ '^[A-Za-z0-9_-]{1,120}$' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_INPUT_INVALID');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-reference:'||v_reference));
  SELECT public._storefront_coupon_normalized_phone(o.phone) INTO v_phone
    FROM public.orders AS o
   WHERE o.reference=v_reference AND lower(o.payment_method)='wompi'
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_ORDER_NOT_FOUND');
  END IF;
  IF v_phone ~ '^[0-9]{10}$' THEN
    v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
    PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  END IF;

  UPDATE public.orders AS o
     SET wompi_reconciliation_required=true,updated_at=now()
   WHERE o.reference=v_reference AND lower(o.payment_method)='wompi';
  GET DIAGNOSTICS v_order_rows = ROW_COUNT;

  UPDATE public.storefront_wompi_checkout_locks AS l
     SET reconciliation_required=true,updated_at=now()
   WHERE l.reference=v_reference;
  GET DIAGNOSTICS v_lock_rows = ROW_COUNT;

  RETURN jsonb_build_object('success',v_order_rows=1,'reference',v_reference,
    'order_flag_updated',v_order_rows=1,'lock_flag_updated',v_lock_rows=1,
    'lock_missing',v_lock_rows=0);
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_storefront_wompi_reconciliation(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_storefront_wompi_reconciliation(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_storefront_coupon_redemption(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_row public.storefront_coupon_redemptions%ROWTYPE;
BEGIN
  IF v_reference='' THEN RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_INVALID'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('storefront-coupon-reference:wompi:'||v_reference));
  SELECT r.* INTO v_row FROM public.storefront_coupon_redemptions AS r
   WHERE r.channel='wompi' AND r.reference=v_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'found',false); END IF;
  IF v_row.status='redeemed' OR v_row.status='released' THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_REFERENCE_FINAL','status',v_row.status);
  END IF;
  UPDATE public.storefront_coupon_redemptions AS r
     SET expires_at=now(),updated_at=now()
   WHERE r.id=v_row.id AND r.status='reserved';
  RETURN jsonb_build_object('success',true,'found',true,'status','reserved','expires_at',now());
END;
$function$;
REVOKE ALL ON FUNCTION public.expire_storefront_coupon_redemption(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_storefront_coupon_redemption(text) TO service_role;


-- Quote, lock pricing rules, and reserve stock/coupon as one transaction for Wompi.
-- The browser never supplies the authoritative discount or final total.
CREATE OR REPLACE FUNCTION public.prepare_storefront_wompi_checkout(
  p_reference text,
  p_items jsonb,
  p_city text,
  p_coupon_code text,
  p_customer_email text,
  p_customer_phone text,
  p_expected_quote jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp'
AS $function$
DECLARE
  v_reference text:=btrim(coalesce(p_reference,''));
  v_code text:=upper(btrim(coalesce(p_coupon_code,'')));
  v_quote jsonb;
  v_inventory jsonb;
  v_coupon_reservation jsonb;
  v_expires_at timestamptz;
  v_total numeric;
  v_expected_total numeric;
  v_discount_total numeric;
  v_expected_discount_total numeric;
  v_coupon_discount_total numeric;
  v_expected_coupon_discount_total numeric;
  v_shipping numeric;
  v_expected_shipping numeric;
  v_original_subtotal numeric;
  v_expected_original_subtotal numeric;
  v_discounted_subtotal numeric;
  v_expected_discounted_subtotal numeric;
  v_product_lock_id public.products.id%TYPE;
  v_phone text:=public._storefront_coupon_normalized_phone(p_customer_phone);
  v_phone_hash text;
BEGIN
  IF v_reference !~ '^[A-Za-z0-9_-]{1,120}$'
     OR v_code !~ '^(|[A-Z0-9][A-Z0-9_-]{0,63})$'
     OR v_phone !~ '^[0-9]{10}$' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_INPUT_INVALID','message','No se pudo validar la referencia, carrito o cupón.');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_INPUT_INVALID','message','El carrito debe ser una lista JSON válida.');
  END IF;
  IF jsonb_array_length(p_items)=0 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_CHECKOUT_INPUT_INVALID','message','El carrito está vacío.');
  END IF;
  IF p_expected_quote IS NULL OR jsonb_typeof(p_expected_quote) IS DISTINCT FROM 'object'
     OR p_expected_quote->>'success' IS DISTINCT FROM 'true'
     OR p_expected_quote->>'original_subtotal' IS NULL
     OR p_expected_quote->>'discounted_subtotal' IS NULL
     OR p_expected_quote->>'discount_total' IS NULL
     OR p_expected_quote->>'coupon_discount_total' IS NULL
     OR p_expected_quote->>'shipping' IS NULL
     OR p_expected_quote->>'total' IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID','message','La cotización inicial está incompleta. No se reservó inventario ni cupón.');
  END IF;
  IF jsonb_typeof(p_expected_quote->'items') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID','message','La cotización inicial no contiene líneas válidas. No se reservó inventario ni cupón.');
  END IF;
  IF jsonb_array_length(p_expected_quote->'items')=0 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID','message','La cotización inicial no contiene productos. No se reservó inventario ni cupón.');
  END IF;

  -- Serialize against the phone-level reconciliation marker before pricing locks.
  v_phone_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtext('storefront-wompi-phone:'||v_phone_hash));
  IF EXISTS (
    SELECT 1 FROM public.orders AS o
     WHERE lower(o.payment_method)='wompi'
       AND (o.wompi_reconciliation_required=true OR o.coupon_reconciliation_required=true)
       AND public._storefront_coupon_normalized_phone(o.phone)=v_phone
  ) OR EXISTS (
    SELECT 1 FROM public.storefront_wompi_checkout_locks AS l
     WHERE l.customer_phone_hash=v_phone_hash AND l.reconciliation_required=true
  ) THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_RECONCILIATION_REQUIRED',
      'message','Existe un pago que requiere revisión manual antes de iniciar otro checkout.');
  END IF;

  -- Then lock settings, combo/shipping tables, sorted products, and finally the coupon.
  PERFORM 1 FROM public.storefront_shipping_settings AS s WHERE s.id=1 FOR SHARE;
  LOCK TABLE public.storefront_product_combos IN SHARE MODE;
  LOCK TABLE public.storefront_shipping_rules IN SHARE MODE;
  LOCK TABLE public.storefront_shipping_rule_destinations IN SHARE MODE;
  FOR v_product_lock_id IN
    SELECT DISTINCT p.id
      FROM public.products AS p
      JOIN jsonb_array_elements(p_items) AS requested(item)
        ON p.id::text=requested.item->>'id'
     ORDER BY p.id
  LOOP
    PERFORM 1 FROM public.products AS p
     WHERE p.id=v_product_lock_id
     FOR NO KEY UPDATE OF p;
  END LOOP;
  IF v_code<>'' THEN
    PERFORM 1 FROM public.storefront_coupons AS c WHERE c.code=v_code FOR UPDATE;
  END IF;

  -- Identity is deliberately blank for the public quote. The reservation RPC hashes it server-side.
  v_quote:=public.get_storefront_cart_quote_with_coupon(p_items,p_city,v_code,'','');
  IF coalesce((v_quote->>'success')::boolean,false) IS DISTINCT FROM true
     OR v_quote->'items' IS NULL OR jsonb_typeof(v_quote->'items') IS DISTINCT FROM 'array'
     OR v_quote->>'original_subtotal' IS NULL OR v_quote->>'discounted_subtotal' IS NULL
     OR v_quote->>'discount_total' IS NULL OR v_quote->>'coupon_discount_total' IS NULL
     OR v_quote->>'shipping' IS NULL OR v_quote->>'total' IS NULL THEN
    RETURN jsonb_build_object('success',false,'code',coalesce(v_quote->>'code','WOMPI_QUOTE_INVALID'),
      'message',coalesce(v_quote->>'message','No se pudo validar el total vigente del carrito.'),'quote',v_quote);
  END IF;

  v_original_subtotal:=round((v_quote->>'original_subtotal')::numeric,0);
  v_discounted_subtotal:=round((v_quote->>'discounted_subtotal')::numeric,0);
  v_discount_total:=round((v_quote->>'discount_total')::numeric,0);
  v_coupon_discount_total:=round((v_quote->>'coupon_discount_total')::numeric,0);
  v_shipping:=round((v_quote->>'shipping')::numeric,0);
  v_total:=round((v_quote->>'total')::numeric,0);
  v_expected_original_subtotal:=round((p_expected_quote->>'original_subtotal')::numeric,0);
  v_expected_discounted_subtotal:=round((p_expected_quote->>'discounted_subtotal')::numeric,0);
  v_expected_discount_total:=round((p_expected_quote->>'discount_total')::numeric,0);
  v_expected_coupon_discount_total:=round((p_expected_quote->>'coupon_discount_total')::numeric,0);
  v_expected_shipping:=round((p_expected_quote->>'shipping')::numeric,0);
  v_expected_total:=round((p_expected_quote->>'total')::numeric,0);

  IF v_original_subtotal<>v_expected_original_subtotal
     OR v_discounted_subtotal<>v_expected_discounted_subtotal
     OR v_discount_total<>v_expected_discount_total
     OR v_coupon_discount_total<>v_expected_coupon_discount_total
     OR v_shipping<>v_expected_shipping
     OR v_total<>v_expected_total
     OR v_quote->'items' IS DISTINCT FROM p_expected_quote->'items'
     OR v_quote->'discounts' IS DISTINCT FROM p_expected_quote->'discounts'
     OR v_quote->'coupon_id' IS DISTINCT FROM p_expected_quote->'coupon_id'
     OR v_quote->'coupon_code' IS DISTINCT FROM p_expected_quote->'coupon_code'
     OR coalesce(v_quote->>'currency','COP') IS DISTINCT FROM coalesce(p_expected_quote->>'currency','COP') THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_CHANGED','message','El precio, descuento, cupón o envío cambió durante la preparación. Revisa el nuevo total antes de confirmar.',
      'quote',v_quote,'total',v_total,'shipping',v_shipping,'discount_total',v_discount_total,'coupon_discount_total',v_coupon_discount_total);
  END IF;
  IF v_total<=0 THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_TOTAL_NOT_POSITIVE','message','Wompi no admite un total de cero. No se reservó inventario ni cupón.','quote',v_quote);
  END IF;
  IF v_total<>v_discounted_subtotal+v_shipping
     OR v_discounted_subtotal<>v_original_subtotal-v_discount_total
     OR v_discount_total<0 OR v_discount_total>v_original_subtotal
     OR v_coupon_discount_total<0 OR v_coupon_discount_total>v_discount_total THEN
    RETURN jsonb_build_object('success',false,'code','WOMPI_QUOTE_INVALID','message','La cotización vigente no concilia sus importes. No se reservó inventario ni cupón.');
  END IF;
  IF v_code<>'' AND v_coupon_discount_total<=0 THEN
    RETURN jsonb_build_object('success',false,'code','COUPON_NO_DISCOUNT','message','El cupón no genera un descuento aplicable a este carrito.');
  END IF;

  v_inventory:=public.reserve_order_inventory(v_reference,p_items,10);
  IF coalesce((v_inventory->>'success')::boolean,false) IS DISTINCT FROM true THEN
    PERFORM public.release_inventory_reservation(v_reference);
    RETURN jsonb_build_object('success',false,'code',coalesce(v_inventory->>'code','WOMPI_INVENTORY_RESERVATION_FAILED'),
      'message',coalesce(v_inventory->>'message','No hay suficientes unidades disponibles.'));
  END IF;
  v_expires_at:=nullif(v_inventory->>'expires_at','')::timestamptz;
  IF v_expires_at IS NULL OR v_expires_at<=now()+interval '5 seconds' OR v_expires_at>now()+interval '10 minutes' THEN
    PERFORM public.release_inventory_reservation(v_reference);
    RETURN jsonb_build_object('success',false,'code','WOMPI_INVENTORY_EXPIRY_INVALID','message','La reserva de inventario no tiene una expiración válida.');
  END IF;

  IF v_code<>'' THEN
    v_coupon_reservation:=public.reserve_storefront_coupon_redemption(
      v_code,'wompi',v_reference,p_customer_email,p_customer_phone,v_coupon_discount_total::bigint,v_expires_at
    );
    IF coalesce((v_coupon_reservation->>'success')::boolean,false) IS DISTINCT FROM true
       OR v_coupon_reservation->>'status' IS DISTINCT FROM 'reserved'
       OR coalesce((v_coupon_reservation->>'discount_total')::numeric,-1)<>v_coupon_discount_total THEN
      PERFORM public.release_inventory_reservation(v_reference);
      RETURN coalesce(v_coupon_reservation,'{}'::jsonb)||jsonb_build_object('success',false);
    END IF;
  END IF;

  RETURN jsonb_build_object('success',true,'reference',v_reference,'quote',v_quote,'expires_at',v_expires_at,
    'coupon_reserved',v_code<>'');
END;
$function$;
REVOKE ALL ON FUNCTION public.prepare_storefront_wompi_checkout(text,jsonb,text,text,text,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_storefront_wompi_checkout(text,jsonb,text,text,text,text,jsonb)
  TO service_role;
