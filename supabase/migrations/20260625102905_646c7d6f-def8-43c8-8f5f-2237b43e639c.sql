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
        v_batch_id := gen_random_uuid();
      END IF;

      INSERT INTO public.account_transactions(
        tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, branch_id, batch_id
      ) VALUES (
        r.tenant_id, v_credit_account_id, r.expense_date, NULL, v_diff,
        COALESCE(r.description, 'Expense') || ' — reconciliation backfill (' ||
          CASE WHEN v_credit_code = '1000' THEN 'Cash' ELSE 'AP' END || ')',
        'expense', r.id, auth.uid(), r.branch_id, v_batch_id
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