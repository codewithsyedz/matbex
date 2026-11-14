-- delivery_revenue_account_and_channel_pnl
--
-- 1. End of Day credited delivery revenue to code 4100, which is "Beverage Sales" in every
--    production chart (9,193.05 SAR on the production copy); the delivery revenue account is
--    4020 "Food Sales - Delivery". Past days are corrected at cutover by a draft journal
--    (server/scripts/cutover-ledger-fixes.mjs, CUTOVER-DLV-REV).
--
-- 2. Delivery-app orders arriving through the integration (online_orders, channel hungerstation/
--    jahez/mrsool/talabat) posted to the ledger on their own, with codes that mean something else
--    in production (2150 Payroll Payable, 4010 Takeaway Sales, 6300 Marketing), without VAT, and
--    again on top of End of Day, which already records delivery sales (DR 1100 / CR revenue + VAT).
--    The commission was booked at order time and again at payout. Now: End of Day is the one
--    place delivery sales are posted, payouts clear 1100 and book the commission
--    (post_aggregator_settlement_reconciled). The order trigger and its account seeder are removed;
--    no integration is enabled anywhere, so nothing was ever posted by it.
--
-- 3. v_channel_profitability read those codes, ran as its owner (no row security) and was
--    readable by logged-out users. It now reports each platform's payouts from the ledger
--    (gross cleared from 1100, commission, net paid in), as the caller (security_invoker).

CREATE OR REPLACE FUNCTION public.delivery_revenue_account(p_tenant_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT id FROM chart_of_accounts
  WHERE tenant_id = p_tenant_id AND is_active AND account_type = 'revenue'
    AND (account_code = '4020'
         OR (account_name ILIKE '%deliver%' AND account_name NOT ILIKE '%fee%' AND account_name NOT ILIKE '%commission%'))
  ORDER BY (account_code = '4020') DESC, account_code
  LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.delivery_revenue_account(uuid) FROM PUBLIC, anon, authenticated;

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
  v_delivery_revenue_id := public.delivery_revenue_account(v_sales.tenant_id);
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
$function$

;

DROP TRIGGER IF EXISTS trg_post_aggregator_order_paid ON public.online_orders;
DROP FUNCTION IF EXISTS public.post_aggregator_order_paid();
DROP FUNCTION IF EXISTS public.ensure_aggregator_accounts(uuid);

DROP VIEW IF EXISTS public.v_channel_profitability;
CREATE VIEW public.v_channel_profitability WITH (security_invoker = true) AS
SELECT t.tenant_id,
       t.channel,
       t.transaction_date,
       sum(t.credit) FILTER (WHERE coa.account_type = 'asset')                 AS gross,       -- cleared from 1100
       sum(t.debit - t.credit) FILTER (WHERE coa.account_type = 'expense')     AS commission,
       sum(t.debit) FILTER (WHERE coa.account_type = 'asset')                  AS net          -- paid into the bank
FROM account_transactions t
JOIN chart_of_accounts coa ON coa.id = t.account_id
WHERE t.reference_type = 'aggregator_settlement' AND NOT COALESCE(t.is_voided, false) AND t.channel IS NOT NULL
GROUP BY t.tenant_id, t.channel, t.transaction_date;
REVOKE ALL ON public.v_channel_profitability FROM PUBLIC, anon;
GRANT SELECT ON public.v_channel_profitability TO authenticated, service_role;
