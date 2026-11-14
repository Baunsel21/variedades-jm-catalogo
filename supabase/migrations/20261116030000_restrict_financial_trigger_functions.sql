-- Internal trigger functions must not be callable directly by storefront roles.
-- Trigger execution remains available to PostgreSQL; this only removes direct
-- EXECUTE grants from PUBLIC/anon/authenticated.
REVOKE ALL ON FUNCTION public._sirevya_expense_supplier_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._sirevya_record_product_cost_history() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._sirevya_expense_supplier_owner() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public._sirevya_record_product_cost_history() TO postgres, service_role;
