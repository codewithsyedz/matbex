CREATE TABLE public.ai_expense_journal_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
  selected_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  confidence numeric(5,4),
  classification text,
  rationale text,
  model text NOT NULL,
  prompt_version text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('posted', 'blocked', 'failed')),
  error_message text,
  ledger_transaction_id uuid REFERENCES public.account_transactions(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_expense_journal_confidence_range CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

GRANT SELECT ON public.ai_expense_journal_audit TO authenticated;
GRANT ALL ON public.ai_expense_journal_audit TO service_role;

ALTER TABLE public.ai_expense_journal_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles can read AI expense journal audit"
ON public.ai_expense_journal_audit
FOR SELECT
TO authenticated
USING (
  public.is_superadmin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.user_tenant_roles utr
    WHERE utr.user_id = auth.uid()
      AND utr.tenant_id = ai_expense_journal_audit.tenant_id
      AND utr.role IN ('owner', 'manager', 'accountant')
  )
);

CREATE INDEX idx_ai_expense_journal_audit_expense
  ON public.ai_expense_journal_audit(expense_id, created_at DESC);
CREATE INDEX idx_ai_expense_journal_audit_tenant
  ON public.ai_expense_journal_audit(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.apply_ai_expense_account_and_post(
  p_expense_id uuid,
  p_account_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expense record;
  v_account record;
  v_actor uuid := auth.uid();
  v_allowed boolean := false;
  v_tx_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Sign in is required';
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
    RAISE EXCEPTION 'FORBIDDEN: Finance role and restaurant access are required';
  END IF;

  IF v_expense.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted';
  END IF;
  IF COALESCE(v_expense.ledger_posted, false) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense is already posted';
  END IF;
  IF COALESCE(btrim(v_expense.description), '') = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense description is required for AI classification';
  END IF;

  SELECT id, tenant_id, account_type, is_active, requires_cost_center
  INTO v_account
  FROM public.chart_of_accounts
  WHERE id = p_account_id;

  IF NOT FOUND OR v_account.tenant_id <> v_expense.tenant_id OR NOT v_account.is_active THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Selected account is not an active account for this tenant';
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

  UPDATE public.expenses
  SET account_id = p_account_id
  WHERE id = p_expense_id;

  v_tx_id := public.post_expense_to_ledger(p_expense_id, p_account_id);
  RETURN v_tx_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_ai_expense_account_and_post(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ai_expense_account_and_post(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ai_expense_account_and_post(uuid, uuid) TO service_role;