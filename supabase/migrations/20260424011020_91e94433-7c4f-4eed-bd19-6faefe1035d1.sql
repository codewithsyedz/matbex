-- Helper: resolve the inventory asset account that should receive a COGS-mapped expense
CREATE OR REPLACE FUNCTION public.resolve_inventory_account_for_cogs(
  p_tenant_id UUID,
  p_cogs_account_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code TEXT;
  v_target_code TEXT;
  v_account_id UUID;
BEGIN
  SELECT account_code INTO v_code
  FROM public.chart_of_accounts
  WHERE id = p_cogs_account_id;

  -- Map COGS code -> inventory asset code
  v_target_code := CASE
    WHEN v_code IN ('5010','5100') THEN '1210' -- Beverages
    WHEN v_code = '5020'           THEN '1220' -- Packaging
    WHEN v_code = '5200'           THEN '1240' -- Consumables / Kitchen Supplies
    ELSE '1200'                                -- Default: Food
  END;

  SELECT id INTO v_account_id
  FROM public.chart_of_accounts
  WHERE tenant_id = p_tenant_id
    AND account_code = v_target_code
    AND account_type = 'asset'
    AND is_active = TRUE
  LIMIT 1;

  -- Fallback to any inventory food account
  IF v_account_id IS NULL THEN
    SELECT id INTO v_account_id
    FROM public.chart_of_accounts
    WHERE tenant_id = p_tenant_id
      AND account_type = 'asset'
      AND account_code LIKE '12%'
      AND is_active = TRUE
    ORDER BY account_code
    LIMIT 1;
  END IF;

  RETURN v_account_id;
END;
$$;

-- Trigger function: auto-post expense on approval, rerouting COGS to Inventory
CREATE OR REPLACE FUNCTION public.auto_post_expense_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_transaction_id UUID;
  v_post_account_id UUID;
  v_account_type TEXT;
BEGIN
  IF NEW.approval_status = 'approved'
     AND (OLD.approval_status IS DISTINCT FROM NEW.approval_status)
     AND NEW.account_id IS NOT NULL
     AND COALESCE(NEW.ledger_posted, FALSE) = FALSE
     AND NEW.deleted_at IS NULL
  THEN
    SELECT account_type::text INTO v_account_type
    FROM public.chart_of_accounts
    WHERE id = NEW.account_id;

    IF v_account_type = 'cogs' THEN
      v_post_account_id := public.resolve_inventory_account_for_cogs(NEW.tenant_id, NEW.account_id);
      IF v_post_account_id IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: No inventory asset account found for COGS routing';
      END IF;
    ELSE
      v_post_account_id := NEW.account_id;
    END IF;

    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by
    ) VALUES (
      NEW.tenant_id, v_post_account_id, NEW.expense_date, NEW.amount, NULL,
      COALESCE(NEW.description, 'Expense'),
      'expense', NEW.id,
      COALESCE(auth.uid(), NEW.created_by)
    )
    RETURNING id INTO v_transaction_id;

    NEW.ledger_posted := TRUE;
    NEW.ledger_transaction_id := v_transaction_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_post_expense_on_approval ON public.expenses;
CREATE TRIGGER trg_auto_post_expense_on_approval
BEFORE UPDATE OF approval_status ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.auto_post_expense_on_approval();

-- Update the existing post_expense_to_ledger RPC to also reroute COGS -> Inventory
CREATE OR REPLACE FUNCTION public.post_expense_to_ledger(p_expense_id uuid, p_account_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_expense RECORD;
  v_transaction_id UUID;
  v_account_type TEXT;
  v_post_account_id UUID;
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
    v_post_account_id := public.resolve_inventory_account_for_cogs(v_expense.tenant_id, p_account_id);
    IF v_post_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: No inventory asset account found for COGS routing';
    END IF;
  ELSE
    v_post_account_id := p_account_id;
  END IF;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by
  ) VALUES (
    v_expense.tenant_id, v_post_account_id, v_expense.expense_date, v_expense.amount, NULL,
    COALESCE(v_expense.description, 'Expense'),
    'expense', p_expense_id, auth.uid()
  )
  RETURNING id INTO v_transaction_id;

  UPDATE public.expenses
  SET ledger_posted = TRUE,
      ledger_transaction_id = v_transaction_id,
      account_id = p_account_id  -- preserve original mapping for reporting
  WHERE id = p_expense_id;

  RETURN v_transaction_id;
END;
$$;

-- Backfill: approve + post all pending expenses that have a CoA mapping
DO $$
DECLARE
  r RECORD;
  v_tx_id UUID;
  v_post_account_id UUID;
  v_account_type TEXT;
BEGIN
  FOR r IN
    SELECT id, tenant_id, account_id, expense_date, amount, description, created_by
    FROM public.expenses
    WHERE approval_status = 'pending'
      AND account_id IS NOT NULL
      AND COALESCE(ledger_posted, FALSE) = FALSE
      AND deleted_at IS NULL
  LOOP
    SELECT account_type::text INTO v_account_type
    FROM public.chart_of_accounts WHERE id = r.account_id;

    IF v_account_type = 'cogs' THEN
      v_post_account_id := public.resolve_inventory_account_for_cogs(r.tenant_id, r.account_id);
    ELSE
      v_post_account_id := r.account_id;
    END IF;

    IF v_post_account_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by
    ) VALUES (
      r.tenant_id, v_post_account_id, r.expense_date, r.amount, NULL,
      COALESCE(r.description, 'Expense'), 'expense', r.id, r.created_by
    )
    RETURNING id INTO v_tx_id;

    UPDATE public.expenses
    SET approval_status = 'approved',
        approved_at = now(),
        ledger_posted = TRUE,
        ledger_transaction_id = v_tx_id
    WHERE id = r.id;
  END LOOP;
END $$;