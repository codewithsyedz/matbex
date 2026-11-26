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
  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF v_expense.approval_status != 'approved' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted to ledger';
  END IF;

  IF COALESCE(v_expense.ledger_posted, false) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense has already been posted to ledger';
  END IF;

  SELECT account_type::text INTO v_account_type
  FROM public.chart_of_accounts
  WHERE id = p_account_id;

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

  v_actor_id := COALESCE(auth.uid(), v_expense.approved_by, v_expense.created_by);

  INSERT INTO public.journal_entry_batches (
    tenant_id,
    batch_date,
    description,
    reference_number,
    entry_type,
    created_by,
    is_posted,
    posted_at,
    posted_by,
    journal_type,
    approval_status,
    approved_by,
    approved_at
  ) VALUES (
    v_expense.tenant_id,
    v_expense.expense_date,
    CASE
      WHEN v_journal_type = 'purchase' THEN 'Inventory purchase from expense: '
      ELSE 'Expense posting: '
    END || COALESCE(v_expense.description, v_expense.id::text),
    'EXP-' || v_expense.id::text,
    v_journal_type,
    v_actor_id,
    true,
    now(),
    v_actor_id,
    v_journal_type,
    'approved',
    v_actor_id,
    now()
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_expense.tenant_id, v_debit_account_id, v_expense.expense_date, v_expense.amount, NULL,
    CASE
      WHEN v_journal_type = 'purchase' THEN COALESCE(v_expense.description, 'Inventory purchase') || ' — inventory purchase'
      ELSE COALESCE(v_expense.description, 'Expense')
    END,
    'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
  )
  RETURNING id INTO v_debit_tx_id;

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
  SET ledger_posted = true,
      ledger_transaction_id = v_debit_tx_id,
      account_id = p_account_id
  WHERE id = p_expense_id;

  RETURN v_debit_tx_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_expense_ledger(p_tenant_id uuid DEFAULT NULL::uuid)
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
AS $function$
DECLARE
  r RECORD;
  v_credit_code text;
  v_credit_account_id uuid;
  v_diff numeric;
  v_batch_id uuid;
  v_debit_tx_id uuid;
  v_post_dr numeric;
  v_post_cr numeric;
  v_actor_id uuid;
BEGIN
  FOR r IN
    SELECT e.*,
           COALESCE((SELECT SUM(at.debit) FROM public.account_transactions at
                     WHERE at.reference_type = 'expense'
                       AND at.reference_id = e.id
                       AND COALESCE(at.is_voided, false) = false), 0) AS dr,
           COALESCE((SELECT SUM(at.credit) FROM public.account_transactions at
                     WHERE at.reference_type = 'expense'
                       AND at.reference_id = e.id
                       AND COALESCE(at.is_voided, false) = false), 0) AS cr
    FROM public.expenses e
    WHERE e.deleted_at IS NULL
      AND (p_tenant_id IS NULL OR e.tenant_id = p_tenant_id)
      AND e.approval_status = 'approved'
      AND (
        COALESCE(e.ledger_posted, false) = false
        OR EXISTS (
          SELECT 1
          FROM public.account_transactions at
          WHERE at.reference_type = 'expense'
            AND at.reference_id = e.id
            AND COALESCE(at.is_voided, false) = false
        )
      )
  LOOP
    IF COALESCE(r.ledger_posted, false) = false AND r.dr = 0 AND r.cr = 0 THEN
      IF r.account_id IS NULL THEN
        expense_id := r.id;
        expense_date := r.expense_date;
        amount := r.amount;
        debit_total := 0;
        credit_total := 0;
        action := 'flagged';
        detail := 'Missing Chart of Accounts mapping; expense cannot be posted automatically';
        RETURN NEXT;
        CONTINUE;
      END IF;

      BEGIN
        v_debit_tx_id := public.post_expense_to_ledger(r.id, r.account_id);

        SELECT COALESCE(SUM(at.debit), 0), COALESCE(SUM(at.credit), 0)
          INTO v_post_dr, v_post_cr
        FROM public.account_transactions at
        WHERE at.reference_type = 'expense'
          AND at.reference_id = r.id
          AND COALESCE(at.is_voided, false) = false;

        expense_id := r.id;
        expense_date := r.expense_date;
        amount := r.amount;
        debit_total := v_post_dr;
        credit_total := v_post_cr;
        action := CASE WHEN ABS(v_post_dr - v_post_cr) <= 0.005 THEN 'posted' ELSE 'flagged' END;
        detail := CASE WHEN ABS(v_post_dr - v_post_cr) <= 0.005
          THEN 'Created balanced debit and credit ledger entries'
          ELSE 'Posted rows still do not balance; manual review required'
        END;
        RETURN NEXT;
      EXCEPTION WHEN OTHERS THEN
        expense_id := r.id;
        expense_date := r.expense_date;
        amount := r.amount;
        debit_total := r.dr;
        credit_total := r.cr;
        action := 'flagged';
        detail := SQLERRM;
        RETURN NEXT;
      END;

      CONTINUE;
    END IF;

    v_diff := r.dr - r.cr;
    IF ABS(v_diff) <= 0.005 THEN
      IF COALESCE(r.ledger_posted, false) = false THEN
        UPDATE public.expenses
        SET ledger_posted = true,
            ledger_transaction_id = (
              SELECT at.id
              FROM public.account_transactions at
              WHERE at.reference_type = 'expense'
                AND at.reference_id = r.id
                AND COALESCE(at.is_voided, false) = false
                AND COALESCE(at.debit, 0) > 0
              ORDER BY at.created_at ASC
              LIMIT 1
            )
        WHERE id = r.id;

        expense_id := r.id;
        expense_date := r.expense_date;
        amount := r.amount;
        debit_total := r.dr;
        credit_total := r.cr;
        action := 'marked_posted';
        detail := 'Existing ledger entries were already balanced; marked expense as posted';
        RETURN NEXT;
      END IF;
      CONTINUE;
    END IF;

    IF v_diff > 0.005 THEN
      v_credit_code := CASE WHEN COALESCE(r.status, 'unpaid') = 'paid' THEN '1000' ELSE '2000' END;

      SELECT id INTO v_credit_account_id
      FROM public.chart_of_accounts
      WHERE tenant_id = r.tenant_id
        AND account_code = v_credit_code
      LIMIT 1;

      IF v_credit_account_id IS NULL THEN
        expense_id := r.id;
        expense_date := r.expense_date;
        amount := r.amount;
        debit_total := r.dr;
        credit_total := r.cr;
        action := 'flagged';
        detail := 'Missing counter-account ' || v_credit_code || ' in chart of accounts';
        RETURN NEXT;
        CONTINUE;
      END IF;

      v_batch_id := (
        SELECT at.batch_id
        FROM public.account_transactions at
        WHERE at.reference_type = 'expense'
          AND at.reference_id = r.id
          AND at.batch_id IS NOT NULL
        LIMIT 1
      );

      IF v_batch_id IS NULL THEN
        v_actor_id := COALESCE(auth.uid(), r.approved_by, r.created_by);
        INSERT INTO public.journal_entry_batches (
          tenant_id,
          batch_date,
          description,
          reference_number,
          entry_type,
          created_by,
          is_posted,
          posted_at,
          posted_by,
          journal_type,
          approval_status,
          approved_by,
          approved_at
        ) VALUES (
          r.tenant_id,
          r.expense_date,
          'Expense reconciliation backfill: ' || COALESCE(r.description, r.id::text),
          'EXP-RECON-' || r.id::text,
          'expense',
          v_actor_id,
          true,
          now(),
          v_actor_id,
          'expense',
          'approved',
          v_actor_id,
          now()
        ) RETURNING id INTO v_batch_id;
      END IF;

      INSERT INTO public.account_transactions(
        tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, branch_id, batch_id
      ) VALUES (
        r.tenant_id, v_credit_account_id, r.expense_date, NULL, v_diff,
        COALESCE(r.description, 'Expense') || ' — reconciliation backfill (' ||
          CASE WHEN v_credit_code = '1000' THEN 'Cash' ELSE 'AP' END || ')',
        'expense', r.id, COALESCE(auth.uid(), r.approved_by, r.created_by), r.branch_id, v_batch_id
      );

      UPDATE public.expenses
      SET ledger_posted = true,
          ledger_transaction_id = COALESCE(ledger_transaction_id, (
            SELECT at.id
            FROM public.account_transactions at
            WHERE at.reference_type = 'expense'
              AND at.reference_id = r.id
              AND COALESCE(at.is_voided, false) = false
              AND COALESCE(at.debit, 0) > 0
            ORDER BY at.created_at ASC
            LIMIT 1
          ))
      WHERE id = r.id;

      expense_id := r.id;
      expense_date := r.expense_date;
      amount := r.amount;
      debit_total := r.dr;
      credit_total := r.cr + v_diff;
      action := 'backfilled';
      detail := 'Inserted missing credit leg of ' || v_diff::text || ' to account ' || v_credit_code;
      RETURN NEXT;
    ELSE
      expense_id := r.id;
      expense_date := r.expense_date;
      amount := r.amount;
      debit_total := r.dr;
      credit_total := r.cr;
      action := 'flagged';
      detail := 'Credits exceed debits by ' || ABS(v_diff)::text || ' — manual review required';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  FOR v_tenant_id IN
    SELECT DISTINCT tenant_id
    FROM public.expenses
    WHERE deleted_at IS NULL
      AND approval_status = 'approved'
      AND COALESCE(ledger_posted, false) = false
      AND account_id IS NOT NULL
  LOOP
    PERFORM * FROM public.reconcile_expense_ledger(v_tenant_id);
  END LOOP;
END $$;