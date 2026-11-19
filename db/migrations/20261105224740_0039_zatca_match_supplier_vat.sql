ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS vat_number text;
CREATE INDEX IF NOT EXISTS idx_suppliers_vat_number ON public.suppliers (restaurant_id, vat_number) WHERE vat_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.zatca_norm_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(
    regexp_replace(lower(coalesce(p, '')), '\m(co|company|est|establishment|trading|ltd|llc|for|the|شركة|مؤسسة|للتجارة|المحدودة)\M', '', 'g'),
    '[^a-z0-9\u0600-\u06ff]', '', 'g')
$$;

CREATE OR REPLACE FUNCTION public.post_zatca_purchase_invoice(p_invoice_id uuid, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv record;
  v_tenant uuid;
  v_exp record;
  v_supplier uuid;
  v_new_id uuid;
  v_rate numeric;
  v_desc text;
  v_has_vat boolean;
  v_name text;
BEGIN
  SELECT pi.*, r.tenant_id AS r_tenant INTO v_inv
  FROM purchase_invoices pi JOIN restaurants r ON r.id = pi.restaurant_id
  WHERE pi.id = p_invoice_id FOR UPDATE OF pi;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
  v_tenant := v_inv.r_tenant;

  IF NOT (public.has_tenant_role(auth.uid(), v_tenant, 'owner'::app_role)
       OR public.has_tenant_role(auth.uid(), v_tenant, 'manager'::app_role)
       OR public.has_tenant_role(auth.uid(), v_tenant, 'accountant'::app_role)) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants can post supplier invoices.';
  END IF;
  IF v_inv.posting_status IN ('linked','posted') THEN
    RETURN jsonb_build_object('status', v_inv.posting_status, 'expense_id', v_inv.linked_expense_id, 'already', true);
  END IF;

  v_desc := 'ZATCA invoice ' || v_inv.invoice_number || COALESCE(' — ' || v_inv.supplier_name_text, '');

  -- Match an existing expense: same branch, total within 0.50, within 5 days, not yet linked,
  -- AND the supplier agrees. A different supplier VAT number always rules a candidate out.
  -- With supplier details on the invoice, the expense must match by VAT number, supplier
  -- name, or mention the supplier in its description. Without them, amount + date suffice.
  v_has_vat := NULLIF(trim(v_inv.supplier_vat_number), '') IS NOT NULL;
  v_name := public.zatca_norm_name(v_inv.supplier_name_text);
  SELECT e.*, s.id AS s_id, s.vat_number AS s_vat,
    CASE WHEN v_has_vat AND s.vat_number = v_inv.supplier_vat_number THEN 3
         WHEN v_name <> '' AND public.zatca_norm_name(s.name) <> '' AND (public.zatca_norm_name(s.name) LIKE '%' || v_name || '%' OR v_name LIKE '%' || public.zatca_norm_name(s.name) || '%') THEN 2
         WHEN length(v_name) >= 4 AND public.zatca_norm_name(e.description) LIKE '%' || v_name || '%' THEN 1
         ELSE 0 END AS score
  INTO v_exp
  FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
  WHERE e.restaurant_id = v_inv.restaurant_id
    AND (v_inv.branch_id IS NULL OR e.branch_id IS NULL OR e.branch_id = v_inv.branch_id)
    AND e.deleted_at IS NULL
    AND e.purchase_invoice_id IS NULL
    AND abs(e.amount - v_inv.total_amount) <= 0.5
    AND abs(e.expense_date - v_inv.invoice_date) <= 5
    AND NOT (v_has_vat AND s.vat_number IS NOT NULL AND s.vat_number <> v_inv.supplier_vat_number)
  ORDER BY score DESC, abs(e.amount - v_inv.total_amount), abs(e.expense_date - v_inv.invoice_date)
  LIMIT 1;
  IF v_exp.id IS NOT NULL AND v_exp.score = 0 AND (v_has_vat OR v_name <> '') THEN
    v_exp := NULL;  -- amount/date match only, but supplier unconfirmed: don't link
  END IF;

  IF v_exp.id IS NOT NULL THEN
    UPDATE expenses SET purchase_invoice_id = v_inv.id, updated_at = now() WHERE id = v_exp.id;
    -- Remember the supplier's VAT number for future matching.
    IF v_has_vat AND v_exp.s_id IS NOT NULL AND v_exp.s_vat IS NULL AND v_exp.score >= 2 THEN
      UPDATE suppliers SET vat_number = v_inv.supplier_vat_number WHERE id = v_exp.s_id;
    END IF;
    IF v_inv.tax_amount > 0 AND v_exp.vat_split_status <> 'applied' AND COALESCE(v_exp.vat_amount,0) = 0 THEN
      IF COALESCE(v_exp.ledger_posted,false) THEN
        v_rate := round(v_inv.tax_amount / NULLIF(v_inv.subtotal,0) * 100, 4);
        PERFORM public.apply_expense_vat_split(v_exp.id, v_rate, 'From ZATCA invoice ' || v_inv.invoice_number);
      ELSE
        UPDATE expenses SET vat_amount = round(v_inv.tax_amount * v_exp.amount / v_inv.total_amount, 2),
          net_amount = v_exp.amount - round(v_inv.tax_amount * v_exp.amount / v_inv.total_amount, 2),
          vat_inclusive = true, vat_split_status = 'applied',
          vat_rate = round(v_inv.tax_amount / NULLIF(v_inv.subtotal,0) * 100, 4)
        WHERE id = v_exp.id;
      END IF;
    END IF;
    UPDATE purchase_invoices SET linked_expense_id = v_exp.id, posting_status = 'linked',
      posting_note = 'Linked to existing expense of ' || v_exp.amount || ' on ' || v_exp.expense_date
        || CASE v_exp.score WHEN 3 THEN ' (supplier VAT number matched)' WHEN 2 THEN ' (supplier name matched)' WHEN 1 THEN ' (supplier named in description)' ELSE '' END
    WHERE id = v_inv.id;
    RETURN jsonb_build_object('status','linked','expense_id', v_exp.id);
  END IF;

  -- No match: a new expense on credit (supplier payable), posted with input VAT.
  IF p_account_id IS NULL THEN
    UPDATE purchase_invoices SET posting_status = 'needs_account',
      posting_note = 'No expense with the same amount, date and supplier — choose an expense account to post it.'
    WHERE id = v_inv.id;
    RETURN jsonb_build_object('status','needs_account');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE id = p_account_id AND tenant_id = v_tenant
                 AND account_type::text IN ('expense','cogs','asset')) THEN
    RAISE EXCEPTION 'Choose an expense, cost or asset account from your chart of accounts.';
  END IF;

  IF v_inv.supplier_vat_number IS NOT NULL THEN
    SELECT s.id INTO v_supplier FROM suppliers s
    WHERE s.restaurant_id = v_inv.restaurant_id
      AND s.vat_number = v_inv.supplier_vat_number
    LIMIT 1;
  END IF;
  IF v_supplier IS NULL AND v_inv.supplier_name_text IS NOT NULL THEN
    SELECT s.id INTO v_supplier FROM suppliers s
    WHERE s.restaurant_id = v_inv.restaurant_id AND public.zatca_norm_name(s.name) = v_name AND v_name <> '' LIMIT 1;
    IF v_supplier IS NOT NULL AND v_has_vat THEN
      UPDATE suppliers SET vat_number = v_inv.supplier_vat_number WHERE id = v_supplier AND vat_number IS NULL;
    END IF;
  END IF;

  INSERT INTO expenses (restaurant_id, tenant_id, branch_id, amount, description, expense_date, created_by,
    status, approval_status, approved_by, approved_at, account_id, supplier_id, purchase_invoice_id,
    vat_amount, net_amount, vat_inclusive, vat_rate, vat_split_status, receipt_url)
  VALUES (v_inv.restaurant_id, v_tenant, v_inv.branch_id, v_inv.total_amount, v_desc, v_inv.invoice_date, auth.uid(),
    'unpaid', 'approved', auth.uid(), now(), p_account_id, v_supplier, v_inv.id,
    v_inv.tax_amount, v_inv.subtotal, true,
    CASE WHEN v_inv.subtotal > 0 THEN round(v_inv.tax_amount / v_inv.subtotal * 100, 4) END,
    'applied', v_inv.image_url)
  RETURNING id INTO v_new_id;

  PERFORM public.post_expense_to_ledger(v_new_id, p_account_id);

  UPDATE purchase_invoices SET linked_expense_id = v_new_id, posting_status = 'posted', account_id = p_account_id,
    ledger_posted = true, posting_note = 'Posted as a new expense on credit with input VAT'
  WHERE id = v_inv.id;
  RETURN jsonb_build_object('status','posted','expense_id', v_new_id);
END;
$function$;