ALTER TABLE public.staff_advances
  ADD COLUMN IF NOT EXISTS funding_source text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS funding_account_id uuid REFERENCES public.chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS capital_account_id uuid REFERENCES public.owner_capital_accounts(id);

ALTER TABLE public.staff_advances
  DROP CONSTRAINT IF EXISTS staff_advances_funding_source_check;
ALTER TABLE public.staff_advances
  ADD CONSTRAINT staff_advances_funding_source_check
  CHECK (funding_source IN ('company','owner_capital','partner_capital'));

CREATE OR REPLACE FUNCTION public.post_staff_advance_to_ledger(p_advance_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_advance RECORD;
  v_restaurant RECORD;
  v_advance_account_id uuid;
  v_credit_account_id uuid;
  v_transaction_id uuid;
  v_credit_label text := 'Cash';
BEGIN
  SELECT sa.*, s.name as staff_name INTO v_advance
  FROM staff_advances sa
  JOIN staff s ON sa.staff_id = s.id
  WHERE sa.id = p_advance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff advance record not found';
  END IF;

  IF v_advance.ledger_posted THEN
    RAISE EXCEPTION 'Advance already posted to ledger';
  END IF;

  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_advance.restaurant_id;

  SELECT id INTO v_advance_account_id FROM chart_of_accounts
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1150' AND is_active = true LIMIT 1;

  IF v_advance_account_id IS NULL THEN
    INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
    VALUES (v_restaurant.tenant_id, '1150', 'Advance to Employees Against Salary', 'asset', 'Advances given to employees pending deduction from salary')
    RETURNING id INTO v_advance_account_id;
  END IF;

  -- Credit side depends on who funded the advance
  IF COALESCE(v_advance.funding_source, 'company') <> 'company' THEN
    IF v_advance.capital_account_id IS NULL THEN
      RAISE EXCEPTION 'An owner/partner capital account must be selected for this advance';
    END IF;
    SELECT oca.equity_account_id,
           oca.partner_name || ' capital'
      INTO v_credit_account_id, v_credit_label
    FROM owner_capital_accounts oca
    WHERE oca.id = v_advance.capital_account_id
      AND oca.tenant_id = v_restaurant.tenant_id;
    IF v_credit_account_id IS NULL THEN
      RAISE EXCEPTION 'Selected owner/partner capital account is not linked to an equity account';
    END IF;
  ELSE
    IF v_advance.funding_account_id IS NOT NULL THEN
      SELECT id, account_name INTO v_credit_account_id, v_credit_label
      FROM chart_of_accounts
      WHERE id = v_advance.funding_account_id
        AND tenant_id = v_restaurant.tenant_id
        AND is_active = true;
    END IF;
    IF v_credit_account_id IS NULL THEN
      SELECT id, account_name INTO v_credit_account_id, v_credit_label
      FROM chart_of_accounts
      WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
    END IF;
    IF v_credit_account_id IS NULL THEN
      RAISE EXCEPTION 'Cash account (1000) not configured';
    END IF;
  END IF;

  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit,
    description, reference_type, reference_id, created_by, branch_id
  )
  VALUES (
    v_restaurant.tenant_id, v_advance_account_id, v_advance.advance_date, v_advance.amount,
    'Staff Advance - ' || v_advance.staff_name, 'staff_advance', p_advance_id, v_advance.created_by, v_advance.branch_id
  )
  RETURNING id INTO v_transaction_id;

  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, credit,
    description, reference_type, reference_id, created_by, branch_id
  )
  VALUES (
    v_restaurant.tenant_id, v_credit_account_id, v_advance.advance_date, v_advance.amount,
    'Staff Advance - ' || v_advance.staff_name || ' (paid from ' || COALESCE(v_credit_label, 'Cash') || ')',
    'staff_advance', p_advance_id, v_advance.created_by, v_advance.branch_id
  );

  UPDATE staff_advances
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_advance_id;

  RETURN v_transaction_id;
END;
$function$;