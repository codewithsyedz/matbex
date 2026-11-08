
CREATE TABLE IF NOT EXISTS public.zatca_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  device_id uuid REFERENCES public.zatca_devices(id) ON DELETE SET NULL,
  original_sales_transaction_id uuid NOT NULL REFERENCES public.sales_transactions(id) ON DELETE RESTRICT,
  original_uuid text NOT NULL,
  original_pih text,
  original_icv int,
  credit_note_number text NOT NULL,
  uuid text NOT NULL UNIQUE,
  icv int,
  pih text,
  invoice_hash text,
  signed_xml_url text,
  clearance_status text NOT NULL DEFAULT 'PENDING',
  clearance_response jsonb,
  cleared_at timestamptz,
  reason_code text NOT NULL DEFAULT 'OTHER',
  reason_text text,
  total_refunded numeric(12,2) NOT NULL DEFAULT 0,
  vat_refunded numeric(12,2) NOT NULL DEFAULT 0,
  refund_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  schema_validation_errors jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zatca_cn_reason_chk CHECK (reason_code IN ('RETURN_OF_GOODS','CORRECTION_OF_AMOUNTS','CHANGE_OF_BUYER','CANCELLATION','OTHER')),
  CONSTRAINT zatca_cn_status_chk CHECK (clearance_status IN ('PENDING','CLEARED','REPORTED','CLEARED_SIM','REJECTED','SCHEMA_INVALID'))
);

CREATE INDEX IF NOT EXISTS idx_zatca_cn_tenant ON public.zatca_credit_notes(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zatca_cn_original ON public.zatca_credit_notes(original_sales_transaction_id);

ALTER TABLE public.zatca_credit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zatca_cn_tenant_read"
  ON public.zatca_credit_notes
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "zatca_cn_tenant_write"
  ON public.zatca_credit_notes
  FOR ALL TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id))
  WITH CHECK (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE TRIGGER trg_zatca_cn_updated_at
  BEFORE UPDATE ON public.zatca_credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS zatca_schema_errors jsonb;
