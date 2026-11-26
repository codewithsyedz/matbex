-- merge_duplicate_azizia_supplier
--
-- Smoke Grill had "Azizia Central Market" twice (same name and phone, same payables account):
-- d5930060 (2 June, all branches, 143 invoices) is kept; d4463885 (20 June, tied to the deleted
-- duplicate Al-Wadi branch, 8 invoices, 9 expenses, 1 supplier payment) is merged into it and
-- removed. Agreed with the account holder on 2026-11-16. Runs only where both rows exist.
DO $$
DECLARE
  k constant uuid := 'd5930060-816f-48d9-8127-5883c5444315';
  d constant uuid := 'd4463885-ade3-47cc-bbdf-25cc5b57e49c';
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = k) OR NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = d) THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['purchase_invoices', 'expenses', 'purchases', 'supplier_payments', 'inventory_items',
                           'inventory_batches', 'project_commitments', 'project_transactions', 'supplier_ap_account_audit'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('UPDATE public.%I SET supplier_id = $1 WHERE supplier_id = $2', t) USING k, d;
    END IF;
  END LOOP;
  DELETE FROM public.suppliers WHERE id = d;
END $$;
