-- Extiende el calendario actual de combos; no crea un segundo editor ni cambia los RPC legacy.
-- Las fechas se interpretan en America/Bogota desde el panel; las reglas existentes quedan en prioridad 0.
-- Requiere que Fase 2 haya instalado las reglas de tarifas por ciudad/zona antes de sustituir la cotización.
DO $shipping_rules_contract$
BEGIN
  IF to_regclass('public.storefront_shipping_rules') IS NULL
     OR to_regclass('public.storefront_shipping_rule_destinations') IS NULL
     OR to_regprocedure('public.normalize_storefront_delivery_city(text)') IS NULL THEN
    RAISE EXCEPTION 'Calendario de combos requiere primero la migración de tarifas por ciudad/zona (Fase 2).';
  END IF;
END
$shipping_rules_contract$;

ALTER TABLE public.storefront_product_combos
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'America/Bogota';

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='storefront_product_combos_priority_check' AND conrelid='public.storefront_product_combos'::regclass) THEN
    ALTER TABLE public.storefront_product_combos
      ADD CONSTRAINT storefront_product_combos_priority_check CHECK (priority BETWEEN 0 AND 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='storefront_product_combos_time_zone_check' AND conrelid='public.storefront_product_combos'::regclass) THEN
    ALTER TABLE public.storefront_product_combos
      ADD CONSTRAINT storefront_product_combos_time_zone_check CHECK (time_zone='America/Bogota');
  END IF;
END $constraints$;

COMMENT ON COLUMN public.storefront_product_combos.priority IS
  'Prioridad de campaña; mayor valor se aplica primero. La asignación por unidad sigue usando v_remaining.';
COMMENT ON COLUMN public.storefront_product_combos.time_zone IS
  'Zona horaria fija de la tienda para editar start_at/end_at: America/Bogota.';
CREATE INDEX IF NOT EXISTS storefront_product_combos_priority_calendar_idx
  ON public.storefront_product_combos (enabled,priority DESC,start_at,end_at,created_at,id);

DO $legacy_combo_contract$
DECLARE v_legacy_oid oid;v_result text;v_arg_names text[];
BEGIN
  v_legacy_oid:=to_regprocedure('public.admin_save_storefront_product_combo(uuid,text,uuid,uuid,text,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone,text,numeric,numeric,text,text)');
  IF v_legacy_oid IS NULL THEN
    RAISE EXCEPTION 'Calendario de combos requiere el RPC legacy admin_save_storefront_product_combo de 17 argumentos.';
  END IF;
  SELECT pg_get_function_result(p.oid),p.proargnames INTO v_result,v_arg_names
    FROM pg_proc p WHERE p.oid=v_legacy_oid;
  IF v_result NOT LIKE 'TABLE(id uuid,%enabled boolean,%)'
     OR NOT (v_arg_names @> ARRAY['id','enabled']::text[]) THEN
    RAISE EXCEPTION 'Contrato legacy de guardado incompatible: se esperaba una tabla con id uuid y enabled boolean.';
  END IF;
END $legacy_combo_contract$;

CREATE OR REPLACE FUNCTION public.admin_list_storefront_product_combos_v2()
RETURNS TABLE(
 id uuid,rule_type text,product_a_id uuid,product_b_id uuid,product_a_name text,product_b_name text,
 category_a text,category_b text,title text,message text,button_label text,enabled boolean,
 start_at timestamptz,end_at timestamptz,updated_at timestamptz,discount_type text,
 discount_value numeric,combo_price numeric,created_at timestamptz,display_location text,
 display_category text,priority integer,time_zone text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_admin_user_id uuid;
BEGIN
 SELECT s.admin_user_id INTO v_admin_user_id FROM public.store_settings s WHERE s.id=1;
 IF auth.uid() IS NULL OR v_admin_user_id IS NULL OR auth.uid() IS DISTINCT FROM v_admin_user_id THEN
   RAISE EXCEPTION 'Este usuario no está autorizado para consultar las promociones combinadas.' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT c.id,c.rule_type::text,c.product_a_id,c.product_b_id,pa.name::text,pb.name::text,
        c.category_a::text,c.category_b::text,c.title::text,c.message::text,c.button_label::text,
        c.enabled,c.start_at,c.end_at,c.updated_at,c.discount_type::text,c.discount_value,c.combo_price,
        c.created_at,c.display_location::text,c.display_category::text,c.priority,c.time_zone::text
 FROM public.storefront_product_combos c
 LEFT JOIN public.products pa ON pa.id=c.product_a_id
 LEFT JOIN public.products pb ON pb.id=c.product_b_id
 ORDER BY c.priority DESC,c.start_at NULLS LAST,c.created_at ASC,c.id;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_save_storefront_product_combo_v2(
 p_combo_id uuid,p_rule_type text,p_product_a_id uuid,p_product_b_id uuid,
 p_category_a text,p_category_b text,p_title text,p_message text,p_button_label text,
 p_enabled boolean,p_start_at timestamptz,p_end_at timestamptz,p_discount_type text,
 p_discount_value numeric,p_combo_price numeric,p_display_location text,p_display_category text,
 p_priority integer,p_time_zone text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_admin_user_id uuid;v_id uuid;v_enabled boolean;
BEGIN
 SELECT s.admin_user_id INTO v_admin_user_id FROM public.store_settings s WHERE s.id=1;
 IF auth.uid() IS NULL OR v_admin_user_id IS NULL OR auth.uid() IS DISTINCT FROM v_admin_user_id THEN
   RAISE EXCEPTION 'Este usuario no está autorizado para guardar promociones combinadas.' USING ERRCODE='42501';
 END IF;
 IF p_priority IS NULL OR p_priority NOT BETWEEN 0 AND 1000 THEN
   RAISE EXCEPTION 'La prioridad debe ser un entero entre 0 y 1000.' USING ERRCODE='22023';
 END IF;
 IF p_time_zone IS DISTINCT FROM 'America/Bogota' THEN
   RAISE EXCEPTION 'La zona horaria de la tienda debe ser America/Bogota.' USING ERRCODE='22023';
 END IF;
 SELECT saved.id,saved.enabled INTO v_id,v_enabled
 FROM public.admin_save_storefront_product_combo(
   p_combo_id,p_rule_type,p_product_a_id,p_product_b_id,p_category_a,p_category_b,
   p_title,p_message,p_button_label,p_enabled,p_start_at,p_end_at,p_discount_type,
   p_discount_value,p_combo_price,p_display_location,p_display_category
 ) AS saved;
 IF NOT FOUND OR v_id IS NULL THEN
   RAISE EXCEPTION 'No se pudo guardar la combinación base; se revirtió la prioridad.';
 END IF;
 UPDATE public.storefront_product_combos
    SET priority=p_priority,time_zone=p_time_zone,updated_at=now(),updated_by=auth.uid()
  WHERE id=v_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el combo guardado; la transacción se revirtió.'; END IF;
 RETURN jsonb_build_object('id',v_id,'enabled',v_enabled,'priority',p_priority,'time_zone',p_time_zone);
END $function$;

CREATE OR REPLACE FUNCTION public.get_public_storefront_product_combos_v2()
RETURNS TABLE(
 id uuid,rule_type text,product_a_id uuid,product_b_id uuid,category_a text,category_b text,
 title text,message text,button_label text,display_location text,display_category text,
 start_at timestamptz,end_at timestamptz,discount_type text,discount_value numeric,
 combo_price numeric,created_at timestamptz,priority integer,time_zone text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
 SELECT c.id,c.rule_type::text,c.product_a_id,c.product_b_id,c.category_a::text,c.category_b::text,
        c.title::text,c.message::text,c.button_label::text,c.display_location::text,c.display_category::text,
        c.start_at,c.end_at,c.discount_type::text,c.discount_value,c.combo_price,c.created_at,c.priority,c.time_zone::text
 FROM public.storefront_product_combos c
 WHERE c.enabled=true
   AND (c.start_at IS NULL OR c.start_at<=now())
   AND (c.end_at IS NULL OR c.end_at>now())
   AND (
     (c.rule_type='product_pair'
       AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=c.product_a_id AND p.user_id=(SELECT s.admin_user_id FROM public.store_settings s WHERE s.id=1))
       AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=c.product_b_id AND p.user_id=(SELECT s.admin_user_id FROM public.store_settings s WHERE s.id=1)))
     OR
     (c.rule_type='category_pair'
       AND EXISTS(SELECT 1 FROM public.products p WHERE p.user_id=(SELECT s.admin_user_id FROM public.store_settings s WHERE s.id=1) AND public.sirevya_normalize_combo_category(p.category)=public.sirevya_normalize_combo_category(c.category_a))
       AND EXISTS(SELECT 1 FROM public.products p WHERE p.user_id=(SELECT s.admin_user_id FROM public.store_settings s WHERE s.id=1) AND public.sirevya_normalize_combo_category(p.category)=public.sirevya_normalize_combo_category(c.category_b)))
   )
 ORDER BY c.priority DESC,c.created_at ASC,c.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_storefront_product_combos_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_list_storefront_product_combos_v2() TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.admin_save_storefront_product_combo_v2(uuid,text,uuid,uuid,text,text,text,text,text,boolean,timestamptz,timestamptz,text,numeric,numeric,text,text,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_storefront_product_combo_v2(uuid,text,uuid,uuid,text,text,text,text,text,boolean,timestamptz,timestamptz,text,numeric,numeric,text,text,integer,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_public_storefront_product_combos_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_product_combos_v2() TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_storefront_cart_quote(p_items jsonb, p_city text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
   ORDER BY c.priority DESC,c.created_at ASC,c.id ASC
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
END $function$;
REVOKE ALL ON FUNCTION public.get_storefront_cart_quote(jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote(jsonb,text) TO anon,authenticated,service_role;
