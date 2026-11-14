BEGIN;

-- Los registros de sales ya contienen cost_price por línea. Este cambio no los reescribe.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS expenses_user_supplier_date_idx
  ON public.expenses (user_id, supplier_id, expense_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.product_cost_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_key text NOT NULL DEFAULT '',
  purchase_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (purchase_cost >= 0),
  import_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (import_cost >= 0),
  other_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_cost >= 0),
  effective_from date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, variant_key),
  CHECK (length(variant_key) <= 240)
);
CREATE INDEX IF NOT EXISTS product_cost_profiles_user_product_idx
  ON public.product_cost_profiles (user_id, product_id, variant_key);

CREATE TABLE IF NOT EXISTS public.product_cost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_key text NOT NULL DEFAULT '',
  purchase_cost numeric(14,2) NOT NULL CHECK (purchase_cost >= 0),
  import_cost numeric(14,2) NOT NULL CHECK (import_cost >= 0),
  other_cost numeric(14,2) NOT NULL CHECK (other_cost >= 0),
  effective_from date NOT NULL,
  changed_reason text NOT NULL DEFAULT '',
  changed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(variant_key) <= 240),
  CHECK (length(changed_reason) <= 300)
);
CREATE INDEX IF NOT EXISTS product_cost_history_user_product_date_idx
  ON public.product_cost_history (user_id, product_id, variant_key, effective_from DESC, changed_at DESC);

CREATE OR REPLACE FUNCTION public._sirevya_record_product_cost_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR ROW(OLD.purchase_cost, OLD.import_cost, OLD.other_cost, OLD.effective_from)
     IS DISTINCT FROM ROW(NEW.purchase_cost, NEW.import_cost, NEW.other_cost, NEW.effective_from) THEN
    INSERT INTO public.product_cost_history
      (user_id, product_id, variant_key, purchase_cost, import_cost, other_cost, effective_from, changed_reason)
    VALUES
      (NEW.user_id, NEW.product_id, NEW.variant_key, NEW.purchase_cost, NEW.import_cost, NEW.other_cost,
       NEW.effective_from, CASE WHEN TG_OP = 'INSERT' THEN 'Registro inicial' ELSE 'Actualización de coste' END);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS product_cost_profiles_history ON public.product_cost_profiles;
CREATE TRIGGER product_cost_profiles_history
AFTER INSERT OR UPDATE OF purchase_cost, import_cost, other_cost, effective_from
ON public.product_cost_profiles
FOR EACH ROW EXECUTE FUNCTION public._sirevya_record_product_cost_history();

CREATE OR REPLACE FUNCTION public._sirevya_expense_supplier_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers s WHERE s.id = NEW.supplier_id AND s.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'EXPENSE_SUPPLIER_OWNER_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS expenses_supplier_owner_guard ON public.expenses;
CREATE TRIGGER expenses_supplier_owner_guard
BEFORE INSERT OR UPDATE OF user_id, supplier_id ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public._sirevya_expense_supplier_owner();

ALTER TABLE public.product_cost_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_cost_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_cost_profiles, public.product_cost_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_cost_profiles TO authenticated;
GRANT SELECT ON TABLE public.product_cost_history TO authenticated;

DROP POLICY IF EXISTS product_cost_profiles_admin_select ON public.product_cost_profiles;
CREATE POLICY product_cost_profiles_admin_select ON public.product_cost_profiles FOR SELECT TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid());
DROP POLICY IF EXISTS product_cost_profiles_admin_insert ON public.product_cost_profiles;
CREATE POLICY product_cost_profiles_admin_insert ON public.product_cost_profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_store_admin() AND user_id = auth.uid());
DROP POLICY IF EXISTS product_cost_profiles_admin_update ON public.product_cost_profiles;
CREATE POLICY product_cost_profiles_admin_update ON public.product_cost_profiles FOR UPDATE TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid())
  WITH CHECK (public.is_store_admin() AND user_id = auth.uid());
DROP POLICY IF EXISTS product_cost_profiles_admin_delete ON public.product_cost_profiles;
CREATE POLICY product_cost_profiles_admin_delete ON public.product_cost_profiles FOR DELETE TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid());

DROP POLICY IF EXISTS product_cost_history_admin_read ON public.product_cost_history;
CREATE POLICY product_cost_history_admin_read ON public.product_cost_history FOR SELECT TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid());

DROP POLICY IF EXISTS expenses_admin_supplier_select ON public.expenses;
CREATE POLICY expenses_admin_supplier_select ON public.expenses FOR SELECT TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid());
DROP POLICY IF EXISTS expenses_admin_supplier_insert ON public.expenses;
CREATE POLICY expenses_admin_supplier_insert ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (
    public.is_store_admin() AND user_id = auth.uid() AND
    (supplier_id IS NULL OR EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = supplier_id AND s.user_id = auth.uid()))
  );
DROP POLICY IF EXISTS expenses_admin_supplier_update ON public.expenses;
CREATE POLICY expenses_admin_supplier_update ON public.expenses FOR UPDATE TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid())
  WITH CHECK (
    public.is_store_admin() AND user_id = auth.uid() AND
    (supplier_id IS NULL OR EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = supplier_id AND s.user_id = auth.uid()))
  );
DROP POLICY IF EXISTS expenses_admin_supplier_delete ON public.expenses;
CREATE POLICY expenses_admin_supplier_delete ON public.expenses FOR DELETE TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.admin_upsert_product_cost(
  p_product_id uuid,
  p_variant_key text DEFAULT '',
  p_purchase_cost numeric DEFAULT 0,
  p_import_cost numeric DEFAULT 0,
  p_other_cost numeric DEFAULT 0,
  p_effective_from date DEFAULT current_date
)
RETURNS public.product_cost_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE result public.product_cost_profiles;
BEGIN
  IF NOT public.is_store_admin() THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_OWNED';
  END IF;
  IF p_purchase_cost < 0 OR p_import_cost < 0 OR p_other_cost < 0 THEN RAISE EXCEPTION 'COST_MUST_BE_NON_NEGATIVE'; END IF;
  INSERT INTO public.product_cost_profiles(user_id, product_id, variant_key, purchase_cost, import_cost, other_cost, effective_from)
  VALUES (auth.uid(), p_product_id, btrim(coalesce(p_variant_key,'')), p_purchase_cost, p_import_cost, p_other_cost, p_effective_from)
  ON CONFLICT (product_id, variant_key) DO UPDATE SET
    purchase_cost=EXCLUDED.purchase_cost, import_cost=EXCLUDED.import_cost, other_cost=EXCLUDED.other_cost,
    effective_from=EXCLUDED.effective_from, updated_at=now()
  RETURNING * INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_product_cost(uuid,text,numeric,numeric,numeric,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_product_cost(uuid,text,numeric,numeric,numeric,date) TO authenticated;

COMMIT;
