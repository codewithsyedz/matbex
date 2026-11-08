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
  -- VAT Payable (liability) until it is remitted.
  IF v_vat_payable_id IS NOT NULL THEN
    SELECT COALESCE(b.vat_rate, 0) / 100.0 INTO v_rate
    FROM branches b WHERE b.id = v_branch_id;
    v_rate := COALESCE(v_rate, 0);
    IF v_rate < 0 OR v_rate >= 1 THEN v_rate := 0; END IF;
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