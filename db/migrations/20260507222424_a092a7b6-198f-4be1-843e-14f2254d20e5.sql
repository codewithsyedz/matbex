
-- 1. Snapshot columns on sales_transactions
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS zatca_seller_name      TEXT,
  ADD COLUMN IF NOT EXISTS zatca_seller_name_ar   TEXT,
  ADD COLUMN IF NOT EXISTS zatca_vat_number       TEXT,
  ADD COLUMN IF NOT EXISTS zatca_qr_base64        TEXT,
  ADD COLUMN IF NOT EXISTS zatca_pdf_url          TEXT,
  ADD COLUMN IF NOT EXISTS zatca_invoice_total    NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS zatca_vat_total        NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS zatca_timestamp        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS zatca_generated_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sales_transactions_zatca_pending
  ON public.sales_transactions (restaurant_id, created_at DESC)
  WHERE zatca_qr_base64 IS NULL;

-- 2. invoice_generation_logs
CREATE TABLE IF NOT EXISTS public.invoice_generation_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID NOT NULL,
  sales_transaction_id UUID REFERENCES public.sales_transactions(id) ON DELETE SET NULL,
  receipt_number      TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('success','failed','skipped')),
  mode                TEXT NOT NULL CHECK (mode IN ('STRICT','SOFT')),
  seller_name         TEXT,
  vat_number          TEXT,
  qr_base64           TEXT,
  pdf_url             TEXT,
  pdf_bytes           INTEGER,
  invoice_total       NUMERIC(14,2),
  vat_total           NUMERIC(14,2),
  duration_ms         INTEGER,
  error_message       TEXT,
  triggered_by        UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_gen_logs_restaurant_created
  ON public.invoice_generation_logs (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_gen_logs_txn
  ON public.invoice_generation_logs (sales_transaction_id);

ALTER TABLE public.invoice_generation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_gen_logs_select
  ON public.invoice_generation_logs
  FOR SELECT
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY invoice_gen_logs_insert
  ON public.invoice_generation_logs
  FOR INSERT
  WITH CHECK (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));
-- No UPDATE / DELETE policies - immutable audit log.
