CREATE OR REPLACE FUNCTION public.approve_expense_for_ai_posting(
  p_expense_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expense public.expenses%ROWTYPE;
  v_actor uuid := auth.uid();
  v_allowed boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Sign in is required';
  END IF;

  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = p_expense_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Expense not found';
  END IF;

  SELECT public.is_superadmin(v_actor) OR EXISTS (
    SELECT 1
    FROM public.user_tenant_roles utr
    WHERE utr.user_id = v_actor
      AND utr.tenant_id = v_expense.tenant_id
      AND utr.role IN ('owner', 'manager')
  ) INTO v_allowed;

  IF NOT v_allowed OR NOT public.can_access_restaurant(v_expense.restaurant_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Owner or manager access is required to approve expenses';
  END IF;

  IF v_expense.approval_status = 'rejected' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: A rejected expense cannot be approved without being resubmitted';
  END IF;

  IF v_expense.approval_status <> 'approved' THEN
    UPDATE public.expenses
    SET approval_status = 'approved',
        approved_by = v_actor,
        approved_at = now(),
        rejection_reason = NULL
    WHERE id = p_expense_id;
  END IF;

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'approved', true,
    'already_approved', v_expense.approval_status = 'approved',
    'already_posted', COALESCE(v_expense.ledger_posted, false),
    'ledger_transaction_id', v_expense.ledger_transaction_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_expense_for_ai_posting(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_expense_for_ai_posting(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_expense_for_ai_posting(uuid) TO service_role;