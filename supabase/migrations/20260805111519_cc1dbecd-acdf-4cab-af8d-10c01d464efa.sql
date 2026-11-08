
-- ============ Accounts helper ============
CREATE OR REPLACE FUNCTION public.ensure_installment_accounts(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
  VALUES (_tenant_id, '2450', 'BNPL / Installment Payable', 'liability',
          'Amounts payable to installment providers (Tabby, Tamara, bank plans)', true)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
  VALUES (_tenant_id, '6850', 'Finance & Installment Charges', 'expense',
          'Markup / fees charged by installment and BNPL providers', true)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;
END;
$$;

-- ============ Tables ============
CREATE TABLE public.installment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id),
  provider text NOT NULL DEFAULT 'tabby',
  supplier_name text,
  description text NOT NULL,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  target_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  liability_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  finance_account_id uuid REFERENCES public.chart_of_accounts(id),
  cash_price numeric(15,2) NOT NULL CHECK (cash_price > 0),
  finance_charge numeric(15,2) NOT NULL DEFAULT 0 CHECK (finance_charge >= 0),
  total_payable numeric(15,2) NOT NULL CHECK (total_payable > 0),
  installment_count integer NOT NULL CHECK (installment_count between 1 and 120),
  first_due_date date NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly',
  status text NOT NULL DEFAULT 'active',
  notes text,
  batch_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.installment_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.installment_plans(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id),
  installment_no integer NOT NULL,
  due_date date NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  paid_amount numeric(15,2) NOT NULL DEFAULT 0,
  paid_date date,
  status text NOT NULL DEFAULT 'pending',
  funding_source text NOT NULL DEFAULT 'company',
  payment_account_id uuid REFERENCES public.chart_of_accounts(id),
  capital_account_id uuid REFERENCES public.owner_capital_accounts(id),
  batch_id uuid,
  reference_number text,
  paid_by uuid,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, installment_no)
);

CREATE INDEX idx_installment_plans_tenant ON public.installment_plans(tenant_id, status);
CREATE INDEX idx_installment_plans_branch ON public.installment_plans(branch_id);
CREATE INDEX idx_installment_payments_plan ON public.installment_payments(plan_id, installment_no);
CREATE INDEX idx_installment_payments_due ON public.installment_payments(tenant_id, status, due_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.installment_plans TO authenticated;
GRANT ALL ON public.installment_plans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.installment_payments TO authenticated;
GRANT ALL ON public.installment_payments TO service_role;

ALTER TABLE public.installment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view installment plans"
ON public.installment_plans FOR SELECT TO authenticated
USING (public.is_superadmin(auth.uid()) OR public.user_belongs_to_tenant(auth.uid(), tenant_id));

CREATE POLICY "Finance roles can manage installment plans"
ON public.installment_plans FOR ALL TO authenticated
USING (public.can_manage_capital(tenant_id))
WITH CHECK (public.can_manage_capital(tenant_id));

CREATE POLICY "Tenant users can view installment payments"
ON public.installment_payments FOR SELECT TO authenticated
USING (public.is_superadmin(auth.uid()) OR public.user_belongs_to_tenant(auth.uid(), tenant_id));

CREATE POLICY "Finance roles can manage installment payments"
ON public.installment_payments FOR ALL TO authenticated
USING (public.can_manage_capital(tenant_id))
WITH CHECK (public.can_manage_capital(tenant_id));

CREATE TRIGGER trg_installment_plans_updated_at
BEFORE UPDATE ON public.installment_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Create plan ============
CREATE OR REPLACE FUNCTION public.create_installment_plan(
  p_tenant_id uuid,
  p_description text,
  p_target_account_id uuid,
  p_cash_price numeric,
  p_installment_count integer,
  p_first_due_date date,
  p_provider text DEFAULT 'tabby',
  p_supplier_name text DEFAULT NULL,
  p_purchase_date date DEFAULT CURRENT_DATE,
  p_finance_charge numeric DEFAULT 0,
  p_frequency text DEFAULT 'monthly',
  p_branch_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch uuid := p_branch_id;
  v_liability uuid;
  v_finance uuid;
  v_total numeric(15,2);
  v_plan uuid;
  v_batch uuid;
  v_desc text;
  v_i integer;
  v_base numeric(15,2);
  v_last numeric(15,2);
  v_due date;
  v_interval interval;
BEGIN
  IF NOT public.can_manage_capital(p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can record installment purchases';
  END IF;

  IF COALESCE(p_cash_price, 0) <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: cash price must be greater than zero';
  END IF;
  IF COALESCE(p_installment_count, 0) < 1 THEN
    RAISE EXCEPTION 'INVALID_COUNT: at least one installment is required';
  END IF;
  IF p_frequency NOT IN ('weekly', 'biweekly', 'monthly') THEN
    RAISE EXCEPTION 'INVALID_FREQUENCY';
  END IF;

  PERFORM public.ensure_installment_accounts(p_tenant_id);
  v_liability := public.get_account_id_by_code(p_tenant_id, '2450');
  v_finance := public.get_account_id_by_code(p_tenant_id, '6850');

  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                 WHERE id = p_target_account_id AND tenant_id = p_tenant_id AND is_active) THEN
    RAISE EXCEPTION 'INVALID_TARGET_ACCOUNT';
  END IF;

  IF v_branch IS NULL THEN
    SELECT b.id INTO v_branch
    FROM public.branches b
    JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE r.tenant_id = p_tenant_id AND b.is_active AND b.deleted_at IS NULL
    ORDER BY b.is_primary DESC, b.created_at
    LIMIT 1;
  END IF;

  v_total := ROUND(p_cash_price + COALESCE(p_finance_charge, 0), 2);
  v_desc := 'Installment purchase - ' || p_description ||
            CASE WHEN p_supplier_name IS NOT NULL THEN ' (' || p_supplier_name || ')' ELSE '' END;

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
  VALUES
    (p_tenant_id, p_purchase_date, v_desc, 'INST-' || to_char(now(), 'YYYYMMDDHH24MISS'),
     'adjustment', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), v_branch)
  RETURNING id INTO v_batch;

  INSERT INTO public.installment_plans
    (tenant_id, branch_id, provider, supplier_name, description, purchase_date,
     target_account_id, liability_account_id, finance_account_id, cash_price, finance_charge,
     total_payable, installment_count, first_due_date, frequency, notes, batch_id, created_by)
  VALUES
    (p_tenant_id, v_branch, p_provider, p_supplier_name, p_description, p_purchase_date,
     p_target_account_id, v_liability, v_finance, ROUND(p_cash_price, 2), ROUND(COALESCE(p_finance_charge, 0), 2),
     v_total, p_installment_count, p_first_due_date, p_frequency, p_notes, v_batch, auth.uid())
  RETURNING id INTO v_plan;

  -- DR asset/expense (cash price), DR finance charge (markup), CR BNPL payable (total)
  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description,
     reference_type, reference_id, created_by, batch_id, branch_id)
  VALUES
    (p_tenant_id, p_target_account_id, p_purchase_date, ROUND(p_cash_price, 2), 0, v_desc,
     'installment_plan', v_plan, auth.uid(), v_batch, v_branch);

  IF COALESCE(p_finance_charge, 0) > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (p_tenant_id, v_finance, p_purchase_date, ROUND(p_finance_charge, 2), 0,
       v_desc || ' - finance charge', 'installment_plan', v_plan, auth.uid(), v_batch, v_branch);
  END IF;

  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description,
     reference_type, reference_id, created_by, batch_id, branch_id)
  VALUES
    (p_tenant_id, v_liability, p_purchase_date, 0, v_total, v_desc,
     'installment_plan', v_plan, auth.uid(), v_batch, v_branch);

  -- schedule
  v_base := ROUND(v_total / p_installment_count, 2);
  v_last := ROUND(v_total - (v_base * (p_installment_count - 1)), 2);
  v_interval := CASE p_frequency
                  WHEN 'weekly' THEN interval '7 days'
                  WHEN 'biweekly' THEN interval '14 days'
                  ELSE interval '1 month' END;

  FOR v_i IN 1..p_installment_count LOOP
    v_due := (p_first_due_date + (v_interval * (v_i - 1)))::date;
    INSERT INTO public.installment_payments
      (tenant_id, plan_id, branch_id, installment_no, due_date, amount)
    VALUES
      (p_tenant_id, v_plan, v_branch, v_i, v_due,
       CASE WHEN v_i = p_installment_count THEN v_last ELSE v_base END);
  END LOOP;

  RETURN v_plan;
END;
$$;

-- ============ Pay installment ============
CREATE OR REPLACE FUNCTION public.pay_installment(
  p_installment_id uuid,
  p_payment_account_id uuid DEFAULT NULL,
  p_paid_date date DEFAULT CURRENT_DATE,
  p_funding_source text DEFAULT 'company',
  p_capital_account_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row RECORD;
  v_plan RECORD;
  v_credit_account uuid;
  v_batch uuid;
  v_desc text;
  v_remaining integer;
BEGIN
  SELECT * INTO v_row FROM public.installment_payments WHERE id = p_installment_id;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'INSTALLMENT_NOT_FOUND';
  END IF;
  IF NOT public.can_manage_capital(v_row.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can settle installments';
  END IF;
  IF v_row.status = 'paid' THEN
    RAISE EXCEPTION 'ALREADY_PAID: installment % is already settled', v_row.installment_no;
  END IF;

  SELECT * INTO v_plan FROM public.installment_plans WHERE id = v_row.plan_id;

  IF p_funding_source = 'partner' THEN
    IF p_capital_account_id IS NULL THEN
      RAISE EXCEPTION 'CAPITAL_ACCOUNT_REQUIRED: select the partner account funding this installment';
    END IF;
    SELECT equity_account_id INTO v_credit_account
    FROM public.owner_capital_accounts WHERE id = p_capital_account_id AND tenant_id = v_row.tenant_id;
    IF v_credit_account IS NULL THEN
      RAISE EXCEPTION 'CAPITAL_ACCOUNT_NOT_FOUND';
    END IF;
  ELSE
    IF p_payment_account_id IS NULL THEN
      RAISE EXCEPTION 'PAYMENT_ACCOUNT_REQUIRED: select the cash or bank account funding this installment';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                   WHERE id = p_payment_account_id AND tenant_id = v_row.tenant_id AND is_active) THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_ACCOUNT';
    END IF;
    v_credit_account := p_payment_account_id;
  END IF;

  v_desc := 'Installment ' || v_row.installment_no || '/' || v_plan.installment_count ||
            ' - ' || v_plan.description;

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
  VALUES
    (v_row.tenant_id, p_paid_date, v_desc,
     COALESCE(p_reference_number, 'INSTP-' || to_char(now(), 'YYYYMMDDHH24MISS')),
     'expense', 'expense', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), v_row.branch_id)
  RETURNING id INTO v_batch;

  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description,
     reference_type, reference_id, created_by, batch_id, branch_id)
  VALUES
    (v_row.tenant_id, v_plan.liability_account_id, p_paid_date, v_row.amount, 0, v_desc,
     'installment_payment', v_row.id, auth.uid(), v_batch, v_row.branch_id),
    (v_row.tenant_id, v_credit_account, p_paid_date, 0, v_row.amount, v_desc,
     'installment_payment', v_row.id, auth.uid(), v_batch, v_row.branch_id);

  UPDATE public.installment_payments
  SET status = 'paid',
      paid_amount = amount,
      paid_date = p_paid_date,
      funding_source = p_funding_source,
      payment_account_id = CASE WHEN p_funding_source = 'partner' THEN NULL ELSE p_payment_account_id END,
      capital_account_id = CASE WHEN p_funding_source = 'partner' THEN p_capital_account_id ELSE NULL END,
      batch_id = v_batch,
      reference_number = p_reference_number,
      paid_by = auth.uid()
  WHERE id = p_installment_id;

  SELECT count(*) INTO v_remaining
  FROM public.installment_payments
  WHERE plan_id = v_row.plan_id AND status <> 'paid';

  UPDATE public.installment_plans
  SET status = CASE WHEN v_remaining = 0 THEN 'completed' ELSE 'active' END
  WHERE id = v_row.plan_id;

  RETURN v_batch;
END;
$$;

-- ============ Void an installment payment ============
CREATE OR REPLACE FUNCTION public.void_installment_payment(
  p_installment_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row RECORD;
  v_plan RECORD;
  v_batch uuid;
  v_desc text;
  v_line RECORD;
BEGIN
  SELECT * INTO v_row FROM public.installment_payments WHERE id = p_installment_id;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'INSTALLMENT_NOT_FOUND';
  END IF;
  IF NOT public.can_manage_capital(v_row.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.status <> 'paid' OR v_row.batch_id IS NULL THEN
    RAISE EXCEPTION 'NOT_SETTLED: only a settled installment can be voided';
  END IF;

  SELECT * INTO v_plan FROM public.installment_plans WHERE id = v_row.plan_id;
  v_desc := 'REVERSAL - Installment ' || v_row.installment_no || '/' || v_plan.installment_count ||
            ' - ' || v_plan.description || COALESCE(' (' || p_reason || ')', '');

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
  VALUES
    (v_row.tenant_id, CURRENT_DATE, v_desc, 'INSTV-' || to_char(now(), 'YYYYMMDDHH24MISS'),
     'reversal', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), v_row.branch_id)
  RETURNING id INTO v_batch;

  FOR v_line IN
    SELECT * FROM public.account_transactions WHERE batch_id = v_row.batch_id
  LOOP
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (v_line.tenant_id, v_line.account_id, CURRENT_DATE, COALESCE(v_line.credit, 0), COALESCE(v_line.debit, 0),
       v_desc, 'installment_payment_void', v_row.id, auth.uid(), v_batch, v_line.branch_id);
  END LOOP;

  UPDATE public.installment_payments
  SET status = 'pending', paid_amount = 0, paid_date = NULL, batch_id = NULL,
      payment_account_id = NULL, capital_account_id = NULL, paid_by = NULL,
      voided_at = now(), void_reason = p_reason
  WHERE id = p_installment_id;

  UPDATE public.installment_plans SET status = 'active' WHERE id = v_row.plan_id;

  RETURN v_batch;
END;
$$;
