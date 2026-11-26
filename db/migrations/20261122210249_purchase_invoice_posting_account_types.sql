-- Supplier invoices could be posted to any asset account (cash, bank, receivables,
-- accumulated depreciation...). Only expense, COGS and inventory (1200-1299)
-- accounts are valid targets for a purchase. Body otherwise unchanged from
-- 20261122200058_purchase_invoice_payments.

CREATE OR REPLACE FUNCTION public.post_purchase_invoice_to_ledger(p_invoice_id uuid, p_account_id uuid, p_payment_method text DEFAULT NULL)
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

  -- Among assets only inventory (1200-1299) can receive a purchase: cash, bank and
  -- receivables are not costs, and fixed/prepaid assets have their own registers
  -- (validate_journal_entry_accounts refuses them on purchase/expense journals).
  IF v_account.id IS NULL
     OR NOT (v_account.account_type IN ('expense', 'cogs')
             OR (v_account.account_type = 'asset' AND v_account.account_code >= '1200' AND v_account.account_code < '1300')) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Choose an active expense, cost of sales or inventory (1200-1299) account.';
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
