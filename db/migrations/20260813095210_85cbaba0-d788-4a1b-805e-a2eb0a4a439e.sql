CREATE OR REPLACE FUNCTION public.assert_branch_vat_rate_configured(p_branch_id uuid, p_context text DEFAULT 'ledger posting')
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rate numeric;
  v_name text;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'VAT_CONFIG_ERROR: No branch is attached to this record, so the VAT rate to apply cannot be determined. Assign a branch before %.', p_context
      USING HINT = 'Open the record and select the branch it belongs to.';
  END IF;

  SELECT b.vat_rate, b.name INTO v_rate, v_name FROM branches b WHERE b.id = p_branch_id;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'VAT_CONFIG_ERROR: Branch % no longer exists, so its VAT rate cannot be read for %.', p_branch_id, p_context;
  END IF;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'VAT_CONFIG_ERROR: Branch "%" has no VAT rate configured, so output VAT cannot be calculated for %.', v_name, p_context
      USING HINT = 'Set the VAT rate for this branch in Settings > Branches (use 0 if the branch is not VAT registered).';
  END IF;

  IF v_rate < 0 OR v_rate >= 100 THEN
    RAISE EXCEPTION 'VAT_CONFIG_ERROR: Branch "%" has an invalid VAT rate of %%%. It must be between 0 and 100. Posting for % is blocked until it is corrected.', v_name, ROUND(v_rate, 2), p_context
      USING HINT = 'Correct the VAT rate for this branch in Settings > Branches.';
  END IF;

  RETURN v_rate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_night_summary_vat_consistent(p_summary_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_summary record;
  v_rate numeric;
  v_expected numeric;
  v_branch_name text;
BEGIN
  SELECT * INTO v_summary FROM night_shift_summaries WHERE id = p_summary_id;
  IF v_summary IS NULL THEN
    RETURN;
  END IF;

  v_rate := public.assert_branch_vat_rate_configured(v_summary.branch_id, 'posting the night shift summary');
  SELECT name INTO v_branch_name FROM branches WHERE id = v_summary.branch_id;

  v_expected := ROUND(COALESCE(v_summary.net_sales, 0) * v_rate / 100.0, 2);

  IF ABS(v_expected - COALESCE(v_summary.vat_amount, 0)) > 1 THEN
    RAISE EXCEPTION 'VAT_CONFIG_ERROR: The VAT recorded on this night shift summary (%) does not match branch "%" configured VAT rate of %%% on net sales of % (expected %). Posting is blocked until the summary or the branch VAT rate is corrected.',
      ROUND(COALESCE(v_summary.vat_amount, 0), 2), v_branch_name, ROUND(v_rate, 2), ROUND(COALESCE(v_summary.net_sales, 0), 2), v_expected
      USING HINT = 'Re-check the shift totals, or update the branch VAT rate in Settings > Branches.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_daily_sales_to_ledger(p_sales_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sales RECORD;
  v_batch_id uuid;
  v_branch_id uuid;
  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_card_clearing_id uuid;
  v_ar_account_id uuid;
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
  SELECT * INTO v_sales FROM daily_sales_summary WHERE id = p_sales_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales record not found';
  END IF;
  IF v_sales.ledger_posted THEN
    RAISE EXCEPTION 'Sales already posted to ledger';
  END IF;

  v_branch_id := v_sales.branch_id;

  IF v_branch_id IS NULL THEN
    SELECT b.id INTO v_branch_id
    FROM branches b
    WHERE b.tenant_id = v_sales.tenant_id
      AND COALESCE(b.is_active, true) = true
    ORDER BY COALESCE(b.is_primary, false) DESC, b.created_at ASC
    LIMIT 1;
  END IF;

  SELECT id INTO v_cash_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
  SELECT id INTO v_bank_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1010' AND is_active = true LIMIT 1;
  SELECT id INTO v_card_clearing_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1015' AND is_active = true LIMIT 1;
  SELECT id INTO v_ar_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1100' AND is_active = true LIMIT 1;
  SELECT id INTO v_revenue_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '4000' AND is_active = true LIMIT 1;
  SELECT id INTO v_delivery_revenue_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '4100' AND is_active = true LIMIT 1;
  SELECT id INTO v_vat_payable_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '2200' AND is_active = true LIMIT 1;

  IF v_delivery_revenue_id IS NULL THEN
    v_delivery_revenue_id := v_revenue_account_id;
  END IF;
  IF v_card_clearing_id IS NULL THEN
    v_card_clearing_id := v_bank_account_id;
  END IF;

  IF v_cash_account_id IS NULL OR v_bank_account_id IS NULL OR v_revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts not configured for tenant';
  END IF;

  -- Output VAT: recorded sales figures are the VAT-inclusive amounts the
  -- guests paid, so the tax portion is backed out and parked in 2200
  -- VAT Payable (liability) until it is remitted. The branch VAT rate must be
  -- explicitly configured and valid — posting is blocked otherwise.
  v_rate := public.assert_branch_vat_rate_configured(v_branch_id, 'closing this sales day') / 100.0;
  IF v_vat_payable_id IS NULL AND v_rate > 0 THEN
    RAISE EXCEPTION 'VAT_CONFIG_ERROR: This branch charges %%% VAT but account 2200 (VAT Payable) is missing or inactive in the chart of accounts, so output VAT cannot be recorded.', ROUND(v_rate * 100, 2)
      USING HINT = 'Add or reactivate account 2200 VAT Payable in Accounting > Chart of Accounts.';
  END IF;

  v_std_gross := COALESCE(v_sales.cash_sales,0) + COALESCE(v_sales.card_sales,0) + COALESCE(v_sales.other_sales,0);
  v_del_gross := COALESCE(v_sales.delivery_sales,0);

  v_std_net := ROUND(v_std_gross / (1 + v_rate), 2);
  v_std_vat := ROUND(v_std_gross - v_std_net, 2);
  v_del_net := ROUND(v_del_gross / (1 + v_rate), 2);
  v_del_vat := ROUND(v_del_gross - v_del_net, 2);

  INSERT INTO journal_entry_batches (
    tenant_id, branch_id, description, batch_date, created_by, entry_type, journal_type,
    is_posted, posted_at, posted_by
  )
  VALUES (
    v_sales.tenant_id,
    v_branch_id,
    'Daily Sales - ' || v_sales.sales_date::text,
    v_sales.sales_date,
    v_sales.created_by,
    'adjustment',
    'adjustment',
    true,
    now(),
    v_sales.created_by
  )
  RETURNING id INTO v_batch_id;

  IF v_sales.cash_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_branch_id, v_cash_account_id, v_sales.sales_date, v_sales.cash_sales, 'Cash Sales - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_sales.card_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_branch_id, v_card_clearing_id, v_sales.sales_date, v_sales.card_sales, 'Card Sales (awaiting settlement) - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_sales.delivery_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_branch_id, v_ar_account_id, v_sales.sales_date, v_sales.delivery_sales, 'Delivery Sales Receivable - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_sales.other_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_branch_id, v_cash_account_id, v_sales.sales_date, v_sales.other_sales, 'Other Sales - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_std_gross > 0 THEN
    INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, credit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_branch_id, v_revenue_account_id, v_sales.sales_date,
            v_std_net,
            'Sales Revenue (net of VAT) - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_del_gross > 0 THEN
    INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, credit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_branch_id, v_delivery_revenue_id, v_sales.sales_date, v_del_net,
            'Delivery Revenue (net of VAT) - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_vat_payable_id IS NOT NULL AND (v_std_vat + v_del_vat) > 0 THEN
    INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, credit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_branch_id, v_vat_payable_id, v_sales.sales_date, v_std_vat + v_del_vat,
            'Output VAT on sales - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  UPDATE daily_sales_summary
  SET ledger_posted = true,
      ledger_posted_at = now(),
      ledger_batch_id = v_batch_id
  WHERE id = p_sales_id;

  RETURN v_batch_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_night_summary_to_ledger(p_summary_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_summary record;
  v_batch_id uuid;
  v_cash_account_id uuid;
  v_card_account_id uuid;
  v_revenue_account_id uuid;
  v_vat_account_id uuid;
BEGIN
  -- Get summary details
  SELECT * INTO v_summary FROM night_shift_summaries WHERE id = p_summary_id;

  IF v_summary IS NULL THEN
    RAISE EXCEPTION 'Night shift summary not found';
  END IF;

  IF v_summary.ledger_posted THEN
    RAISE EXCEPTION 'Summary already posted to ledger';
  END IF;

  -- Branch VAT rate must exist and agree with the VAT recorded on the summary
  PERFORM public.assert_night_summary_vat_consistent(p_summary_id);

  -- Get account IDs
  SELECT id INTO v_cash_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '1000' LIMIT 1;
  
  SELECT id INTO v_card_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '1020' LIMIT 1;
  
  SELECT id INTO v_revenue_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '4000' LIMIT 1;
  
  SELECT id INTO v_vat_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '2200' LIMIT 1;
  
  -- Create journal batch
  INSERT INTO journal_entry_batches (
    tenant_id, description, journal_type, reference_type, reference_id, status
  ) VALUES (
    v_summary.tenant_id,
    'Night Shift Summary - ' || v_summary.business_date,
    'sale',
    'night_summary',
    p_summary_id,
    'posted'
  ) RETURNING id INTO v_batch_id;
  
  -- Dr Cash
  IF v_summary.cash_collected > 0 AND v_cash_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, debit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_cash_account_id, v_batch_id, v_summary.business_date,
      v_summary.cash_collected, 'Night summary cash', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Dr Card Clearing
  IF v_summary.card_collected > 0 AND v_card_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, debit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_card_account_id, v_batch_id, v_summary.business_date,
      v_summary.card_collected, 'Night summary card', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Cr Revenue
  IF v_summary.net_sales > 0 AND v_revenue_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, credit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_revenue_account_id, v_batch_id, v_summary.business_date,
      v_summary.net_sales, 'Night summary revenue', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Cr VAT (if applicable)
  IF v_summary.vat_amount > 0 AND v_vat_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, credit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_vat_account_id, v_batch_id, v_summary.business_date,
      v_summary.vat_amount, 'Night summary VAT', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Mark as posted
  UPDATE night_shift_summaries 
  SET ledger_posted = true, ledger_batch_id = v_batch_id
  WHERE id = p_summary_id;
  
  RETURN v_batch_id;
END;
$function$;