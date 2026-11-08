CREATE TABLE IF NOT EXISTS public.supplier_ap_account_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  supplier_id uuid,
  supplier_name text,
  account_id uuid,
  account_code text,
  account_name text,
  action text NOT NULL,
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_ap_audit_tenant_created
  ON public.supplier_ap_account_audit (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_ap_audit_supplier
  ON public.supplier_ap_account_audit (supplier_id);

GRANT SELECT ON public.supplier_ap_account_audit TO authenticated;
GRANT ALL ON public.supplier_ap_account_audit TO service_role;

ALTER TABLE public.supplier_ap_account_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance staff can view supplier AP audit" ON public.supplier_ap_account_audit;
CREATE POLICY "Finance staff can view supplier AP audit"
ON public.supplier_ap_account_audit
FOR SELECT
TO authenticated
USING (
  public.can_access_restaurant(tenant_id)
  AND (
    public.has_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), tenant_id, 'manager'::app_role)
    OR public.has_role(auth.uid(), tenant_id, 'accountant'::app_role)
    OR public.has_role(auth.uid(), tenant_id, 'superadmin'::app_role)
  )
);

-- Log link / unlink of a supplier's AP head
CREATE OR REPLACE FUNCTION public.log_supplier_ap_account_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct RECORD;
  v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.ap_account_id IS NULL THEN RETURN NULL; END IF;
    v_action := 'created';
  ELSE
    IF NEW.ap_account_id IS NOT DISTINCT FROM OLD.ap_account_id THEN RETURN NULL; END IF;
    v_action := CASE
      WHEN OLD.ap_account_id IS NULL THEN 'created'
      WHEN NEW.ap_account_id IS NULL THEN 'unlinked'
      ELSE 'relinked'
    END;
  END IF;

  SELECT account_code, account_name INTO v_acct
  FROM public.chart_of_accounts
  WHERE id = COALESCE(NEW.ap_account_id, OLD.ap_account_id);

  INSERT INTO public.supplier_ap_account_audit (
    tenant_id, supplier_id, supplier_name, account_id, account_code, account_name,
    action, changed_fields, performed_by
  ) VALUES (
    NEW.restaurant_id, NEW.id, NEW.name,
    COALESCE(NEW.ap_account_id, OLD.ap_account_id),
    v_acct.account_code, v_acct.account_name,
    v_action,
    jsonb_build_object(
      'ap_account_id', jsonb_build_object(
        'from', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD.ap_account_id) ELSE 'null'::jsonb END,
        'to', to_jsonb(NEW.ap_account_id)
      )
    ),
    auth.uid()
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_supplier_ap_account_link ON public.suppliers;
CREATE TRIGGER trg_log_supplier_ap_account_link
AFTER INSERT OR UPDATE OF ap_account_id ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.log_supplier_ap_account_link();

-- Log edits made to an account that serves as a supplier AP head
CREATE OR REPLACE FUNCTION public.log_supplier_ap_account_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sup RECORD;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  SELECT id, name INTO v_sup FROM public.suppliers WHERE ap_account_id = NEW.id LIMIT 1;
  IF v_sup.id IS NULL THEN RETURN NULL; END IF;

  IF NEW.account_code IS DISTINCT FROM OLD.account_code THEN
    v_changes := v_changes || jsonb_build_object('account_code',
      jsonb_build_object('from', OLD.account_code, 'to', NEW.account_code));
  END IF;
  IF NEW.account_name IS DISTINCT FROM OLD.account_name THEN
    v_changes := v_changes || jsonb_build_object('account_name',
      jsonb_build_object('from', OLD.account_name, 'to', NEW.account_name));
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    v_changes := v_changes || jsonb_build_object('is_active',
      jsonb_build_object('from', OLD.is_active, 'to', NEW.is_active));
  END IF;

  IF v_changes = '{}'::jsonb THEN RETURN NULL; END IF;

  INSERT INTO public.supplier_ap_account_audit (
    tenant_id, supplier_id, supplier_name, account_id, account_code, account_name,
    action, changed_fields, performed_by
  ) VALUES (
    NEW.tenant_id, v_sup.id, v_sup.name, NEW.id, NEW.account_code, NEW.account_name,
    CASE WHEN NEW.is_active IS DISTINCT FROM OLD.is_active
         THEN (CASE WHEN NEW.is_active THEN 'activated' ELSE 'deactivated' END)
         ELSE 'modified' END,
    v_changes,
    auth.uid()
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_supplier_ap_account_change ON public.chart_of_accounts;
CREATE TRIGGER trg_log_supplier_ap_account_change
AFTER UPDATE ON public.chart_of_accounts
FOR EACH ROW EXECUTE FUNCTION public.log_supplier_ap_account_change();