-- overhead_accrual_payroll_payable
--
-- Rent, utilities and salaries were missing from the monthly P&L (CFO review, Smoke Grill
-- production copy, 2026-11-14):
--   * Rent and utilities are set up as monthly overhead items (overhead_allocation, about 17,200 a
--     month over both branches), but only reach the ledger through the daily overhead closing,
--     which was run once (3 Aug 2026). Nothing else ever expensed them.
--   * post_overhead_payment_to_ledger always failed: it wrote journal_entry_batches columns that
--     do not exist (reference_type, reference_id, entry_date, is_approved), and its fixed codes
--     sent rent to 6000 (Salaries & Wages on this chart), insurance to 6100 (Salary Expense) and
--     internet to 6150 (Employee Benefits). All 4 recorded payments are missing from the books.
--   * post_payroll_to_ledger dated the salary expense on the payment date, so October's salaries
--     paid on 1 November landed in November. It also let any member of the restaurant post.
--
-- Now:
--   * overhead_item_accounts() picks the expense account for an overhead item by its name (rent,
--     electricity, water, gas, internet/phone, insurance; then utilities, then miscellaneous),
--     creating 6005 Rent Expense when a chart has no rent expense account. The accrual account
--     is 2100 Accrued Liabilities (the account the daily overhead closing already credits).
--   * post_overhead_month_accrual(restaurant, month, dry_run) posts, once per branch and month,
--     DR each item's expense account / CR 2100, dated the month end. Daily overhead closings
--     posted in that month are reversed in the same entry (capped at the month's amount), so
--     the month is never expensed twice. dry_run returns the lines without posting.
--   * post_overhead_payment_to_ledger posts DR 2100 / CR cash or bank: paying clears the accrual
--     instead of expensing again.
--   * post_payroll_to_ledger: when a salary is paid in a later month than the period it covers,
--     the expense is dated the period end (DR salary / CR 2150 Payroll Payable) and the payment
--     the payment date (DR 2150 / CR cash, advances, fines). A locked period end falls back to
--     the payment date. Posting needs journal-posting rights.

-- ---------------------------------------------------------------------------------------------
-- Account resolution for one overhead item.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.overhead_item_accounts(
  p_tenant_id uuid, p_name text, p_account_id uuid DEFAULT NULL, p_create boolean DEFAULT false)
 RETURNS TABLE(expense_account_id uuid, expense_label text, accrual_account_id uuid, accrual_label text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := lower(coalesce(p_name, ''));
  v_pattern text;
  v_exp_id uuid;
  v_exp_label text;
  v_acc_id uuid;
  v_acc_label text;
  v_code text;
  v_new_label text;
BEGIN
  IF p_account_id IS NOT NULL THEN
    SELECT id, account_code || ' ' || account_name INTO v_exp_id, v_exp_label FROM chart_of_accounts
    WHERE id = p_account_id AND tenant_id = p_tenant_id AND is_active AND account_type = 'expense';
  END IF;

  IF v_exp_id IS NULL THEN
    v_pattern := CASE
      WHEN v_name ~ '\mrent' THEN '\mrent'
      WHEN v_name ~ 'electric' THEN 'electric'
      WHEN v_name ~ '\mwater' THEN '\mwater'
      WHEN v_name ~ '\mgas\M' THEN '\mgas\M'
      WHEN v_name ~ 'internet|phone|telephone|wifi' THEN 'internet|telephone|phone'
      WHEN v_name ~ 'insurance' THEN 'insurance'
      ELSE NULL END;
    IF v_pattern IS NOT NULL THEN
      SELECT id, account_code || ' ' || account_name INTO v_exp_id, v_exp_label FROM chart_of_accounts
      WHERE tenant_id = p_tenant_id AND is_active AND account_type = 'expense'
        AND lower(account_name) ~ v_pattern
        AND lower(account_name) !~ 'deprec|amortiz|pre-?opening'
      ORDER BY account_code LIMIT 1;
    END IF;
  END IF;

  -- Rent with no rent expense account: create one (6005, or the next free 600x code).
  IF v_exp_id IS NULL AND v_name ~ '\mrent' THEN
    SELECT c INTO v_code FROM unnest(ARRAY['6005','6006','6007','6008','6009','6015','6025']) c
    WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND account_code = c)
    LIMIT 1;
    IF p_create AND v_code IS NOT NULL THEN
      INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
      VALUES (p_tenant_id, v_code, 'Rent Expense', 'expense', 'Premises rent (monthly overhead accrual)')
      RETURNING id, account_code || ' ' || account_name INTO v_exp_id, v_exp_label;
    ELSIF v_code IS NOT NULL THEN
      v_new_label := v_code || ' Rent Expense (new account)';
    END IF;
  END IF;

  IF v_exp_id IS NULL AND v_new_label IS NULL AND v_name ~ 'electric|\mwater|\mgas\M|internet|phone|telephone|wifi|utilit' THEN
    SELECT id, account_code || ' ' || account_name INTO v_exp_id, v_exp_label FROM chart_of_accounts
    WHERE tenant_id = p_tenant_id AND is_active AND account_type = 'expense' AND lower(account_name) ~ 'utilit'
      AND lower(account_name) !~ 'pre-?opening'
    ORDER BY account_code LIMIT 1;
  END IF;
  IF v_exp_id IS NULL AND v_new_label IS NULL THEN
    SELECT id, account_code || ' ' || account_name INTO v_exp_id, v_exp_label FROM chart_of_accounts
    WHERE tenant_id = p_tenant_id AND is_active AND account_type = 'expense' AND lower(account_name) ~ 'miscellaneous'
    ORDER BY account_code LIMIT 1;
  END IF;

  SELECT id, account_code || ' ' || account_name INTO v_acc_id, v_acc_label FROM chart_of_accounts
  WHERE tenant_id = p_tenant_id AND is_active AND account_code = '2100' LIMIT 1;
  IF v_acc_id IS NULL THEN
    IF p_create AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND account_code = '2100') THEN
      INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
      VALUES (p_tenant_id, '2100', 'Accrued Liabilities', 'liability', 'Expenses incurred, not yet paid')
      RETURNING id, account_code || ' ' || account_name INTO v_acc_id, v_acc_label;
    END IF;
  END IF;

  RETURN QUERY SELECT v_exp_id, coalesce(v_exp_label, v_new_label, 'no matching expense account'),
                      v_acc_id, coalesce(v_acc_label, '2100 Accrued Liabilities (new account)');
END;
$function$;
REVOKE ALL ON FUNCTION public.overhead_item_accounts(uuid, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.overhead_item_accounts(uuid, text, uuid, boolean) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- Month-end accrual of the overhead items, one journal per branch and month.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_overhead_month_accrual(
  p_restaurant_id uuid, p_month date, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_branch record;
  v_item record;
  v_acc record;
  v_ref text;
  v_total numeric;
  v_daily numeric;
  v_factor numeric;
  v_batch uuid;
  v_desc text;
  v_lines jsonb;
  v_out jsonb := '[]'::jsonb;
  v_posted numeric := 0;
  v_line record;
BEGIN
  SELECT tenant_id INTO v_tenant FROM restaurants WHERE id = p_restaurant_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to post the overhead accrual' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_tenant_access(v_tenant);
  PERFORM public.assert_restaurant_access(p_restaurant_id);
  IF NOT p_dry_run AND NOT public.can_post_journal_entries(v_tenant) THEN
    RAISE EXCEPTION 'Not allowed to post journal entries for this business' USING ERRCODE = '42501';
  END IF;
  IF p_month IS NULL OR v_start > (now() AT TIME ZONE 'Asia/Riyadh')::date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Choose a month that has started';
  END IF;

  FOR v_branch IN
    SELECT DISTINCT o.branch_id FROM overhead_allocation o
    WHERE o.restaurant_id = p_restaurant_id AND o.is_active AND coalesce(o.monthly_amount, 0) > 0
      AND o.created_at::date <= v_end
  LOOP
    v_ref := 'OHACC-' || to_char(v_start, 'YYYYMM')
             || coalesce('-' || upper(substring(replace(v_branch.branch_id::text, '-', '') FROM 1 FOR 6)), '');
    v_lines := '[]'::jsonb;
    v_total := 0;

    -- Expense lines, one per item.
    FOR v_item IN
      SELECT o.id, o.name, o.account_id, round(o.monthly_amount::numeric, 2) AS amount FROM overhead_allocation o
      WHERE o.restaurant_id = p_restaurant_id AND o.is_active AND coalesce(o.monthly_amount, 0) > 0
        AND o.created_at::date <= v_end AND o.branch_id IS NOT DISTINCT FROM v_branch.branch_id
      ORDER BY o.name
    LOOP
      SELECT * INTO v_acc FROM public.overhead_item_accounts(v_tenant, v_item.name, v_item.account_id, NOT p_dry_run);
      IF NOT p_dry_run AND (v_acc.expense_account_id IS NULL OR v_acc.accrual_account_id IS NULL) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: No expense account for overhead item "%". Set an account on it in Settings → Overheads.', v_item.name;
      END IF;
      v_lines := v_lines || jsonb_build_object('item', v_item.name, 'account_id', v_acc.expense_account_id,
        'account', v_acc.expense_label, 'debit', v_item.amount, 'credit', 0,
        'accrual_account_id', v_acc.accrual_account_id, 'accrual_account', v_acc.accrual_label);
      v_total := v_total + v_item.amount;
    END LOOP;

    -- Daily overhead closings already posted in the month for this branch: reversed here.
    SELECT coalesce(sum(t.debit), 0) INTO v_daily FROM account_transactions t
    WHERE t.tenant_id = v_tenant AND t.reference_type = 'daily_overhead' AND NOT coalesce(t.is_voided, false)
      AND t.transaction_date BETWEEN v_start AND v_end AND t.branch_id IS NOT DISTINCT FROM v_branch.branch_id
      AND coalesce(t.debit, 0) > 0;
    v_factor := CASE WHEN v_daily > v_total AND v_daily > 0 THEN v_total / v_daily ELSE 1 END;

    v_out := v_out || jsonb_build_object('branch_id', v_branch.branch_id, 'reference', v_ref,
      'total', v_total, 'daily_overhead_reversed', round(least(v_daily, v_total), 2), 'lines', v_lines,
      'already_posted', EXISTS (SELECT 1 FROM journal_entry_batches WHERE tenant_id = v_tenant AND reference_number = v_ref));

    IF p_dry_run OR v_total <= 0
       OR EXISTS (SELECT 1 FROM journal_entry_batches WHERE tenant_id = v_tenant AND reference_number = v_ref) THEN
      CONTINUE;
    END IF;

    v_desc := 'Overhead accrual ' || to_char(v_start, 'Mon YYYY') || ' (rent, utilities and other monthly overheads)'
              || CASE WHEN v_daily > 0 THEN '; reverses daily overhead closings of the month' ELSE '' END;
    INSERT INTO journal_entry_batches (tenant_id, branch_id, batch_date, description, reference_number, entry_type,
                                       journal_type, created_by, is_posted, posted_at, posted_by, approval_status)
    VALUES (v_tenant, v_branch.branch_id, v_end, v_desc, v_ref, 'adjustment', 'accrual', auth.uid(), true, now(), auth.uid(), 'approved')
    RETURNING id INTO v_batch;

    -- Net every leg per account: item expenses (DR), the accrual (CR), and the reversal of the
    -- month's daily overhead lines (their debits credited back, their credits debited back).
    FOR v_line IN
      WITH legs AS (
        SELECT (l->>'account_id')::uuid AS account_id, (l->>'debit')::numeric AS amt, l->>'item' AS item
        FROM jsonb_array_elements(v_lines) l
        UNION ALL
        SELECT (l->>'accrual_account_id')::uuid, -(l->>'debit')::numeric, NULL FROM jsonb_array_elements(v_lines) l
        UNION ALL
        SELECT t.account_id, -(coalesce(t.debit, 0) - coalesce(t.credit, 0)) * v_factor, NULL
        FROM account_transactions t
        WHERE t.tenant_id = v_tenant AND t.reference_type = 'daily_overhead' AND NOT coalesce(t.is_voided, false)
          AND t.transaction_date BETWEEN v_start AND v_end AND t.branch_id IS NOT DISTINCT FROM v_branch.branch_id
      )
      SELECT account_id, round(sum(amt), 2) AS net, string_agg(DISTINCT item, ', ') AS items
      FROM legs GROUP BY account_id HAVING round(sum(amt), 2) <> 0
    LOOP
      INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, credit, description,
                                        reference_type, reference_id, created_by, batch_id)
      VALUES (v_tenant, v_branch.branch_id, v_line.account_id, v_end, greatest(v_line.net, 0), greatest(-v_line.net, 0),
              'Overhead accrual ' || to_char(v_start, 'Mon YYYY') || coalesce(': ' || v_line.items, ''),
              'overhead_accrual', v_batch, auth.uid(), v_batch);
    END LOOP;
    v_posted := v_posted + v_total;
  END LOOP;

  RETURN jsonb_build_object('month', to_char(v_start, 'YYYY-MM'), 'dry_run', p_dry_run,
                            'posted_total', v_posted, 'branches', v_out);
END;
$function$;
REVOKE ALL ON FUNCTION public.post_overhead_month_accrual(uuid, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_overhead_month_accrual(uuid, date, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Paying an overhead item clears the accrual.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_overhead_payment_to_ledger(p_payment_id uuid, p_payment_method text DEFAULT 'cash'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment record;
  v_overhead record;
  v_acc record;
  v_credit uuid;
  v_method text;
  v_batch uuid;
  v_ref text;
  v_desc text;
  v_line uuid;
BEGIN
  SELECT * INTO v_payment FROM overhead_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  PERFORM public.assert_restaurant_access(v_payment.restaurant_id);
  IF auth.uid() IS NOT NULL AND NOT public.can_post_journal_entries(v_payment.tenant_id) THEN
    RAISE EXCEPTION 'Not allowed to post journal entries for this business' USING ERRCODE = '42501';
  END IF;
  IF v_payment.ledger_posted THEN RAISE EXCEPTION 'Payment already posted to ledger'; END IF;

  SELECT * INTO v_overhead FROM overhead_allocation WHERE id = v_payment.overhead_allocation_id;
  SELECT * INTO v_acc FROM public.overhead_item_accounts(v_payment.tenant_id, v_overhead.name, v_overhead.account_id, true);
  IF v_acc.accrual_account_id IS NULL THEN RAISE EXCEPTION 'Accrued Liabilities account (2100) not found'; END IF;

  v_method := lower(coalesce(nullif(p_payment_method, ''), v_payment.payment_method, 'cash'));
  SELECT id INTO v_credit FROM chart_of_accounts
  WHERE tenant_id = v_payment.tenant_id AND is_active
    AND account_code = CASE WHEN v_method = 'cash' THEN '1000' WHEN v_method IN ('card', 'bank', 'bank_transfer', 'transfer') THEN '1010' END
  LIMIT 1;
  IF v_credit IS NULL THEN RAISE EXCEPTION 'No cash (1000) or bank (1010) account for payment method %', v_method; END IF;

  v_ref := 'OHPAY-' || upper(left(replace(p_payment_id::text, '-', ''), 10));
  v_desc := 'Overhead payment: ' || coalesce(v_overhead.name, 'overhead') || ' for ' || to_char(v_payment.payment_month, 'Mon YYYY');
  INSERT INTO journal_entry_batches (tenant_id, branch_id, batch_date, description, reference_number, entry_type,
                                     journal_type, created_by, is_posted, posted_at, posted_by, approval_status)
  VALUES (v_payment.tenant_id, v_payment.branch_id, v_payment.payment_date, v_desc, v_ref, 'adjustment', 'payment',
          coalesce(auth.uid(), v_payment.created_by), true, now(), coalesce(auth.uid(), v_payment.created_by), 'approved')
  RETURNING id INTO v_batch;

  INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, credit, description,
                                    reference_type, reference_id, created_by, batch_id)
  VALUES (v_payment.tenant_id, v_payment.branch_id, v_acc.accrual_account_id, v_payment.payment_date, v_payment.amount_paid, 0,
          v_desc, 'overhead_payment', p_payment_id, coalesce(auth.uid(), v_payment.created_by), v_batch),
         (v_payment.tenant_id, v_payment.branch_id, v_credit, v_payment.payment_date, 0, v_payment.amount_paid,
          v_desc, 'overhead_payment', p_payment_id, coalesce(auth.uid(), v_payment.created_by), v_batch);
  SELECT id INTO v_line FROM account_transactions WHERE batch_id = v_batch AND debit > 0 LIMIT 1;

  UPDATE overhead_payments SET ledger_posted = true, ledger_transaction_id = v_line, updated_at = now()
  WHERE id = p_payment_id;
  RETURN v_batch;
END;
$function$;
REVOKE ALL ON FUNCTION public.post_overhead_payment_to_ledger(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_overhead_payment_to_ledger(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Payroll: expense in the period it was earned.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_payroll_to_ledger(p_payroll_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payroll RECORD;
  v_restaurant RECORD;
  v_wages_account_id uuid;
  v_cash_account_id uuid;
  v_advance_account_id uuid;
  v_fines_account_id uuid;
  v_payable_account_id uuid;
  v_transaction_id uuid;
  v_gross numeric;
  v_advance numeric;
  v_fines numeric;
  v_net numeric;
  v_remaining numeric;
  v_leg numeric;
  v_accrue boolean;
  v_pay_date date;
  r RECORD;
BEGIN
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.payroll_records WHERE id = p_payroll_id));

  SELECT pr.*, s.name AS staff_name INTO v_payroll
  FROM payroll_records pr
  JOIN staff s ON pr.staff_id = s.id
  WHERE pr.id = p_payroll_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll record not found';
  END IF;

  IF v_payroll.ledger_posted THEN
    RAISE EXCEPTION 'Payroll already posted to ledger';
  END IF;

  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_payroll.restaurant_id;

  IF auth.uid() IS NOT NULL AND NOT public.can_post_journal_entries(v_restaurant.tenant_id) THEN
    RAISE EXCEPTION 'Not allowed to post payroll for this business' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_wages_account_id FROM chart_of_accounts
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '6100' AND is_active = true LIMIT 1;

  SELECT id INTO v_cash_account_id FROM chart_of_accounts
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;

  IF v_wages_account_id IS NULL OR v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts (6100, 1000) not configured';
  END IF;

  v_gross := COALESCE(v_payroll.amount, 0);
  v_advance := LEAST(COALESCE(v_payroll.advance_recovered, 0), v_gross);
  v_fines := LEAST(GREATEST(COALESCE(v_payroll.fines_deducted, 0), 0), v_gross - v_advance);
  v_net := v_gross - v_advance - v_fines;

  -- Paid in a later month than the period it covers: expense at the period end through Payroll
  -- Payable, unless that period is locked.
  v_accrue := v_payroll.period_end IS NOT NULL AND v_payroll.payment_date IS NOT NULL
    AND date_trunc('month', v_payroll.payment_date) > date_trunc('month', v_payroll.period_end)
    AND NOT EXISTS (
      SELECT 1 FROM fiscal_period_locks l
      WHERE l.tenant_id = v_restaurant.tenant_id AND l.is_locked AND l.unlocked_at IS NULL
        AND v_payroll.period_end BETWEEN l.period_start AND l.period_end);

  IF v_accrue THEN
    SELECT id INTO v_payable_account_id FROM chart_of_accounts
    WHERE tenant_id = v_restaurant.tenant_id AND account_code = '2150' AND is_active = true LIMIT 1;
    IF v_payable_account_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE tenant_id = v_restaurant.tenant_id AND account_code = '2150') THEN
        v_accrue := false; -- 2150 exists but is inactive: keep the old dating
      ELSE
        INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
        VALUES (v_restaurant.tenant_id, '2150', 'Payroll Payable', 'liability', 'Salaries earned, not yet paid')
        RETURNING id INTO v_payable_account_id;
      END IF;
    END IF;
  END IF;
  v_pay_date := v_payroll.payment_date;

  IF v_advance > 0 THEN
    SELECT id INTO v_advance_account_id FROM chart_of_accounts
    WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1150' AND is_active = true LIMIT 1;

    IF v_advance_account_id IS NULL THEN
      INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
      VALUES (v_restaurant.tenant_id, '1150', 'Advance to Employees Against Salary', 'asset',
              'Advances given to employees pending deduction from salary')
      RETURNING id INTO v_advance_account_id;
    END IF;
  END IF;

  IF v_fines > 0 THEN
    SELECT id INTO v_fines_account_id FROM chart_of_accounts
    WHERE tenant_id = v_restaurant.tenant_id AND account_code = '4910' AND is_active = true LIMIT 1;

    IF v_fines_account_id IS NULL THEN
      INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
      VALUES (v_restaurant.tenant_id, '4910', 'Employee Fines Recovered', 'revenue',
              'Disciplinary fines and deductions recovered from employee salaries')
      RETURNING id INTO v_fines_account_id;
    END IF;
  END IF;

  -- DEBIT: gross salary expense (dated the period end when accrued).
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit,
    description, reference_type, reference_id, branch_id
  )
  VALUES (
    v_restaurant.tenant_id, v_wages_account_id,
    CASE WHEN v_accrue THEN v_payroll.period_end ELSE v_pay_date END, v_gross,
    CASE WHEN v_accrue THEN 'Salary earned ' || to_char(v_payroll.period_end, 'Mon YYYY') || ' (gross) - '
         ELSE 'Salary Payment (gross) - ' END || v_payroll.staff_name,
    'expense', p_payroll_id, v_payroll.branch_id
  )
  RETURNING id INTO v_transaction_id;

  IF v_accrue THEN
    -- CREDIT Payroll Payable at the period end, DEBIT it on the payment date.
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, credit, debit, description, reference_type, reference_id, branch_id)
    VALUES (v_restaurant.tenant_id, v_payable_account_id, v_payroll.period_end, v_gross, NULL,
            'Salary payable ' || to_char(v_payroll.period_end, 'Mon YYYY') || ' - ' || v_payroll.staff_name,
            'expense', p_payroll_id, v_payroll.branch_id),
           (v_restaurant.tenant_id, v_payable_account_id, v_pay_date, NULL, v_gross,
            'Salary payable settled - ' || v_payroll.staff_name, 'expense', p_payroll_id, v_payroll.branch_id);
  END IF;

  -- CREDIT: advance recovered. Legs stay on the payroll reference so the
  -- per-expense balance check sees a complete, balanced journal; individual
  -- advances remain traceable through the description.
  IF v_advance > 0 THEN
    v_remaining := v_advance;

    FOR r IN
      SELECT sa.id, GREATEST(COALESCE(sa.amount, 0) - COALESCE(sa.repaid_amount, 0), 0) AS outstanding,
             COALESCE(sa.amount, 0) AS amount
      FROM staff_advances sa
      WHERE sa.deducted_from_payroll_id = p_payroll_id
      ORDER BY sa.created_at
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_leg := LEAST(v_remaining, GREATEST(r.outstanding, r.amount));
      IF v_leg > 0 THEN
        INSERT INTO account_transactions (
          tenant_id, account_id, transaction_date, credit,
          description, reference_type, reference_id, branch_id
        )
        VALUES (
          v_restaurant.tenant_id, v_advance_account_id, v_pay_date, v_leg,
          'Advance recovered from salary - ' || v_payroll.staff_name || ' (advance ' || left(r.id::text, 8) || ')',
          'expense', p_payroll_id, v_payroll.branch_id
        );
        v_remaining := v_remaining - v_leg;
      END IF;
    END LOOP;

    IF v_remaining > 0 THEN
      INSERT INTO account_transactions (
        tenant_id, account_id, transaction_date, credit,
        description, reference_type, reference_id, branch_id
      )
      VALUES (
        v_restaurant.tenant_id, v_advance_account_id, v_pay_date, v_remaining,
        'Advance recovered from salary - ' || v_payroll.staff_name, 'expense', p_payroll_id, v_payroll.branch_id
      );
    END IF;
  END IF;

  IF v_fines > 0 THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit,
      description, reference_type, reference_id, branch_id
    )
    VALUES (
      v_restaurant.tenant_id, v_fines_account_id, v_pay_date, v_fines,
      'Employee fines deducted from salary - ' || v_payroll.staff_name, 'expense', p_payroll_id, v_payroll.branch_id
    );
  END IF;

  IF v_net > 0 THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit,
      description, reference_type, reference_id, branch_id
    )
    VALUES (
      v_restaurant.tenant_id, v_cash_account_id, v_pay_date, v_net,
      'Salary Payment (net) - ' || v_payroll.staff_name, 'expense', p_payroll_id, v_payroll.branch_id
    );
  END IF;

  UPDATE payroll_records
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_payroll_id;

  RETURN v_transaction_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.post_payroll_to_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_payroll_to_ledger(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- A daily overhead closing cannot be posted into a month the accrual already covers.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_daily_overhead(p_closure_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.daily_overhead_closures%ROWTYPE;
  v_debit uuid;
  v_credit uuid;
  v_batch uuid;
BEGIN
  SELECT * INTO c FROM public.daily_overhead_closures WHERE id = p_closure_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Closure not found';
  END IF;
  IF NOT public.can_manage_daily_overhead(c.restaurant_id) THEN
    RAISE EXCEPTION 'Not authorised to post daily overhead';
  END IF;

  IF c.status = 'posted' AND c.batch_id IS NOT NULL THEN
    RETURN c.batch_id;
  END IF;
  IF c.status NOT IN ('finalized','posting_failed','adjusted') THEN
    RAISE EXCEPTION 'Day must be finalized before posting';
  END IF;

  -- The month's overheads are already booked by the month-end accrual: posting the day too would
  -- expense it twice.
  IF EXISTS (SELECT 1 FROM public.journal_entry_batches b
             WHERE b.tenant_id = c.tenant_id
               AND b.reference_number = 'OHACC-' || to_char(c.business_date, 'YYYYMM')
                   || COALESCE('-' || UPPER(SUBSTRING(REPLACE(c.branch_id::text, '-', '') FROM 1 FOR 6)), '')) THEN
    RAISE EXCEPTION 'Overheads for % are already accrued for the month; the daily closing is not posted', to_char(c.business_date, 'Mon YYYY');
  END IF;

  SELECT b.id INTO v_batch FROM public.journal_entry_batches b
  WHERE b.tenant_id = c.tenant_id AND b.reference_number = c.gl_reference LIMIT 1;
  IF v_batch IS NOT NULL THEN
    PERFORM set_config('app.daily_overhead_ctx', 'on', true);
    UPDATE public.daily_overhead_closures
    SET status = 'posted', batch_id = v_batch, posted_at = COALESCE(posted_at, now()),
        posting_error = NULL, updated_at = now()
    WHERE id = c.id;
    PERFORM set_config('app.daily_overhead_ctx', 'off', true);
    PERFORM public.notify_daily_overhead_posting(c.id, true, NULL);
    RETURN v_batch;
  END IF;

  IF c.overhead_amount <= 0 THEN
    RAISE EXCEPTION 'Nothing to post: overhead amount is zero';
  END IF;

  SELECT r.debit_account_id, r.credit_account_id INTO v_debit, v_credit
  FROM public.resolve_daily_overhead_accounts(c.restaurant_id, c.branch_id) r;

  IF v_debit IS NULL OR v_credit IS NULL THEN
    PERFORM set_config('app.daily_overhead_ctx', 'on', true);
    UPDATE public.daily_overhead_closures
    SET status = 'posting_failed',
        posting_error = 'Overhead accounts are not configured (need a daily overhead expense account and an accrual account)',
        updated_at = now()
    WHERE id = c.id;
    PERFORM set_config('app.daily_overhead_ctx', 'off', true);
    INSERT INTO public.daily_overhead_audit (tenant_id, closure_id, business_date, action, error_message, performed_by)
    VALUES (c.tenant_id, c.id, c.business_date, 'post_failed', 'Overhead accounts are not configured', auth.uid());
    RAISE EXCEPTION 'Overhead accounts are not configured for this branch';
  END IF;

  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, description, batch_date, reference_number, created_by,
    entry_type, journal_type, is_posted, posted_at, posted_by, approval_status
  ) VALUES (
    c.tenant_id, c.branch_id, 'Daily Overhead Allocation', c.business_date, c.gl_reference,
    COALESCE(auth.uid(), c.finalized_by), 'adjustment', 'adjustment', true, now(),
    COALESCE(auth.uid(), c.finalized_by), 'approved'
  ) RETURNING id INTO v_batch;

  INSERT INTO public.account_transactions (
    tenant_id, branch_id, account_id, transaction_date, debit, credit, description,
    reference_type, reference_id, created_by, batch_id
  ) VALUES
  (c.tenant_id, c.branch_id, v_debit, c.business_date, c.overhead_amount, 0,
   'Daily Overhead Allocation ' || c.gl_reference, 'daily_overhead', c.id, COALESCE(auth.uid(), c.finalized_by), v_batch),
  (c.tenant_id, c.branch_id, v_credit, c.business_date, 0, c.overhead_amount,
   'Daily Overhead Allocation ' || c.gl_reference, 'daily_overhead', c.id, COALESCE(auth.uid(), c.finalized_by), v_batch);

  PERFORM set_config('app.daily_overhead_ctx', 'on', true);
  UPDATE public.daily_overhead_closures
  SET status = 'posted', batch_id = v_batch, posted_at = now(), posting_error = NULL, updated_at = now()
  WHERE id = c.id;
  PERFORM set_config('app.daily_overhead_ctx', 'off', true);

  INSERT INTO public.daily_overhead_audit (
    tenant_id, closure_id, business_date, action, amount_after, batch_id, gl_reference, performed_by
  ) VALUES (c.tenant_id, c.id, c.business_date, 'posted', c.overhead_amount, v_batch, c.gl_reference, auth.uid());

  PERFORM public.notify_daily_overhead_posting(c.id, true, NULL);

  RETURN v_batch;
END;
$function$;
