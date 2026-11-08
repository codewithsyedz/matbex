CREATE OR REPLACE FUNCTION public.expense_payment_role_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_cashier_only boolean := false;
  v_can_mark_paid boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_cashier_only := public.has_role(v_actor, NEW.restaurant_id, 'cashier'::app_role)
    AND NOT public.has_role(v_actor, NEW.restaurant_id, 'owner'::app_role)
    AND NOT public.has_role(v_actor, NEW.restaurant_id, 'manager'::app_role)
    AND NOT public.has_role(v_actor, NEW.restaurant_id, 'accountant'::app_role);

  v_can_mark_paid := public.has_role(v_actor, NEW.restaurant_id, 'owner'::app_role)
    OR public.has_role(v_actor, NEW.restaurant_id, 'manager'::app_role)
    OR public.has_role(v_actor, NEW.restaurant_id, 'accountant'::app_role);

  IF TG_OP = 'INSERT' AND v_is_cashier_only THEN
    NEW.status := 'unpaid';
    NEW.paid_amount := 0;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.status, 'unpaid') <> 'paid'
     AND COALESCE(NEW.status, 'unpaid') = 'paid'
     AND NOT v_can_mark_paid THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only owners, managers, or accountants can mark expenses as paid.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_expense_payment_role_guard ON public.expenses;
CREATE TRIGGER zz_expense_payment_role_guard
BEFORE INSERT OR UPDATE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.expense_payment_role_guard();

CREATE OR REPLACE FUNCTION public.reclassify_expense_credit_account(p_expense_id uuid, p_reason text DEFAULT 'payment status changed')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_exp RECORD;
  v_target_code text;
  v_target_account_id uuid;
  v_actor uuid;
  v_batch_id uuid;
  v_credit_amount numeric;
  v_existing_target_credit numeric;
  v_existing_other_credit numeric;
  v_new_tx_id uuid;
  v_voided_ids uuid[] := ARRAY[]::uuid[];
  v_credit RECORD;
BEGIN
  SELECT * INTO v_exp
  FROM public.expenses
  WHERE id = p_expense_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'failed', 'reason_code', 'not_found', 'error', 'Expense not found');
  END IF;

  IF COALESCE(v_exp.ledger_posted, false) = false THEN
    RETURN jsonb_build_object('outcome', 'skipped', 'reason_code', 'not_posted', 'reason_detail', 'Expense is not posted to the ledger yet');
  END IF;

  v_target_code := CASE WHEN COALESCE(v_exp.status, 'unpaid') = 'paid' THEN '1000' ELSE '2000' END;

  SELECT id INTO v_target_account_id
  FROM public.chart_of_accounts
  WHERE tenant_id = v_exp.tenant_id
    AND account_code = v_target_code
    AND is_active = true
  LIMIT 1;

  IF v_target_account_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'failed', 'reason_code', 'missing_account', 'error', 'Counter account ' || v_target_code || ' not found');
  END IF;

  SELECT COALESCE(sum(debit), 0)
    INTO v_credit_amount
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = p_expense_id
    AND COALESCE(is_voided, false) = false;

  IF v_credit_amount <= 0 THEN
    v_credit_amount := v_exp.amount;
  END IF;

  SELECT COALESCE(sum(CASE WHEN account_id = v_target_account_id THEN credit ELSE 0 END), 0),
         COALESCE(sum(CASE WHEN account_id <> v_target_account_id THEN credit ELSE 0 END), 0)
    INTO v_existing_target_credit, v_existing_other_credit
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = p_expense_id
    AND COALESCE(is_voided, false) = false
    AND COALESCE(credit, 0) > 0;

  IF abs(v_existing_target_credit - v_credit_amount) <= 0.005
     AND abs(v_existing_other_credit) <= 0.005 THEN
    RETURN jsonb_build_object('outcome', 'unchanged', 'target_account_code', v_target_code);
  END IF;

  SELECT batch_id INTO v_batch_id
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = p_expense_id
    AND batch_id IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1;

  v_actor := COALESCE(auth.uid(), v_exp.approved_by, v_exp.created_by);

  FOR v_credit IN
    SELECT id, account_id, debit, credit
    FROM public.account_transactions
    WHERE reference_type = 'expense'
      AND reference_id = p_expense_id
      AND COALESCE(is_voided, false) = false
      AND COALESCE(credit, 0) > 0
  LOOP
    UPDATE public.account_transactions
    SET is_voided = true,
        voided_at = now(),
        voided_by = v_actor,
        void_reason = 'Reclassified expense counter-account: ' || p_reason
    WHERE id = v_credit.id;

    UPDATE public.chart_of_accounts
    SET balance = balance - COALESCE(v_credit.debit, 0) + COALESCE(v_credit.credit, 0),
        updated_at = now()
    WHERE id = v_credit.account_id;

    v_voided_ids := array_append(v_voided_ids, v_credit.id);
  END LOOP;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_exp.tenant_id, v_target_account_id, v_exp.expense_date, NULL, v_credit_amount,
    COALESCE(v_exp.description, 'Expense') || ' — ' ||
      CASE WHEN v_target_code = '1000' THEN 'paid (Cash)' ELSE 'on credit (AP)' END,
    'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id
  ) RETURNING id INTO v_new_tx_id;

  BEGIN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, batch_id, transaction_ids,
      dr_total, cr_total, trigger_source, triggered_by
    ) VALUES (
      v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success',
      CASE WHEN v_target_code = '1000' THEN 'reclassified_to_cash' ELSE 'reclassified_to_ap' END,
      'Reclassified expense credit account after payment status change. Voided old credit legs and inserted ' || v_target_code || '.',
      v_batch_id, v_voided_ids || v_new_tx_id,
      v_credit_amount, v_credit_amount, 'manual', v_actor
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'outcome', 'reclassified',
    'target_account_code', v_target_code,
    'new_transaction_id', v_new_tx_id,
    'voided_transaction_ids', v_voided_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclassify_expense_credit_account(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reclassify_expense_credit_on_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.ledger_posted, false) = true
     AND NEW.deleted_at IS NULL
     AND (
       COALESCE(OLD.status, 'unpaid') IS DISTINCT FROM COALESCE(NEW.status, 'unpaid')
       OR COALESCE(OLD.paid_amount, 0) IS DISTINCT FROM COALESCE(NEW.paid_amount, 0)
     ) THEN
    PERFORM public.reclassify_expense_credit_account(NEW.id, 'expense payment status changed');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reclassify_expense_credit_on_payment_change ON public.expenses;
CREATE TRIGGER trg_reclassify_expense_credit_on_payment_change
AFTER UPDATE OF status, paid_amount ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.reclassify_expense_credit_on_payment_change();

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
  v_credit_code text;
  v_batch_id uuid;
  v_actor_id uuid;
  v_journal_type text;
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

  v_credit_code := CASE WHEN COALESCE(v_expense.status, 'unpaid') = 'paid' THEN '1000' ELSE '2000' END;

  SELECT id INTO v_credit_account_id
  FROM public.chart_of_accounts
  WHERE tenant_id = v_expense.tenant_id AND account_code = v_credit_code LIMIT 1;
  IF v_credit_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Counter-account % not found in chart of accounts for this tenant', v_credit_code;
  END IF;

  v_actor_id := COALESCE(auth.uid(), v_expense.approved_by, v_expense.created_by);

  INSERT INTO public.journal_entry_batches (
    tenant_id, batch_date, description, reference_number, entry_type, created_by,
    is_posted, posted_at, posted_by, journal_type, approval_status, approved_by, approved_at
  ) VALUES (
    v_expense.tenant_id, v_expense.expense_date,
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
    COALESCE(v_expense.description, 'Expense') || ' — ' ||
      CASE WHEN v_credit_code = '1000' THEN 'paid (Cash)' ELSE 'on credit (AP)' END,
    'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
  );

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
           'posted', 'Posted via post_expense_to_ledger using counter-account ' || v_credit_code, v_batch_id,
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

CREATE OR REPLACE FUNCTION public.auto_reconcile_single_expense(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_exp RECORD;
  v_dr numeric; v_cr numeric; v_diff numeric;
  v_credit_code text; v_credit_acct uuid;
  v_batch_id uuid; v_err text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('outcome','failed','error','Not authenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_actor
      AND role IN ('owner'::app_role,'manager'::app_role,'accountant'::app_role)
  ) THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','forbidden','error','Insufficient privileges');
  END IF;

  SELECT id, tenant_id, branch_id, amount, expense_date, status, description
    INTO v_exp
  FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','failed','error','Expense not found');
  END IF;
  IF public.get_user_tenant_id(v_actor) <> v_exp.tenant_id THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','forbidden','error','Cannot reconcile for another tenant');
  END IF;

  SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO v_dr, v_cr
  FROM public.account_transactions
  WHERE reference_type='expense' AND reference_id = p_expense_id
    AND COALESCE(is_voided,false) = false;
  v_diff := round(v_dr - v_cr, 2);

  IF abs(v_diff) <= 0.005 THEN
    RETURN jsonb_build_object('outcome','already_balanced','dr_total',v_dr,'cr_total',v_cr);
  END IF;

  SELECT batch_id INTO v_batch_id FROM public.account_transactions
  WHERE reference_type='expense' AND reference_id = p_expense_id
  ORDER BY created_at ASC LIMIT 1;

  IF v_diff > 0 AND abs(v_diff - v_exp.amount) <= 0.01 THEN
    v_credit_code := CASE WHEN COALESCE(v_exp.status,'unpaid') = 'paid' THEN '1000' ELSE '2000' END;
    SELECT id INTO v_credit_acct FROM public.chart_of_accounts
      WHERE tenant_id = v_exp.tenant_id AND account_code = v_credit_code LIMIT 1;

    IF v_credit_acct IS NULL THEN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','needs_manual_review',
        'missing_account','Counter account '||v_credit_code||' missing in CoA',
        v_dr, v_cr, 'reconcile_job', v_actor);
      RETURN jsonb_build_object('outcome','needs_manual_review',
        'reason_code','missing_account','error','Counter account '||v_credit_code||' missing');
    END IF;

    BEGIN
      INSERT INTO public.account_transactions (
        tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, branch_id, batch_id
      ) VALUES (v_exp.tenant_id, v_credit_acct, v_exp.expense_date, NULL, v_diff,
        COALESCE(v_exp.description,'Expense') || ' — auto-reconcile credit leg',
        'expense', v_exp.id, v_actor, v_exp.branch_id, v_batch_id);
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, batch_id, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','success',
        'auto_reconciled','Inserted missing credit leg of '||v_diff||' to '||v_credit_code,
        v_batch_id, v_dr, v_cr + v_diff, 'reconcile_job', v_actor);
      RETURN jsonb_build_object('outcome','fixed','diff',v_diff,'batch_id',v_batch_id);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','failed',
        'validation_failed', v_err, v_dr, v_cr, 'reconcile_job', v_actor);
      RETURN jsonb_build_object('outcome','failed','error', v_err);
    END;
  END IF;

  INSERT INTO public.expense_posting_audit (
    tenant_id, expense_id, branch_id, action, outcome,
    reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
  ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','needs_manual_review',
    'ambiguous_imbalance','Diff '||v_diff||' does not match a single missing-leg pattern',
    v_dr, v_cr, 'reconcile_job', v_actor);
  RETURN jsonb_build_object('outcome','needs_manual_review',
    'reason_code','ambiguous_imbalance','diff', v_diff,
    'error','Imbalance does not match a known auto-fix pattern');
END;
$$;

CREATE OR REPLACE FUNCTION public.explain_imbalance(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_exp RECORD;
  v_dr numeric; v_cr numeric; v_diff numeric;
  v_legs jsonb;
  v_batches jsonb;
  v_credit_code text; v_credit_acct_info jsonb;
  v_suggested jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT e.id, e.tenant_id, e.branch_id, e.amount, e.expense_date, e.status,
         e.description, e.account_id, b.name AS branch_name,
         coa.account_code, coa.account_name
    INTO v_exp
  FROM public.expenses e
  LEFT JOIN public.branches b ON b.id = e.branch_id
  LEFT JOIN public.chart_of_accounts coa ON coa.id = e.account_id
  WHERE e.id = p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF public.get_user_tenant_id(v_actor) <> v_exp.tenant_id THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT COALESCE(sum(t.debit),0), COALESCE(sum(t.credit),0)
    INTO v_dr, v_cr
  FROM public.account_transactions t
  WHERE t.reference_type='expense' AND t.reference_id = p_expense_id
    AND COALESCE(t.is_voided,false) = false;
  v_diff := round(v_dr - v_cr, 2);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'transaction_date', t.transaction_date,
    'debit', t.debit, 'credit', t.credit,
    'description', t.description, 'batch_id', t.batch_id,
    'is_voided', t.is_voided,
    'account_code', coa.account_code,
    'account_name', coa.account_name,
    'account_type', coa.account_type
  ) ORDER BY t.created_at), '[]'::jsonb) INTO v_legs
  FROM public.account_transactions t
  LEFT JOIN public.chart_of_accounts coa ON coa.id = t.account_id
  WHERE t.reference_type='expense' AND t.reference_id = p_expense_id;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
    'batch_id', jb.id, 'batch_number', jb.batch_number,
    'description', jb.description, 'entry_date', jb.entry_date,
    'status', jb.status, 'total_amount', jb.total_amount
  )), '[]'::jsonb) INTO v_batches
  FROM public.journal_entry_batches jb
  WHERE jb.id IN (
    SELECT DISTINCT batch_id FROM public.account_transactions
    WHERE reference_type='expense' AND reference_id = p_expense_id AND batch_id IS NOT NULL
  );

  IF v_diff > 0 AND abs(v_diff - v_exp.amount) <= 0.01 THEN
    v_credit_code := CASE WHEN COALESCE(v_exp.status,'unpaid') = 'paid' THEN '1000' ELSE '2000' END;
    SELECT jsonb_build_object(
      'id', id, 'account_code', account_code, 'account_name', account_name
    ) INTO v_credit_acct_info
    FROM public.chart_of_accounts
    WHERE tenant_id = v_exp.tenant_id AND account_code = v_credit_code LIMIT 1;

    v_suggested := jsonb_build_object(
      'pattern','missing_credit_leg',
      'fixable_automatically', v_credit_acct_info IS NOT NULL,
      'fields', ARRAY['credit'],
      'proposed_action',
        'Insert a credit of '||v_diff||' to account '||v_credit_code||
        ' ('||COALESCE(v_credit_acct_info->>'account_name','MISSING')||')',
      'credit_account', v_credit_acct_info,
      'credit_amount', v_diff
    );
  ELSE
    v_suggested := jsonb_build_object(
      'pattern','ambiguous',
      'fixable_automatically', false,
      'fields', ARRAY['debit','credit'],
      'proposed_action','Manual review required — diff does not match a known pattern.'
    );
  END IF;

  RETURN jsonb_build_object(
    'expense', jsonb_build_object(
      'id', v_exp.id,
      'description', v_exp.description,
      'amount', v_exp.amount,
      'expense_date', v_exp.expense_date,
      'status', v_exp.status,
      'branch_name', v_exp.branch_name,
      'account_code', v_exp.account_code,
      'account_name', v_exp.account_name
    ),
    'totals', jsonb_build_object('dr_total', v_dr, 'cr_total', v_cr, 'diff', v_diff),
    'batches', v_batches,
    'legs', v_legs,
    'suggested_fix', v_suggested
  );
END;
$$;