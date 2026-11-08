CREATE OR REPLACE FUNCTION public.record_equipment_purchase(
  p_tenant_id uuid,
  p_name text,
  p_cost numeric,
  p_class_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_purchase_date date DEFAULT CURRENT_DATE,
  p_supplier_name text DEFAULT NULL,
  p_funding_source text DEFAULT 'company',
  p_payment_account_id uuid DEFAULT NULL,
  p_capital_account_id uuid DEFAULT NULL,
  p_expense_account_id uuid DEFAULT NULL,
  p_useful_life_months integer DEFAULT NULL,
  p_salvage_value numeric DEFAULT NULL,
  p_vat_rate numeric DEFAULT 0,
  p_price_includes_vat boolean DEFAULT false,
  p_asset_tag text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_force_capitalize boolean DEFAULT false,
  p_force_expense boolean DEFAULT false,
  p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid := p_branch_id;
  v_set public.fixed_asset_settings%ROWTYPE;
  v_class public.fixed_asset_classes%ROWTYPE;
  v_rate numeric := COALESCE(p_vat_rate, 0) / 100.0;
  v_gross numeric(15,2) := ROUND(COALESCE(p_cost, 0), 2);
  v_net numeric(15,2);
  v_vat numeric(15,2);
  v_vat_acc uuid;
  v_credit_acc uuid;
  v_debit_acc uuid;
  v_capitalize boolean;
  v_batch uuid;
  v_asset uuid;
  v_desc text;
  v_life integer;
  v_salvage numeric(15,2);
  v_project uuid := p_project_id;
BEGIN
  IF NOT public.can_manage_capital(p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can record equipment purchases';
  END IF;
  IF v_gross <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: cost must be greater than zero';
  END IF;
  IF p_funding_source NOT IN ('company','partner','credit') THEN
    RAISE EXCEPTION 'INVALID_FUNDING_SOURCE';
  END IF;
  IF COALESCE(p_vat_rate, 0) < 0 OR COALESCE(p_vat_rate, 0) > 100 THEN
    RAISE EXCEPTION 'INVALID_VAT_RATE';
  END IF;
  IF v_project IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = v_project AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'INVALID_PROJECT';
  END IF;

  PERFORM public.ensure_fixed_asset_accounts(p_tenant_id);
  PERFORM public.ensure_installment_accounts(p_tenant_id);
  SELECT * INTO v_set FROM public.fixed_asset_settings WHERE tenant_id = p_tenant_id;
  v_vat_acc := public.get_account_id_by_code(p_tenant_id, '1180');

  IF v_branch IS NULL THEN
    SELECT b.id INTO v_branch
    FROM public.branches b
    JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE r.tenant_id = p_tenant_id AND b.is_active AND b.deleted_at IS NULL
    ORDER BY b.is_primary DESC, b.created_at
    LIMIT 1;
  END IF;

  IF v_rate > 0 AND COALESCE(p_price_includes_vat, false) THEN
    v_net := ROUND(v_gross / (1 + v_rate), 2);
    v_vat := ROUND(v_gross - v_net, 2);
  ELSIF v_rate > 0 THEN
    v_net := v_gross;
    v_vat := ROUND(v_gross * v_rate, 2);
  ELSE
    v_net := v_gross;
    v_vat := 0;
  END IF;

  IF p_force_expense THEN
    v_capitalize := false;
  ELSIF p_force_capitalize THEN
    v_capitalize := true;
  ELSIF NOT COALESCE(v_set.auto_expense_below_threshold, true) THEN
    v_capitalize := true;
  ELSE
    v_capitalize := v_net >= COALESCE(v_set.capitalization_threshold, 1500);
  END IF;

  IF v_capitalize THEN
    IF p_class_id IS NOT NULL THEN
      SELECT * INTO v_class FROM public.fixed_asset_classes
      WHERE id = p_class_id AND tenant_id = p_tenant_id AND is_active;

      IF v_class.id IS NOT NULL AND v_class.branch_id IS NULL AND v_branch IS NOT NULL THEN
        SELECT * INTO v_class FROM public.fixed_asset_classes
        WHERE tenant_id = p_tenant_id AND branch_id = v_branch AND code = v_class.code AND is_active
        UNION ALL
        SELECT * FROM public.fixed_asset_classes WHERE id = p_class_id
        LIMIT 1;
      END IF;
    END IF;
    IF v_class.id IS NULL THEN
      SELECT * INTO v_class FROM public.fixed_asset_classes
      WHERE id = public.resolve_asset_class(p_tenant_id, v_branch, 'kitchen_equipment');
    END IF;
    IF v_class.id IS NULL THEN
      RAISE EXCEPTION 'NO_ASSET_CLASS: configure at least one asset class first';
    END IF;
    v_debit_acc := v_class.asset_account_id;
    v_life := COALESCE(p_useful_life_months, v_class.useful_life_months, v_set.default_useful_life_months, 60);
    v_salvage := COALESCE(p_salvage_value, ROUND(v_net * COALESCE(v_class.salvage_rate_pct, 0) / 100.0, 2), 0);
    v_salvage := LEAST(GREATEST(v_salvage, 0), GREATEST(v_net - 0.01, 0));
  ELSE
    v_debit_acc := COALESCE(p_expense_account_id, v_set.default_expense_account_id,
                            public.get_account_id_by_code(p_tenant_id, '6240'));
    IF v_debit_acc IS NULL THEN
      RAISE EXCEPTION 'NO_EXPENSE_ACCOUNT: set a default expense account for below-threshold purchases';
    END IF;
    v_life := NULL;
    v_salvage := 0;
  END IF;

  IF p_funding_source = 'partner' THEN
    IF p_capital_account_id IS NULL THEN
      RAISE EXCEPTION 'CAPITAL_ACCOUNT_REQUIRED: choose the partner account funding this purchase';
    END IF;
    SELECT equity_account_id INTO v_credit_acc
    FROM public.owner_capital_accounts
    WHERE id = p_capital_account_id AND tenant_id = p_tenant_id;
    IF v_credit_acc IS NULL THEN
      RAISE EXCEPTION 'INVALID_CAPITAL_ACCOUNT';
    END IF;
  ELSIF p_funding_source = 'credit' THEN
    v_credit_acc := public.get_account_id_by_code(p_tenant_id, '2000');
    IF v_credit_acc IS NULL THEN
      RAISE EXCEPTION 'NO_AP_ACCOUNT: accounts payable account is missing';
    END IF;
  ELSE
    v_credit_acc := COALESCE(p_payment_account_id, public.get_account_id_by_code(p_tenant_id, '1000'));
    IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                   WHERE id = v_credit_acc AND tenant_id = p_tenant_id AND is_active) THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_ACCOUNT';
    END IF;
  END IF;

  v_desc := CASE WHEN v_capitalize THEN 'Equipment purchase (capitalized) - ' ELSE 'Equipment purchase (expensed) - ' END
            || p_name
            || CASE WHEN p_supplier_name IS NOT NULL THEN ' (' || p_supplier_name || ')' ELSE '' END;

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id, project_id)
  VALUES
    (p_tenant_id, p_purchase_date, v_desc, 'FA-' || to_char(now(), 'YYYYMMDDHH24MISS'),
     'purchase', 'purchase', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), v_branch, v_project)
  RETURNING id INTO v_batch;

  IF v_capitalize THEN
    INSERT INTO public.fixed_assets
      (tenant_id, branch_id, class_id, asset_tag, name, supplier_name, acquisition_date, in_service_date,
       cost, vat_amount, salvage_value, useful_life_months, depreciation_method, asset_account_id, accum_dep_account_id,
       dep_expense_account_id, funding_source, payment_account_id, capital_account_id, batch_id, notes, created_by,
       project_id)
    VALUES
      (p_tenant_id, v_branch, v_class.id, p_asset_tag, p_name, p_supplier_name, p_purchase_date, p_purchase_date,
       v_net, v_vat, v_salvage, v_life, COALESCE(v_class.depreciation_method, 'straight_line'),
       v_class.asset_account_id, v_class.accum_dep_account_id, v_class.dep_expense_account_id,
       p_funding_source, CASE WHEN p_funding_source = 'company' THEN v_credit_acc ELSE NULL END,
       p_capital_account_id, v_batch, p_notes, auth.uid(), v_project)
    RETURNING id INTO v_asset;
  END IF;

  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description,
     reference_type, reference_id, created_by, batch_id, branch_id, project_id)
  VALUES
    (p_tenant_id, v_debit_acc, p_purchase_date, v_net, 0, v_desc,
     'fixed_asset', COALESCE(v_asset, v_batch), auth.uid(), v_batch, v_branch, v_project);

  IF v_vat > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id, project_id)
    VALUES
      (p_tenant_id, v_vat_acc, p_purchase_date, v_vat, 0, v_desc || ' - input VAT',
       'fixed_asset', COALESCE(v_asset, v_batch), auth.uid(), v_batch, v_branch, v_project);
  END IF;

  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description,
     reference_type, reference_id, created_by, batch_id, branch_id, project_id)
  VALUES
    (p_tenant_id, v_credit_acc, p_purchase_date, 0, ROUND(v_net + v_vat, 2), v_desc,
     'fixed_asset', COALESCE(v_asset, v_batch), auth.uid(), v_batch, v_branch, v_project);

  RETURN jsonb_build_object(
    'decision', CASE WHEN v_capitalize THEN 'capitalized' ELSE 'expensed' END,
    'asset_id', v_asset,
    'batch_id', v_batch,
    'net_amount', v_net,
    'vat_amount', v_vat,
    'project_id', v_project,
    'threshold', COALESCE(v_set.capitalization_threshold, 1500)
  );
END;
$$;
