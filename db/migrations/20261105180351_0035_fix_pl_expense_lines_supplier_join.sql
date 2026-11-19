CREATE OR REPLACE FUNCTION public.get_profit_loss_expense_lines(p_tenant_id uuid, p_from_date date, p_to_date date, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(transaction_id uuid, branch_id uuid, branch_name text, currency_code text, account_id uuid, transaction_date date, description text, reference_type text, reference_id uuid, payment_method text, supplier_name text, amount numeric, is_expense_source boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_default_currency text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date THEN
    RAISE EXCEPTION 'A valid reporting period is required';
  END IF;
  IF NOT public.user_belongs_to_tenant(auth.uid(), p_tenant_id)
     AND NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b
    JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE b.id = p_branch_id AND b.deleted_at IS NULL AND r.tenant_id = p_tenant_id
      AND public.user_can_access_branch(auth.uid(), b.restaurant_id, b.id)
  ) THEN
    RAISE EXCEPTION 'Branch access denied';
  END IF;

  SELECT COALESCE(r.currency, 'SAR') INTO v_default_currency
  FROM public.restaurants r WHERE r.tenant_id = p_tenant_id
  ORDER BY r.is_primary DESC, r.created_at ASC LIMIT 1;

  RETURN QUERY
  SELECT
    at.id, at.branch_id,
    COALESCE(b.name, 'Unassigned')::text,
    COALESCE(r.currency, v_default_currency, 'SAR')::text,
    at.account_id, at.transaction_date,
    COALESCE(NULLIF(btrim(e.description), ''), NULLIF(btrim(at.description), ''), 'Expense')::text,
    at.reference_type::text, at.reference_id,
    e.payment_method::text,
    s.name::text,
    (COALESCE(at.debit, 0) - COALESCE(at.credit, 0))::numeric,
    (at.reference_type = 'expense' AND e.id IS NOT NULL)
  FROM public.account_transactions at
  JOIN public.chart_of_accounts coa
    ON coa.id = at.account_id AND coa.tenant_id = p_tenant_id
   AND coa.account_type = 'expense'::public.account_type
  LEFT JOIN public.expenses e
    ON at.reference_type = 'expense' AND e.id = at.reference_id AND e.tenant_id = p_tenant_id
  LEFT JOIN public.suppliers s
    ON s.id = e.supplier_id
   AND EXISTS (SELECT 1 FROM public.restaurants sr WHERE sr.id = s.restaurant_id AND sr.tenant_id = p_tenant_id)
  LEFT JOIN public.branches b ON b.id = at.branch_id
  LEFT JOIN public.restaurants r ON r.id = b.restaurant_id
  WHERE at.tenant_id = p_tenant_id
    AND COALESCE(at.is_voided, false) = false
    AND at.transaction_date BETWEEN p_from_date AND p_to_date
    AND (p_branch_id IS NULL OR at.branch_id = p_branch_id)
    AND (at.branch_id IS NULL OR public.user_can_access_branch(auth.uid(), b.restaurant_id, at.branch_id))
    AND ABS(COALESCE(at.debit, 0) - COALESCE(at.credit, 0)) >= 0.005
  ORDER BY COALESCE(b.name, 'Unassigned'), coa.account_code, at.transaction_date DESC, at.created_at DESC;
END;
$function$;