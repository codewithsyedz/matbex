
-- 1. Update post_expense_to_ledger to assign a shared batch_id to both legs
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
  v_batch_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF v_expense.approval_status != 'approved' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted to ledger';
  END IF;
  IF v_expense.ledger_posted THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense has already been posted to ledger';
  END IF;

  SELECT account_type::text INTO v_account_type
  FROM public.chart_of_accounts WHERE id = p_account_id;

  IF v_account_type = 'cogs' THEN
    v_debit_account_id := public.resolve_inventory_account_for_cogs(v_expense.tenant_id, p_account_id);
    IF v_debit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: No inventory asset account found for COGS routing';
    END IF;
  ELSE
    v_debit_account_id := p_account_id;
  END IF;

  IF COALESCE(v_expense.status, 'unpaid') = 'paid' THEN
    v_credit_code := '1000';
  ELSE
    v_credit_code := '2000';
  END IF;

  SELECT id INTO v_credit_account_id
  FROM public.chart_of_accounts
  WHERE tenant_id = v_expense.tenant_id
    AND account_code = v_credit_code
  LIMIT 1;

  IF v_credit_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Counter-account % not found in chart of accounts for this tenant', v_credit_code;
  END IF;

  -- DEBIT leg
  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_expense.tenant_id, v_debit_account_id, v_expense.expense_date, v_expense.amount, NULL,
    COALESCE(v_expense.description, 'Expense'),
    'expense', p_expense_id, auth.uid(), v_expense.branch_id, v_batch_id
  )
  RETURNING id INTO v_debit_tx_id;

  -- CREDIT leg
  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_expense.tenant_id, v_credit_account_id, v_expense.expense_date, NULL, v_expense.amount,
    COALESCE(v_expense.description, 'Expense') || ' — ' ||
      CASE WHEN v_credit_code = '1000' THEN 'paid (Cash)' ELSE 'on credit (AP)' END,
    'expense', p_expense_id, auth.uid(), v_expense.branch_id, v_batch_id
  );

  UPDATE public.expenses
  SET ledger_posted = TRUE,
      ledger_transaction_id = v_debit_tx_id,
      account_id = p_account_id
  WHERE id = p_expense_id;

  RETURN v_debit_tx_id;
END;
$function$;

-- 2. Deferred constraint trigger validating that expense postings balance per expense at commit time
CREATE OR REPLACE FUNCTION public.validate_expense_ledger_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_ref uuid;
  v_debit numeric;
  v_credit numeric;
BEGIN
  v_ref := COALESCE(NEW.reference_id, OLD.reference_id);
  IF v_ref IS NULL THEN
    RETURN NULL;
  END IF;
  IF COALESCE(NEW.reference_type, OLD.reference_type) <> 'expense' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_debit, v_credit
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = v_ref
    AND COALESCE(is_voided, false) = false;

  -- Allow fully voided / fully removed sets (both 0)
  IF v_debit = 0 AND v_credit = 0 THEN
    RETURN NULL;
  END IF;

  IF ABS(v_debit - v_credit) > 0.005 THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED: Expense % postings do not balance (DR=%, CR=%). Every expense must have matching debit and credit legs that net to zero.',
      v_ref, v_debit, v_credit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_expense_ledger_balance ON public.account_transactions;
CREATE CONSTRAINT TRIGGER trg_validate_expense_ledger_balance
AFTER INSERT OR UPDATE OR DELETE ON public.account_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_expense_ledger_balance();

-- 3. Reconciliation routine
CREATE OR REPLACE FUNCTION public.reconcile_expense_ledger(p_tenant_id uuid DEFAULT NULL)
 RETURNS TABLE(
   expense_id uuid,
   expense_date date,
   amount numeric,
   debit_total numeric,
   credit_total numeric,
   action text,
   detail text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_credit_code text;
  v_credit_account_id uuid;
  v_diff numeric;
  v_batch_id uuid;
BEGIN
  FOR r IN
    SELECT e.*, 
           COALESCE((SELECT SUM(debit) FROM public.account_transactions at
                     WHERE at.reference_type='expense' AND at.reference_id=e.id
                       AND COALESCE(at.is_voided,false)=false), 0) AS dr,
           COALESCE((SELECT SUM(credit) FROM public.account_transactions at
                     WHERE at.reference_type='expense' AND at.reference_id=e.id
                       AND COALESCE(at.is_voided,false)=false), 0) AS cr
    FROM public.expenses e
    WHERE e.ledger_posted = true
      AND COALESCE(e.deleted_at, 'epoch'::timestamptz) = 'epoch'::timestamptz OR e.deleted_at IS NULL
      AND (p_tenant_id IS NULL OR e.tenant_id = p_tenant_id)
  LOOP
    v_diff := r.dr - r.cr;
    IF ABS(v_diff) <= 0.005 THEN
      CONTINUE; -- balanced, skip
    END IF;

    -- Try to backfill: if DR > CR, insert a missing credit leg
    IF v_diff > 0.005 THEN
      v_credit_code := CASE WHEN COALESCE(r.status,'unpaid')='paid' THEN '1000' ELSE '2000' END;
      SELECT id INTO v_credit_account_id
        FROM public.chart_of_accounts
        WHERE tenant_id = r.tenant_id AND account_code = v_credit_code
        LIMIT 1;
      IF v_credit_account_id IS NULL THEN
        expense_id := r.id; expense_date := r.expense_date; amount := r.amount;
        debit_total := r.dr; credit_total := r.cr;
        action := 'flagged';
        detail := 'Missing counter-account ' || v_credit_code || ' in chart of accounts';
        RETURN NEXT;
        CONTINUE;
      END IF;

      v_batch_id := (SELECT batch_id FROM public.account_transactions
                     WHERE reference_type='expense' AND reference_id=r.id
                       AND batch_id IS NOT NULL LIMIT 1);
      IF v_batch_id IS NULL THEN v_batch_id := gen_random_uuid(); END IF;

      INSERT INTO public.account_transactions(
        tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, branch_id, batch_id
      ) VALUES (
        r.tenant_id, v_credit_account_id, r.expense_date, NULL, v_diff,
        COALESCE(r.description,'Expense') || ' — reconciliation backfill ('
          || CASE WHEN v_credit_code='1000' THEN 'Cash' ELSE 'AP' END || ')',
        'expense', r.id, auth.uid(), r.branch_id, v_batch_id
      );

      expense_id := r.id; expense_date := r.expense_date; amount := r.amount;
      debit_total := r.dr + 0; credit_total := r.cr + v_diff;
      action := 'backfilled';
      detail := 'Inserted missing credit leg of ' || v_diff::text || ' to account ' || v_credit_code;
      RETURN NEXT;
    ELSE
      -- CR > DR (rare): flag for manual review, do not auto-mutate
      expense_id := r.id; expense_date := r.expense_date; amount := r.amount;
      debit_total := r.dr; credit_total := r.cr;
      action := 'flagged';
      detail := 'Credits exceed debits by ' || ABS(v_diff)::text || ' — manual review required';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_expense_ledger(uuid) TO authenticated, service_role;
