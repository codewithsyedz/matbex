
CREATE TABLE public.installment_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid,
  plan_id uuid REFERENCES public.installment_plans(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.fixed_assets(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  action text NOT NULL,
  summary text,
  old_data jsonb,
  new_data jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.installment_audit_events TO authenticated;
GRANT ALL ON public.installment_audit_events TO service_role;

ALTER TABLE public.installment_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles can view installment audit"
ON public.installment_audit_events FOR SELECT TO authenticated
USING (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id));

CREATE INDEX idx_installment_audit_plan ON public.installment_audit_events(plan_id, created_at DESC);
CREATE INDEX idx_installment_audit_asset ON public.installment_audit_events(asset_id, created_at DESC);
CREATE INDEX idx_installment_audit_tenant ON public.installment_audit_events(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_installment_plan_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_summary text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'plan_created';
    v_summary := format('Installment purchase created: %s (%s x total %s)',
      COALESCE(NEW.description, NEW.supplier_name, 'purchase'),
      NEW.installment_count, NEW.total_payable);
  ELSE
    IF NEW.installment_count IS DISTINCT FROM OLD.installment_count
       OR NEW.first_due_date IS DISTINCT FROM OLD.first_due_date
       OR NEW.frequency IS DISTINCT FROM OLD.frequency THEN
      v_action := 'plan_rescheduled';
      v_summary := format('Schedule changed: %s -> %s installments, first due %s -> %s',
        OLD.installment_count, NEW.installment_count, OLD.first_due_date, NEW.first_due_date);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'plan_status_changed';
      v_summary := format('Status %s -> %s', OLD.status, NEW.status);
    ELSIF NEW.invoice_url IS DISTINCT FROM OLD.invoice_url THEN
      v_action := 'invoice_updated';
      v_summary := CASE WHEN NEW.invoice_url IS NULL THEN 'Invoice attachment removed'
                        ELSE 'Invoice attachment updated' END;
    ELSIF NEW.asset_id IS DISTINCT FROM OLD.asset_id THEN
      v_action := 'asset_linked';
      v_summary := 'Fixed asset linked to installment purchase';
    ELSIF NEW.asset_class_id IS DISTINCT FROM OLD.asset_class_id THEN
      v_action := 'asset_class_updated';
      v_summary := 'Fixed asset class updated';
    ELSE
      v_action := 'plan_updated';
      v_summary := 'Installment purchase details updated';
    END IF;
  END IF;

  INSERT INTO public.installment_audit_events (
    tenant_id, branch_id, plan_id, asset_id, entity_type, action, summary,
    old_data, new_data, actor_id
  ) VALUES (
    NEW.tenant_id, NEW.branch_id, NEW.id, NEW.asset_id, 'installment_plan',
    v_action, v_summary,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    auth.uid()
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_installment_plan_audit
AFTER INSERT OR UPDATE ON public.installment_plans
FOR EACH ROW EXECUTE FUNCTION public.log_installment_plan_audit();

CREATE OR REPLACE FUNCTION public.log_installment_asset_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_action text;
  v_summary text;
BEGIN
  SELECT id INTO v_plan_id FROM public.installment_plans WHERE asset_id = NEW.id LIMIT 1;

  IF v_plan_id IS NULL AND NEW.source IS DISTINCT FROM 'installment' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'asset_registered';
    v_summary := format('Fixed asset registered: %s (cost %s)', NEW.name, NEW.cost);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_action := 'asset_status_changed';
    v_summary := format('Asset status %s -> %s', OLD.status, NEW.status);
  ELSIF NEW.accumulated_depreciation IS DISTINCT FROM OLD.accumulated_depreciation THEN
    v_action := 'asset_depreciated';
    v_summary := format('Accumulated depreciation %s -> %s', OLD.accumulated_depreciation, NEW.accumulated_depreciation);
  ELSE
    v_action := 'asset_updated';
    v_summary := 'Fixed asset details updated';
  END IF;

  INSERT INTO public.installment_audit_events (
    tenant_id, branch_id, plan_id, asset_id, entity_type, action, summary,
    old_data, new_data, actor_id
  ) VALUES (
    NEW.tenant_id, NEW.branch_id, v_plan_id, NEW.id, 'fixed_asset',
    v_action, v_summary,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    auth.uid()
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_installment_asset_audit
AFTER INSERT OR UPDATE ON public.fixed_assets
FOR EACH ROW EXECUTE FUNCTION public.log_installment_asset_audit();
