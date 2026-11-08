-- 1) Lead attribution: which ad / source produced each sign-up or demo booking
CREATE TABLE public.lead_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_type text NOT NULL CHECK (lead_type IN ('signup','trial','demo','enquiry')),
  lead_ref uuid,
  email text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  gclid text, fbclid text,
  landing_path text, referrer text,
  first_seen_at timestamptz,
  ad_consent text,
  country text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.lead_attributions TO service_role;
GRANT SELECT ON public.lead_attributions TO authenticated;
ALTER TABLE public.lead_attributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Superadmins read lead attributions" ON public.lead_attributions
  FOR SELECT TO authenticated USING (public.is_superadmin(auth.uid()));
CREATE INDEX lead_attributions_created_idx ON public.lead_attributions (created_at DESC);

-- 2) ZATCA provider application with stored documents
CREATE TABLE public.zatca_provider_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  company_name text, cr_number text, vat_number text, national_address text,
  contact_name text, contact_email text, contact_phone text,
  solution_name text, solution_description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','submitted','approved','rejected')),
  zatca_reference text,
  submitted_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.zatca_provider_applications TO authenticated;
GRANT ALL ON public.zatca_provider_applications TO service_role;
ALTER TABLE public.zatca_provider_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their ZATCA application" ON public.zatca_provider_applications
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role));

CREATE TABLE public.zatca_provider_application_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.zatca_provider_applications(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  doc_key text NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  uploaded_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.zatca_provider_application_documents TO authenticated;
GRANT ALL ON public.zatca_provider_application_documents TO service_role;
ALTER TABLE public.zatca_provider_application_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage ZATCA application documents" ON public.zatca_provider_application_documents
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role));

-- Storage policies for the private bucket "zatca-application-docs" (path: <tenant_id>/...)
CREATE POLICY "Owners read ZATCA application files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'zatca-application-docs' AND public.has_tenant_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'owner'::app_role));
CREATE POLICY "Owners upload ZATCA application files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'zatca-application-docs' AND public.has_tenant_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'owner'::app_role));

-- 3) Post ZATCA supplier invoices into the books
ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS linked_expense_id uuid,
  ADD COLUMN IF NOT EXISTS posting_status text NOT NULL DEFAULT 'not_posted',
  ADD COLUMN IF NOT EXISTS posting_note text;

CREATE OR REPLACE FUNCTION public.post_zatca_purchase_invoice(p_invoice_id uuid, p_account_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inv record;
  v_tenant uuid;
  v_exp record;
  v_supplier uuid;
  v_new_id uuid;
  v_rate numeric;
  v_desc text;
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

  -- Try to match an existing expense: same branch, same total (±0.50), within 5 days, not yet linked.
  SELECT e.* INTO v_exp FROM expenses e
  WHERE e.restaurant_id = v_inv.restaurant_id
    AND (v_inv.branch_id IS NULL OR e.branch_id IS NULL OR e.branch_id = v_inv.branch_id)
    AND e.deleted_at IS NULL
    AND e.purchase_invoice_id IS NULL
    AND abs(e.amount - v_inv.total_amount) <= 0.5
    AND abs(e.expense_date - v_inv.invoice_date) <= 5
  ORDER BY abs(e.amount - v_inv.total_amount), abs(e.expense_date - v_inv.invoice_date)
  LIMIT 1;

  IF v_exp.id IS NOT NULL THEN
    UPDATE expenses SET purchase_invoice_id = v_inv.id, updated_at = now() WHERE id = v_exp.id;
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
    WHERE id = v_inv.id;
    RETURN jsonb_build_object('status','linked','expense_id', v_exp.id);
  END IF;

  -- No match: a new expense on credit (supplier payable), posted with input VAT.
  IF p_account_id IS NULL THEN
    UPDATE purchase_invoices SET posting_status = 'needs_account',
      posting_note = 'No matching expense found — choose an expense account to post it.'
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
      AND (to_jsonb(s)->>'vat_number' = v_inv.supplier_vat_number OR to_jsonb(s)->>'tax_number' = v_inv.supplier_vat_number)
    LIMIT 1;
  END IF;
  IF v_supplier IS NULL AND v_inv.supplier_name_text IS NOT NULL THEN
    SELECT s.id INTO v_supplier FROM suppliers s
    WHERE s.restaurant_id = v_inv.restaurant_id AND lower(s.name) = lower(v_inv.supplier_name_text) LIMIT 1;
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
$$;
REVOKE ALL ON FUNCTION public.post_zatca_purchase_invoice(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.post_zatca_purchase_invoice(uuid, uuid) TO authenticated;