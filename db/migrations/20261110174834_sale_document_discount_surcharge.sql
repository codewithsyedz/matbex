-- Document-level discount and surcharge on a sale (listed amounts, same pricing mode as the
-- lines). The POS printed and reported them to ZATCA (UBL AllowanceCharge, QR total) but the
-- stored sale ignored them, so a discounted sale was saved at its full price and sales/VAT
-- reports disagreed with the invoice the customer received. POST /api/v1/pos/sales now applies
-- them to the totals and keeps them here.
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS document_discount numeric(12,2) NOT NULL DEFAULT 0 CHECK (document_discount >= 0),
  ADD COLUMN IF NOT EXISTS document_surcharge numeric(12,2) NOT NULL DEFAULT 0 CHECK (document_surcharge >= 0);
