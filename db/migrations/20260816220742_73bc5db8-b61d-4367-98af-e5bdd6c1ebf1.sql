CREATE OR REPLACE FUNCTION public.detect_invoice_ledger_divergence_for_tenant(
  p_tenant_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS TABLE (
  invoice_id uuid,
  invoice_number text,
  invoice_date date,
  supplier_name text,
  branch_id uuid,
  invoice_total numeric,
  lines_total numeric,
  unique_lines_total numeric,
  duplicate_amount numeric,
  duplicate_line_count integer,
  expense_id uuid,
  expense_amount numeric,
  ledger_debit numeric,
  ledger_leg_count integer,
  issues text[],
  duplicate_groups jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := p_tenant_id;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  RETURN QUERY
  WITH inv AS (
    SELECT pi.id, pi.invoice_number, pi.invoice_date, pi.branch_id, pi.supplier_id,
           ROUND(COALESCE(pi.total_amount, 0), 2) AS total_amount
    FROM public.purchase_invoices pi
    WHERE pi.restaurant_id = v_tenant
      AND (p_branch_id IS NULL OR pi.branch_id = p_branch_id)
      AND (p_from IS NULL OR pi.invoice_date >= p_from)
      AND (p_to IS NULL OR pi.invoice_date <= p_to)
  ),
  grouped AS (
    SELECT ii.invoice_id,
           COALESCE(ii.description, '') AS description,
           COALESCE(ii.quantity, 0) AS quantity,
           COALESCE(ii.unit_price, 0) AS unit_price,
           ROUND(COALESCE(ii.total_price, 0), 2) AS line_total,
           COUNT(*)::int AS occurrences
    FROM public.invoice_items ii
    JOIN inv ON inv.id = ii.invoice_id
    GROUP BY 1, 2, 3, 4, 5
  ),
  line_stats AS (
    SELECT g.invoice_id,
           ROUND(SUM(g.line_total * g.occurrences), 2) AS lines_total,
           ROUND(SUM(g.line_total), 2) AS unique_lines_total,
           SUM(g.occurrences - 1)::int AS dup_lines,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'description', g.description,
                 'quantity', g.quantity,
                 'unit_price', g.unit_price,
                 'line_total', g.line_total,
                 'occurrences', g.occurrences,
                 'excess_amount', ROUND(g.line_total * (g.occurrences - 1), 2)
               ) ORDER BY g.occurrences DESC, g.description
             ) FILTER (WHERE g.occurrences > 1),
             '[]'::jsonb
           ) AS dup_groups
    FROM grouped g
    GROUP BY g.invoice_id
  ),
  exp AS (
    SELECT DISTINCT ON (e.purchase_invoice_id)
           e.purchase_invoice_id, e.id AS expense_id, ROUND(COALESCE(e.amount, 0), 2) AS amount
    FROM public.expenses e
    JOIN inv ON inv.id = e.purchase_invoice_id
    WHERE e.tenant_id = v_tenant AND e.deleted_at IS NULL
    ORDER BY e.purchase_invoice_id, e.created_at
  ),
  led AS (
    SELECT at.reference_id AS expense_id,
           ROUND(SUM(COALESCE(at.debit, 0)), 2) AS debit_total,
           COUNT(*)::int AS legs
    FROM public.account_transactions at
    JOIN exp ON exp.expense_id = at.reference_id
    LEFT JOIN public.journal_entry_batches b ON b.id = at.batch_id
    WHERE at.tenant_id = v_tenant
      AND at.reference_type = 'expense'
      AND COALESCE(at.is_voided, false) = false
      AND COALESCE(b.entry_type::text, '') <> 'payment'
      AND COALESCE(b.reference_number, '') NOT LIKE 'EXPPAY-%'
      AND COALESCE(b.reference_number, '') NOT LIKE 'APREMAP%'
    GROUP BY at.reference_id
  ),
  scored AS (
    SELECT inv.id,
           inv.invoice_number,
           inv.invoice_date,
           s.name AS supplier_name,
           inv.branch_id,
           inv.total_amount,
           COALESCE(ls.lines_total, 0) AS lines_total,
           COALESCE(ls.unique_lines_total, 0) AS unique_lines_total,
           ROUND(COALESCE(ls.lines_total, 0) - COALESCE(ls.unique_lines_total, 0), 2) AS dup_amount,
           COALESCE(ls.dup_lines, 0) AS dup_lines,
           exp.expense_id,
           exp.amount AS expense_amount,
           led.debit_total,
           COALESCE(led.legs, 0) AS legs,
           COALESCE(ls.dup_groups, '[]'::jsonb) AS dup_groups
    FROM inv
    LEFT JOIN public.suppliers s ON s.id = inv.supplier_id
    LEFT JOIN line_stats ls ON ls.invoice_id = inv.id
    LEFT JOIN exp ON exp.purchase_invoice_id = inv.id
    LEFT JOIN led ON led.expense_id = exp.expense_id
  ),
  flagged AS (
    SELECT sc.*,
           ARRAY_REMOVE(ARRAY[
             CASE WHEN sc.dup_lines > 0 THEN 'duplicate_lines' END,
             CASE WHEN sc.lines_total > 0 AND ABS(sc.total_amount - sc.lines_total) > 0.01 THEN 'total_mismatch' END,
             CASE WHEN sc.expense_amount IS NOT NULL AND ABS(sc.expense_amount - sc.total_amount) > 0.01 THEN 'expense_mismatch' END,
             CASE WHEN sc.expense_id IS NOT NULL AND sc.legs = 0 THEN 'not_posted' END,
             CASE WHEN sc.legs > 0 AND ABS(COALESCE(sc.debit_total, 0) - sc.total_amount) > 0.01 THEN 'ledger_mismatch' END
           ], NULL) AS issue_list
    FROM scored sc
  )
  SELECT f.id, f.invoice_number, f.invoice_date, f.supplier_name, f.branch_id,
         f.total_amount, f.lines_total, f.unique_lines_total, f.dup_amount, f.dup_lines,
         f.expense_id, f.expense_amount, f.debit_total, f.legs, f.issue_list, f.dup_groups
  FROM flagged f
  WHERE array_length(f.issue_list, 1) > 0
  ORDER BY f.invoice_date DESC, f.invoice_number;
END;
$fn$;

REVOKE ALL ON FUNCTION public.detect_invoice_ledger_divergence_for_tenant(uuid, uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.detect_invoice_ledger_divergence_for_tenant(uuid, uuid, date, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_invoice_ledger_divergence_for_tenant(uuid, uuid, date, date) TO service_role;