CREATE OR REPLACE FUNCTION public.post_daily_sales_to_ledger(p_sales_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sales RECORD;
  v_batch_id uuid;
  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_ar_account_id uuid;
  v_revenue_account_id uuid;
  v_delivery_revenue_id uuid;
BEGIN
  SELECT * INTO v_sales FROM daily_sales_summary WHERE id = p_sales_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales record not found';
  END IF;
  IF v_sales.ledger_posted THEN
    RAISE EXCEPTION 'Sales already posted to ledger';
  END IF;

  SELECT id INTO v_cash_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
  SELECT id INTO v_bank_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1010' AND is_active = true LIMIT 1;
  SELECT id INTO v_ar_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1100' AND is_active = true LIMIT 1;
  SELECT id INTO v_revenue_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '4000' AND is_active = true LIMIT 1;
  SELECT id INTO v_delivery_revenue_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '4100' AND is_active = true LIMIT 1;

  IF v_delivery_revenue_id IS NULL THEN
    v_delivery_revenue_id := v_revenue_account_id;
  END IF;

  IF v_cash_account_id IS NULL OR v_bank_account_id IS NULL OR v_revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts not configured for tenant';
  END IF;

  INSERT INTO journal_entry_batches (
    tenant_id, description, batch_date, created_by, entry_type, journal_type,
    is_posted, posted_at, posted_by
  )
  VALUES (
    v_sales.tenant_id,
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
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_cash_account_id, v_sales.sales_date, v_sales.cash_sales, 'Cash Sales - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_sales.card_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_bank_account_id, v_sales.sales_date, v_sales.card_sales, 'Card Sales - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_sales.delivery_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_ar_account_id, v_sales.sales_date, v_sales.delivery_sales, 'Delivery Sales Receivable - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_sales.other_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_cash_account_id, v_sales.sales_date, v_sales.other_sales, 'Other Sales - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF (v_sales.cash_sales + v_sales.card_sales + v_sales.other_sales) > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_revenue_account_id, v_sales.sales_date,
            v_sales.cash_sales + v_sales.card_sales + v_sales.other_sales,
            'Sales Revenue - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_sales.delivery_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_delivery_revenue_id, v_sales.sales_date, v_sales.delivery_sales,
            'Delivery Revenue - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  UPDATE daily_sales_summary
  SET ledger_posted = true,
      ledger_posted_at = now(),
      ledger_batch_id = v_batch_id
  WHERE id = p_sales_id;

  RETURN v_batch_id;
END;
$function$;