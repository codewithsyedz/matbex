ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS ap_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.resolve_supplier_ap_account(p_tenant_id uuid, p_supplier_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_supplier RECORD;
  v_parent uuid;
  v_account uuid;
  v_code text;
  v_name text;
  i int;
BEGIN
  IF p_supplier_id IS NULL OR p_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_supplier_id;
  IF NOT FOUND OR COALESCE(btrim(v_supplier.name), '') = '' THEN
    RETURN NULL;
  END IF;

  -- Already linked and still usable
  IF v_supplier.ap_account_id IS NOT NULL THEN
    SELECT id INTO v_account FROM public.chart_of_accounts
     WHERE id = v_supplier.ap_account_id AND tenant_id = p_tenant_id AND is_active = true;
    IF v_account IS NOT NULL THEN
      RETURN v_account;
    END IF;
  END IF;

  SELECT id INTO v_parent FROM public.chart_of_accounts
   WHERE tenant_id = p_tenant_id AND account_code = '2000' AND is_active = true
   LIMIT 1;
  IF v_parent IS NULL THEN
    RETURN NULL;
  END IF;

  v_name := 'AP - ' || btrim(v_supplier.name);

  -- Reuse an existing head with the same name
  SELECT id INTO v_account FROM public.chart_of_accounts
   WHERE tenant_id = p_tenant_id AND is_active = true AND account_name = v_name
   ORDER BY account_code
   LIMIT 1;

  IF v_account IS NULL THEN
    -- Allocate the next free code in the supplier payable range
    FOR i IN 2500..2899 LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.chart_of_accounts
         WHERE tenant_id = p_tenant_id AND account_code = i::text
      ) THEN
        v_code := i::text;
        EXIT;
      END IF;
    END LOOP;

    IF v_code IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: No free supplier payable account code left in range 2500-2899';
    END IF;

    INSERT INTO public.chart_of_accounts (
      tenant_id, account_code, account_name, account_type, parent_id,
      description, is_system_account, is_active
    ) VALUES (
      p_tenant_id, v_code, v_name, 'liability', v_parent,
      'Auto-created supplier payable head for ' || btrim(v_supplier.name),
      false, true
    ) RETURNING id INTO v_account;
  END IF;

  UPDATE public.suppliers SET ap_account_id = v_account, updated_at = now()
   WHERE id = p_supplier_id AND ap_account_id IS DISTINCT FROM v_account;

  RETURN v_account;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_expense_to_ledger(p_expense_id uuid, p_account_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expense RECORD;
  v_debit_tx_id uuid;
  v_account_type text;
  v_debit_account_id uuid;
  v_credit_account_id uuid;
  v_credit_parent_id uuid;
  v_supplier_ap uuid;
  v_credit_code text;
  v_credit_label text;
  v_batch_id uuid;
  v_actor_id uuid;
  v_journal_type text;
  v_dr numeric;
  v_cr numeric;
  v_vat numeric;
  v_net numeric;
  v_vat_account uuid;
BEGIN
  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF v_expense.approval_status != 'approved' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted to ledger';
  END IF;
  IF COALESCE(v_expense.ledger_posted, false) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense has already been posted to ledger';
  END IF;

  v_vat := ROUND(COALESCE(v_expense.vat_amount, 0), 2);
  IF v_vat < 0 OR v_vat > v_expense.amount + 0.005 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: VAT amount % is not valid for an expense of %', v_vat, v_expense.amount;
  END IF;
  v_net := ROUND(v_expense.amount - v_vat, 2);

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

  IF v_vat > 0 THEN
    v_vat_account := public.resolve_vat_account(v_expense.tenant_id, 'input');
    IF v_vat_account IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Input VAT account (1180) not found in chart of accounts';
    END IF;
    v_vat_account := public.resolve_branch_account(v_vat_account, v_expense.branch_id);
  END IF;

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
    -- Prefer a supplier-specific payable head when the bill names a supplier.
    v_supplier_ap := public.resolve_supplier_ap_account(v_expense.tenant_id, v_expense.supplier_id);

    IF v_supplier_ap IS NOT NULL THEN
      v_credit_account_id := v_supplier_ap;
      SELECT account_code INTO v_credit_code FROM public.chart_of_accounts WHERE id = v_credit_account_id;
      v_credit_label := 'on credit (' || COALESCE(v_credit_code, 'AP') || ' supplier payable)';
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
    v_expense.tenant_id, v_debit_account_id, v_expense.expense_date, v_net, NULL,
    CASE WHEN v_journal_type = 'purchase'
         THEN COALESCE(v_expense.description, 'Inventory purchase') || ' — inventory purchase (net)'
         ELSE COALESCE(v_expense.description, 'Expense') END,
    'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
  ) RETURNING id INTO v_debit_tx_id;

  IF v_vat > 0 THEN
    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by, branch_id, batch_id
    ) VALUES (
      v_expense.tenant_id, v_vat_account, v_expense.expense_date, v_vat, NULL,
      COALESCE(v_expense.description, 'Expense') || ' — input VAT recoverable',
      'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
    );
  END IF;

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
  SET ledger_posted = true, ledger_transaction_id = v_debit_tx_id, account_id = p_account_id,
      net_amount = v_net
  WHERE id = p_expense_id;

  BEGIN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, batch_id, transaction_ids,
      dr_total, cr_total, trigger_source, triggered_by
    )
    SELECT v_expense.tenant_id, p_expense_id, v_expense.branch_id, 'post', 'success',
           'posted', 'Posted via post_expense_to_ledger, credit account ' || COALESCE(v_credit_code,'?')
             || CASE WHEN v_vat > 0 THEN ', input VAT ' || v_vat::text ELSE '' END, v_batch_id,
           array_agg(t.id),
           COALESCE(sum(t.debit),0), COALESCE(sum(t.credit),0),
           CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END,
           v_actor_id
    FROM public.account_transactions t WHERE t.batch_id = v_batch_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_debit_tx_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reclassify_expense_credit_account(p_expense_id uuid, p_reason text DEFAULT 'status_change'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exp RECORD;
  v_ap_parent uuid;
  v_ap_account uuid;
  v_supplier_ap uuid;
  v_cash_account uuid;
  v_ap_net numeric;
  v_amount numeric;
  v_actor uuid;
  v_batch_id uuid;
  v_is_paid boolean;
  v_pay_date date;
  v_acct_label text;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','not_found','error','Expense not found');
  END IF;

  IF COALESCE(v_exp.ledger_posted,false) = false THEN
    RETURN jsonb_build_object('outcome','skipped','reason_code','not_posted','reason_detail','Expense is not posted to the ledger yet');
  END IF;

  v_pay_date := GREATEST(COALESCE(v_exp.expense_date, CURRENT_DATE), CURRENT_DATE);
  v_is_paid := COALESCE(v_exp.status,'unpaid') = 'paid';

  SELECT id INTO v_ap_parent FROM public.chart_of_accounts
   WHERE tenant_id = v_exp.tenant_id AND account_code = '2000' AND is_active = true LIMIT 1;

  v_cash_account := public.resolve_expense_funding_account(p_expense_id);

  IF v_ap_parent IS NULL OR v_cash_account IS NULL THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','missing_account','error','Payable or funding account not found');
  END IF;

  IF NOT public.assert_expense_funding_account_valid(p_expense_id, v_cash_account) THEN
    SELECT COALESCE(account_code || ' ' || account_name, v_cash_account::text)
      INTO v_acct_label FROM public.chart_of_accounts WHERE id = v_cash_account;

    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'failed', 'invalid_funding_account',
        'Settlement blocked — paying account ' || COALESCE(v_acct_label,'(unknown)') ||
        ' is not a cash or bank account (1000-1099).',
        0, 0, CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END, auth.uid()
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
      'outcome','failed',
      'reason_code','invalid_funding_account',
      'error','Paying account ' || COALESCE(v_acct_label,'(unknown)') ||
              ' is not a cash or bank account. Choose a 1000-1099 cash/bank account before marking this bill paid.'
    );
  END IF;

  -- Supplier bills settle against their own payable head when one exists.
  v_supplier_ap := public.resolve_supplier_ap_account(v_exp.tenant_id, v_exp.supplier_id);
  v_ap_account := COALESCE(v_supplier_ap, public.resolve_branch_account(v_ap_parent, v_exp.branch_id));

  -- Open balance may sit on the supplier head, the branch child, or the shared parent.
  SELECT COALESCE(sum(COALESCE(credit,0) - COALESCE(debit,0)), 0)
    INTO v_ap_net
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = p_expense_id
    AND account_id IN (
      v_ap_account,
      v_ap_parent,
      public.resolve_branch_account(v_ap_parent, v_exp.branch_id),
      COALESCE(v_supplier_ap, v_ap_parent)
    )
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
      v_exp.tenant_id, v_exp.branch_id, v_pay_date,
      'Supplier payment: ' || COALESCE(v_exp.description, v_exp.id::text),
      'EXPPAY-' || v_exp.id::text, 'payment', v_actor,
      true, now(), v_actor, 'expense', 'approved', v_actor, now()
    ) RETURNING id INTO v_batch_id;

    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by, branch_id, batch_id
    ) VALUES
      (v_exp.tenant_id, v_ap_account, v_pay_date, v_amount, NULL,
       COALESCE(v_exp.description,'Expense') || ' — payable settled', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id),
      (v_exp.tenant_id, v_cash_account, v_pay_date, NULL, v_amount,
       COALESCE(v_exp.description,'Expense') || ' — paid from selected account', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id);

    UPDATE public.chart_of_accounts SET balance = balance + v_amount, updated_at = now() WHERE id = v_ap_account;
    UPDATE public.chart_of_accounts SET balance = balance - v_amount, updated_at = now() WHERE id = v_cash_account;

    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        batch_id, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success', 'payable_settled',
        'DR supplier / Accounts Payable head / CR selected funding account — ' || p_reason,
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
     COALESCE(v_exp.description,'Expense') || ' — payment reversed', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id),
    (v_exp.tenant_id, v_ap_account, CURRENT_DATE, NULL, v_amount,
     COALESCE(v_exp.description,'Expense') || ' — payable reinstated', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id);

  UPDATE public.chart_of_accounts SET balance = balance + v_amount, updated_at = now() WHERE id = v_cash_account;
  UPDATE public.chart_of_accounts SET balance = balance - v_amount, updated_at = now() WHERE id = v_ap_account;

  BEGIN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
      batch_id, dr_total, cr_total, trigger_source, triggered_by
    ) VALUES (
      v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success', 'settlement_reversed',
      'DR funding account / CR supplier payable head — ' || p_reason,
      v_batch_id, v_amount, v_amount,
      CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END, v_actor
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('outcome','success','reason_code','settlement_reversed','amount',v_amount,'batch_id',v_batch_id);
END;
$function$;