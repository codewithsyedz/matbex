-- customer_account_receivables
--
-- Customer tab sales never reached the ledger as receivables: the End of Day form pre-fills
-- cash/card from every POS sale by payment method, so a sale put on a customer's tab was
-- posted as cash; settlement receipts then credited 1100, which holds delivery-platform
-- receivables (production: 2,541 SAR wrongly cleared). Accounting treatment (accrual,
-- revenue and VAT at the time of sale):
--   tab sale (End of Day)    DR 1130 Customer Accounts, CR Sales / Output VAT
--   customer payment         DR Cash/Bank, CR 1130   (settlement invoices and instalments)
--   write-off / reversal     DR Bad Debt, CR 1130 / the reverse
-- 1110/1120 are already "AR - Delivery Platforms" / "AR - Corporate" in production; 1130 is free.

-- 1) The account: seeded for new tenants, backfilled, and resolved by one helper.
CREATE OR REPLACE FUNCTION public.seed_standard_coa_missing(p_tenant_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _coa_snapshot (
    account_code text PRIMARY KEY,
    account_name text,
    description text,
    is_system_account boolean
  ) ON COMMIT DROP;
  DELETE FROM _coa_snapshot;

  INSERT INTO _coa_snapshot
  SELECT account_code, account_name, description, is_system_account
  FROM public.chart_of_accounts
  WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_before = ROW_COUNT;

  PERFORM public.ensure_standard_coa_accounts(p_tenant_id);

  UPDATE public.chart_of_accounts c
     SET account_name = s.account_name,
         description = s.description,
         is_system_account = s.is_system_account
    FROM _coa_snapshot s
   WHERE c.tenant_id = p_tenant_id
     AND c.account_code = s.account_code
     AND (c.account_name, c.description, c.is_system_account)
         IS DISTINCT FROM (s.account_name, s.description, s.is_system_account);

  -- Day-end adjustments (see 20260506231755).
  INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, is_active, description)
  VALUES (p_tenant_id, '6999', 'Cash Over/Short', 'expense', true,
          'Auto-created for day-end adjustments and reconciliations')
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  -- Customer tab sales and their payments (see 20261111190452).
  INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, is_active, description)
  VALUES (p_tenant_id, '1130', 'Accounts Receivable - Customer Accounts', 'asset', true,
          'What customers owe on their tabs; separate from delivery-platform receivables')
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  SELECT count(*) INTO v_after FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id;
  RETURN v_after - v_before;
END;
$function$;

INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, is_active, description)
SELECT t.id, '1130', 'Accounts Receivable - Customer Accounts', 'asset', true,
       'What customers owe on their tabs; separate from delivery-platform receivables'
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = t.id AND c.account_code = '1130');

-- 1130 when it is the customer account, else an active asset account named for customer
-- receivables, else a new one on the first free 113x/114x code.
CREATE OR REPLACE FUNCTION public.customer_receivable_account(p_tenant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_code text;
BEGIN
  SELECT id INTO v_id FROM chart_of_accounts
  WHERE tenant_id = p_tenant_id AND is_active AND account_type = 'asset'
    AND account_name ILIKE '%receivable%' AND account_name ILIKE '%customer%'
  ORDER BY (account_code = '1130') DESC, account_code
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT c INTO v_code FROM (SELECT (1130 + g)::text c, g FROM generate_series(0, 19) g) cand
  WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts a WHERE a.tenant_id = p_tenant_id AND a.account_code = cand.c)
  ORDER BY g LIMIT 1;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIG_ERROR: no free 113x code for Customer Accounts receivable';
  END IF;
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
  VALUES (p_tenant_id, v_code, 'Accounts Receivable - Customer Accounts', 'asset',
          'What customers owe on their tabs; separate from delivery-platform receivables')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.customer_receivable_account(uuid) FROM PUBLIC, anon, authenticated;

-- 2) End of Day: the day's sales on customer accounts, posted to 1130.
ALTER TABLE public.daily_sales_summary
  ADD COLUMN IF NOT EXISTS account_sales numeric(12,2) NOT NULL DEFAULT 0
  CONSTRAINT daily_sales_summary_account_sales_nonneg CHECK (account_sales >= 0);
COMMENT ON COLUMN public.daily_sales_summary.account_sales IS
  'Sales put on customers'' tabs that day (gross, VAT inclusive); posted DR Customer Accounts receivable, not cash.';

-- What each sale put on the customer's account at the till: total minus what was paid then.
-- Later instalments (credit adjustments tied to the sale) are added back so a payment made
-- before End of Day does not shrink the day's tab sales. Voided sales and void mirrors count 0.
-- SECURITY INVOKER: callers see only the sales their RLS allows.
CREATE OR REPLACE FUNCTION public.sale_account_amounts(p_restaurant_id uuid, p_branch_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE (sale_id uuid, on_account numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT s.id,
         GREATEST(0, round(s.total - (COALESCE(s.paid_amount, 0) - COALESCE((
           SELECT sum(a.amount) FROM customer_balance_adjustments a
           WHERE a.transaction_id = s.id AND a.adjustment_type = 'credit'), 0)), 2))
  FROM sales_transactions s
  WHERE s.restaurant_id = p_restaurant_id
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND s.created_at >= p_from AND s.created_at < p_to
    AND s.customer_id IS NOT NULL
    AND s.voided_at IS NULL
    AND s.voids_transaction_id IS NULL
    AND s.total > 0
$function$;
REVOKE ALL ON FUNCTION public.sale_account_amounts(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sale_account_amounts(uuid, uuid, timestamptz, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.post_daily_sales_to_ledger(p_sales_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sales record;
  v_batch_id uuid;
  v_branch_id uuid;
  v_actor uuid := auth.uid();
  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_card_clearing_id uuid;
  v_ar_account_id uuid;
  v_cust_ar_id uuid;
  v_revenue_account_id uuid;
  v_delivery_revenue_id uuid;
  v_vat_payable_id uuid;
  v_rate numeric := 0;
  v_std_gross numeric := 0;
  v_std_net numeric := 0;
  v_std_vat numeric := 0;
  v_del_gross numeric := 0;
  v_del_net numeric := 0;
  v_del_vat numeric := 0;
BEGIN
  SELECT * INTO v_sales FROM public.daily_sales_summary WHERE id = p_sales_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Sales record not found'; END IF;
  IF COALESCE(v_sales.ledger_posted, false) THEN RAISE EXCEPTION 'VALIDATION_ERROR: Sales already posted to ledger'; END IF;
  IF v_sales.status NOT IN ('closed', 'approved') THEN RAISE EXCEPTION 'VALIDATION_ERROR: Sales day must be closed before posting'; END IF;
  IF v_actor IS NOT NULL AND NOT (
    public.is_superadmin(v_actor)
    OR (public.can_access_restaurant(v_sales.restaurant_id) AND EXISTS (
      SELECT 1 FROM public.user_tenant_roles utr
      WHERE utr.user_id = v_actor AND utr.tenant_id = v_sales.tenant_id
        AND utr.role IN ('owner', 'manager', 'accountant')
    ))
  ) THEN RAISE EXCEPTION 'FORBIDDEN: Finance role and restaurant access are required'; END IF;

  v_branch_id := v_sales.branch_id;
  IF v_branch_id IS NULL THEN
    SELECT b.id INTO v_branch_id FROM public.branches b
    WHERE b.restaurant_id = v_sales.restaurant_id AND COALESCE(b.is_active, true)
    ORDER BY COALESCE(b.is_primary, false) DESC, b.created_at ASC LIMIT 1;
  END IF;

  SELECT id INTO v_cash_account_id FROM public.chart_of_accounts WHERE tenant_id=v_sales.tenant_id AND account_code='1000' AND is_active LIMIT 1;
  SELECT id INTO v_bank_account_id FROM public.chart_of_accounts WHERE tenant_id=v_sales.tenant_id AND account_code='1010' AND is_active LIMIT 1;
  SELECT id INTO v_card_clearing_id FROM public.chart_of_accounts WHERE tenant_id=v_sales.tenant_id AND account_code='1015' AND is_active LIMIT 1;
  SELECT id INTO v_ar_account_id FROM public.chart_of_accounts WHERE tenant_id=v_sales.tenant_id AND account_code='1100' AND is_active LIMIT 1;
  SELECT id INTO v_delivery_revenue_id FROM public.chart_of_accounts WHERE tenant_id=v_sales.tenant_id AND account_code='4100' AND is_active LIMIT 1;
  SELECT id INTO v_vat_payable_id FROM public.chart_of_accounts WHERE tenant_id=v_sales.tenant_id AND account_code='2200' AND is_active LIMIT 1;

  IF v_sales.ai_revenue_account_id IS NOT NULL THEN
    SELECT id INTO v_revenue_account_id FROM public.chart_of_accounts
    WHERE id=v_sales.ai_revenue_account_id AND tenant_id=v_sales.tenant_id AND account_type='revenue' AND is_active;
  ELSE
    SELECT id INTO v_revenue_account_id FROM public.chart_of_accounts
    WHERE tenant_id=v_sales.tenant_id AND account_code='4000' AND is_active LIMIT 1;
  END IF;
  IF v_delivery_revenue_id IS NULL THEN v_delivery_revenue_id := v_revenue_account_id; END IF;
  IF v_card_clearing_id IS NULL THEN v_card_clearing_id := v_bank_account_id; END IF;
  IF v_cash_account_id IS NULL OR v_bank_account_id IS NULL OR v_revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIG_ERROR: Required cash, bank, or revenue account is missing';
  END IF;

  v_rate := public.assert_branch_vat_rate_configured(v_branch_id, 'closing this sales day') / 100.0;
  IF v_vat_payable_id IS NULL AND v_rate > 0 THEN
    RAISE EXCEPTION 'VAT_CONFIG_ERROR: VAT Payable account 2200 is missing or inactive';
  END IF;

  -- account_sales: the day's sales put on customers' tabs (not in the cash/card totals).
  v_std_gross := COALESCE(v_sales.cash_sales,0)+COALESCE(v_sales.card_sales,0)+COALESCE(v_sales.other_sales,0)+COALESCE(v_sales.account_sales,0);
  IF COALESCE(v_sales.account_sales,0) > 0 THEN v_cust_ar_id := public.customer_receivable_account(v_sales.tenant_id); END IF;
  v_del_gross := COALESCE(v_sales.delivery_sales,0);
  v_std_net := ROUND(v_std_gross/(1+v_rate),2);
  v_std_vat := ROUND(v_std_gross-v_std_net,2);
  v_del_net := ROUND(v_del_gross/(1+v_rate),2);
  v_del_vat := ROUND(v_del_gross-v_del_net,2);

  INSERT INTO public.journal_entry_batches (tenant_id,branch_id,description,batch_date,created_by,entry_type,journal_type,is_posted,posted_at,posted_by,approval_status)
  VALUES (v_sales.tenant_id,v_branch_id,'Daily Sales - '||v_sales.sales_date::text,v_sales.sales_date,COALESCE(v_actor,v_sales.created_by),'sale','automatic',true,now(),COALESCE(v_actor,v_sales.created_by),'approved')
  RETURNING id INTO v_batch_id;

  IF v_sales.cash_sales>0 THEN INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,debit,description,reference_type,reference_id,batch_id,created_by) VALUES (v_sales.tenant_id,v_branch_id,v_cash_account_id,v_sales.sales_date,v_sales.cash_sales,'Cash Sales - '||v_sales.sales_date,'sale',p_sales_id,v_batch_id,COALESCE(v_actor,v_sales.created_by)); END IF;
  IF v_sales.card_sales>0 THEN INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,debit,description,reference_type,reference_id,batch_id,created_by) VALUES (v_sales.tenant_id,v_branch_id,v_card_clearing_id,v_sales.sales_date,v_sales.card_sales,'Card Sales (awaiting settlement) - '||v_sales.sales_date,'sale',p_sales_id,v_batch_id,COALESCE(v_actor,v_sales.created_by)); END IF;
  IF v_sales.delivery_sales>0 THEN
    IF v_ar_account_id IS NULL THEN RAISE EXCEPTION 'ACCOUNT_CONFIG_ERROR: Accounts Receivable 1100 is required for delivery sales'; END IF;
    INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,debit,description,reference_type,reference_id,batch_id,created_by) VALUES (v_sales.tenant_id,v_branch_id,v_ar_account_id,v_sales.sales_date,v_sales.delivery_sales,'Delivery Sales Receivable - '||v_sales.sales_date,'sale',p_sales_id,v_batch_id,COALESCE(v_actor,v_sales.created_by));
  END IF;
  IF v_sales.other_sales>0 THEN INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,debit,description,reference_type,reference_id,batch_id,created_by) VALUES (v_sales.tenant_id,v_branch_id,v_cash_account_id,v_sales.sales_date,v_sales.other_sales,'Other Sales - '||v_sales.sales_date,'sale',p_sales_id,v_batch_id,COALESCE(v_actor,v_sales.created_by)); END IF;
  IF COALESCE(v_sales.account_sales,0)>0 THEN INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,debit,description,reference_type,reference_id,batch_id,created_by) VALUES (v_sales.tenant_id,v_branch_id,v_cust_ar_id,v_sales.sales_date,v_sales.account_sales,'Customer Account Sales - '||v_sales.sales_date,'sale',p_sales_id,v_batch_id,COALESCE(v_actor,v_sales.created_by)); END IF;
  IF v_std_gross>0 THEN INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,credit,description,reference_type,reference_id,batch_id,created_by) VALUES (v_sales.tenant_id,v_branch_id,v_revenue_account_id,v_sales.sales_date,v_std_net,'Sales Revenue (net of VAT) - '||v_sales.sales_date,'sale',p_sales_id,v_batch_id,COALESCE(v_actor,v_sales.created_by)); END IF;
  IF v_del_gross>0 THEN INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,credit,description,reference_type,reference_id,batch_id,created_by) VALUES (v_sales.tenant_id,v_branch_id,v_delivery_revenue_id,v_sales.sales_date,v_del_net,'Delivery Revenue (net of VAT) - '||v_sales.sales_date,'sale',p_sales_id,v_batch_id,COALESCE(v_actor,v_sales.created_by)); END IF;
  IF v_vat_payable_id IS NOT NULL AND (v_std_vat+v_del_vat)>0 THEN INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,credit,description,reference_type,reference_id,batch_id,created_by) VALUES (v_sales.tenant_id,v_branch_id,v_vat_payable_id,v_sales.sales_date,v_std_vat+v_del_vat,'Output VAT on sales - '||v_sales.sales_date,'sale',p_sales_id,v_batch_id,COALESCE(v_actor,v_sales.created_by)); END IF;

  UPDATE public.daily_sales_summary SET ledger_posted=true,ledger_posted_at=now(),ledger_batch_id=v_batch_id WHERE id=p_sales_id;
  RETURN v_batch_id;
END;
$function$;

-- 3) Settlement-invoice receipts clear the customer account, not delivery receivables.
CREATE OR REPLACE FUNCTION public.post_settlement_to_ledger(p_payment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_payment record; v_invoice record; v_restaurant record; v_actor uuid:=auth.uid(); v_branch uuid; v_cash uuid; v_bank uuid; v_ar uuid; v_debit uuid; v_batch uuid; v_tx uuid;
BEGIN
  SELECT * INTO v_payment FROM public.settlement_payments WHERE id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Customer receipt not found'; END IF;
  IF COALESCE(v_payment.ledger_posted,false) THEN RETURN v_payment.ledger_transaction_id; END IF;
  SELECT * INTO v_invoice FROM public.settlement_invoices WHERE id=v_payment.settlement_invoice_id;
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id=v_payment.restaurant_id;
  IF v_restaurant.id IS NULL OR v_invoice.id IS NULL OR v_invoice.restaurant_id<>v_payment.restaurant_id THEN RAISE EXCEPTION 'VALIDATION_ERROR: Receipt invoice or restaurant mismatch'; END IF;
  IF v_actor IS NOT NULL AND NOT (public.is_superadmin(v_actor) OR (public.can_access_restaurant(v_payment.restaurant_id) AND EXISTS (SELECT 1 FROM public.user_tenant_roles utr WHERE utr.user_id=v_actor AND utr.tenant_id=v_restaurant.tenant_id AND utr.role IN ('owner','manager','accountant')))) THEN RAISE EXCEPTION 'FORBIDDEN: Finance role and restaurant access are required'; END IF;
  SELECT CASE WHEN count(DISTINCT branch_id)=1 THEN min(branch_id::text)::uuid ELSE NULL END INTO v_branch FROM public.sales_transactions WHERE settlement_invoice_id=v_invoice.id AND branch_id IS NOT NULL;
  SELECT id INTO v_cash FROM public.chart_of_accounts WHERE tenant_id=v_restaurant.tenant_id AND account_code IN ('1000','1030') AND is_active ORDER BY CASE account_code WHEN '1000' THEN 0 ELSE 1 END LIMIT 1;
  SELECT id INTO v_bank FROM public.chart_of_accounts WHERE tenant_id=v_restaurant.tenant_id AND account_code='1010' AND is_active LIMIT 1;
  v_ar := public.customer_receivable_account(v_restaurant.tenant_id);  -- 1130, not 1100 (delivery)
  v_debit:=CASE WHEN lower(v_payment.payment_method)='cash' THEN v_cash ELSE v_bank END;
  IF v_debit IS NULL OR v_ar IS NULL THEN RAISE EXCEPTION 'ACCOUNT_CONFIG_ERROR: Cash/Bank and Accounts Receivable accounts are required'; END IF;
  INSERT INTO public.journal_entry_batches (tenant_id,branch_id,batch_date,description,reference_number,entry_type,journal_type,created_by,is_posted,posted_at,posted_by,approval_status)
  VALUES (v_restaurant.tenant_id,v_branch,current_date,'Customer receipt - '||v_invoice.invoice_number,'RCP-'||left(p_payment_id::text,8),'sale','automatic',v_payment.paid_by,true,now(),v_payment.paid_by,'approved') RETURNING id INTO v_batch;
  INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,debit,description,reference_type,reference_id,batch_id,created_by)
  VALUES (v_restaurant.tenant_id,v_branch,v_debit,current_date,v_payment.amount,'Customer receipt - '||v_invoice.invoice_number,'customer_receipt',p_payment_id,v_batch,v_payment.paid_by) RETURNING id INTO v_tx;
  INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,credit,description,reference_type,reference_id,batch_id,created_by)
  VALUES (v_restaurant.tenant_id,v_branch,v_ar,current_date,v_payment.amount,'Customer receipt - '||v_invoice.invoice_number,'customer_receipt',p_payment_id,v_batch,v_payment.paid_by);
  UPDATE public.settlement_payments SET ledger_posted=true,ledger_transaction_id=v_tx WHERE id=p_payment_id;
  INSERT INTO public.ai_income_journal_audit (tenant_id,branch_id,source_type,source_id,selected_account_id,classification,rationale,model,prompt_version,outcome,ledger_batch_id,requested_by)
  VALUES (v_restaurant.tenant_id,v_branch,'customer_receipt',p_payment_id,v_ar,'accounts_receivable_clearance','Receipt clears the existing receivable; revenue is not recognized twice.','deterministic','customer-receipt-v1','posted',v_batch,v_payment.paid_by);
  RETURN v_tx;
END;
$function$;

-- 4) Customer credit postings (20261111124900) against the customer account. The credit API
--    now calls this for instalments, write-offs and write-off reversals.
CREATE OR REPLACE FUNCTION public.post_customer_credit_to_ledger(p_adjustment_id uuid, p_kind text, p_payment_method text DEFAULT NULL::text, p_reverses uuid DEFAULT NULL::uuid)
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

  v_ar := public.customer_receivable_account(v_adj.tenant_id);  -- 1130 Customer Accounts

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
