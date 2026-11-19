-- paid_cash_expenses_and_credit_ledger_posting

-- 1) An expense saved as paid is paid.
--    Both expense forms send status 'paid' but no paid_amount, and the status is derived from
--    paid_amount, so every paid expense was stored unpaid and its credit went to Accounts
--    Payable instead of the cash/bank account it was paid from (production: 1,750 marked paid
--    by hand afterwards, 34 still open). On INSERT only, 'paid' with no paid amount now means
--    paid in full. Cashier-entered expenses are still sent as 'unpaid' by the app, and
--    expense_payment_role_guard still decides who may record a paid expense.
CREATE OR REPLACE FUNCTION public.sync_expense_payment_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'paid' AND COALESCE(NEW.paid_amount, 0) = 0 THEN
    NEW.paid_amount := NEW.amount;
  END IF;
  IF NEW.paid_amount IS NULL THEN
    NEW.paid_amount := 0;
  END IF;
  IF NEW.paid_amount < 0 THEN
    RAISE EXCEPTION 'paid_amount cannot be negative';
  END IF;
  IF NEW.paid_amount > NEW.amount THEN
    RAISE EXCEPTION 'paid_amount (%) cannot exceed amount (%)', NEW.paid_amount, NEW.amount;
  END IF;
  IF NEW.paid_amount >= NEW.amount AND NEW.amount > 0 THEN
    NEW.status := 'paid';
  ELSE
    NEW.status := 'unpaid';
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) Customer credit ledger postings: defined, NOT called yet.
--    Collections against a sale, write-offs and their reversals should credit Accounts
--    Receivable (1100), but customer tab sales never debit it: End of Day posts the cash/card
--    totals the manager types (post_daily_sales_to_ledger), and 1100 holds only delivery-app
--    receivables. Crediting 1100 now would wrongly reduce the delivery receivable, which is
--    what settlement-invoice receipts already do (production: 2,541 SAR). Once tab sales post
--    DR 1100 (an accountant decision on how End of Day treats them), the credit API calls
--    post_customer_credit_to_ledger in the same transaction as each adjustment:
--      collection          DR Cash (1000, else 1030) or Bank (1010) by payment method, CR 1100
--      write_off           DR Bad Debt Expense, CR 1100
--      write_off_reversal  DR 1100, CR the Bad Debt account the write-off used (legs linked to it)
--    Dated today; branch from the sale when there is one. Tested against the ledger's rules
--    (reversal linkage, batches, account types) when written.

-- Bad Debt Expense for a tenant: 6900 where that is what it is called (some businesses use
-- 6900 for Waste & Spoilage), else any active expense account named Bad Debt, else a new one.
CREATE OR REPLACE FUNCTION public.ensure_bad_debt_account(p_tenant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_code text;
BEGIN
  SELECT id INTO v_id FROM chart_of_accounts
  WHERE tenant_id = p_tenant_id AND is_active AND account_type = 'expense' AND account_name ILIKE '%bad debt%'
  ORDER BY (account_code = '6900') DESC, account_code
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT c INTO v_code FROM (
    SELECT '6905' AS c, 0 AS o
    UNION ALL SELECT (6900 + g)::text, g FROM generate_series(1, 89) g
  ) cand
  WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts a WHERE a.tenant_id = p_tenant_id AND a.account_code = cand.c)
  ORDER BY o
  LIMIT 1;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIG_ERROR: no free 69xx code for a Bad Debt Expense account';
  END IF;

  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
  VALUES (p_tenant_id, v_code, 'Bad Debt Expense', 'expense', 'Customer credit written off (created for write-off posting)')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_customer_credit_to_ledger(p_adjustment_id uuid, p_kind text, p_payment_method text DEFAULT NULL, p_reverses uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_adj record;
  v_branch uuid;
  v_ar uuid;
  v_other uuid;
  v_debit uuid;
  v_credit uuid;
  v_label text;
  v_ref text;
  v_batch uuid;
  v_leg uuid;
  v_orig_dr uuid;  -- original write-off legs, for a reversal
  v_orig_cr uuid;
  v_source uuid;   -- reference_id on the legs: the adjustment, or for a reversal the write-off it undoes
BEGIN
  SELECT * INTO v_adj FROM customer_balance_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Balance adjustment not found';
  END IF;
  IF v_adj.ledger_posted THEN
    RETURN v_adj.ledger_transaction_id;
  END IF;
  IF COALESCE(v_adj.amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  IF v_adj.transaction_id IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM sales_transactions WHERE id = v_adj.transaction_id;
  END IF;

  SELECT id INTO v_ar FROM chart_of_accounts
  WHERE tenant_id = v_adj.tenant_id AND account_code = '1100' AND is_active LIMIT 1;
  IF v_ar IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIG_ERROR: Accounts Receivable (1100) is required';
  END IF;

  IF p_kind = 'collection' THEN
    IF lower(COALESCE(p_payment_method, 'cash')) = 'cash' THEN
      SELECT id INTO v_other FROM chart_of_accounts
      WHERE tenant_id = v_adj.tenant_id AND account_code IN ('1000','1030') AND is_active
      ORDER BY CASE account_code WHEN '1000' THEN 0 ELSE 1 END LIMIT 1;
    ELSE
      SELECT id INTO v_other FROM chart_of_accounts
      WHERE tenant_id = v_adj.tenant_id AND account_code = '1010' AND is_active LIMIT 1;
    END IF;
    IF v_other IS NULL THEN
      RAISE EXCEPTION 'ACCOUNT_CONFIG_ERROR: Cash (1000) or Bank (1010) account is required';
    END IF;
    v_debit := v_other; v_credit := v_ar;
    v_label := 'Customer payment'; v_ref := 'customer_receipt';
  ELSIF p_kind = 'write_off' THEN
    v_other := public.ensure_bad_debt_account(v_adj.tenant_id);
    v_debit := v_other; v_credit := v_ar;
    v_label := 'Customer write-off'; v_ref := 'customer_write_off';
  ELSIF p_kind = 'write_off_reversal' THEN
    -- Each leg points at the leg of the original write-off it reverses (trg_validate_reversal_linkage).
    SELECT id, account_id INTO v_orig_dr, v_other FROM account_transactions
    WHERE reference_type = 'customer_write_off' AND reference_id = p_reverses AND debit > 0 AND NOT COALESCE(is_voided, false) LIMIT 1;
    SELECT id INTO v_orig_cr FROM account_transactions
    WHERE reference_type = 'customer_write_off' AND reference_id = p_reverses AND credit > 0 AND NOT COALESCE(is_voided, false) LIMIT 1;
    IF v_orig_dr IS NULL OR v_orig_cr IS NULL THEN
      RAISE EXCEPTION 'The write-off being reversed has no ledger entry';
    END IF;
    v_debit := v_ar; v_credit := v_other;
    v_source := p_reverses;  -- a reversal must carry the original's source document
    v_label := 'Write-off reversed'; v_ref := 'customer_write_off_reversal';
  ELSE
    RAISE EXCEPTION 'Unknown credit posting kind %', p_kind;
  END IF;

  v_source := COALESCE(v_source, v_adj.id);

  -- A posted journal batch per entry, as customer receipts do (post_settlement_to_ledger).
  INSERT INTO journal_entry_batches (tenant_id, branch_id, batch_date, description, reference_number, entry_type,
                                     journal_type, created_by, is_posted, posted_at, posted_by, approval_status)
  VALUES (v_adj.tenant_id, v_branch, current_date, v_label || ' - ' || COALESCE(v_adj.reference_number, v_adj.reason),
          upper(left(v_ref, 3)) || '-' || left(v_adj.id::text, 8), CASE WHEN p_kind = 'collection' THEN 'sale' ELSE 'adjustment' END,
          'automatic', COALESCE(auth.uid(), v_adj.created_by), true, now(), COALESCE(auth.uid(), v_adj.created_by), 'approved')
  RETURNING id INTO v_batch;

  INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, credit,
                                    description, reference_type, reference_id, batch_id, created_by, original_transaction_id)
  VALUES (v_adj.tenant_id, v_branch, v_debit, current_date, v_adj.amount, 0,
          v_label || ' - ' || COALESCE(v_adj.reference_number, v_adj.reason), v_ref, v_source, v_batch, COALESCE(auth.uid(), v_adj.created_by),
          v_orig_cr)
  RETURNING id INTO v_leg;
  INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, credit,
                                    description, reference_type, reference_id, batch_id, created_by, original_transaction_id)
  VALUES (v_adj.tenant_id, v_branch, v_credit, current_date, 0, v_adj.amount,
          v_label || ' - ' || COALESCE(v_adj.reference_number, v_adj.reason), v_ref, v_source, v_batch, COALESCE(auth.uid(), v_adj.created_by),
          v_orig_dr);

  UPDATE customer_balance_adjustments
  SET ledger_posted = true, ledger_transaction_id = v_leg
  WHERE id = v_adj.id;
  RETURN v_leg;
END;
$function$;

-- Only the API (table owner, after requireRestaurantRole) calls these.
REVOKE ALL ON FUNCTION public.ensure_bad_debt_account(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_customer_credit_to_ledger(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
