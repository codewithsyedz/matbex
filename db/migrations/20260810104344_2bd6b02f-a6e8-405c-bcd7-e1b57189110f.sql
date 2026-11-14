CREATE OR REPLACE FUNCTION public.get_partner_funding_summary(p_project_id uuid)
RETURNS TABLE (
  partner_id uuid,
  partner_name text,
  ownership_pct numeric,
  capital_balance numeric,
  loan_balance numeric,
  payable_balance numeric,
  total_funded numeric,
  unclassified_amount numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id, p.partner_name, p.ownership_pct,
    COALESCE(p.opening_capital,0) + COALESCE((
      SELECT SUM(t.credit - t.debit) FROM account_transactions t
      WHERE t.account_id = p.capital_account_id AND NOT COALESCE(t.is_voided,false)),0),
    COALESCE((SELECT SUM(t.credit - t.debit) FROM account_transactions t
      WHERE t.account_id = p.loan_account_id AND NOT COALESCE(t.is_voided,false)),0),
    COALESCE((SELECT SUM(t.credit - t.debit) FROM account_transactions t
      WHERE t.account_id = p.payable_account_id AND NOT COALESCE(t.is_voided,false)),0),
    COALESCE((SELECT SUM(x.amount) FROM project_transactions x
      WHERE x.partner_id = p.id AND x.status = 'posted'),0)
      + COALESCE((SELECT SUM(a.amount) FROM project_acquisitions a
      WHERE a.partner_id = p.id AND a.classification_status = 'posted'),0)
      + COALESCE((SELECT SUM(f.amount) FROM project_acquisition_funders f
      JOIN project_acquisitions a2 ON a2.id = f.acquisition_id
      WHERE f.partner_id = p.id
        AND a2.classification_status = 'posted'
        AND a2.partner_id IS DISTINCT FROM p.id),0),
    COALESCE((SELECT SUM(x.amount) FROM project_transactions x
      WHERE x.partner_id = p.id AND x.status IN ('needs_review','classified')),0)
  FROM project_partners p
  WHERE (p_project_id IS NULL OR p.project_id = p_project_id)
    AND p.is_active
    AND public.can_manage_capital(p.tenant_id);
$$;