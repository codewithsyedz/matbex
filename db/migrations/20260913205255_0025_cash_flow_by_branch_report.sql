CREATE OR REPLACE FUNCTION public.get_cash_flow_by_branch(
  p_tenant_id uuid,
  p_from_date date,
  p_to_date date,
  p_branch_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  branch_id uuid,
  branch_name text,
  currency_code text,
  account_id uuid,
  account_code text,
  account_name text,
  account_type public.account_type,
  is_fixed_asset_account boolean,
  opening_balance numeric,
  period_movement numeric,
  closing_balance numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT 1
    FROM public.branches b
    JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE b.id = p_branch_id
      AND b.deleted_at IS NULL
      AND r.tenant_id = p_tenant_id
      AND public.user_can_access_branch(auth.uid(), b.restaurant_id, b.id)
  ) THEN
    RAISE EXCEPTION 'Branch access denied';
  END IF;

  SELECT COALESCE(r.currency, 'SAR')
  INTO v_default_currency
  FROM public.restaurants r
  WHERE r.tenant_id = p_tenant_id
  ORDER BY r.is_primary DESC, r.created_at ASC
  LIMIT 1;

  RETURN QUERY
  SELECT
    at.branch_id,
    COALESCE(b.name, 'Unassigned')::text AS branch_name,
    COALESCE(r.currency, v_default_currency, 'SAR')::text AS currency_code,
    coa.id AS account_id,
    coa.account_code::text,
    coa.account_name::text,
    coa.account_type,
    COALESCE(coa.is_fixed_asset_account, false) AS is_fixed_asset_account,
    CASE
      WHEN coa.account_type IN ('asset'::public.account_type, 'expense'::public.account_type, 'cogs'::public.account_type)
        THEN COALESCE(SUM(COALESCE(at.debit, 0) - COALESCE(at.credit, 0)) FILTER (WHERE at.transaction_date < p_from_date), 0)
      ELSE COALESCE(SUM(COALESCE(at.credit, 0) - COALESCE(at.debit, 0)) FILTER (WHERE at.transaction_date < p_from_date), 0)
    END::numeric AS opening_balance,
    CASE
      WHEN coa.account_type IN ('asset'::public.account_type, 'expense'::public.account_type, 'cogs'::public.account_type)
        THEN COALESCE(SUM(COALESCE(at.debit, 0) - COALESCE(at.credit, 0)) FILTER (WHERE at.transaction_date BETWEEN p_from_date AND p_to_date), 0)
      ELSE COALESCE(SUM(COALESCE(at.credit, 0) - COALESCE(at.debit, 0)) FILTER (WHERE at.transaction_date BETWEEN p_from_date AND p_to_date), 0)
    END::numeric AS period_movement,
    CASE
      WHEN coa.account_type IN ('asset'::public.account_type, 'expense'::public.account_type, 'cogs'::public.account_type)
        THEN COALESCE(SUM(COALESCE(at.debit, 0) - COALESCE(at.credit, 0)) FILTER (WHERE at.transaction_date <= p_to_date), 0)
      ELSE COALESCE(SUM(COALESCE(at.credit, 0) - COALESCE(at.debit, 0)) FILTER (WHERE at.transaction_date <= p_to_date), 0)
    END::numeric AS closing_balance
  FROM public.account_transactions at
  JOIN public.chart_of_accounts coa
    ON coa.id = at.account_id
   AND coa.tenant_id = p_tenant_id
  LEFT JOIN public.branches b ON b.id = at.branch_id
  LEFT JOIN public.restaurants r ON r.id = b.restaurant_id
  WHERE at.tenant_id = p_tenant_id
    AND COALESCE(at.is_voided, false) = false
    AND at.transaction_date <= p_to_date
    AND (p_branch_id IS NULL OR at.branch_id = p_branch_id)
    AND (
      at.branch_id IS NULL
      OR public.user_can_access_branch(auth.uid(), b.restaurant_id, at.branch_id)
    )
  GROUP BY at.branch_id, b.name, r.currency, coa.id, coa.account_code, coa.account_name,
           coa.account_type, coa.is_fixed_asset_account
  HAVING ABS(SUM(COALESCE(at.debit, 0) - COALESCE(at.credit, 0))) >= 0.005
      OR ABS(COALESCE(SUM(COALESCE(at.debit, 0) - COALESCE(at.credit, 0))
             FILTER (WHERE at.transaction_date BETWEEN p_from_date AND p_to_date), 0)) >= 0.005
  ORDER BY COALESCE(b.name, 'Unassigned'), coa.account_code;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_flow_by_branch(uuid, date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cash_flow_by_branch(uuid, date, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_by_branch(uuid, date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_by_branch(uuid, date, date, uuid) TO service_role;