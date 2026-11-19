
ALTER TABLE public.overhead_allocation  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.overhead_payments    ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.cogs_purchases       ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.staff                ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.payroll_records      ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_overhead_allocation_branch ON public.overhead_allocation(restaurant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_overhead_payments_branch   ON public.overhead_payments(restaurant_id, branch_id, payment_month);
CREATE INDEX IF NOT EXISTS idx_cogs_purchases_branch      ON public.cogs_purchases(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_staff_branch               ON public.staff(restaurant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_payroll_records_branch     ON public.payroll_records(restaurant_id, branch_id, period_start);

UPDATE public.payroll_records pr
SET branch_id = s.branch_id
FROM public.staff s
WHERE pr.staff_id = s.id AND pr.branch_id IS NULL AND s.branch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.auto_stamp_account_tx_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch uuid;
BEGIN
  IF NEW.branch_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.reference_id IS NULL OR NEW.reference_type IS NULL THEN RETURN NEW; END IF;
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
      WHEN 'cogs_purchase','cogs_purchases' THEN
        SELECT branch_id INTO v_branch FROM public.cogs_purchases WHERE id = NEW.reference_id;
      WHEN 'payroll','payroll_record','payroll_records' THEN
        SELECT branch_id INTO v_branch FROM public.payroll_records WHERE id = NEW.reference_id;
      WHEN 'overhead_payment','overhead_payments' THEN
        SELECT branch_id INTO v_branch FROM public.overhead_payments WHERE id = NEW.reference_id;
      ELSE v_branch := NULL;
    END CASE;
  EXCEPTION WHEN OTHERS THEN v_branch := NULL;
  END;
  NEW.branch_id := v_branch;
  RETURN NEW;
END;
$function$;

UPDATE public.account_transactions t SET branch_id = cp.branch_id
FROM public.cogs_purchases cp
WHERE t.branch_id IS NULL AND cp.branch_id IS NOT NULL
  AND lower(t.reference_type) IN ('cogs_purchase','cogs_purchases') AND t.reference_id = cp.id;

UPDATE public.account_transactions t SET branch_id = pr.branch_id
FROM public.payroll_records pr
WHERE t.branch_id IS NULL AND pr.branch_id IS NOT NULL
  AND lower(t.reference_type) IN ('payroll','payroll_record','payroll_records') AND t.reference_id = pr.id;

UPDATE public.account_transactions t SET branch_id = op.branch_id
FROM public.overhead_payments op
WHERE t.branch_id IS NULL AND op.branch_id IS NOT NULL
  AND lower(t.reference_type) IN ('overhead_payment','overhead_payments') AND t.reference_id = op.id;
