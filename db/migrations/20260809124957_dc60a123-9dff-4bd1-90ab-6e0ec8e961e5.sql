ALTER TABLE public.staff_advances
  ADD COLUMN IF NOT EXISTS repaid_amount numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.staff_advance_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  branch_id uuid,
  advance_id uuid NOT NULL REFERENCES public.staff_advances(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  repayment_date date NOT NULL DEFAULT CURRENT_DATE,
  source text NOT NULL DEFAULT 'cash' CHECK (source IN ('cash','bank','payroll')),
  account_id uuid REFERENCES public.chart_of_accounts(id),
  payroll_id uuid,
  notes text,
  ledger_transaction_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_advance_repayments_advance ON public.staff_advance_repayments(advance_id);
CREATE INDEX IF NOT EXISTS idx_staff_advance_repayments_restaurant ON public.staff_advance_repayments(restaurant_id, repayment_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_advance_repayments TO authenticated;
GRANT ALL ON public.staff_advance_repayments TO service_role;

ALTER TABLE public.staff_advance_repayments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers and owners can view advance repayments"
ON public.staff_advance_repayments FOR SELECT TO authenticated
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

CREATE POLICY "Managers and owners can create advance repayments"
ON public.staff_advance_repayments FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

CREATE POLICY "Managers and owners can update advance repayments"
ON public.staff_advance_repayments FOR UPDATE TO authenticated
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

CREATE POLICY "Owners can delete advance repayments"
ON public.staff_advance_repayments FOR DELETE TO authenticated
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role));

CREATE POLICY "Branch pin restriction"
ON public.staff_advance_repayments FOR ALL TO authenticated
USING (branch_id IS NULL OR user_can_access_branch(auth.uid(), restaurant_id, branch_id))
WITH CHECK (branch_id IS NULL OR user_can_access_branch(auth.uid(), restaurant_id, branch_id));

CREATE TRIGGER update_staff_advance_repayments_updated_at
BEFORE UPDATE ON public.staff_advance_repayments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.record_staff_advance_repayment(
  p_advance_id uuid,
  p_amount numeric,
  p_repayment_date date DEFAULT CURRENT_DATE,
  p_source text DEFAULT 'cash',
  p_account_id uuid DEFAULT NULL,
  p_payroll_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_advance RECORD;
  v_outstanding numeric;
  v_advance_account_id uuid;
  v_debit_account_id uuid;
  v_debit_label text := 'Cash';
  v_txn_id uuid;
  v_repayment_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Repayment amount must be greater than zero';
  END IF;
  IF p_source NOT IN ('cash','bank','payroll') THEN
    RAISE EXCEPTION 'Invalid repayment source: %', p_source;
  END IF;

  SELECT sa.*, s.name AS staff_name INTO v_advance
  FROM staff_advances sa
  JOIN staff s ON s.id = sa.staff_id
  WHERE sa.id = p_advance_id
  FOR UPDATE OF sa;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff advance record not found';
  END IF;

  IF v_advance.status = 'forgiven' THEN
    RAISE EXCEPTION 'This advance was forgiven and cannot be repaid';
  END IF;

  IF COALESCE(v_advance.ledger_reversed, false) THEN
    RAISE EXCEPTION 'This advance ledger entry was reversed and cannot be repaid';
  END IF;

  v_outstanding := v_advance.amount - COALESCE(v_advance.repaid_amount, 0);
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'This advance is already fully repaid';
  END IF;
  IF p_amount > v_outstanding + 0.005 THEN
    RAISE EXCEPTION 'Repayment (%) exceeds the outstanding balance (%)', p_amount, v_outstanding;
  END IF;

  SELECT id INTO v_advance_account_id FROM chart_of_accounts
  WHERE tenant_id = v_advance.tenant_id AND account_code = '1150' AND is_active = true LIMIT 1;
  IF v_advance_account_id IS NULL THEN
    RAISE EXCEPTION 'Employee advances account (1150) is not configured';
  END IF;

  -- Payroll-sourced repayments are credited to 1150 by post_payroll_to_ledger,
  -- so we only post a journal for cash/bank repayments here.
  IF p_source <> 'payroll' THEN
    IF p_account_id IS NOT NULL THEN
      SELECT id, account_name INTO v_debit_account_id, v_debit_label
      FROM chart_of_accounts
      WHERE id = p_account_id AND tenant_id = v_advance.tenant_id AND is_active = true;
    END IF;
    IF v_debit_account_id IS NULL THEN
      SELECT id, account_name INTO v_debit_account_id, v_debit_label
      FROM chart_of_accounts
      WHERE tenant_id = v_advance.tenant_id
        AND account_code = CASE WHEN p_source = 'bank' THEN '1010' ELSE '1000' END
        AND is_active = true
      LIMIT 1;
    END IF;
    IF v_debit_account_id IS NULL THEN
      RAISE EXCEPTION 'No cash/bank account configured to receive the repayment';
    END IF;

    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, debit,
      description, reference_type, reference_id, created_by, branch_id
    ) VALUES (
      v_advance.tenant_id, v_debit_account_id, p_repayment_date, p_amount,
      'Advance repayment - ' || v_advance.staff_name || ' (' || COALESCE(v_debit_label,'Cash') || ')',
      'staff_advance_repayment', p_advance_id, auth.uid(), v_advance.branch_id
    ) RETURNING id INTO v_txn_id;

    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit,
      description, reference_type, reference_id, created_by, branch_id
    ) VALUES (
      v_advance.tenant_id, v_advance_account_id, p_repayment_date, p_amount,
      'Advance repayment - ' || v_advance.staff_name,
      'staff_advance_repayment', p_advance_id, auth.uid(), v_advance.branch_id
    );
  END IF;

  INSERT INTO staff_advance_repayments (
    tenant_id, restaurant_id, branch_id, advance_id, amount, repayment_date,
    source, account_id, payroll_id, notes, ledger_transaction_id, created_by
  ) VALUES (
    v_advance.tenant_id, v_advance.restaurant_id, v_advance.branch_id, p_advance_id, p_amount, p_repayment_date,
    p_source, v_debit_account_id, p_payroll_id, p_notes, v_txn_id, auth.uid()
  ) RETURNING id INTO v_repayment_id;

  UPDATE staff_advances
  SET repaid_amount = COALESCE(repaid_amount, 0) + p_amount,
      status = CASE WHEN COALESCE(repaid_amount, 0) + p_amount >= amount - 0.005 THEN 'deducted' ELSE status END,
      deducted_from_payroll_id = CASE
        WHEN COALESCE(repaid_amount, 0) + p_amount >= amount - 0.005 THEN COALESCE(p_payroll_id, deducted_from_payroll_id)
        ELSE deducted_from_payroll_id END,
      deducted_at = CASE WHEN COALESCE(repaid_amount, 0) + p_amount >= amount - 0.005 THEN now() ELSE deducted_at END,
      updated_at = now()
  WHERE id = p_advance_id;

  RETURN v_repayment_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_staff_advance_repayment(p_repayment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rep RECORD;
BEGIN
  SELECT * INTO v_rep FROM staff_advance_repayments WHERE id = p_repayment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repayment not found';
  END IF;

  DELETE FROM account_transactions
  WHERE reference_type = 'staff_advance_repayment'
    AND reference_id = v_rep.advance_id
    AND tenant_id = v_rep.tenant_id
    AND transaction_date = v_rep.repayment_date
    AND (debit = v_rep.amount OR credit = v_rep.amount)
    AND (id = v_rep.ledger_transaction_id OR v_rep.ledger_transaction_id IS NULL OR true);

  UPDATE staff_advances
  SET repaid_amount = GREATEST(COALESCE(repaid_amount, 0) - v_rep.amount, 0),
      status = CASE WHEN status = 'deducted' AND GREATEST(COALESCE(repaid_amount,0) - v_rep.amount, 0) < amount - 0.005 THEN 'pending' ELSE status END,
      deducted_at = CASE WHEN GREATEST(COALESCE(repaid_amount,0) - v_rep.amount, 0) < amount - 0.005 THEN NULL ELSE deducted_at END,
      updated_at = now()
  WHERE id = v_rep.advance_id;

  DELETE FROM staff_advance_repayments WHERE id = p_repayment_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_staff_advance_repayment(uuid, numeric, date, text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_staff_advance_repayment(uuid) TO authenticated;