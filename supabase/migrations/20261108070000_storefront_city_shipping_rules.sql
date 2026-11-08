-- Fase 2: reglas de envío opcionales por ciudad o zona.
-- La tarifa general existente sigue siendo el fallback; Cali permanece gratis.
-- No se actualizan pedidos, reservas ni inventario históricos.

CREATE TABLE public.storefront_shipping_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('city','zone')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 1000),
  shipping_cost bigint NOT NULL CHECK (shipping_cost BETWEEN 0 AND 5000000),
  free_shipping_threshold bigint CHECK (
    free_shipping_threshold IS NULL OR free_shipping_threshold BETWEEN 1 AND 50000000
  ),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.storefront_shipping_rule_destinations (
  rule_id uuid NOT NULL REFERENCES public.storefront_shipping_rules(id) ON DELETE CASCADE,
  destination text NOT NULL CHECK (length(btrim(destination)) BETWEEN 1 AND 80),
  destination_key text NOT NULL CHECK (length(btrim(destination_key)) BETWEEN 1 AND 80),
  PRIMARY KEY (rule_id,destination_key)
);

CREATE INDEX storefront_shipping_rules_enabled_priority_idx
  ON public.storefront_shipping_rules(enabled,scope,priority DESC,id);
CREATE INDEX storefront_shipping_rule_destinations_key_idx
  ON public.storefront_shipping_rule_destinations(destination_key,rule_id);

ALTER TABLE public.storefront_shipping_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_shipping_rule_destinations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storefront_shipping_rules FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.storefront_shipping_rule_destinations FROM PUBLIC,anon,authenticated,service_role;

-- Normalización Unicode canónica equivalente a String.normalize('NFD') en navegador:
-- quita todas las marcas diacríticas, puntuación simple y espacios repetidos.
CREATE OR REPLACE FUNCTION public.normalize_storefront_delivery_city(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT btrim(regexp_replace(
    regexp_replace(normalize(lower(btrim(coalesce(p_value,''))),NFD),U&'[\0300-\036f]','','g'),
    '[[:space:],.]+',' ','g'
  ));
$function$;
REVOKE ALL ON FUNCTION public.normalize_storefront_delivery_city(text) FROM PUBLIC,anon,authenticated,service_role;

-- Mantiene la firma actual y agrega únicamente destinos activos a la respuesta.
CREATE OR REPLACE FUNCTION public.get_public_storefront_shipping_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_row public.storefront_shipping_settings%ROWTYPE;
  v_rules jsonb;
BEGIN
  SELECT * INTO v_row FROM public.storefront_shipping_settings WHERE id=1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','La configuración de envíos no está disponible.');
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id',active_rules.id,
      'scope',active_rules.scope,
      'name',active_rules.name,
      'priority',active_rules.priority,
      'shipping_cost',active_rules.shipping_cost,
      'free_shipping_threshold',active_rules.free_shipping_threshold,
      'destinations',active_rules.destinations
    ) ORDER BY CASE WHEN active_rules.scope='city' THEN 0 ELSE 1 END,
                     active_rules.priority DESC,active_rules.id
  ),'[]'::jsonb)
  INTO v_rules
  FROM (
    SELECT r.id,r.scope,r.name,r.priority,r.shipping_cost,r.free_shipping_threshold,
           coalesce(array_agg(d.destination ORDER BY d.destination_key),ARRAY[]::text[]) AS destinations
      FROM public.storefront_shipping_rules AS r
      LEFT JOIN public.storefront_shipping_rule_destinations AS d ON d.rule_id=r.id
     WHERE r.enabled=true
     GROUP BY r.id,r.scope,r.name,r.priority,r.shipping_cost,r.free_shipping_threshold
     ORDER BY CASE WHEN r.scope='city' THEN 0 ELSE 1 END,r.priority DESC,r.id
     LIMIT 500
  ) AS active_rules;

  RETURN jsonb_build_object(
    'success',true,
    'national_shipping_cost',v_row.national_shipping_cost,
    'free_shipping_threshold',v_row.free_shipping_threshold,
    'free_shipping_in_cali',true,
    'destination_rules',v_rules,
    'updated_at',v_row.updated_at
  );
END
$function$;
REVOKE ALL ON FUNCTION public.get_public_storefront_shipping_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_shipping_settings() TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_list_storefront_shipping_rules()
RETURNS TABLE(
  id uuid,
  scope text,
  name text,
  priority integer,
  shipping_cost bigint,
  free_shipping_threshold bigint,
  enabled boolean,
  destinations text[],
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF coalesce(public.is_store_admin(),false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Este usuario no está autorizado para consultar las reglas de envío.' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT r.id,r.scope,r.name,r.priority,r.shipping_cost,r.free_shipping_threshold,r.enabled,
         coalesce(array_agg(d.destination ORDER BY d.destination_key)
           FILTER (WHERE d.destination IS NOT NULL),ARRAY[]::text[]),r.updated_at
    FROM public.storefront_shipping_rules AS r
    LEFT JOIN public.storefront_shipping_rule_destinations AS d ON d.rule_id=r.id
   GROUP BY r.id,r.scope,r.name,r.priority,r.shipping_cost,r.free_shipping_threshold,r.enabled,r.updated_at
   ORDER BY r.enabled DESC,CASE WHEN r.scope='city' THEN 0 ELSE 1 END,r.priority DESC,r.name,r.id;
END
$function$;
REVOKE ALL ON FUNCTION public.admin_list_storefront_shipping_rules() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_storefront_shipping_rules() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_storefront_shipping_rule(
  p_rule_id uuid,
  p_scope text,
  p_name text,
  p_destinations text[],
  p_shipping_cost bigint,
  p_free_shipping_threshold bigint,
  p_priority integer,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_scope text:=lower(btrim(coalesce(p_scope,'')));
  v_name text:=btrim(coalesce(p_name,''));
  v_destination text;
  v_key text;
  v_destinations text[]:=ARRAY[]::text[];
  v_keys text[]:=ARRAY[]::text[];
  v_existing record;
BEGIN
  IF coalesce(public.is_store_admin(),false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Este usuario no está autorizado para modificar las reglas de envío.' USING ERRCODE='42501';
  END IF;
  -- Serializa cambios de destinos antes de comprobar conflictos activos.
  PERFORM 1 FROM public.storefront_shipping_settings WHERE id=1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La configuración general de envíos no está disponible.' USING ERRCODE='55000';
  END IF;
  IF v_scope NOT IN ('city','zone') THEN
    RAISE EXCEPTION 'Selecciona una regla por ciudad o por zona.' USING ERRCODE='22023';
  END IF;
  IF length(v_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'El nombre de la regla debe tener entre 1 y 80 caracteres.' USING ERRCODE='22023';
  END IF;
  IF p_shipping_cost IS NULL OR p_shipping_cost NOT BETWEEN 0 AND 5000000 THEN
    RAISE EXCEPTION 'La tarifa debe estar entre $0 y $5.000.000.' USING ERRCODE='22023';
  END IF;
  IF p_free_shipping_threshold IS NOT NULL AND p_free_shipping_threshold NOT BETWEEN 1 AND 50000000 THEN
    RAISE EXCEPTION 'El umbral debe estar entre $1 y $50.000.000 o quedar desactivado.' USING ERRCODE='22023';
  END IF;
  IF p_priority IS NULL OR p_priority NOT BETWEEN 0 AND 1000 THEN
    RAISE EXCEPTION 'La prioridad debe estar entre 0 y 1.000.' USING ERRCODE='22023';
  END IF;
  IF p_destinations IS NULL OR cardinality(p_destinations)<1 OR cardinality(p_destinations)>50 THEN
    RAISE EXCEPTION 'Indica entre 1 y 50 ciudades o alias, uno por línea.' USING ERRCODE='22023';
  END IF;
  IF v_scope='zone' AND cardinality(p_destinations)<2 THEN
    RAISE EXCEPTION 'Una zona debe incluir al menos dos destinos.' USING ERRCODE='22023';
  END IF;
  IF p_rule_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.storefront_shipping_rules WHERE id=p_rule_id
  ) THEN
    RAISE EXCEPTION 'La regla que intentas editar ya no existe.' USING ERRCODE='22023';
  END IF;

  FOR v_destination IN SELECT btrim(value) FROM unnest(p_destinations) AS x(value) LOOP
    v_key:=public.normalize_storefront_delivery_city(v_destination);
    IF length(v_destination) NOT BETWEEN 1 AND 80 OR length(v_key) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'Cada destino debe tener entre 1 y 80 caracteres.' USING ERRCODE='22023';
    END IF;
    IF v_key IN ('cali','santiago de cali','cali valle del cauca') THEN
      RAISE EXCEPTION 'Cali y sus alias conservan envío gratis y no se pueden asignar a una tarifa.' USING ERRCODE='22023';
    END IF;
    IF v_key=ANY(v_keys) THEN
      RAISE EXCEPTION 'La lista contiene destinos duplicados después de normalizarlos.' USING ERRCODE='22023';
    END IF;
    v_keys:=array_append(v_keys,v_key);
    v_destinations:=array_append(v_destinations,v_destination);
  END LOOP;

  -- Una ciudad solo puede resolver a una regla city activa. Las zonas pueden
  -- solaparse; el checkout las resuelve por prioridad y luego por UUID estable.
  IF coalesce(p_enabled,false) AND v_scope='city' AND EXISTS(
    SELECT 1
      FROM public.storefront_shipping_rule_destinations AS d
      JOIN public.storefront_shipping_rules AS r ON r.id=d.rule_id
     WHERE r.enabled=true AND r.scope='city'
       AND (p_rule_id IS NULL OR r.id<>p_rule_id)
       AND d.destination_key=ANY(v_keys)
  ) THEN
    RAISE EXCEPTION 'Un destino ya pertenece a otra regla activa por ciudad.' USING ERRCODE='23505';
  END IF;
  IF p_rule_id IS NULL AND (SELECT count(*) FROM public.storefront_shipping_rules)>=500 THEN
    RAISE EXCEPTION 'Se alcanzó el límite de 500 reglas de envío.' USING ERRCODE='54000';
  END IF;

  v_id:=coalesce(p_rule_id,gen_random_uuid());
  IF p_rule_id IS NULL THEN
    INSERT INTO public.storefront_shipping_rules(
      id,scope,name,priority,shipping_cost,free_shipping_threshold,enabled,created_at,updated_at,updated_by
    ) VALUES (
      v_id,v_scope,v_name,p_priority,p_shipping_cost,p_free_shipping_threshold,coalesce(p_enabled,false),now(),now(),auth.uid()
    );
  ELSE
    UPDATE public.storefront_shipping_rules
       SET scope=v_scope,name=v_name,priority=p_priority,shipping_cost=p_shipping_cost,
           free_shipping_threshold=p_free_shipping_threshold,enabled=coalesce(p_enabled,false),
           updated_at=now(),updated_by=auth.uid()
     WHERE id=v_id;
  END IF;

  DELETE FROM public.storefront_shipping_rule_destinations WHERE rule_id=v_id;
  INSERT INTO public.storefront_shipping_rule_destinations(rule_id,destination,destination_key)
  SELECT v_id,source.destination,source.destination_key
    FROM unnest(v_destinations,v_keys) AS source(destination,destination_key);

  UPDATE public.storefront_shipping_settings
     SET updated_at=now(),updated_by=auth.uid()
   WHERE id=1;

  RETURN jsonb_build_object(
    'success',true,
    'rule_id',v_id,
    'message',CASE WHEN coalesce(p_enabled,false) THEN 'Regla de envío guardada y activa.' ELSE 'Regla guardada como inactiva.' END
  );
END
$function$;
REVOKE ALL ON FUNCTION public.admin_save_storefront_shipping_rule(uuid,text,text,text[],bigint,bigint,integer,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_storefront_shipping_rule(uuid,text,text,text[],bigint,bigint,integer,boolean) TO authenticated;

-- Extiende la cotización existente, sin cambiar su firma ni la lógica de combos.
-- El fallback sigue leyendo storefront_shipping_settings; Cali nunca recibe tarifa.
CREATE OR REPLACE FUNCTION public.get_storefront_cart_quote(p_items jsonb, p_city text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_input jsonb; v_product public.products%ROWTYPE; v_line_count integer:=0; v_qty integer;
  v_owner_id uuid; v_city text:=btrim(coalesce(p_city,'')); v_base numeric(14,2):=0;
  v_discount numeric(14,2):=0; v_subtotal numeric(14,2):=0; v_shipping numeric(14,2):=0; v_total numeric(14,2):=0;
  v_ids uuid[]:=ARRAY[]::uuid[]; v_names text[]:=ARRAY[]::text[]; v_codes text[]:=ARRAY[]::text[];
  v_categories text[]:=ARRAY[]::text[]; v_prices numeric[]:=ARRAY[]::numeric[]; v_qtys integer[]:=ARRAY[]::integer[];
  v_remaining integer[]:=ARRAY[]::integer[]; v_line_discounts numeric[]:=ARRAY[]::numeric[];
  v_colors text[]:=ARRAY[]::text[]; v_sizes text[]:=ARRAY[]::text[];
  v_rule record; v_n integer; i integer; j integer; v_is_a boolean; v_is_b boolean; v_units integer;
  v_pair_total numeric(14,2); v_save_per_pair numeric(14,2); v_share_a numeric(14,2); v_share_b numeric(14,2);
  v_rule_units integer; v_rule_discount numeric(14,2); v_applied jsonb:='[]'::jsonb; v_item_json jsonb:='[]'::jsonb;
  v_original_line numeric(14,2); v_net_line numeric(14,2); v_normalized_city text;
  v_national_shipping_cost bigint; v_free_shipping_threshold bigint;
  v_shipping_rule_id uuid; v_shipping_rule_scope text; v_shipping_rule_name text;
  v_destination_status text; v_resolved_shipping_cost bigint; v_resolved_threshold bigint;
BEGIN
  SELECT s.admin_user_id INTO v_owner_id FROM public.store_settings AS s WHERE s.id=1;
  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'message','La tienda no tiene administrador configurado.');
  END IF;
  IF v_city='' THEN
    RETURN jsonb_build_object('success',false,'message','Selecciona tu ciudad para calcular el envío correctamente.');
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)<1 OR jsonb_array_length(p_items)>50 THEN
    RETURN jsonb_build_object('success',false,'message','El carrito debe contener de 1 a 50 líneas.');
  END IF;
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_items) AS x(value) LOOP
    IF coalesce(btrim(v_input->>'id'),'')='' THEN RETURN jsonb_build_object('success',false,'message','Una línea no contiene identificador de producto.'); END IF;
    v_qty:=coalesce((v_input->>'qty')::integer,0);
    IF v_qty<1 OR v_qty>100 THEN RETURN jsonb_build_object('success',false,'message','La cantidad de una línea no es válida.'); END IF;
    SELECT * INTO v_product FROM public.products p WHERE p.id=(v_input->>'id')::uuid AND p.user_id=v_owner_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'message','Uno de los productos ya no existe.'); END IF;
    IF v_product.sale_price IS NULL OR v_product.sale_price<0 THEN RETURN jsonb_build_object('success',false,'message','El precio guardado de un producto no es válido.'); END IF;
    v_ids:=array_append(v_ids,v_product.id);v_names:=array_append(v_names,coalesce(v_product.name,'Producto'));
    v_codes:=array_append(v_codes,coalesce(v_product.code,''));v_categories:=array_append(v_categories,coalesce(v_product.category,''));
    v_prices:=array_append(v_prices,v_product.sale_price::numeric);v_qtys:=array_append(v_qtys,v_qty);v_remaining:=array_append(v_remaining,v_qty);
    v_line_discounts:=array_append(v_line_discounts,0::numeric);v_colors:=array_append(v_colors,btrim(coalesce(v_input->>'color','')));v_sizes:=array_append(v_sizes,btrim(coalesce(v_input->>'size','')));
    v_base:=v_base+(v_product.sale_price::numeric*v_qty);v_line_count:=v_line_count+1;
  END LOOP;
  v_n:=array_length(v_ids,1);
  FOR v_rule IN
    SELECT c.* FROM public.storefront_product_combos c
    WHERE c.enabled=true AND c.discount_type<>'none'
      AND (c.start_at IS NULL OR c.start_at<=now()) AND (c.end_at IS NULL OR c.end_at>now())
    ORDER BY c.created_at ASC,c.id ASC
  LOOP
    v_rule_units:=0;v_rule_discount:=0;
    FOR i IN 1..v_n LOOP
      IF v_remaining[i]<=0 THEN CONTINUE; END IF;
      IF v_rule.rule_type='product_pair' THEN v_is_a:=v_ids[i]=v_rule.product_a_id;
      ELSE v_is_a:=public.sirevya_normalize_combo_category(v_categories[i])=public.sirevya_normalize_combo_category(v_rule.category_a); END IF;
      IF NOT v_is_a THEN CONTINUE; END IF;
      FOR j IN 1..v_n LOOP
        IF i=j OR v_remaining[j]<=0 THEN CONTINUE; END IF;
        IF v_rule.rule_type='product_pair' THEN v_is_b:=v_ids[j]=v_rule.product_b_id;
        ELSE v_is_b:=public.sirevya_normalize_combo_category(v_categories[j])=public.sirevya_normalize_combo_category(v_rule.category_b); END IF;
        IF NOT v_is_b THEN CONTINUE; END IF;
        v_pair_total:=v_prices[i]+v_prices[j];
        IF v_pair_total<=0 THEN CONTINUE; END IF;
        IF v_rule.discount_type='percent' THEN v_save_per_pair:=round(v_pair_total*least(100,coalesce(v_rule.discount_value,0))/100,0);
        ELSIF v_rule.discount_type='fixed_amount' THEN v_save_per_pair:=least(v_pair_total,coalesce(v_rule.discount_value,0));
        ELSIF v_rule.discount_type='combo_price' THEN v_save_per_pair:=greatest(0,v_pair_total-coalesce(v_rule.combo_price,0));
        ELSE v_save_per_pair:=0; END IF;
        v_save_per_pair:=least(v_pair_total,greatest(0,v_save_per_pair));
        IF v_save_per_pair<=0 THEN CONTINUE; END IF;
        v_units:=least(v_remaining[i],v_remaining[j]);
        v_share_a:=round(v_save_per_pair*v_prices[i]/v_pair_total,0);
        v_share_b:=v_save_per_pair-v_share_a;
        v_line_discounts[i]:=v_line_discounts[i]+v_share_a*v_units;
        v_line_discounts[j]:=v_line_discounts[j]+v_share_b*v_units;
        v_remaining[i]:=v_remaining[i]-v_units;v_remaining[j]:=v_remaining[j]-v_units;
        v_rule_units:=v_rule_units+v_units;v_rule_discount:=v_rule_discount+(v_save_per_pair*v_units);
      END LOOP;
    END LOOP;
    IF v_rule_discount>0 THEN
      v_applied:=v_applied||jsonb_build_array(jsonb_build_object(
        'id',v_rule.id,'title',v_rule.title,'rule_type',v_rule.rule_type,'category_a',v_rule.category_a,'category_b',v_rule.category_b,
        'discount_type',v_rule.discount_type,'discount_value',v_rule.discount_value,'combo_price',v_rule.combo_price,
        'units',v_rule_units,'discount_total',v_rule_discount));
    END IF;
  END LOOP;
  FOR i IN 1..v_n LOOP
    v_original_line:=v_prices[i]*v_qtys[i];v_line_discounts[i]:=least(v_original_line,greatest(0,v_line_discounts[i]));
    v_net_line:=greatest(0,v_original_line-v_line_discounts[i]);v_discount:=v_discount+v_line_discounts[i];
    v_item_json:=v_item_json||jsonb_build_array(jsonb_build_object(
      'id',v_ids[i]::text,'name',v_names[i],'code',v_codes[i],'category',v_categories[i],
      'qty',v_qtys[i],'price',v_prices[i],'color',v_colors[i],'size',v_sizes[i],
      'original_subtotal',v_original_line,'discount_total',v_line_discounts[i],'net_subtotal',v_net_line));
  END LOOP;
  v_subtotal:=greatest(0,v_base-v_discount);
  v_normalized_city:=public.normalize_storefront_delivery_city(v_city);

  -- La fila singleton sincroniza las ediciones de tarifa con cotizaciones COD.
  SELECT s.national_shipping_cost,s.free_shipping_threshold
    INTO v_national_shipping_cost,v_free_shipping_threshold
    FROM public.storefront_shipping_settings AS s WHERE s.id=1 FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'message','La configuración de envíos no está disponible.');
  END IF;

  IF v_normalized_city IN ('cali','santiago de cali','cali valle del cauca') THEN
    v_shipping:=0;
    v_destination_status:='cali_free';
    v_shipping_rule_name:='Envío gratis en Cali';
    v_resolved_shipping_cost:=0;
    v_resolved_threshold:=NULL;
  ELSE
    SELECT r.id,r.scope,r.name,r.shipping_cost,r.free_shipping_threshold
      INTO v_shipping_rule_id,v_shipping_rule_scope,v_shipping_rule_name,v_resolved_shipping_cost,v_resolved_threshold
      FROM public.storefront_shipping_rule_destinations AS d
      JOIN public.storefront_shipping_rules AS r ON r.id=d.rule_id
     WHERE d.destination_key=v_normalized_city AND r.enabled=true
     ORDER BY CASE WHEN r.scope='city' THEN 0 ELSE 1 END,r.priority DESC,r.id
     LIMIT 1
     FOR SHARE OF r;

    IF FOUND THEN
      v_destination_status:='matched_'||v_shipping_rule_scope;
    ELSE
      v_destination_status:='fallback';
      v_shipping_rule_name:='Tarifa general';
      v_resolved_shipping_cost:=v_national_shipping_cost;
      v_resolved_threshold:=v_free_shipping_threshold;
    END IF;

    IF v_resolved_threshold IS NOT NULL AND v_subtotal>=v_resolved_threshold THEN
      v_shipping:=0;
    ELSE
      v_shipping:=v_resolved_shipping_cost;
    END IF;
  END IF;

  v_total:=v_subtotal+v_shipping;
  RETURN jsonb_build_object(
    'success',true,'original_subtotal',v_base,'discount_total',v_discount,'discounted_subtotal',v_subtotal,
    'shipping',v_shipping,'total',v_total,'items',v_item_json,'discounts',v_applied,'currency','COP',
    'normalized_city',v_normalized_city,'destination_status',v_destination_status,
    'shipping_rule_id',v_shipping_rule_id,'shipping_rule_scope',v_shipping_rule_scope,
    'shipping_rule_name',v_shipping_rule_name,'shipping_rule_cost',v_resolved_shipping_cost,
    'shipping_rule_threshold',v_resolved_threshold
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success',false,'message','El carrito contiene un identificador o una cantidad no válida.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success',false,'message','No se pudo calcular el total del carrito. Verifica los productos y las promociones.');
END
$function$;
REVOKE ALL ON FUNCTION public.get_storefront_cart_quote(jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote(jsonb,text) TO anon,authenticated,service_role;
