-- 1. Traceability on cash_events
ALTER TABLE public.cash_events
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS reference_id uuid;

CREATE INDEX IF NOT EXISTS idx_cash_events_reference
  ON public.cash_events (reference_type, reference_id);

-- 2. Helper: is this COA account "cash in hand" (drawer money)?
CREATE OR REPLACE FUNCTION public.is_cash_on_hand_account(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
    WHERE id = p_account_id
      AND account_type = 'asset'
      AND account_code >= '1000' AND account_code < '1010'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_cash_on_hand_account(uuid) TO authenticated, service_role;

-- 3. Helper: find the open shift that should absorb a cash movement
CREATE OR REPLACE FUNCTION public.find_open_shift_for_cash(p_tenant_id uuid, p_branch_id uuid)
RETURNS TABLE (shift_id uuid, restaurant_id uuid, branch_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.restaurant_id, s.branch_id
  FROM public.shifts s
  JOIN public.restaurants r ON r.id = s.restaurant_id
  WHERE r.tenant_id = p_tenant_id
    AND s.status = 'open'
    AND (p_branch_id IS NULL OR s.branch_id IS NOT DISTINCT FROM p_branch_id)
  ORDER BY s.opened_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.find_open_shift_for_cash(uuid, uuid) TO authenticated, service_role;

-- 4. pay_installment: post a drawer movement when paid from cash on hand
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
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_plan RECORD;
  v_credit_account uuid;
  v_batch uuid;
  v_desc text;
  v_remaining integer;
  v_shift RECORD;
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

  -- Drawer impact: only cash-on-hand payouts reduce the physical till.
  IF p_funding_source <> 'partner' AND public.is_cash_on_hand_account(v_credit_account) THEN
    SELECT * INTO v_shift FROM public.find_open_shift_for_cash(v_row.tenant_id, v_row.branch_id);
    IF v_shift.shift_id IS NOT NULL THEN
      INSERT INTO public.cash_events
        (shift_id, restaurant_id, branch_id, event_type, amount, payment_method,
         description, created_by, reference_type, reference_id)
      VALUES
        (v_shift.shift_id, v_shift.restaurant_id, v_shift.branch_id, 'adjustment',
         -1 * v_row.amount, 'cash',
         'BNPL installment payout - ' || v_desc, auth.uid(),
         'installment_payment', v_row.id);
    END IF;
  END IF;

  SELECT count(*) INTO v_remaining
  FROM public.installment_payments
  WHERE plan_id = v_row.plan_id AND status <> 'paid';

  UPDATE public.installment_plans
  SET status = CASE WHEN v_remaining = 0 THEN 'completed' ELSE 'active' END
  WHERE id = v_row.plan_id;

  RETURN v_batch;
END;
$$;

-- 5. void_installment_payment: give the cash back to the open shift
CREATE OR REPLACE FUNCTION public.void_installment_payment(
  p_installment_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_plan RECORD;
  v_batch uuid;
  v_desc text;
  v_line RECORD;
  v_cash RECORD;
  v_shift RECORD;
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

  -- Reverse the drawer movement if one was recorded for this installment.
  SELECT * INTO v_cash
  FROM public.cash_events
  WHERE reference_type = 'installment_payment' AND reference_id = v_row.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_cash.id IS NOT NULL THEN
    SELECT * INTO v_shift FROM public.find_open_shift_for_cash(v_row.tenant_id, v_row.branch_id);
    INSERT INTO public.cash_events
      (shift_id, restaurant_id, branch_id, event_type, amount, payment_method,
       description, created_by, reference_type, reference_id)
    VALUES
      (COALESCE(v_shift.shift_id, v_cash.shift_id), v_cash.restaurant_id, v_cash.branch_id,
       'adjustment', -1 * v_cash.amount, 'cash',
       'Reversal of BNPL installment payout - ' || v_desc, auth.uid(),
       'installment_payment_void', v_row.id);
  END IF;

  UPDATE public.installment_payments
  SET status = 'pending', paid_amount = 0, paid_date = NULL, batch_id = NULL,
      payment_account_id = NULL, capital_account_id = NULL, paid_by = NULL,
      voided_at = now(), void_reason = p_reason
  WHERE id = p_installment_id;

  UPDATE public.installment_plans SET status = 'active' WHERE id = v_row.plan_id;

  RETURN v_batch;
END;
$$;