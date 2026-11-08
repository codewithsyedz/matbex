ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS supplier_vat_number text,
  ADD COLUMN IF NOT EXISTS supplier_name_text text,
  ADD COLUMN IF NOT EXISTS zatca_uuid text,
  ADD COLUMN IF NOT EXISTS zatca_qr text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoices_zatca_unique
  ON public.purchase_invoices (restaurant_id, COALESCE(supplier_vat_number, ''), invoice_number)
  WHERE source = 'zatca_upload';