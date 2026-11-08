CREATE OR REPLACE FUNCTION public.post_payroll_to_ledger(p_payroll_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_payroll RECORD;
  v_restaurant RECORD;
  v_wages_account_id uuid;
  v_cash_account_id uuid;
  v_advance_account_id uuid;
  v_fines_account_id uuid;
  v_transaction_id uuid;
  v_gross numeric;
  v_advance numeric;
  v_fines numeric;
  v_net numeric;
  v_remaining numeric;
  v_leg numeric;
  r RECORD;
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
  v_fines := LEAST(GREATEST(COALESCE(v_payroll.fines_deducted, 0), 0), v_gross - v_advance);
  v_net := v_gross - v_advance - v_fines;

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

  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit,
    description, reference_type, reference_id, branch_id
  )
  VALUES (
    v_restaurant.tenant_id, v_wages_account_id, v_payroll.payment_date, v_gross,
    'Salary Payment (gross) - ' || v_payroll.staff_name, 'expense', p_payroll_id, v_payroll.branch_id
  )
  RETURNING id INTO v_transaction_id;

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
          v_restaurant.tenant_id, v_advance_account_id, v_payroll.payment_date, v_leg,
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
        v_restaurant.tenant_id, v_advance_account_id, v_payroll.payment_date, v_remaining,
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
      v_restaurant.tenant_id, v_fines_account_id, v_payroll.payment_date, v_fines,
      'Employee fines deducted from salary - ' || v_payroll.staff_name, 'expense', p_payroll_id, v_payroll.branch_id
    );
  END IF;

  IF v_net > 0 THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit,
      description, reference_type, reference_id, branch_id
    )
    VALUES (
      v_restaurant.tenant_id, v_cash_account_id, v_payroll.payment_date, v_net,
      'Salary Payment (net) - ' || v_payroll.staff_name, 'expense', p_payroll_id, v_payroll.branch_id
    );
  END IF;

  UPDATE payroll_records
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_payroll_id;

  RETURN v_transaction_id;
END;
$function$;