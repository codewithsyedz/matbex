-- ZATCA Phase 1 settings (tenant-scoped, single-row per tenant)
CREATE TABLE IF NOT EXISTS public.zatca_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  seller_name_en text,
  seller_name_ar text,
  vat_registration_number text,
  qr_enabled boolean NOT NULL DEFAULT true,
  zatca_phase_mode text NOT NULL DEFAULT 'PHASE_1' CHECK (zatca_phase_mode IN ('PHASE_1','PHASE_2_READY')),
  qr_size text NOT NULL DEFAULT 'MEDIUM' CHECK (qr_size IN ('SMALL','MEDIUM','LARGE')),
  show_on_printed_receipt boolean NOT NULL DEFAULT true,
  show_on_digital_receipt boolean NOT NULL DEFAULT true,
  auto_generate_pdf_receipt boolean NOT NULL DEFAULT true,
  show_seller_name_on_receipt boolean NOT NULL DEFAULT true,
  show_vat_number_on_receipt boolean NOT NULL DEFAULT true,
  pdf_generation_mode text NOT NULL DEFAULT 'SOFT' CHECK (pdf_generation_mode IN ('STRICT','SOFT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zatca_vat_format CHECK (
    vat_registration_number IS NULL
    OR vat_registration_number ~ '^[0-9]{15}$'
  )
);

ALTER TABLE public.zatca_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY zatca_settings_select ON public.zatca_settings
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY zatca_settings_insert ON public.zatca_settings
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY zatca_settings_update ON public.zatca_settings
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TRIGGER trg_zatca_settings_updated_at
  BEFORE UPDATE ON public.zatca_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();