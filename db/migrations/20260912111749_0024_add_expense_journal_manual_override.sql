ALTER TABLE public.ai_expense_journal_audit
  ADD COLUMN IF NOT EXISTS is_manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS original_ai_audit_id uuid REFERENCES public.ai_expense_journal_audit(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_selected_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.apply_manual_expense_account_override(
  p_expense_id uuid,
  p_account_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expense record;
  v_account record;
  v_actor uuid := auth.uid();
  v_allowed boolean := false;
  v_latest_ai record;
  v_tx_id uuid;
  v_amendment jsonb;
  v_was_posted boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Sign in is required';
  END IF;
  IF COALESCE(length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: A reason of at least 3 characters is required';
  END IF;

  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Expense not found';
  END IF;

  SELECT public.is_superadmin(v_actor) OR EXISTS (
    SELECT 1
    FROM public.user_tenant_roles utr
    WHERE utr.user_id = v_actor
      AND utr.tenant_id = v_expense.tenant_id
      AND utr.role IN ('owner', 'manager', 'accountant')
  ) INTO v_allowed;

  IF NOT v_allowed OR NOT public.can_access_restaurant(v_expense.restaurant_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Owner, manager, accountant, or Super Admin access is required';
  END IF;

  IF v_expense.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted or reclassified';
  END IF;

  SELECT id, tenant_id, account_type, is_active, requires_cost_center
  INTO v_account
  FROM public.chart_of_accounts
  WHERE id = p_account_id;

  IF NOT FOUND OR v_account.tenant_id <> v_expense.tenant_id OR NOT v_account.is_active THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Select an active account belonging to this tenant';
  END IF;
  IF v_account.account_type NOT IN ('expense', 'asset', 'liability', 'cogs') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Selected account type is not valid for expense posting';
  END IF;
  IF COALESCE(v_account.requires_cost_center, false)
     AND v_expense.branch_id IS NULL
     AND v_expense.project_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Selected account requires a branch or project cost centre';
  END IF;
  IF v_expense.branch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.account_branch_visibility abv
    WHERE abv.account_id = p_account_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.account_branch_visibility abv
    WHERE abv.account_id = p_account_id AND abv.branch_id = v_expense.branch_id
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Selected account is not available for this branch';
  END IF;

  SELECT a.id, a.selected_account_id, a.confidence, a.classification, a.rationale
  INTO v_latest_ai
  FROM public.ai_expense_journal_audit a
  WHERE a.expense_id = p_expense_id
    AND COALESCE(a.is_manual_override, false) = false
  ORDER BY a.created_at DESC
  LIMIT 1;

  v_was_posted := COALESCE(v_expense.ledger_posted, false);
  IF v_was_posted THEN
    v_amendment := public.amend_posted_expense(
      p_expense_id => p_expense_id,
      p_reason => 'Manual account override: ' || btrim(p_reason),
      p_account_id => p_account_id
    );
    v_tx_id := NULLIF(v_amendment ->> 'new_transaction_id', '')::uuid;
  ELSE
    IF v_expense.status = 'paid'
       AND v_expense.payment_account_id IS NULL
       AND v_expense.capital_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Select Cash in Hand, Cash in Bank, Petty Cash, or a capital account before posting';
    END IF;
    v_tx_id := public.apply_ai_expense_account_and_post(p_expense_id, p_account_id);
  END IF;

  INSERT INTO public.ai_expense_journal_audit (
    tenant_id, branch_id, expense_id, selected_account_id, confidence,
    classification, rationale, model, prompt_version, outcome,
    ledger_transaction_id, requested_by, is_manual_override, override_reason,
    original_ai_audit_id, original_selected_account_id
  ) VALUES (
    v_expense.tenant_id, v_expense.branch_id, p_expense_id, p_account_id,
    v_latest_ai.confidence, 'Manual override', btrim(p_reason), 'human',
    'manual-override-v1', 'posted', v_tx_id, v_actor, true, btrim(p_reason),
    v_latest_ai.id, v_latest_ai.selected_account_id
  );

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'ledger_transaction_id', v_tx_id,
    'account_id', p_account_id,
    'was_posted', v_was_posted,
    'reversal_batch_id', v_amendment -> 'reversal_batch_id'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_manual_expense_account_override(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_manual_expense_account_override(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_manual_expense_account_override(uuid, uuid, text) TO service_role;

CREATE INDEX IF NOT EXISTS idx_ai_expense_journal_audit_original
  ON public.ai_expense_journal_audit(original_ai_audit_id)
  WHERE original_ai_audit_id IS NOT NULL;