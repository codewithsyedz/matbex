
ALTER TABLE public.account_transactions
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_account_tx_tenant_branch_date
  ON public.account_transactions (tenant_id, branch_id, transaction_date);

CREATE OR REPLACE FUNCTION public.auto_stamp_account_tx_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.reference_id IS NULL OR NEW.reference_type IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    CASE lower(NEW.reference_type)
      WHEN 'sale','sales','sales_transaction','sales_transactions' THEN
        SELECT branch_id INTO v_branch FROM public.sales_transactions WHERE id = NEW.reference_id;
      WHEN 'expense','expenses' THEN
        SELECT branch_id INTO v_branch FROM public.expenses WHERE id = NEW.reference_id;
      WHEN 'purchase','purchases' THEN
        SELECT branch_id INTO v_branch FROM public.purchases WHERE id = NEW.reference_id;
      WHEN 'purchase_invoice','purchase_invoices','invoice' THEN
        SELECT branch_id INTO v_branch FROM public.purchase_invoices WHERE id = NEW.reference_id;
      WHEN 'staff_advance','staff_advances' THEN
        SELECT branch_id INTO v_branch FROM public.staff_advances WHERE id = NEW.reference_id;
      ELSE
        v_branch := NULL;
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    v_branch := NULL;
  END;

  NEW.branch_id := v_branch;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_stamp_account_tx_branch ON public.account_transactions;
CREATE TRIGGER trg_auto_stamp_account_tx_branch
BEFORE INSERT ON public.account_transactions
FOR EACH ROW EXECUTE FUNCTION public.auto_stamp_account_tx_branch();

UPDATE public.account_transactions atx
SET branch_id = s.branch_id
FROM public.sales_transactions s
WHERE atx.branch_id IS NULL
  AND atx.reference_id = s.id
  AND lower(atx.reference_type) IN ('sale','sales','sales_transaction','sales_transactions');

UPDATE public.account_transactions atx
SET branch_id = e.branch_id
FROM public.expenses e
WHERE atx.branch_id IS NULL
  AND atx.reference_id = e.id
  AND lower(atx.reference_type) IN ('expense','expenses');

UPDATE public.account_transactions atx
SET branch_id = p.branch_id
FROM public.purchases p
WHERE atx.branch_id IS NULL
  AND atx.reference_id = p.id
  AND lower(atx.reference_type) IN ('purchase','purchases');

UPDATE public.account_transactions atx
SET branch_id = pi.branch_id
FROM public.purchase_invoices pi
WHERE atx.branch_id IS NULL
  AND atx.reference_id = pi.id
  AND lower(atx.reference_type) IN ('purchase_invoice','purchase_invoices','invoice');

UPDATE public.account_transactions atx
SET branch_id = sa.branch_id
FROM public.staff_advances sa
WHERE atx.branch_id IS NULL
  AND atx.reference_id = sa.id
  AND lower(atx.reference_type) IN ('staff_advance','staff_advances');
