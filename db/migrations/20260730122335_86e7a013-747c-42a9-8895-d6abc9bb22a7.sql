CREATE TABLE public.vat_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  branch_id uuid,
  transaction_id uuid NOT NULL REFERENCES public.sales_transactions(id) ON DELETE CASCADE,
  receipt_number text,
  transaction_date timestamptz,
  issue_kind text NOT NULL,
  vat_rate numeric NOT NULL DEFAULT 0.15,
  stored_subtotal numeric NOT NULL DEFAULT 0,
  stored_tax numeric NOT NULL DEFAULT 0,
  stored_total numeric NOT NULL DEFAULT 0,
  expected_subtotal numeric NOT NULL DEFAULT 0,
  expected_tax numeric NOT NULL DEFAULT 0,
  expected_total numeric NOT NULL DEFAULT 0,
  delta numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  resolved_by uuid,
  resolved_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vat_incidents_status_check CHECK (status IN ('open','resolved','ignored')),
  CONSTRAINT vat_incidents_unique_open UNIQUE (transaction_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vat_incidents TO authenticated;
GRANT ALL ON public.vat_incidents TO service_role;

ALTER TABLE public.vat_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view vat incidents"
ON public.vat_incidents FOR SELECT TO authenticated
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Managers can update vat incidents"
ON public.vat_incidents FOR UPDATE TO authenticated
USING (
  public.can_access_restaurant(restaurant_id) AND (
    public.has_tenant_role(auth.uid(), public.get_restaurant_tenant_id(restaurant_id), 'owner'::app_role) OR
    public.has_tenant_role(auth.uid(), public.get_restaurant_tenant_id(restaurant_id), 'manager'::app_role) OR
    public.has_tenant_role(auth.uid(), public.get_restaurant_tenant_id(restaurant_id), 'accountant'::app_role)
  )
)
WITH CHECK (public.can_access_restaurant(restaurant_id));

CREATE INDEX idx_vat_incidents_restaurant ON public.vat_incidents (restaurant_id, status, created_at DESC);
CREATE INDEX idx_vat_incidents_branch ON public.vat_incidents (branch_id);

CREATE TRIGGER update_vat_incidents_updated_at
BEFORE UPDATE ON public.vat_incidents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.detect_vat_incident()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric := 0.15;
  v_items_gross numeric;
  v_gross numeric;
  v_net numeric;
  v_vat numeric;
  v_issue text;
  v_tol numeric := 0.02;
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    SELECT COALESCE(b.vat_rate, 15) / 100.0 INTO v_rate FROM public.branches b WHERE b.id = NEW.branch_id;
    v_rate := COALESCE(v_rate, 0.15);
  END IF;

  SELECT SUM(si.total_price) INTO v_items_gross
  FROM public.sales_items si WHERE si.transaction_id = NEW.id;

  v_gross := ROUND(COALESCE(v_items_gross, NEW.total, 0)::numeric, 2);
  v_net := ROUND(v_gross / (1 + v_rate), 2);
  v_vat := ROUND(v_gross - v_net, 2);

  IF v_items_gross IS NOT NULL AND ABS(COALESCE(NEW.total,0) - v_items_gross) > v_tol THEN
    IF ABS(COALESCE(NEW.total,0) - ROUND(v_items_gross * (1 + v_rate), 2)) <= v_tol THEN
      v_issue := 'vat_on_top';
    ELSE
      v_issue := 'items_mismatch';
    END IF;
  ELSIF COALESCE(NEW.tax,0) = 0 AND v_vat > 0 THEN
    v_issue := 'missing_vat';
  ELSIF ABS(COALESCE(NEW.subtotal,0) - v_net) > v_tol OR ABS(COALESCE(NEW.tax,0) - v_vat) > v_tol THEN
    v_issue := 'wrong_split';
  END IF;

  IF v_issue IS NULL THEN
    UPDATE public.vat_incidents
       SET status = 'resolved', resolved_at = now(), note = COALESCE(note, 'Auto-resolved: totals now reconcile')
     WHERE transaction_id = NEW.id AND status = 'open';
    RETURN NEW;
  END IF;

  INSERT INTO public.vat_incidents (
    restaurant_id, branch_id, transaction_id, receipt_number, transaction_date,
    issue_kind, vat_rate, stored_subtotal, stored_tax, stored_total,
    expected_subtotal, expected_tax, expected_total, delta
  ) VALUES (
    NEW.restaurant_id, NEW.branch_id, NEW.id, NEW.receipt_number, NEW.created_at,
    v_issue, v_rate, COALESCE(NEW.subtotal,0), COALESCE(NEW.tax,0), COALESCE(NEW.total,0),
    v_net, v_vat, v_gross, ROUND(v_gross - COALESCE(NEW.total,0), 2)
  )
  ON CONFLICT (transaction_id) DO UPDATE SET
    issue_kind = EXCLUDED.issue_kind,
    vat_rate = EXCLUDED.vat_rate,
    stored_subtotal = EXCLUDED.stored_subtotal,
    stored_tax = EXCLUDED.stored_tax,
    stored_total = EXCLUDED.stored_total,
    expected_subtotal = EXCLUDED.expected_subtotal,
    expected_tax = EXCLUDED.expected_tax,
    expected_total = EXCLUDED.expected_total,
    delta = EXCLUDED.delta,
    status = CASE WHEN public.vat_incidents.status = 'ignored' THEN 'ignored' ELSE 'open' END,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_detect_vat_incident
AFTER INSERT OR UPDATE OF subtotal, tax, total ON public.sales_transactions
FOR EACH ROW EXECUTE FUNCTION public.detect_vat_incident();