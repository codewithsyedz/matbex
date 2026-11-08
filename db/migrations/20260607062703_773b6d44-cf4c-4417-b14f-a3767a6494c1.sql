
CREATE TYPE public.receipt_template_preset AS ENUM (
  'simple','tax_invoice','detailed','saudi_bilingual','zatca_standard'
);
CREATE TYPE public.receipt_template_language AS ENUM ('en','ar','bilingual');

CREATE TABLE public.receipt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  preset public.receipt_template_preset NOT NULL DEFAULT 'tax_invoice',
  language public.receipt_template_language NOT NULL DEFAULT 'bilingual',
  paper_width smallint NOT NULL DEFAULT 80 CHECK (paper_width IN (58,80)),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  header_note_en text,
  header_note_ar text,
  footer_note_en text,
  footer_note_ar text,
  is_default_simplified boolean NOT NULL DEFAULT false,
  is_default_standard boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receipt_templates_tenant_idx ON public.receipt_templates(tenant_id) WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipt_templates TO authenticated;
GRANT ALL ON public.receipt_templates TO service_role;

ALTER TABLE public.receipt_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read receipt templates"
ON public.receipt_templates FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Owners/managers manage receipt templates"
ON public.receipt_templates FOR ALL TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('owner','manager','superadmin')
  )
)
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('owner','manager','superadmin')
  )
);

CREATE TRIGGER trg_receipt_templates_updated_at
BEFORE UPDATE ON public.receipt_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pos_hardware_settings
  ADD COLUMN IF NOT EXISTS default_simplified_template_id uuid REFERENCES public.receipt_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_standard_template_id   uuid REFERENCES public.receipt_templates(id) ON DELETE SET NULL;

ALTER TABLE public.pos_hardware_settings
  DROP CONSTRAINT IF EXISTS pos_hardware_settings_receipt_template_check;
ALTER TABLE public.pos_hardware_settings
  ADD CONSTRAINT pos_hardware_settings_receipt_template_check
  CHECK (receipt_template IN ('simple','tax_invoice','detailed','saudi_bilingual','zatca_standard'));
