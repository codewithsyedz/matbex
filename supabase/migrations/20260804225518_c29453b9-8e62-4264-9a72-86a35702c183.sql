-- 1. Funding source columns -------------------------------------------------
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS funding_source text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS payment_account_id uuid REFERENCES public.chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS capital_account_id uuid REFERENCES public.owner_capital_accounts(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_funding_source_check'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_funding_source_check
      CHECK (funding_source IN ('company','owner_capital','partner_capital'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_capital_account ON public.expenses(capital_account_id)
  WHERE capital_account_id IS NOT NULL;

-- 2. Helper: resolve the credit (funding) account for a paid expense ---------
CREATE OR REPLACE FUNCTION public.resolve_expense_funding_account(p_expense_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp RECORD;
  v_account uuid;
  v_parent uuid;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Owner / partner paid personally -> credit their capital (equity) account
  IF v_exp.capital_account_id IS NOT NULL THEN
    SELECT equity_account_id INTO v_account
    FROM public.owner_capital_accounts WHERE id = v_exp.capital_account_id;
    IF v_account IS NOT NULL THEN RETURN v_account; END IF;
  END IF;

  -- Explicit company bank / cash account
  IF v_exp.payment_account_id IS NOT NULL THEN
    RETURN public.resolve_branch_account(v_exp.payment_account_id, v_exp.branch_id);
  END IF;

  -- Fallback: Cash on Hand
  SELECT id INTO v_parent FROM public.chart_of_accounts
   WHERE tenant_id = v_exp.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
  IF v_parent IS NULL THEN RETURN NULL; END IF;
  RETURN public.resolve_branch_account(v_parent, v_exp.branch_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_expense_funding_account(uuid) TO authenticated, service_role;

-- 3. Post expense to ledger: honour the selected funding account -------------
CREATE OR REPLACE FUNCTION public.post_expense_to_ledger(p_expense_id uuid, p_account_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense RECORD;
  v_debit_tx_id uuid;
  v_account_type text;
  v_debit_account_id uuid;
  v_credit_account_id uuid;
  v_credit_parent_id uuid;
  v_credit_code text;
  v_credit_label text;
  v_batch_id uuid;
  v_actor_id uuid;
  v_journal_type text;
  v_dr numeric;
  v_cr numeric;
BEGIN
  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF v_expense.approval_status != 'approved' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted to ledger';
  END IF;
  IF COALESCE(v_expense.ledger_posted, false) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense has already been posted to ledger';
  END IF;

  SELECT account_type::text INTO v_account_type
  FROM public.chart_of_accounts WHERE id = p_account_id;

  IF v_account_type = 'cogs' THEN
    v_debit_account_id := public.resolve_inventory_account_for_cogs(v_expense.tenant_id, p_account_id);
    v_journal_type := 'purchase';
    IF v_debit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: No inventory asset account found for COGS routing';
    END IF;
  ELSE
    v_debit_account_id := p_account_id;
    v_journal_type := 'expense';
  END IF;

  IF v_debit_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense must have a Chart of Accounts mapping before posting to ledger';
  END IF;

  v_debit_account_id := public.resolve_branch_account(v_debit_account_id, v_expense.branch_id);

  IF COALESCE(v_expense.status, 'unpaid') = 'paid' THEN
    v_credit_account_id := public.resolve_expense_funding_account(p_expense_id);
    IF v_credit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: No funding account resolved for this paid expense';
    END IF;
    SELECT account_code INTO v_credit_code FROM public.chart_of_accounts WHERE id = v_credit_account_id;
    v_credit_label := CASE
      WHEN v_expense.capital_account_id IS NOT NULL THEN 'paid by partner (Capital)'
      ELSE 'paid (' || COALESCE(v_credit_code, 'Cash') || ')'
    END;
  ELSE
    v_credit_code := '2000';
    SELECT id INTO v_credit_parent_id
    FROM public.chart_of_accounts
    WHERE tenant_id = v_expense.tenant_id AND account_code = '2000' LIMIT 1;
    IF v_credit_parent_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Counter-account 2000 not found in chart of accounts for this tenant';
    END IF;
    v_credit_account_id := public.resolve_branch_account(v_credit_parent_id, v_expense.branch_id);
    v_credit_label := 'on credit (AP)';
  END IF;

  v_actor_id := COALESCE(auth.uid(), v_expense.approved_by, v_expense.created_by);

  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, batch_date, description, reference_number, entry_type, created_by,
    is_posted, posted_at, posted_by, journal_type, approval_status, approved_by, approved_at
  ) VALUES (
    v_expense.tenant_id, v_expense.branch_id, v_expense.expense_date,
    CASE WHEN v_journal_type = 'purchase' THEN 'Inventory purchase from expense: ' ELSE 'Expense posting: ' END
      || COALESCE(v_expense.description, v_expense.id::text),
    'EXP-' || v_expense.id::text, v_journal_type, v_actor_id,
    true, now(), v_actor_id, v_journal_type, 'approved', v_actor_id, now()
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_expense.tenant_id, v_debit_account_id, v_expense.expense_date, v_expense.amount, NULL,
    CASE WHEN v_journal_type = 'purchase'
         THEN COALESCE(v_expense.description, 'Inventory purchase') || ' — inventory purchase'
         ELSE COALESCE(v_expense.description, 'Expense') END,
    'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
  ) RETURNING id INTO v_debit_tx_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_expense.tenant_id, v_credit_account_id, v_expense.expense_date, NULL, v_expense.amount,
    COALESCE(v_expense.description, 'Expense') || ' — ' || v_credit_label,
    'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
  );

  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
    INTO v_dr, v_cr
  FROM public.account_transactions
  WHERE batch_id = v_batch_id AND COALESCE(is_voided, false) = false;

  IF abs(v_dr - v_cr) > 0.005 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense posting is unbalanced (DR % vs CR %)', v_dr, v_cr;
  END IF;

  UPDATE public.expenses
  SET ledger_posted = true, ledger_transaction_id = v_debit_tx_id, account_id = p_account_id
  WHERE id = p_expense_id;

  BEGIN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, batch_id, transaction_ids,
      dr_total, cr_total, trigger_source, triggered_by
    )
    SELECT v_expense.tenant_id, p_expense_id, v_expense.branch_id, 'post', 'success',
           'posted', 'Posted via post_expense_to_ledger, credit account ' || COALESCE(v_credit_code,'?'), v_batch_id,
           array_agg(t.id),
           COALESCE(sum(t.debit),0), COALESCE(sum(t.credit),0),
           CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END,
           v_actor_id
    FROM public.account_transactions t WHERE t.batch_id = v_batch_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_debit_tx_id;
END;
$$;

-- 4. Settlement / reversal: pay from the selected funding account ------------
CREATE OR REPLACE FUNCTION public.reclassify_expense_credit_account(p_expense_id uuid, p_reason text DEFAULT 'status change')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp RECORD;
  v_ap_parent uuid;
  v_ap_account uuid;
  v_cash_account uuid;
  v_ap_net numeric;
  v_amount numeric;
  v_actor uuid;
  v_batch_id uuid;
  v_is_paid boolean;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','not_found','error','Expense not found');
  END IF;

  IF COALESCE(v_exp.ledger_posted,false) = false THEN
    RETURN jsonb_build_object('outcome','skipped','reason_code','not_posted','reason_detail','Expense is not posted to the ledger yet');
  END IF;

  v_is_paid := COALESCE(v_exp.status,'unpaid') = 'paid';

  SELECT id INTO v_ap_parent FROM public.chart_of_accounts
   WHERE tenant_id = v_exp.tenant_id AND account_code = '2000' AND is_active = true LIMIT 1;

  v_cash_account := public.resolve_expense_funding_account(p_expense_id);

  IF v_ap_parent IS NULL OR v_cash_account IS NULL THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','missing_account','error','Payable or funding account not found');
  END IF;

  v_ap_account := public.resolve_branch_account(v_ap_parent, v_exp.branch_id);

  SELECT COALESCE(sum(COALESCE(credit,0) - COALESCE(debit,0)), 0)
    INTO v_ap_net
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = p_expense_id
    AND account_id IN (v_ap_account, v_ap_parent)
    AND COALESCE(is_voided,false) = false;

  v_actor := COALESCE(auth.uid(), v_exp.approved_by, v_exp.created_by);

  IF v_is_paid THEN
    IF v_ap_net <= 0.005 THEN
      RETURN jsonb_build_object('outcome','unchanged','reason_code','no_open_payable');
    END IF;
    v_amount := round(v_ap_net, 2);

    INSERT INTO public.journal_entry_batches (
      tenant_id, branch_id, batch_date, description, reference_number, entry_type, created_by,
      is_posted, posted_at, posted_by, journal_type, approval_status, approved_by, approved_at
    ) VALUES (
      v_exp.tenant_id, v_exp.branch_id, COALESCE(v_exp.payment_date, CURRENT_DATE),
      'Supplier payment: ' || COALESCE(v_exp.description, v_exp.id::text),
      'EXPPAY-' || v_exp.id::text, 'payment', v_actor,
      true, now(), v_actor, 'expense', 'approved', v_actor, now()
    ) RETURNING id INTO v_batch_id;

    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by, branch_id, batch_id
    ) VALUES
      (v_exp.tenant_id, v_ap_account, COALESCE(v_exp.payment_date, CURRENT_DATE), v_amount, NULL,
       COALESCE(v_exp.description,'Expense') || ' — payable settled', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id),
      (v_exp.tenant_id, v_cash_account, COALESCE(v_exp.payment_date, CURRENT_DATE), NULL, v_amount,
       COALESCE(v_exp.description,'Expense') || ' — paid from selected account', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id);

    UPDATE public.chart_of_accounts SET balance = balance + v_amount, updated_at = now() WHERE id = v_ap_account;
    UPDATE public.chart_of_accounts SET balance = balance - v_amount, updated_at = now() WHERE id = v_cash_account;

    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        batch_id, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success', 'payable_settled',
        'DR 2000 Accounts Payable / CR selected funding account — ' || p_reason,
        v_batch_id, v_amount, v_amount,
        CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END, v_actor
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object('outcome','success','reason_code','payable_settled','amount',v_amount,'batch_id',v_batch_id);
  END IF;

  IF v_ap_net > 0.005 THEN
    RETURN jsonb_build_object('outcome','unchanged','reason_code','payable_already_open');
  END IF;

  v_amount := round(abs(v_ap_net), 2);
  IF v_amount <= 0.005 THEN
    RETURN jsonb_build_object('outcome','unchanged','reason_code','nothing_to_reverse');
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.can_reverse_ap_settlement(auth.uid()) THEN
    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'failed', 'reversal_forbidden',
        'Reversal blocked — user is not an owner or accountant',
        0, 0, 'manual', auth.uid()
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE EXCEPTION 'Only owners or accountants can reverse a posted AP settlement'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, batch_date, description, reference_number, entry_type, created_by,
    is_posted, posted_at, posted_by, journal_type, approval_status, approved_by, approved_at
  ) VALUES (
    v_exp.tenant_id, v_exp.branch_id, CURRENT_DATE,
    'Supplier payment reversal: ' || COALESCE(v_exp.description, v_exp.id::text),
    'EXPPAYREV-' || v_exp.id::text, 'payment', v_actor,
    true, now(), v_actor, 'expense', 'approved', v_actor, now()
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES
    (v_exp.tenant_id, v_cash_account, CURRENT_DATE, v_amount, NULL,
     COALESCE(v_exp.description,'Expense') || ' — payment reversed (funding account restored)', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id),
    (v_exp.tenant_id, v_ap_account, CURRENT_DATE, NULL, v_amount,
     COALESCE(v_exp.description,'Expense') || ' — payable restored (AP)', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id);

  UPDATE public.chart_of_accounts SET balance = balance + v_amount, updated_at = now() WHERE id = v_cash_account;
  UPDATE public.chart_of_accounts SET balance = balance - v_amount, updated_at = now() WHERE id = v_ap_account;

  BEGIN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
      batch_id, dr_total, cr_total, trigger_source, triggered_by
    ) VALUES (
      v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success', 'payment_reversed',
      'DR funding account / CR 2000 Accounts Payable — ' || p_reason,
      v_batch_id, v_amount, v_amount,
      CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END, v_actor
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('outcome','success','reason_code','payment_reversed','amount',v_amount,'batch_id',v_batch_id);
END;
$$;