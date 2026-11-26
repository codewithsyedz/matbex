-- invoice_ledger_check_and_bill_header_sync
--
-- The nightly "invoice-to-ledger mismatches" email (22 on the production copy) was almost all
-- false alarms. On the production copy: 15 bills consistent, 7 with a stale bill header, no
-- ledger errors. The check:
--   * scanned purchase_invoices.restaurant_id = tenant id, so only restaurants whose id equals
--     their tenant's (2 of 6 in production) were ever checked;
--   * summed every debit on the expense, so an amended (reverse + repost) or paid bill counted
--     2-5x its amount;
--   * took only the bill's first expense.
-- Now: every restaurant of the tenant; all of the bill's expenses; the posted cost-side net
-- compared with the expenses; the bill header compared with the expenses. The screen's
-- detect_invoice_ledger_divergence uses the same implementation.

CREATE OR REPLACE FUNCTION public.detect_invoice_ledger_divergence_for_tenant(p_tenant_id uuid, p_branch_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(invoice_id uuid, invoice_number text, invoice_date date, supplier_name text, branch_id uuid, invoice_total numeric, lines_total numeric, unique_lines_total numeric, duplicate_amount numeric, duplicate_line_count integer, expense_id uuid, expense_amount numeric, ledger_debit numeric, ledger_leg_count integer, issues text[], duplicate_groups jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := p_tenant_id;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  RETURN QUERY
  WITH inv AS (
    SELECT pi.id, pi.invoice_number, pi.invoice_date, pi.branch_id, pi.supplier_id,
           ROUND(COALESCE(pi.total_amount, 0), 2) AS total_amount,
           ROUND(COALESCE(pi.subtotal, pi.total_amount - COALESCE(pi.tax_amount, 0), 0), 2) AS line_basis
    FROM public.purchase_invoices pi
    WHERE pi.restaurant_id IN (SELECT r.id FROM public.restaurants r WHERE r.tenant_id = v_tenant)
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
           COUNT(*)::int AS occurrences,
           COUNT(DISTINCT date_trunc('millisecond', ii.created_at))::int AS creation_events
    FROM public.invoice_items ii
    JOIN inv ON inv.id = ii.invoice_id
    GROUP BY 1, 2, 3, 4, 5
  ),
  line_stats AS (
    SELECT g.invoice_id,
           ROUND(SUM(g.line_total * g.occurrences), 2) AS lines_total,
           ROUND(SUM(CASE WHEN g.occurrences > 1 AND g.creation_events = 1 THEN g.line_total ELSE g.line_total * g.occurrences END), 2) AS unique_lines_total,
           SUM(CASE WHEN g.occurrences > 1 AND g.creation_events = 1 THEN g.occurrences - 1 ELSE 0 END)::int AS dup_lines,
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
             ) FILTER (WHERE g.occurrences > 1 AND g.creation_events = 1),
             '[]'::jsonb
           ) AS dup_groups
    FROM grouped g
    GROUP BY g.invoice_id
  ),
  exp AS (
    -- All live expenses of the bill (a bill can be entered as several expenses).
    SELECT e.purchase_invoice_id,
           (array_agg(e.id ORDER BY e.created_at))[1] AS expense_id,
           ROUND(SUM(COALESCE(e.amount, 0)), 2) AS amount,
           array_agg(e.id) AS expense_ids
    FROM public.expenses e
    JOIN inv ON inv.id = e.purchase_invoice_id
    WHERE e.tenant_id = v_tenant AND e.deleted_at IS NULL
    GROUP BY e.purchase_invoice_id
  ),
  led AS (
    -- What the books hold for the bill: the net (debit - credit) of its expenses' legs on the
    -- cost side (expense, inventory, input VAT). Payables and cash/bank (1000-1099, or the
    -- expense's payment account) are the paying side, so amendments (reverse + repost) and
    -- payments/reclassifications net out instead of being counted again.
    SELECT exp.purchase_invoice_id,
           ROUND(SUM(COALESCE(at.debit, 0) - COALESCE(at.credit, 0)), 2) AS debit_total,
           COUNT(*)::int AS legs
    FROM exp
    JOIN public.expenses e ON e.id = ANY (exp.expense_ids)
    JOIN public.account_transactions at
      ON at.reference_type = 'expense' AND at.reference_id = e.id AND at.tenant_id = v_tenant
     AND COALESCE(at.is_voided, false) = false
    JOIN public.chart_of_accounts a ON a.id = at.account_id
    WHERE a.account_type <> 'liability'
      AND NOT (a.account_code BETWEEN '1000' AND '1099')
      AND at.account_id IS DISTINCT FROM e.payment_account_id
    GROUP BY exp.purchase_invoice_id
  ),
  scored AS (
    SELECT inv.id, inv.invoice_number, inv.invoice_date, s.name AS supplier_name,
           inv.branch_id, inv.total_amount, inv.line_basis,
           COALESCE(ls.lines_total, 0) AS lines_total,
           COALESCE(ls.unique_lines_total, 0) AS unique_lines_total,
           ROUND(COALESCE(ls.lines_total, 0) - COALESCE(ls.unique_lines_total, 0), 2) AS dup_amount,
           COALESCE(ls.dup_lines, 0) AS dup_lines,
           exp.expense_id, exp.amount AS expense_amount,
           led.debit_total, COALESCE(led.legs, 0) AS legs,
           COALESCE(ls.dup_groups, '[]'::jsonb) AS dup_groups
    FROM inv
    LEFT JOIN public.suppliers s ON s.id = inv.supplier_id
    LEFT JOIN line_stats ls ON ls.invoice_id = inv.id
    LEFT JOIN exp ON exp.purchase_invoice_id = inv.id
    LEFT JOIN led ON led.purchase_invoice_id = inv.id
  ),
  flagged AS (
    SELECT sc.*,
           ARRAY_REMOVE(ARRAY[
             CASE WHEN sc.dup_lines > 0 THEN 'duplicate_lines' END,
             CASE WHEN sc.lines_total > 0 AND ABS(sc.line_basis - sc.lines_total) > 0.01 THEN 'total_mismatch' END,
             CASE WHEN sc.expense_amount IS NOT NULL AND ABS(sc.expense_amount - sc.total_amount) > 0.01 THEN 'expense_mismatch' END,
             CASE WHEN sc.expense_id IS NOT NULL AND sc.legs = 0 THEN 'not_posted' END,
             CASE WHEN sc.legs > 0 AND ABS(COALESCE(sc.debit_total, 0) - sc.expense_amount) > 0.01 THEN 'ledger_mismatch' END
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
$function$;

CREATE OR REPLACE FUNCTION public.detect_invoice_ledger_divergence(p_branch_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(invoice_id uuid, invoice_number text, invoice_date date, supplier_name text, branch_id uuid, invoice_total numeric, lines_total numeric, unique_lines_total numeric, duplicate_amount numeric, duplicate_line_count integer, expense_id uuid, expense_amount numeric, ledger_debit numeric, ledger_leg_count integer, issues text[], duplicate_groups jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  -- The caller's own business only. One implementation for the screen and the nightly scan:
  -- detect_invoice_ledger_divergence_for_tenant (bill lines vs the subtotal, i.e. total minus
  -- tax_amount; expenses vs the bill; posted cost-side net vs the expenses).
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  RETURN QUERY SELECT * FROM public.detect_invoice_ledger_divergence_for_tenant(v_tenant, p_branch_id, p_from, p_to);
END;
$function$;

-- Keep an expense-created bill's header in step with its expenses. Expenses are corrected
-- (amount/VAT edits, amendments) and the ledger follows them, but the bill header kept the
-- original total. Only bills with no line items and no ledger posting of their own (the expense
-- posts): their header is a summary of the expenses.
CREATE OR REPLACE FUNCTION public.sync_bill_header_from_expenses(p_invoice_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.purchase_invoices pi
  SET total_amount = x.total, tax_amount = x.vat, subtotal = x.total - x.vat
  FROM (
    SELECT ROUND(SUM(COALESCE(e.amount, 0)), 2) AS total, ROUND(SUM(COALESCE(e.vat_amount, 0)), 2) AS vat
    FROM public.expenses e WHERE e.purchase_invoice_id = p_invoice_id AND e.deleted_at IS NULL
    HAVING count(*) > 0
  ) x
  WHERE pi.id = p_invoice_id
    AND NOT COALESCE(pi.ledger_posted, false)
    AND NOT EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.invoice_id = pi.id)
    AND (pi.total_amount, COALESCE(pi.tax_amount, 0)) IS DISTINCT FROM (x.total, x.vat)
$function$;
REVOKE ALL ON FUNCTION public.sync_bill_header_from_expenses(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_sync_bill_header_from_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.purchase_invoice_id IS NOT NULL THEN
    PERFORM public.sync_bill_header_from_expenses(NEW.purchase_invoice_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.purchase_invoice_id IS NOT NULL AND OLD.purchase_invoice_id IS DISTINCT FROM NEW.purchase_invoice_id THEN
    PERFORM public.sync_bill_header_from_expenses(OLD.purchase_invoice_id);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_sync_bill_header_from_expense() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_bill_header_from_expense ON public.expenses;
CREATE TRIGGER trg_sync_bill_header_from_expense
  AFTER UPDATE OF amount, vat_amount, deleted_at, purchase_invoice_id ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_bill_header_from_expense();

-- One-time: bring stale headers in line (production copy, 2026-11-12: 7 bills, e.g. a bill
-- of 2,772 whose expense was corrected to 925; the ledger already held 925).
SELECT public.sync_bill_header_from_expenses(pi.id)
FROM public.purchase_invoices pi
WHERE EXISTS (SELECT 1 FROM public.expenses e WHERE e.purchase_invoice_id = pi.id AND e.deleted_at IS NULL);
