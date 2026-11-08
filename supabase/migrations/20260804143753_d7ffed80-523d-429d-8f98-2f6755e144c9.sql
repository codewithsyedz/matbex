ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS advance_recovered numeric NOT NULL DEFAULT 0;

ALTER TABLE public.payroll_records
  DROP CONSTRAINT IF EXISTS payroll_records_advance_recovered_check;
ALTER TABLE public.payroll_records
  ADD CONSTRAINT payroll_records_advance_recovered_check CHECK (advance_recovered >= 0);

CREATE OR REPLACE FUNCTION public.post_payroll_to_ledger(p_payroll_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payroll RECORD;
  v_restaurant RECORD;
  v_wages_account_id uuid;
  v_cash_account_id uuid;
  v_advance_account_id uuid;
  v_transaction_id uuid;
  v_gross numeric;
  v_advance numeric;
  v_net numeric;
BEGIN
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

  SELECT id INTO v_wages_account_id FROM chart_of_accounts
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '6100' AND is_active = true LIMIT 1;

  SELECT id INTO v_cash_account_id FROM chart_of_accounts
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;

  IF v_wages_account_id IS NULL OR v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts (6100, 1000) not configured';
  END IF;

  v_gross := COALESCE(v_payroll.amount, 0);
  v_advance := LEAST(COALESCE(v_payroll.advance_recovered, 0), v_gross);
  v_net := v_gross - v_advance;

  IF v_advance > 0 THEN
    SELECT id INTO v_advance_account_id FROM chart_of_accounts
    WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1150' AND is_active = true LIMIT 1;

    IF v_advance_account_id IS NULL THEN
      INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
      VALUES (v_restaurant.tenant_id, '1150', 'Employee Advances Receivable', 'asset',
              'Advances given to employees pending deduction from salary')
      RETURNING id INTO v_advance_account_id;
    END IF;
  END IF;

  -- DEBIT: full gross salary expense
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit,
    description, reference_type, reference_id
  )
  VALUES (
    v_restaurant.tenant_id, v_wages_account_id, v_payroll.payment_date, v_gross,
    'Salary Payment (gross) - ' || v_payroll.staff_name, 'expense', p_payroll_id
  )
  RETURNING id INTO v_transaction_id;

  -- CREDIT: advance recovered (asset decreases)
  IF v_advance > 0 THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit,
      description, reference_type, reference_id
    )
    VALUES (
      v_restaurant.tenant_id, v_advance_account_id, v_payroll.payment_date, v_advance,
      'Advance recovered from salary - ' || v_payroll.staff_name, 'expense', p_payroll_id
    );
  END IF;

  -- CREDIT: net cash paid out
  IF v_net > 0 THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit,
      description, reference_type, reference_id
    )
    VALUES (
      v_restaurant.tenant_id, v_cash_account_id, v_payroll.payment_date, v_net,
      'Salary Payment (net) - ' || v_payroll.staff_name, 'expense', p_payroll_id
    );
  END IF;

  UPDATE payroll_records
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_payroll_id;

  RETURN v_transaction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_advance_from_payroll(p_advance_id uuid, p_payroll_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance RECORD;
  v_restaurant RECORD;
  v_advance_account_id uuid;
  v_cash_account_id uuid;
BEGIN
  SELECT sa.*, s.name AS staff_name INTO v_advance
  FROM staff_advances sa
  JOIN staff s ON sa.staff_id = s.id
  WHERE sa.id = p_advance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff advance record not found';
  END IF;

  IF v_advance.status = 'deducted' THEN
    RAISE EXCEPTION 'Advance already deducted';
  END IF;

  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_advance.restaurant_id;

  -- When recovered outside payroll, the employee repays in cash:
  -- DR Cash / CR Employee Advances Receivable.
  -- When linked to a payroll record, post_payroll_to_ledger already credits 1150,
  -- so no journal is created here (avoids double-counting wages).
  IF p_payroll_id IS NULL THEN
    SELECT id INTO v_advance_account_id FROM chart_of_accounts
    WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1150' AND is_active = true LIMIT 1;

    SELECT id INTO v_cash_account_id FROM chart_of_accounts
    WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;

    IF v_advance_account_id IS NOT NULL AND v_cash_account_id IS NOT NULL THEN
      INSERT INTO account_transactions (
        tenant_id, account_id, transaction_date, debit,
        description, reference_type, reference_id
      )
      VALUES (
        v_restaurant.tenant_id, v_cash_account_id, CURRENT_DATE, v_advance.amount,
        'Advance repaid by employee - ' || v_advance.staff_name, 'advance_deduction', p_advance_id
      );

      INSERT INTO account_transactions (
        tenant_id, account_id, transaction_date, credit,
        description, reference_type, reference_id
      )
      VALUES (
        v_restaurant.tenant_id, v_advance_account_id, CURRENT_DATE, v_advance.amount,
        'Advance repaid by employee - ' || v_advance.staff_name, 'advance_deduction', p_advance_id
      );
    END IF;
  END IF;

  UPDATE staff_advances
  SET status = 'deducted',
      deducted_from_payroll_id = p_payroll_id,
      deducted_at = now(),
      updated_at = now()
  WHERE id = p_advance_id;
END;
$$;