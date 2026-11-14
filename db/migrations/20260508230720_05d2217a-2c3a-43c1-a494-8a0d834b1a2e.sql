
CREATE TABLE public.variance_note_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  restaurant_id UUID,
  created_by UUID,
  label TEXT NOT NULL,
  body TEXT NOT NULL,
  reason TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.variance_note_templates ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_variance_note_templates_tenant ON public.variance_note_templates(tenant_id, restaurant_id);

CREATE POLICY "Tenant members can view templates"
  ON public.variance_note_templates FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can insert templates"
  ON public.variance_note_templates FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can update templates"
  ON public.variance_note_templates FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can delete templates"
  ON public.variance_note_templates FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE TRIGGER trg_variance_note_templates_updated_at
  BEFORE UPDATE ON public.variance_note_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
