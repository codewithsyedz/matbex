-- Supplier invoice payments, and invoices saved as already paid.
--
-- post_invoice_payment_to_ledger ("Mark as paid" on supplier invoices) had the
-- same problems post_purchase_invoice_to_ledger had before 20261115222413:
--   * no access check: any signed-in user could pay another business's invoice;
--   * it updated chart_of_accounts.balance by hand on top of
--     trigger_update_account_balance (double count, wrong sign for AP);
--   * it always debited AP 2000, while posting now credits the supplier's own
--     payable head (2500-2899) when there is one;
--   * nothing stopped paying an unposted invoice, an invoice that mirrors an
--     expense, or paying the same invoice twice.
-- The payment now debits the exact payable line the invoice posted to and
-- credits Cash 1000 or Bank 1010 (branch sub-accounts resolved).
--
-- Invoices saved as already paid (status 'paid', e.g. the purchase screen with
-- cash/bank) used to post only on credit and leave the payable open.
-- post_purchase_invoice_to_ledger gains p_payment_method: for a paid invoice it
-- is required and the payment is posted in the same transaction, dated on the
-- invoice date.

CREATE OR REPLACE FUNCTION public.post_purchase_invoice_payment_internal(
  p_invoice_id uuid, p_payment_method text, p_payment_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_inv record;
  v_tenant_id uuid;
  v_ap_account_id uuid;
  v_cash_account_id uuid;
  v_total numeric;
  v_batch_id uuid;
  v_desc text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to record supplier payments.' USING ERRCODE = '42501';
  END IF;

  SELECT pi.*, r.tenant_id AS r_tenant_id
    INTO v_inv
  FROM public.purchase_invoices pi
  JOIN public.restaurants r ON r.id = pi.restaurant_id
  WHERE pi.id = p_invoice_id
  FOR UPDATE OF pi;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  v_tenant_id := v_inv.r_tenant_id;

  IF NOT public.can_post_journal_entries(v_tenant_id) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants allowed to post journals can record supplier payments.'
      USING ERRCODE = '42501';
  END IF;

  IF v_inv.linked_expense_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.expenses e
    WHERE e.purchase_invoice_id = v_inv.id AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: This invoice belongs to an expense; record the payment on the expense.';
  END IF;

  -- The payable line this invoice was posted to (supplier head or 2000).
  SELECT t.account_id, t.credit INTO v_ap_account_id, v_total
  FROM public.account_transactions t
  WHERE t.reference_type = 'purchase_invoice' AND t.reference_id = v_inv.id
    AND COALESCE(t.credit, 0) > 0 AND COALESCE(t.is_voided, false) = false
  ORDER BY t.created_at
  LIMIT 1;

  IF NOT COALESCE(v_inv.ledger_posted, false) OR v_ap_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Post the invoice to the ledger before recording its payment.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.account_transactions t
    WHERE t.reference_type = 'invoice_payment' AND t.reference_id = v_inv.id
      AND COALESCE(t.is_voided, false) = false
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: The payment for this invoice is already recorded.';
  END IF;

  SELECT id INTO v_cash_account_id
  FROM public.chart_of_accounts
  WHERE tenant_id = v_tenant_id
    AND account_code = CASE WHEN p_payment_method = 'cash' THEN '1000'
                            WHEN p_payment_method IN ('bank', 'card') THEN '1010' END
    AND COALESCE(is_active, true)
  LIMIT 1;

  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'bank', 'card') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Choose cash or bank as the payment method.';
  END IF;
  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: % account (%) not found in chart of accounts',
      CASE WHEN p_payment_method = 'cash' THEN 'Cash' ELSE 'Bank' END,
      CASE WHEN p_payment_method = 'cash' THEN '1000' ELSE '1010' END;
  END IF;
  v_cash_account_id := public.resolve_branch_account(v_cash_account_id, v_inv.branch_id);

  v_desc := 'Payment for Purchase Invoice ' || v_inv.invoice_number
    || COALESCE(' - ' || COALESCE((SELECT s.name FROM public.suppliers s
                                   WHERE s.id = v_inv.supplier_id AND s.restaurant_id = v_inv.restaurant_id),
                                  v_inv.supplier_name_text), '');

  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, project_id, batch_date, description, reference_number, entry_type,
    created_by, is_posted, posted_at, posted_by, journal_type, approval_status, approved_by, approved_at
  ) VALUES (
    v_tenant_id, v_inv.branch_id, v_inv.project_id, p_payment_date, v_desc,
    'PINVPAY-' || v_inv.id::text, 'invoice_payment',
    v_user_id, true, now(), v_user_id, 'purchase', 'approved', v_user_id, now()
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit, description,
    reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_tenant_id, v_ap_account_id, p_payment_date, v_total, NULL, v_desc || ' — supplier payable cleared',
    'invoice_payment', v_inv.id, v_user_id, v_inv.branch_id, v_batch_id
  );

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit, description,
    reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_tenant_id, v_cash_account_id, p_payment_date, NULL, v_total,
    v_desc || ' — paid (' || CASE WHEN p_payment_method = 'cash' THEN 'cash' ELSE 'bank' END || ')',
    'invoice_payment', v_inv.id, v_user_id, v_inv.branch_id, v_batch_id
  );

  -- chart_of_accounts.balance is maintained by trigger_update_account_balance.
  UPDATE public.purchase_invoices SET status = 'paid' WHERE id = v_inv.id;

  RETURN v_batch_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.post_purchase_invoice_payment_internal(uuid, text, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_invoice_payment_to_ledger(p_invoice_id uuid, p_payment_method text DEFAULT 'cash'::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.post_purchase_invoice_payment_internal(p_invoice_id, p_payment_method, CURRENT_DATE);
END;
$function$;

REVOKE ALL ON FUNCTION public.post_invoice_payment_to_ledger(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_invoice_payment_to_ledger(uuid, text) TO authenticated;

-- Replaces the two-argument version; existing two-argument calls still resolve
-- here through the default.
DROP FUNCTION public.post_purchase_invoice_to_ledger(uuid, uuid);

CREATE FUNCTION public.post_purchase_invoice_to_ledger(p_invoice_id uuid, p_account_id uuid, p_payment_method text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_inv record;
  v_tenant_id uuid;
  v_account record;
  v_debit_account_id uuid;
  v_journal_type text;
  v_vat numeric;
  v_net numeric;
  v_total numeric;
  v_vat_account_id uuid;
  v_supplier_id uuid;
  v_supplier_name text;
  v_ap_account_id uuid;
  v_batch_id uuid;
  v_debit_tx_id uuid;
  v_desc text;
  v_dr numeric;
  v_cr numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to post supplier invoices.' USING ERRCODE = '42501';
  END IF;

  SELECT pi.*, r.tenant_id AS r_tenant_id
    INTO v_inv
  FROM public.purchase_invoices pi
  JOIN public.restaurants r ON r.id = pi.restaurant_id
  WHERE pi.id = p_invoice_id
  FOR UPDATE OF pi;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  v_tenant_id := v_inv.r_tenant_id;

  IF NOT public.can_post_journal_entries(v_tenant_id) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants allowed to post journals can post supplier invoices.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_inv.ledger_posted, false) OR v_inv.posting_status IN ('posted', 'linked') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Invoice already posted to ledger';
  END IF;

  IF v_inv.linked_expense_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.expenses e
    WHERE e.purchase_invoice_id = v_inv.id AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: This invoice belongs to an expense, which posts it to the ledger. Post or correct the expense instead.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_items ii
    JOIN public.purchases p ON p.invoice_item_id = ii.id
    JOIN public.account_transactions t
      ON t.reference_type = 'inventory_purchase' AND t.reference_id = p.id
     AND COALESCE(t.is_voided, false) = false
    WHERE ii.invoice_id = v_inv.id
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Stock received on this invoice is already in the ledger as inventory purchases; posting the invoice would count it twice.';
  END IF;

  SELECT id, account_code, account_type::text AS account_type
    INTO v_account
  FROM public.chart_of_accounts
  WHERE id = p_account_id AND tenant_id = v_tenant_id AND COALESCE(is_active, true);

  IF v_account.id IS NULL OR v_account.account_type NOT IN ('expense', 'cogs', 'asset') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Choose an active expense, cost or stock account from your chart of accounts.';
  END IF;

  v_total := ROUND(COALESCE(v_inv.total_amount, 0), 2);
  v_vat := ROUND(COALESCE(v_inv.tax_amount, 0), 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Invoice total must be more than zero to post.';
  END IF;
  IF v_vat < 0 OR v_vat >= v_total THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: VAT % is not valid for an invoice total of %', v_vat, v_total;
  END IF;
  v_net := v_total - v_vat;

  -- An invoice saved as already paid also needs its payment in the ledger,
  -- otherwise the supplier payable stays open for money already handed over.
  IF v_inv.status = 'paid' AND COALESCE(p_payment_method, '') NOT IN ('cash', 'bank', 'card') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: This invoice is marked paid. Choose whether it was paid in cash or from the bank so the payment is recorded too.';
  END IF;

  -- Purchases are inventory: a COGS choice books to the matching stock account.
  IF v_account.account_type = 'cogs' THEN
    v_debit_account_id := public.resolve_inventory_account_for_cogs(v_tenant_id, p_account_id);
    IF v_debit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: No inventory account (1200) found to receive this purchase.';
    END IF;
    v_journal_type := 'purchase';
  ELSIF v_account.account_code >= '1200' AND v_account.account_code < '1300' THEN
    v_debit_account_id := p_account_id;
    v_journal_type := 'purchase';
  ELSE
    v_debit_account_id := p_account_id;
    v_journal_type := 'expense';
  END IF;
  v_debit_account_id := public.resolve_branch_account(v_debit_account_id, v_inv.branch_id);

  IF v_vat > 0 THEN
    v_vat_account_id := public.resolve_vat_account(v_tenant_id, 'input');
    IF v_vat_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Input VAT account (1180) not found in chart of accounts';
    END IF;
    v_vat_account_id := public.resolve_branch_account(v_vat_account_id, v_inv.branch_id);
  END IF;

  -- Only a supplier of this restaurant may name the payable head.
  SELECT s.id, s.name INTO v_supplier_id, v_supplier_name
  FROM public.suppliers s
  WHERE s.id = v_inv.supplier_id AND s.restaurant_id = v_inv.restaurant_id;

  v_ap_account_id := public.resolve_supplier_ap_account(v_tenant_id, v_supplier_id);
  IF v_ap_account_id IS NULL THEN
    SELECT id INTO v_ap_account_id
    FROM public.chart_of_accounts
    WHERE tenant_id = v_tenant_id AND account_code = '2000' AND COALESCE(is_active, true)
    LIMIT 1;
    IF v_ap_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Accounts Payable account (2000) not found. Please create it in Chart of Accounts.';
    END IF;
    v_ap_account_id := public.resolve_branch_account(v_ap_account_id, v_inv.branch_id);
  END IF;

  v_desc := 'Purchase Invoice: ' || v_inv.invoice_number
    || COALESCE(' - ' || COALESCE(v_supplier_name, v_inv.supplier_name_text), '');

  -- Owners/managers post directly; enforce_journal_entry_approval_state turns
  -- an accountant's batch into a pending one, as for every other posting.
  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, project_id, batch_date, description, reference_number, entry_type,
    created_by, is_posted, posted_at, posted_by, journal_type, approval_status, approved_by, approved_at
  ) VALUES (
    v_tenant_id, v_inv.branch_id, v_inv.project_id, v_inv.invoice_date, v_desc,
    'PINV-' || v_inv.id::text, 'purchase_invoice',
    v_user_id, true, now(), v_user_id, v_journal_type, 'approved', v_user_id, now()
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit, description,
    reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_tenant_id, v_debit_account_id, v_inv.invoice_date, v_net, NULL, v_desc || ' (net of VAT)',
    'purchase_invoice', v_inv.id, v_user_id, v_inv.branch_id, v_batch_id
  ) RETURNING id INTO v_debit_tx_id;

  IF v_vat > 0 THEN
    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date, debit, credit, description,
      reference_type, reference_id, created_by, branch_id, batch_id
    ) VALUES (
      v_tenant_id, v_vat_account_id, v_inv.invoice_date, v_vat, NULL, v_desc || ' — input VAT recoverable',
      'purchase_invoice', v_inv.id, v_user_id, v_inv.branch_id, v_batch_id
    );
  END IF;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit, description,
    reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_tenant_id, v_ap_account_id, v_inv.invoice_date, NULL, v_total, v_desc || ' — on credit (supplier payable)',
    'purchase_invoice', v_inv.id, v_user_id, v_inv.branch_id, v_batch_id
  );

  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0) INTO v_dr, v_cr
  FROM public.account_transactions
  WHERE batch_id = v_batch_id AND COALESCE(is_voided, false) = false;
  IF abs(v_dr - v_cr) > 0.005 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Invoice posting is unbalanced (DR % vs CR %)', v_dr, v_cr;
  END IF;

  -- chart_of_accounts.balance is maintained by trigger_update_account_balance.
  UPDATE public.purchase_invoices
  SET account_id = p_account_id,
      ledger_posted = true,
      ledger_transaction_id = v_debit_tx_id,  -- FK to account_transactions, as on expenses
      posting_status = 'posted',
      posting_note = 'Posted on credit: net ' || v_net || CASE WHEN v_vat > 0 THEN ', input VAT ' || v_vat ELSE '' END
  WHERE id = v_inv.id;

  IF v_inv.status = 'paid' THEN
    PERFORM public.post_purchase_invoice_payment_internal(v_inv.id, p_payment_method, v_inv.invoice_date);
    UPDATE public.purchase_invoices
    SET posting_note = posting_note || '; paid (' || CASE WHEN p_payment_method = 'cash' THEN 'cash' ELSE 'bank' END || ')'
    WHERE id = v_inv.id;
  END IF;

  RETURN v_batch_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.post_purchase_invoice_to_ledger(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_purchase_invoice_to_ledger(uuid, uuid, text) TO authenticated;
