
CREATE TABLE IF NOT EXISTS public.installment_vat_mismatch_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid,
  plan_id uuid NOT NULL REFERENCES public.installment_plans(id) ON DELETE CASCADE,
  batch_id uuid,
  purchase_date date,
  expected_vat numeric NOT NULL DEFAULT 0,
  posted_vat numeric NOT NULL DEFAULT 0,
  goods_vat numeric NOT NULL DEFAULT 0,
  finance_vat numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  detail text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installment_vat_mismatch_status_chk CHECK (status IN ('open','resolved'))
);

CREATE UNIQUE INDEX IF NOT EXISTS installment_vat_mismatch_open_plan_uidx
  ON public.installment_vat_mismatch_alerts (plan_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS installment_vat_mismatch_tenant_idx
  ON public.installment_vat_mismatch_alerts (tenant_id, branch_id, status, detected_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.installment_vat_mismatch_alerts TO authenticated;
GRANT ALL ON public.installment_vat_mismatch_alerts TO service_role;

ALTER TABLE public.installment_vat_mismatch_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles view installment VAT alerts"
ON public.installment_vat_mismatch_alerts FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_role(auth.uid(), tenant_id, 'owner'::public.app_role)
    OR public.has_role(auth.uid(), tenant_id, 'manager'::public.app_role)
    OR public.has_role(auth.uid(), tenant_id, 'accountant'::public.app_role)
    OR public.has_role(auth.uid(), tenant_id, 'superadmin'::public.app_role)
  )
);

CREATE POLICY "Finance roles update installment VAT alerts"
ON public.installment_vat_mismatch_alerts FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_role(auth.uid(), tenant_id, 'owner'::public.app_role)
    OR public.has_role(auth.uid(), tenant_id, 'manager'::public.app_role)
    OR public.has_role(auth.uid(), tenant_id, 'accountant'::public.app_role)
  )
)
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TRIGGER trg_installment_vat_mismatch_updated_at
BEFORE UPDATE ON public.installment_vat_mismatch_alerts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Core detection: compare a plan's recoverable VAT with what actually hit input VAT accounts
CREATE OR REPLACE FUNCTION public.detect_installment_vat_mismatch(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan record;
  v_goods numeric := 0;
  v_finance numeric := 0;
  v_expected numeric := 0;
  v_posted numeric := 0;
  v_diff numeric := 0;
  v_tol numeric := 0.02;
  v_existing uuid;
  v_alert_id uuid;
  v_detail text;
  r record;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_goods := COALESCE(v_plan.vat_amount, 0);
  v_finance := COALESCE(v_plan.finance_vat_amount, 0);
  v_expected := ROUND(v_goods + v_finance, 2);

  IF v_plan.batch_id IS NOT NULL THEN
    SELECT COALESCE(SUM(t.debit - t.credit), 0) INTO v_posted
    FROM public.account_transactions t
    JOIN public.chart_of_accounts a ON a.id = t.account_id
    WHERE t.batch_id = v_plan.batch_id
      AND COALESCE(t.is_voided, false) = false
      AND (
        a.account_code IN ('1180','1181','1182')
        OR lower(a.account_name) LIKE '%input vat%'
        OR lower(a.account_name) LIKE '%vat recoverable%'
      );
  END IF;
  v_posted := ROUND(COALESCE(v_posted, 0), 2);
  v_diff := ROUND(v_posted - v_expected, 2);

  SELECT id INTO v_existing
  FROM public.installment_vat_mismatch_alerts
  WHERE plan_id = p_plan_id AND status = 'open';

  -- Cancelled plans and matched plans close any open alert
  IF lower(COALESCE(v_plan.status, '')) = 'cancelled' OR ABS(v_diff) <= v_tol THEN
    IF v_existing IS NOT NULL THEN
      UPDATE public.installment_vat_mismatch_alerts
      SET status = 'resolved', resolved_at = now(), posted_vat = v_posted, difference = v_diff
      WHERE id = v_existing;
    END IF;
    RETURN;
  END IF;

  v_detail := format(
    'Recoverable VAT on this installment purchase is %s (goods %s + finance charge %s) but %s was posted to input VAT%s.',
    v_expected, ROUND(v_goods, 2), ROUND(v_finance, 2), v_posted,
    CASE WHEN v_plan.batch_id IS NULL THEN ' (no ledger batch linked)' ELSE '' END
  );

  IF v_existing IS NOT NULL THEN
    UPDATE public.installment_vat_mismatch_alerts
    SET expected_vat = v_expected, posted_vat = v_posted, goods_vat = ROUND(v_goods, 2),
        finance_vat = ROUND(v_finance, 2), difference = v_diff, detail = v_detail,
        batch_id = v_plan.batch_id, branch_id = v_plan.branch_id,
        purchase_date = v_plan.purchase_date, detected_at = now()
    WHERE id = v_existing;
    RETURN; -- already alerted; no duplicate notification
  END IF;

  INSERT INTO public.installment_vat_mismatch_alerts (
    tenant_id, branch_id, plan_id, batch_id, purchase_date,
    expected_vat, posted_vat, goods_vat, finance_vat, difference, detail
  ) VALUES (
    v_plan.tenant_id, v_plan.branch_id, v_plan.id, v_plan.batch_id, v_plan.purchase_date,
    v_expected, v_posted, ROUND(v_goods, 2), ROUND(v_finance, 2), v_diff, v_detail
  )
  RETURNING id INTO v_alert_id;

  FOR r IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE p.tenant_id = v_plan.tenant_id
      AND ur.role IN ('owner'::public.app_role,'manager'::public.app_role,'accountant'::public.app_role)
  LOOP
    INSERT INTO public.in_app_notifications (
      user_id, tenant_id, title, message, action_type, entity_type, entity_id, metadata
    ) VALUES (
      r.user_id, v_plan.tenant_id,
      'Installment VAT mismatch detected',
      COALESCE(v_plan.description, v_plan.supplier_name, 'Installment purchase') || ': ' || v_detail,
      'vat_mismatch', 'installment_vat_mismatch_alert', v_alert_id,
      jsonb_build_object(
        'plan_id', v_plan.id,
        'branch_id', v_plan.branch_id,
        'batch_id', v_plan.batch_id,
        'purchase_date', v_plan.purchase_date,
        'expected_vat', v_expected,
        'posted_vat', v_posted,
        'goods_vat', ROUND(v_goods, 2),
        'finance_vat', ROUND(v_finance, 2),
        'difference', v_diff
      )
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_installment_plan_vat_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.detect_installment_vat_mismatch(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_installment_plans_vat_check ON public.installment_plans;
CREATE TRIGGER trg_installment_plans_vat_check
AFTER INSERT OR UPDATE OF vat_amount, finance_vat_amount, batch_id, status, branch_id
ON public.installment_plans
FOR EACH ROW EXECUTE FUNCTION public.trg_installment_plan_vat_check();

CREATE OR REPLACE FUNCTION public.trg_account_txn_installment_vat_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid := COALESCE(NEW.batch_id, OLD.batch_id);
  v_plan uuid;
BEGIN
  IF v_batch IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT id INTO v_plan FROM public.installment_plans WHERE batch_id = v_batch LIMIT 1;
  IF v_plan IS NOT NULL THEN
    PERFORM public.detect_installment_vat_mismatch(v_plan);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_account_txns_installment_vat_check ON public.account_transactions;
CREATE TRIGGER trg_account_txns_installment_vat_check
AFTER INSERT OR UPDATE OF debit, credit, is_voided, account_id, batch_id
ON public.account_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_account_txn_installment_vat_check();

-- Backfill: evaluate existing plans once
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.installment_plans LOOP
    PERFORM public.detect_installment_vat_mismatch(r.id);
  END LOOP;
END $$;
