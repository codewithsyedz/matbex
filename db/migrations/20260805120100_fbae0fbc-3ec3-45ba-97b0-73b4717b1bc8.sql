
-- 1. Audit trail for installment payments
CREATE OR REPLACE FUNCTION public.audit_installment_payment_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'paid' THEN
    v_action := 'installment_payment_paid';
  ELSIF TG_OP = 'UPDATE' AND OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL THEN
    v_action := 'installment_payment_voided';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_logs (user_id, tenant_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (
    auth.uid(),
    NEW.tenant_id,
    v_action,
    'installment_payment',
    NEW.id,
    jsonb_build_object(
      'status', OLD.status,
      'paid_amount', OLD.paid_amount,
      'paid_date', OLD.paid_date,
      'voided_at', OLD.voided_at
    ),
    jsonb_build_object(
      'plan_id', NEW.plan_id,
      'branch_id', NEW.branch_id,
      'installment_no', NEW.installment_no,
      'due_date', NEW.due_date,
      'amount', NEW.amount,
      'status', NEW.status,
      'paid_amount', NEW.paid_amount,
      'paid_date', NEW.paid_date,
      'funding_source', NEW.funding_source,
      'payment_account_id', NEW.payment_account_id,
      'capital_account_id', NEW.capital_account_id,
      'reference_number', NEW.reference_number,
      'batch_id', NEW.batch_id,
      'void_reason', NEW.void_reason
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_installment_payment ON public.installment_payments;
CREATE TRIGGER trg_audit_installment_payment
AFTER UPDATE ON public.installment_payments
FOR EACH ROW EXECUTE FUNCTION public.audit_installment_payment_changes();

-- 2. One-click mark as paid: resolves a default company cash/bank account when none supplied
CREATE OR REPLACE FUNCTION public.quick_pay_installment(
  p_installment_id uuid,
  p_payment_account_id uuid DEFAULT NULL,
  p_paid_date date DEFAULT NULL,
  p_reference_number text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.installment_payments%ROWTYPE;
  v_account uuid := p_payment_account_id;
BEGIN
  SELECT * INTO v_pay FROM public.installment_payments WHERE id = p_installment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Installment not found';
  END IF;

  IF NOT public.can_access_restaurant(v_pay.tenant_id) THEN
    RAISE EXCEPTION 'Not authorised for this installment';
  END IF;

  IF v_pay.status = 'paid' THEN
    RAISE EXCEPTION 'Installment % is already paid', v_pay.installment_no;
  END IF;

  IF v_account IS NULL THEN
    SELECT id INTO v_account
    FROM public.chart_of_accounts
    WHERE tenant_id = v_pay.tenant_id
      AND is_active = true
      AND account_type = 'asset'
      AND account_code BETWEEN '1000' AND '1019'
    ORDER BY account_code
    LIMIT 1;
  END IF;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'No cash or bank account configured. Open the Chart of Accounts and add a cash/bank account (1000-1019) first.';
  END IF;

  RETURN public.pay_installment(
    p_installment_id := p_installment_id,
    p_payment_account_id := v_account,
    p_paid_date := COALESCE(p_paid_date, CURRENT_DATE),
    p_funding_source := 'company',
    p_capital_account_id := NULL,
    p_reference_number := p_reference_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.quick_pay_installment(uuid, uuid, date, text) TO authenticated;

-- 3. Overdue installments helper (used by the reminder job and the UI)
CREATE OR REPLACE FUNCTION public.get_overdue_installments(p_tenant_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  installment_id uuid,
  plan_id uuid,
  branch_id uuid,
  provider text,
  supplier_name text,
  description text,
  installment_no integer,
  due_date date,
  amount numeric,
  days_overdue integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ip.id, ip.plan_id, ip.branch_id, pl.provider, pl.supplier_name, pl.description,
         ip.installment_no, ip.due_date, ip.amount,
         (p_as_of - ip.due_date)::int
  FROM public.installment_payments ip
  JOIN public.installment_plans pl ON pl.id = ip.plan_id
  WHERE ip.tenant_id = p_tenant_id
    AND ip.voided_at IS NULL
    AND ip.status <> 'paid'
    AND ip.due_date < p_as_of
    AND pl.status = 'active'
  ORDER BY ip.due_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_overdue_installments(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_overdue_installments(uuid, date) TO service_role;
