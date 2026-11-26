-- Link expenses to a supplier and (optionally) to the purchase invoice they generated
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_invoice_id uuid REFERENCES public.purchase_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_supplier_id ON public.expenses(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_purchase_invoice_id ON public.expenses(purchase_invoice_id) WHERE purchase_invoice_id IS NOT NULL;