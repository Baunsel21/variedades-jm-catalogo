-- Centraliza la regla de envío sin cambiar los valores comerciales vigentes.
-- No actualiza pedidos existentes; Wompi y COD comparten la cotización RPC.
CREATE TABLE public.storefront_shipping_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  national_shipping_cost bigint NOT NULL DEFAULT 15000
    CHECK (national_shipping_cost BETWEEN 0 AND 5000000),
  free_shipping_threshold bigint
    CHECK (free_shipping_threshold IS NULL OR free_shipping_threshold BETWEEN 1 AND 50000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.storefront_shipping_settings(id,national_shipping_cost,free_shipping_threshold)
VALUES (1,15000,130000) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.storefront_shipping_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storefront_shipping_settings FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_public_storefront_shipping_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_row public.storefront_shipping_settings%ROWTYPE;
BEGIN
 SELECT * INTO v_row FROM public.storefront_shipping_settings WHERE id=1;
 IF NOT FOUND THEN
   RETURN jsonb_build_object('success',false,'message','La configuración de envíos no está disponible.');
 END IF;
 RETURN jsonb_build_object(
   'success',true,
   'national_shipping_cost',v_row.national_shipping_cost,
   'free_shipping_threshold',v_row.free_shipping_threshold,
   'free_shipping_in_cali',true,
   'updated_at',v_row.updated_at
 );
END $function$;
REVOKE ALL ON FUNCTION public.get_public_storefront_shipping_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_shipping_settings() TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_storefront_shipping_settings(
  p_national_shipping_cost bigint,
  p_free_shipping_threshold bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
 IF coalesce(public.is_store_admin(),false) IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('success',false,'message','No tienes autorización para modificar los envíos.');
 END IF;
 IF p_national_shipping_cost IS NULL OR p_national_shipping_cost<0 OR p_national_shipping_cost>5000000 THEN
   RETURN jsonb_build_object('success',false,'message','La tarifa debe estar entre $0 y $5.000.000.');
 END IF;
 IF p_free_shipping_threshold IS NOT NULL AND (p_free_shipping_threshold<1 OR p_free_shipping_threshold>50000000) THEN
   RETURN jsonb_build_object('success',false,'message','El mínimo debe estar entre $1 y $50.000.000 o quedar desactivado.');
 END IF;
 INSERT INTO public.storefront_shipping_settings(id,national_shipping_cost,free_shipping_threshold,updated_at,updated_by)
 VALUES (1,p_national_shipping_cost,p_free_shipping_threshold,now(),auth.uid())
 ON CONFLICT (id) DO UPDATE SET
   national_shipping_cost=EXCLUDED.national_shipping_cost,
   free_shipping_threshold=EXCLUDED.free_shipping_threshold,
   updated_at=EXCLUDED.updated_at,
   updated_by=EXCLUDED.updated_by;
 RETURN public.get_public_storefront_shipping_settings() || jsonb_build_object('message','Configuración de envíos guardada.');
END $function$;
REVOKE ALL ON FUNCTION public.admin_save_storefront_shipping_settings(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_storefront_shipping_settings(bigint,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_storefront_cart_quote(p_items jsonb, p_city text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_input jsonb; v_product public.products%ROWTYPE; v_line_count integer:=0; v_qty integer;
 v_owner_id uuid; v_city text:=lower(btrim(coalesce(p_city,''))); v_base numeric(14,2):=0;
 v_discount numeric(14,2):=0; v_subtotal numeric(14,2):=0; v_shipping numeric(14,2):=0; v_total numeric(14,2):=0;
 v_ids uuid[]:=ARRAY[]::uuid[]; v_names text[]:=ARRAY[]::text[]; v_codes text[]:=ARRAY[]::text[];
 v_categories text[]:=ARRAY[]::text[]; v_prices numeric[]:=ARRAY[]::numeric[]; v_qtys integer[]:=ARRAY[]::integer[];
 v_remaining integer[]:=ARRAY[]::integer[]; v_line_discounts numeric[]:=ARRAY[]::numeric[];
 v_colors text[]:=ARRAY[]::text[]; v_sizes text[]:=ARRAY[]::text[];
 v_rule record; v_n integer; i integer; j integer; v_is_a boolean; v_is_b boolean; v_units integer;
 v_pair_total numeric(14,2); v_save_per_pair numeric(14,2); v_share_a numeric(14,2); v_share_b numeric(14,2);
 v_rule_units integer; v_rule_discount numeric(14,2); v_applied jsonb:='[]'::jsonb; v_item_json jsonb:='[]'::jsonb;
 v_original_line numeric(14,2); v_net_line numeric(14,2); v_normalized_city text; v_national_shipping_cost bigint; v_free_shipping_threshold bigint;
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
   IF coalesce(v_product.sale_price,0)<0 THEN RETURN jsonb_build_object('success',false,'message','El precio guardado de un producto no es válido.'); END IF;
   v_ids:=array_append(v_ids,v_product.id);v_names:=array_append(v_names,coalesce(v_product.name,'Producto'));
   v_codes:=array_append(v_codes,coalesce(v_product.code,''));v_categories:=array_append(v_categories,coalesce(v_product.category,''));
   v_prices:=array_append(v_prices,coalesce(v_product.sale_price,0)::numeric);v_qtys:=array_append(v_qtys,v_qty);v_remaining:=array_append(v_remaining,v_qty);
   v_line_discounts:=array_append(v_line_discounts,0::numeric);v_colors:=array_append(v_colors,btrim(coalesce(v_input->>'color','')));v_sizes:=array_append(v_sizes,btrim(coalesce(v_input->>'size','')));
   v_base:=v_base+(coalesce(v_product.sale_price,0)::numeric*v_qty);v_line_count:=v_line_count+1;
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
 v_normalized_city:=public.sirevya_normalize_combo_category(v_city);
 SELECT s.national_shipping_cost,s.free_shipping_threshold
   INTO v_national_shipping_cost,v_free_shipping_threshold
   FROM public.storefront_shipping_settings AS s WHERE s.id=1;
 IF NOT FOUND THEN
   RETURN jsonb_build_object('success',false,'message','La configuración de envíos no está disponible.');
 END IF;
 IF v_normalized_city IN ('cali','santiago de cali','cali valle del cauca') THEN
   v_shipping:=0;
 ELSIF v_free_shipping_threshold IS NOT NULL AND v_subtotal>=v_free_shipping_threshold THEN
   v_shipping:=0;
 ELSE
   v_shipping:=v_national_shipping_cost;
 END IF;
 v_total:=v_subtotal+v_shipping;
 RETURN jsonb_build_object('success',true,'original_subtotal',v_base,'discount_total',v_discount,'discounted_subtotal',v_subtotal,
   'shipping',v_shipping,'total',v_total,'items',v_item_json,'discounts',v_applied,'currency','COP');
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN
   RETURN jsonb_build_object('success',false,'message','El carrito contiene un identificador o una cantidad no válida.');
 WHEN OTHERS THEN
   RETURN jsonb_build_object('success',false,'message','No se pudo calcular el total del carrito. Verifica los productos y las promociones.');
END $function$;
REVOKE ALL ON FUNCTION public.get_storefront_cart_quote(jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_cart_quote(jsonb,text) TO anon,authenticated,service_role;
