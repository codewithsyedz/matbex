CREATE OR REPLACE FUNCTION public.get_zatca_pl_reconciliation(p_tenant_id uuid, p_from_date date, p_to_date date, p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_groups jsonb;
  v_unmatched jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date THEN
    RAISE EXCEPTION 'A valid reporting period is required';
  END IF;
  IF NOT public.user_belongs_to_tenant(auth.uid(), p_tenant_id) AND NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  WITH br AS (
    SELECT b.id AS branch_id, b.name AS branch_name, b.restaurant_id,
           COALESCE(r.currency, 'SAR') AS currency_code, COALESCE(r.timezone, 'Asia/Riyadh') AS tz
    FROM public.branches b JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE r.tenant_id = p_tenant_id AND b.deleted_at IS NULL
      AND (p_branch_id IS NULL OR b.id = p_branch_id)
      AND public.user_can_access_branch(auth.uid(), b.restaurant_id, b.id)
  ),
  ledger AS (
    SELECT at.branch_id,
      SUM(CASE WHEN coa.account_type = 'revenue' THEN COALESCE(at.credit,0) - COALESCE(at.debit,0) ELSE 0 END) AS revenue,
      SUM(CASE WHEN coa.account_type = 'expense' THEN COALESCE(at.debit,0) - COALESCE(at.credit,0) ELSE 0 END) AS expenses
    FROM public.account_transactions at
    JOIN public.chart_of_accounts coa ON coa.id = at.account_id AND coa.tenant_id = p_tenant_id
    WHERE at.tenant_id = p_tenant_id AND COALESCE(at.is_voided,false) = false
      AND at.transaction_date BETWEEN p_from_date AND p_to_date
      AND at.branch_id IN (SELECT branch_id FROM br)
    GROUP BY at.branch_id
  ),
  sales AS (
    SELECT st.branch_id,
      COUNT(*) AS invoice_count,
      COUNT(*) FILTER (WHERE lower(COALESCE(st.zatca_clearance_status,'')) IN ('cleared','reported','accepted')) AS filed_count,
      SUM(COALESCE(st.zatca_invoice_total, st.total,0) - COALESCE(st.zatca_vat_total, st.tax,0))
        FILTER (WHERE lower(COALESCE(st.zatca_clearance_status,'')) IN ('cleared','reported','accepted')) AS filed_net,
      SUM(COALESCE(st.zatca_vat_total, st.tax,0))
        FILTER (WHERE lower(COALESCE(st.zatca_clearance_status,'')) IN ('cleared','reported','accepted')) AS filed_vat,
      SUM(COALESCE(st.total,0) - COALESCE(st.tax,0))
        FILTER (WHERE lower(COALESCE(st.zatca_clearance_status,'')) NOT IN ('cleared','reported','accepted')) AS unfiled_net
    FROM public.sales_transactions st JOIN br ON br.branch_id = st.branch_id
    WHERE (st.created_at AT TIME ZONE br.tz)::date BETWEEN p_from_date AND p_to_date
    GROUP BY st.branch_id
  ),
  credits AS (
    SELECT st.branch_id,
      SUM(COALESCE(cn.total_refunded,0) - COALESCE(cn.vat_refunded,0)) AS net,
      SUM(COALESCE(cn.vat_refunded,0)) AS vat
    FROM public.zatca_credit_notes cn
    JOIN public.sales_transactions st ON st.id = cn.original_sales_transaction_id
    JOIN br ON br.branch_id = st.branch_id
    WHERE cn.tenant_id = p_tenant_id
      AND lower(COALESCE(cn.clearance_status,'')) IN ('cleared','reported','accepted')
      AND (cn.created_at AT TIME ZONE br.tz)::date BETWEEN p_from_date AND p_to_date
    GROUP BY st.branch_id
  ),
  exp AS (
    SELECT e.branch_id,
      COUNT(*) AS expense_count,
      SUM(e.amount) AS gross,
      SUM(COALESCE(e.vat_amount,0)) FILTER (WHERE e.vat_split_status IS DISTINCT FROM 'applied') AS vat_inside,
      SUM(COALESCE(e.vat_amount,0)) FILTER (WHERE e.vat_split_status = 'applied') AS vat_split,
      COUNT(*) FILTER (WHERE e.purchase_invoice_id IS NOT NULL) AS matched_count,
      SUM(e.amount) FILTER (WHERE e.purchase_invoice_id IS NOT NULL) AS matched_amount,
      COUNT(*) FILTER (WHERE e.purchase_invoice_id IS NULL AND e.amount <> 0) AS unmatched_count,
      SUM(e.amount) FILTER (WHERE e.purchase_invoice_id IS NULL) AS unmatched_amount
    FROM public.expenses e JOIN br ON br.branch_id = e.branch_id
    WHERE e.tenant_id = p_tenant_id AND e.deleted_at IS NULL
      AND COALESCE(e.approval_status::text,'approved') <> 'rejected'
      AND e.expense_date BETWEEN p_from_date AND p_to_date
    GROUP BY e.branch_id
  ),
  pinv AS (
    SELECT pi.branch_id, COUNT(*) AS invoice_count,
      SUM(COALESCE(pi.subtotal,0)) AS net, SUM(COALESCE(pi.tax_amount,0)) AS vat
    FROM public.purchase_invoices pi JOIN br ON br.branch_id = pi.branch_id
    WHERE pi.invoice_date BETWEEN p_from_date AND p_to_date
      AND lower(COALESCE(pi.status,'')) NOT IN ('void','voided','cancelled','rejected')
    GROUP BY pi.branch_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'branch_id', br.branch_id, 'branch_name', br.branch_name, 'currency_code', br.currency_code,
    'ledger_revenue', COALESCE(l.revenue,0), 'ledger_expenses', COALESCE(l.expenses,0),
    'sales_invoice_count', COALESCE(s.invoice_count,0), 'sales_filed_count', COALESCE(s.filed_count,0),
    'sales_filed_net', COALESCE(s.filed_net,0), 'sales_filed_vat', COALESCE(s.filed_vat,0),
    'sales_unfiled_net', COALESCE(s.unfiled_net,0),
    'credit_notes_net', COALESCE(c.net,0), 'credit_notes_vat', COALESCE(c.vat,0),
    'expense_count', COALESCE(x.expense_count,0), 'expense_gross', COALESCE(x.gross,0),
    'expense_vat_inside', COALESCE(x.vat_inside,0), 'expense_vat_split', COALESCE(x.vat_split,0),
    'expense_matched_count', COALESCE(x.matched_count,0), 'expense_matched_amount', COALESCE(x.matched_amount,0),
    'expense_unmatched_count', COALESCE(x.unmatched_count,0), 'expense_unmatched_amount', COALESCE(x.unmatched_amount,0),
    'purchase_invoice_count', COALESCE(p.invoice_count,0), 'purchase_invoice_net', COALESCE(p.net,0),
    'purchase_invoice_vat', COALESCE(p.vat,0)
  ) ORDER BY br.branch_name), '[]'::jsonb)
  INTO v_groups
  FROM br
  LEFT JOIN ledger l ON l.branch_id = br.branch_id
  LEFT JOIN sales s ON s.branch_id = br.branch_id
  LEFT JOIN credits c ON c.branch_id = br.branch_id
  LEFT JOIN exp x ON x.branch_id = br.branch_id
  LEFT JOIN pinv p ON p.branch_id = br.branch_id
  WHERE l.branch_id IS NOT NULL OR s.branch_id IS NOT NULL OR x.branch_id IS NOT NULL OR p.branch_id IS NOT NULL;

  SELECT COALESCE(jsonb_agg(u ORDER BY u->>'expense_date' DESC), '[]'::jsonb) INTO v_unmatched FROM (
    SELECT jsonb_build_object('id', e.id, 'branch_id', e.branch_id, 'branch_name', b.name,
      'currency_code', COALESCE(r.currency,'SAR'), 'expense_date', e.expense_date,
      'description', COALESCE(NULLIF(btrim(e.description),''), 'Expense'), 'supplier_name', s.name,
      'amount', e.amount, 'vat_amount', COALESCE(e.vat_amount,0)) AS u
    FROM public.expenses e
    JOIN public.branches b ON b.id = e.branch_id
    JOIN public.restaurants r ON r.id = b.restaurant_id AND r.tenant_id = p_tenant_id
    LEFT JOIN public.suppliers s ON s.id = e.supplier_id AND s.restaurant_id = r.id
    WHERE e.tenant_id = p_tenant_id AND e.deleted_at IS NULL AND e.purchase_invoice_id IS NULL AND e.amount <> 0
      AND COALESCE(e.approval_status::text,'approved') <> 'rejected'
      AND e.expense_date BETWEEN p_from_date AND p_to_date
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
      AND public.user_can_access_branch(auth.uid(), b.restaurant_id, b.id)
    ORDER BY e.amount DESC LIMIT 300
  ) q;

  RETURN jsonb_build_object('groups', v_groups, 'unmatched_expenses', v_unmatched);
END;
$$;
REVOKE ALL ON FUNCTION public.get_zatca_pl_reconciliation(uuid,date,date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_zatca_pl_reconciliation(uuid,date,date,uuid) TO authenticated;