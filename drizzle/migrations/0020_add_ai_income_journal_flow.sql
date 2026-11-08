ALTER TABLE public.daily_sales_summary
ADD COLUMN IF NOT EXISTS ai_revenue_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT;

CREATE TABLE public.ai_income_journal_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('daily_sales', 'customer_receipt')),
  source_id uuid NOT NULL,
  selected_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  confidence numeric(5,4),
  classification text,
  rationale text,
  model text NOT NULL,
  prompt_version text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('posted', 'blocked', 'failed')),
  error_message text,
  ledger_batch_id uuid REFERENCES public.journal_entry_batches(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_income_journal_confidence_range CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

GRANT SELECT ON public.ai_income_journal_audit TO authenticated;
GRANT ALL ON public.ai_income_journal_audit TO service_role;

ALTER TABLE public.ai_income_journal_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles can read AI income journal audit"
ON public.ai_income_journal_audit
FOR SELECT TO authenticated
USING (
  public.is_superadmin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_tenant_roles utr
    WHERE utr.user_id = auth.uid()
      AND utr.tenant_id = ai_income_journal_audit.tenant_id
      AND utr.role IN ('owner', 'manager', 'accountant')
  )
);

CREATE INDEX idx_ai_income_journal_audit_source
ON public.ai_income_journal_audit(source_type, source_id, created_at DESC);
CREATE INDEX idx_ai_income_journal_audit_tenant
ON public.ai_income_journal_audit(tenant_id, created_at DESC);

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

  v_std_gross := COALESCE(v_sales.cash_sales,0)+COALESCE(v_sales.card_sales,0)+COALESCE(v_sales.other_sales,0);
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
  IF v_std_gross>0 THEN INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,credit,description,reference_type,reference_id,batch_id,created_by) VALUES (v_sales.tenant_id,v_branch_id,v_revenue_account_id,v_sales.sales_date,v_std_net,'Sales Revenue (net of VAT) - '||v_sales.sales_date,'sale',p_sales_id,v_batch_id,COALESCE(v_actor,v_sales.created_by)); END IF;
  IF v_del_gross>0 THEN INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,credit,description,reference_type,reference_id,batch_id,created_by) VALUES (v_sales.tenant_id,v_branch_id,v_delivery_revenue_id,v_sales.sales_date,v_del_net,'Delivery Revenue (net of VAT) - '||v_sales.sales_date,'sale',p_sales_id,v_batch_id,COALESCE(v_actor,v_sales.created_by)); END IF;
  IF v_vat_payable_id IS NOT NULL AND (v_std_vat+v_del_vat)>0 THEN INSERT INTO public.account_transactions (tenant_id,branch_id,account_id,transaction_date,credit,description,reference_type,reference_id,batch_id,created_by) VALUES (v_sales.tenant_id,v_branch_id,v_vat_payable_id,v_sales.sales_date,v_std_vat+v_del_vat,'Output VAT on sales - '||v_sales.sales_date,'sale',p_sales_id,v_batch_id,COALESCE(v_actor,v_sales.created_by)); END IF;

  UPDATE public.daily_sales_summary SET ledger_posted=true,ledger_posted_at=now(),ledger_batch_id=v_batch_id WHERE id=p_sales_id;
  RETURN v_batch_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_ai_income_account_and_post(p_sales_id uuid,p_account_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sales record; v_account record; v_actor uuid:=auth.uid(); v_batch uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: Sign in is required'; END IF;
  SELECT * INTO v_sales FROM public.daily_sales_summary WHERE id=p_sales_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Sales day not found'; END IF;
  IF COALESCE(v_sales.ledger_posted,false) THEN RAISE EXCEPTION 'VALIDATION_ERROR: Sales already posted'; END IF;
  IF v_sales.status NOT IN ('closed','approved') THEN RAISE EXCEPTION 'VALIDATION_ERROR: Sales day must be closed'; END IF;
  IF NOT (public.is_superadmin(v_actor) OR (public.can_access_restaurant(v_sales.restaurant_id) AND EXISTS (SELECT 1 FROM public.user_tenant_roles utr WHERE utr.user_id=v_actor AND utr.tenant_id=v_sales.tenant_id AND utr.role IN ('owner','manager','accountant')))) THEN RAISE EXCEPTION 'FORBIDDEN: Finance role and restaurant access are required'; END IF;
  SELECT id,tenant_id,account_type,is_active INTO v_account FROM public.chart_of_accounts WHERE id=p_account_id;
  IF NOT FOUND OR v_account.tenant_id<>v_sales.tenant_id OR NOT v_account.is_active OR v_account.account_type<>'revenue' THEN RAISE EXCEPTION 'VALIDATION_ERROR: Select an active revenue account for this tenant'; END IF;
  IF EXISTS (SELECT 1 FROM public.account_branch_visibility WHERE account_id=p_account_id) AND NOT EXISTS (SELECT 1 FROM public.account_branch_visibility WHERE account_id=p_account_id AND branch_id=v_sales.branch_id) THEN RAISE EXCEPTION 'VALIDATION_ERROR: Revenue account is not available for this branch'; END IF;
  UPDATE public.daily_sales_summary SET ai_revenue_account_id=p_account_id WHERE id=p_sales_id;
  v_batch:=public.post_daily_sales_to_ledger(p_sales_id);
  RETURN v_batch;
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_ai_income_account_and_post(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ai_income_account_and_post(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ai_income_account_and_post(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.post_settlement_to_ledger(p_payment_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  SELECT id INTO v_ar FROM public.chart_of_accounts WHERE tenant_id=v_restaurant.tenant_id AND account_code='1100' AND is_active LIMIT 1;
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
REVOKE ALL ON FUNCTION public.post_settlement_to_ledger(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_settlement_to_ledger(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_settlement_to_ledger(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_post_customer_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.post_settlement_to_ledger(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_auto_post_customer_receipt ON public.settlement_payments;
CREATE TRIGGER trg_auto_post_customer_receipt
AFTER INSERT ON public.settlement_payments
FOR EACH ROW EXECUTE FUNCTION public.auto_post_customer_receipt();