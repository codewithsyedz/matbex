ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vat_split_status text NOT NULL DEFAULT 'pending';

DO $$ BEGIN
  ALTER TABLE public.expenses
    ADD CONSTRAINT expenses_vat_split_status_chk
    CHECK (vat_split_status IN ('pending','applied','not_applicable'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Existing rows that already carry a VAT split are done; zero-VAT rows stay pending.
UPDATE public.expenses
SET vat_split_status = 'applied'
WHERE COALESCE(vat_amount, 0) > 0;

CREATE INDEX IF NOT EXISTS idx_expenses_vat_split_pending
  ON public.expenses (tenant_id, branch_id, expense_date)
  WHERE vat_split_status = 'pending' AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.apply_expense_vat_split(
  p_expense_id uuid,
  p_rate_percent numeric,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exp record;
  v_net numeric(15,2);
  v_vat numeric(15,2);
  v_vat_account uuid;
  v_debit_account uuid;
  v_batch uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner'::app_role, 'accountant'::app_role, 'manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only owners, accountants or managers can apply a VAT split.';
  END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id AND deleted_at IS NULL;
  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'Expense not found.';
  END IF;
  IF v_exp.vat_split_status = 'applied' OR COALESCE(v_exp.vat_amount, 0) > 0 THEN
    RAISE EXCEPTION 'This expense already has a VAT split.';
  END IF;
  IF COALESCE(p_rate_percent, 0) <= 0 THEN
    RAISE EXCEPTION 'VAT rate must be greater than zero.';
  END IF;

  -- The recorded amount is treated as VAT inclusive so the ledger total never moves.
  v_net := round(v_exp.amount / (1 + p_rate_percent / 100.0), 2);
  v_vat := round(v_exp.amount - v_net, 2);

  UPDATE expenses
  SET vat_amount = v_vat,
      net_amount = v_net,
      vat_rate = p_rate_percent,
      vat_inclusive = true,
      vat_split_status = 'applied',
      updated_at = now()
  WHERE id = p_expense_id;

  IF COALESCE(v_exp.ledger_posted, false) = true AND v_vat > 0 THEN
    SELECT id INTO v_vat_account
    FROM chart_of_accounts
    WHERE tenant_id = v_exp.tenant_id AND account_code = '1180' AND COALESCE(is_active, true)
    LIMIT 1;
    IF v_vat_account IS NULL THEN
      RAISE EXCEPTION 'Account 1180 Input VAT Recoverable is not configured.';
    END IF;

    SELECT account_id INTO v_debit_account
    FROM account_transactions
    WHERE reference_id = p_expense_id
      AND reference_type = 'expense'
      AND COALESCE(is_voided, false) = false
      AND debit > 0
    ORDER BY debit DESC
    LIMIT 1;
    v_debit_account := COALESCE(v_debit_account, v_exp.account_id);
    IF v_debit_account IS NULL THEN
      RAISE EXCEPTION 'Could not determine the expense account to reclassify.';
    END IF;

    INSERT INTO journal_entry_batches (
      tenant_id, branch_id, batch_date, description, reference_number,
      entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status
    ) VALUES (
      v_exp.tenant_id, v_exp.branch_id, v_exp.expense_date,
      'Retroactive VAT split - ' || COALESCE(v_exp.description, p_expense_id::text)
        || CASE WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN ' (' || trim(p_note) || ')' ELSE '' END,
      'VATSPLIT-' || to_char(v_exp.expense_date, 'YYYYMMDD') || '-' || substr(p_expense_id::text, 1, 8),
      'correction', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved'
    ) RETURNING id INTO v_batch;

    INSERT INTO account_transactions (
      tenant_id, branch_id, account_id, batch_id, transaction_date,
      debit, credit, description, reference_type, reference_id, created_by
    ) VALUES
      (v_exp.tenant_id, v_exp.branch_id, v_vat_account, v_batch, v_exp.expense_date,
       v_vat, 0, 'Input VAT recovered on retroactive split', 'correction', p_expense_id, auth.uid()),
      (v_exp.tenant_id, v_exp.branch_id, v_debit_account, v_batch, v_exp.expense_date,
       0, v_vat, 'Net-of-VAT restatement of expense', 'correction', p_expense_id, auth.uid());
  END IF;

  RETURN jsonb_build_object('ok', true, 'net', v_net, 'vat', v_vat, 'batch_id', v_batch);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_expense_vat_not_applicable(p_expense_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner'::app_role, 'accountant'::app_role, 'manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'Not allowed.';
  END IF;

  UPDATE expenses
  SET vat_split_status = 'not_applicable', updated_at = now()
  WHERE id = p_expense_id AND deleted_at IS NULL AND vat_split_status = 'pending';
  RETURN FOUND;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_expense_vat_split(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_expense_vat_not_applicable(uuid) TO authenticated;