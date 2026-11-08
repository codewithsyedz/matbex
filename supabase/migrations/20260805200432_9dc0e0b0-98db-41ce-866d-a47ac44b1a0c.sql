ALTER TABLE public.installment_plans
  ADD COLUMN IF NOT EXISTS invoice_url text,
  ADD COLUMN IF NOT EXISTS asset_class_id uuid REFERENCES public.fixed_asset_classes(id),
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.fixed_assets(id);

CREATE OR REPLACE FUNCTION public.create_installment_plan(
  p_tenant_id uuid,
  p_description text,
  p_target_account_id uuid,
  p_cash_price numeric,
  p_installment_count integer,
  p_first_due_date date,
  p_provider text DEFAULT 'tabby',
  p_supplier_name text DEFAULT NULL,
  p_purchase_date date DEFAULT CURRENT_DATE,
  p_finance_charge numeric DEFAULT 0,
  p_frequency text DEFAULT 'monthly',
  p_branch_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_vat_rate numeric DEFAULT 0,
  p_price_includes_vat boolean DEFAULT false,
  p_vat_on_finance_charge boolean DEFAULT false,
  p_invoice_url text DEFAULT NULL,
  p_asset_class_id uuid DEFAULT NULL,
  p_asset_tag text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch uuid := p_branch_id;
  v_liability uuid;
  v_finance uuid;
  v_vat_acc uuid;
  v_rate numeric := COALESCE(p_vat_rate, 0) / 100.0;
  v_net numeric(15,2);
  v_vat numeric(15,2);
  v_fee numeric(15,2) := ROUND(COALESCE(p_finance_charge, 0), 2);
  v_fee_vat numeric(15,2) := 0;
  v_total numeric(15,2);
  v_plan uuid;
  v_batch uuid;
  v_desc text;
  v_i integer;
  v_base numeric(15,2);
  v_last numeric(15,2);
  v_due date;
  v_interval interval;
  v_class fixed_asset_classes%ROWTYPE;
  v_asset uuid;
BEGIN
  IF NOT public.can_manage_capital(p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can record installment purchases';
  END IF;

  IF COALESCE(p_cash_price, 0) <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: cash price must be greater than zero';
  END IF;
  IF COALESCE(p_installment_count, 0) < 1 THEN
    RAISE EXCEPTION 'INVALID_COUNT: at least one installment is required';
  END IF;
  IF p_frequency NOT IN ('weekly', 'biweekly', 'monthly') THEN
    RAISE EXCEPTION 'INVALID_FREQUENCY';
  END IF;
  IF COALESCE(p_vat_rate, 0) < 0 OR COALESCE(p_vat_rate, 0) > 100 THEN
    RAISE EXCEPTION 'INVALID_VAT_RATE: VAT rate must be between 0 and 100';
  END IF;

  PERFORM public.ensure_installment_accounts(p_tenant_id);
  v_liability := public.get_account_id_by_code(p_tenant_id, '2450');
  v_finance := public.get_account_id_by_code(p_tenant_id, '6850');
  v_vat_acc := public.get_account_id_by_code(p_tenant_id, '1180');

  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                 WHERE id = p_target_account_id AND tenant_id = p_tenant_id AND is_active) THEN
    RAISE EXCEPTION 'INVALID_TARGET_ACCOUNT';
  END IF;

  IF v_branch IS NULL THEN
    SELECT b.id INTO v_branch
    FROM public.branches b
    JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE r.tenant_id = p_tenant_id AND b.is_active AND b.deleted_at IS NULL
    ORDER BY b.is_primary DESC, b.created_at
    LIMIT 1;
  END IF;

  IF p_asset_class_id IS NOT NULL THEN
    SELECT * INTO v_class FROM public.fixed_asset_classes
    WHERE id = p_asset_class_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_ASSET_CLASS';
    END IF;
  END IF;

  -- VAT split on the goods value
  IF v_rate > 0 AND COALESCE(p_price_includes_vat, false) THEN
    v_net := ROUND(p_cash_price / (1 + v_rate), 2);
    v_vat := ROUND(p_cash_price - v_net, 2);
  ELSIF v_rate > 0 THEN
    v_net := ROUND(p_cash_price, 2);
    v_vat := ROUND(p_cash_price * v_rate, 2);
  ELSE
    v_net := ROUND(p_cash_price, 2);
    v_vat := 0;
  END IF;

  IF v_rate > 0 AND COALESCE(p_vat_on_finance_charge, false) AND v_fee > 0 THEN
    IF COALESCE(p_price_includes_vat, false) THEN
      v_fee_vat := ROUND(v_fee - (v_fee / (1 + v_rate)), 2);
      v_fee := ROUND(v_fee - v_fee_vat, 2);
    ELSE
      v_fee_vat := ROUND(v_fee * v_rate, 2);
    END IF;
  END IF;

  v_total := ROUND(v_net + v_vat + v_fee + v_fee_vat, 2);

  v_desc := 'Installment purchase - ' || p_description ||
            CASE WHEN p_supplier_name IS NOT NULL THEN ' (' || p_supplier_name || ')' ELSE '' END;

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
  VALUES
    (p_tenant_id, p_purchase_date, v_desc, 'INST-' || to_char(now(), 'YYYYMMDDHH24MISS'),
     'adjustment', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), v_branch)
  RETURNING id INTO v_batch;

  INSERT INTO public.installment_plans
    (tenant_id, branch_id, provider, supplier_name, description, purchase_date,
     target_account_id, liability_account_id, finance_account_id, cash_price, finance_charge,
     total_payable, installment_count, first_due_date, frequency, notes, batch_id, created_by,
     vat_rate, vat_amount, finance_vat_amount, price_includes_vat, vat_on_finance_charge, vat_account_id,
     invoice_url, asset_class_id)
  VALUES
    (p_tenant_id, v_branch, p_provider, p_supplier_name, p_description, p_purchase_date,
     p_target_account_id, v_liability, v_finance, v_net, v_fee,
     v_total, p_installment_count, p_first_due_date, p_frequency, p_notes, v_batch, auth.uid(),
     COALESCE(p_vat_rate, 0), v_vat, v_fee_vat, COALESCE(p_price_includes_vat, false),
     COALESCE(p_vat_on_finance_charge, false), CASE WHEN (v_vat + v_fee_vat) > 0 THEN v_vat_acc END,
     p_invoice_url, p_asset_class_id)
  RETURNING id INTO v_plan;

  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description,
     reference_type, reference_id, created_by, batch_id, branch_id)
  VALUES
    (p_tenant_id, p_target_account_id, p_purchase_date, v_net, 0, v_desc,
     'installment_plan', v_plan, auth.uid(), v_batch, v_branch);

  IF (v_vat + v_fee_vat) > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (p_tenant_id, v_vat_acc, p_purchase_date, ROUND(v_vat + v_fee_vat, 2), 0,
       v_desc || ' - input VAT @ ' || COALESCE(p_vat_rate, 0)::text || '%',
       'installment_plan', v_plan, auth.uid(), v_batch, v_branch);
  END IF;

  IF v_fee > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (p_tenant_id, v_finance, p_purchase_date, v_fee, 0,
       v_desc || ' - finance charge', 'installment_plan', v_plan, auth.uid(), v_batch, v_branch);
  END IF;

  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description,
     reference_type, reference_id, created_by, batch_id, branch_id)
  VALUES
    (p_tenant_id, v_liability, p_purchase_date, 0, v_total, v_desc,
     'installment_plan', v_plan, auth.uid(), v_batch, v_branch);

  -- Register the purchase in the fixed asset register (ledger debit already posted above)
  IF p_asset_class_id IS NOT NULL THEN
    INSERT INTO public.fixed_assets
      (tenant_id, branch_id, class_id, asset_tag, name, description, supplier_name,
       acquisition_date, in_service_date, cost, vat_amount, salvage_value, useful_life_months,
       accumulated_depreciation, status, asset_account_id, accum_dep_account_id, dep_expense_account_id,
       funding_source, source, source_reference_id, batch_id, depreciation_method, notes, created_by)
    VALUES
      (p_tenant_id, v_branch, p_asset_class_id, p_asset_tag, p_description,
       v_desc, p_supplier_name, p_purchase_date, p_purchase_date, v_net, v_vat,
       ROUND(v_net * COALESCE(v_class.salvage_rate_pct, 0) / 100.0, 2),
       COALESCE(v_class.useful_life_months, 60), 0, 'active',
       COALESCE(v_class.asset_account_id, p_target_account_id),
       v_class.accum_dep_account_id, v_class.dep_expense_account_id,
       'company', 'installment', v_plan, v_batch,
       COALESCE(v_class.depreciation_method, 'straight_line'),
       'Acquired on an installment plan (' || p_provider || ')', auth.uid())
    RETURNING id INTO v_asset;

    UPDATE public.installment_plans SET asset_id = v_asset WHERE id = v_plan;
  END IF;

  v_base := ROUND(v_total / p_installment_count, 2);
  v_last := ROUND(v_total - (v_base * (p_installment_count - 1)), 2);
  v_interval := CASE p_frequency
                  WHEN 'weekly' THEN interval '7 days'
                  WHEN 'biweekly' THEN interval '14 days'
                  ELSE interval '1 month' END;

  FOR v_i IN 1..p_installment_count LOOP
    v_due := (p_first_due_date + (v_interval * (v_i - 1)))::date;
    INSERT INTO public.installment_payments
      (tenant_id, plan_id, branch_id, installment_no, due_date, amount)
    VALUES
      (p_tenant_id, v_plan, v_branch, v_i, v_due,
       CASE WHEN v_i = p_installment_count THEN v_last ELSE v_base END);
  END LOOP;

  RETURN v_plan;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_installment_plan(uuid, text, uuid, numeric, integer, date, text, text, date, numeric, text, uuid, text, numeric, boolean, boolean, text, uuid, text) TO authenticated;