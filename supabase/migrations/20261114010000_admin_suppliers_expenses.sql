-- Candidato preparado, no aplicado en producción.
-- Habilita los módulos existentes del panel sin exponer datos a anon.

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  phone text NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
  contact text NOT NULL DEFAULT '' CHECK (length(contact) <= 120),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS suppliers_user_name_idx
  ON public.suppliers (user_id, lower(name), id);

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  concept text NOT NULL CHECK (length(btrim(concept)) BETWEEN 1 AND 160),
  amount bigint NOT NULL CHECK (amount > 0 AND amount <= 500000000),
  expense_date date NOT NULL DEFAULT current_date,
  category text NOT NULL DEFAULT 'Otros' CHECK (length(btrim(category)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expenses_user_date_idx
  ON public.expenses (user_id, expense_date DESC, id DESC);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.suppliers, public.expenses FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.suppliers, public.expenses TO authenticated;

DROP POLICY IF EXISTS suppliers_admin_select ON public.suppliers;
CREATE POLICY suppliers_admin_select ON public.suppliers FOR SELECT TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid());
DROP POLICY IF EXISTS suppliers_admin_insert ON public.suppliers;
CREATE POLICY suppliers_admin_insert ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (public.is_store_admin() AND user_id = auth.uid());
DROP POLICY IF EXISTS suppliers_admin_update ON public.suppliers;
CREATE POLICY suppliers_admin_update ON public.suppliers FOR UPDATE TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid())
  WITH CHECK (public.is_store_admin() AND user_id = auth.uid());
DROP POLICY IF EXISTS suppliers_admin_delete ON public.suppliers;
CREATE POLICY suppliers_admin_delete ON public.suppliers FOR DELETE TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid());

DROP POLICY IF EXISTS expenses_admin_select ON public.expenses;
CREATE POLICY expenses_admin_select ON public.expenses FOR SELECT TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid());
DROP POLICY IF EXISTS expenses_admin_insert ON public.expenses;
CREATE POLICY expenses_admin_insert ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (public.is_store_admin() AND user_id = auth.uid());
DROP POLICY IF EXISTS expenses_admin_update ON public.expenses;
CREATE POLICY expenses_admin_update ON public.expenses FOR UPDATE TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid())
  WITH CHECK (public.is_store_admin() AND user_id = auth.uid());
DROP POLICY IF EXISTS expenses_admin_delete ON public.expenses;
CREATE POLICY expenses_admin_delete ON public.expenses FOR DELETE TO authenticated
  USING (public.is_store_admin() AND user_id = auth.uid());
