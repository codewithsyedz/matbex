CREATE OR REPLACE FUNCTION public.update_installment_plan_details(
  p_plan_id uuid,
  p_invoice_url text DEFAULT NULL,
  p_asset_class_id uuid DEFAULT NULL,
  p_asset_tag text DEFAULT NULL,
  p_clear_invoice boolean DEFAULT false,
  p_clear_asset_class boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_class public.fixed_asset_classes%ROWTYPE;
  v_net numeric(15,2);
  v_asset uuid;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND';
  END IF;
  IF NOT public.can_manage_capital(v_plan.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can edit installment purchases';
  END IF;

  UPDATE public.installment_plans
  SET invoice_url = CASE WHEN p_clear_invoice THEN NULL
                         WHEN p_invoice_url IS NOT NULL THEN p_invoice_url
                         ELSE invoice_url END,
      asset_class_id = CASE WHEN p_clear_asset_class THEN NULL
                            WHEN p_asset_class_id IS NOT NULL THEN p_asset_class_id
                            ELSE asset_class_id END
  WHERE id = p_plan_id;

  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan_id;

  IF v_plan.asset_class_id IS NULL THEN
    IF v_plan.invoice_url IS NOT NULL AND v_plan.asset_id IS NOT NULL THEN
      UPDATE public.fixed_assets SET updated_at = now() WHERE id = v_plan.asset_id;
    END IF;
    RETURN v_plan.asset_id;
  END IF;

  SELECT * INTO v_class FROM public.fixed_asset_classes
  WHERE id = v_plan.asset_class_id AND tenant_id = v_plan.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_ASSET_CLASS';
  END IF;

  -- cash_price is already stored NET of VAT by create_installment_plan.
  -- Subtracting vat_amount here would remove VAT twice and desync the
  -- register from the ledger debit, so use the stored net directly.
  v_net := ROUND(v_plan.cash_price, 2);

  IF v_plan.asset_id IS NOT NULL THEN
    UPDATE public.fixed_assets
    SET class_id = v_plan.asset_class_id,
        asset_tag = COALESCE(p_asset_tag, asset_tag),
        cost = v_net,
        vat_amount = COALESCE(v_plan.vat_amount, 0),
        salvage_value = ROUND(v_net * COALESCE(v_class.salvage_rate_pct, 0) / 100.0, 2),
        useful_life_months = COALESCE(v_class.useful_life_months, useful_life_months),
        depreciation_method = COALESCE(v_class.depreciation_method, depreciation_method),
        asset_account_id = COALESCE(v_class.asset_account_id, asset_account_id),
        accum_dep_account_id = COALESCE(v_class.accum_dep_account_id, accum_dep_account_id),
        dep_expense_account_id = COALESCE(v_class.dep_expense_account_id, dep_expense_account_id),
        updated_at = now()
    WHERE id = v_plan.asset_id;
    RETURN v_plan.asset_id;
  END IF;

  INSERT INTO public.fixed_assets
    (tenant_id, branch_id, class_id, asset_tag, name, description, supplier_name,
     acquisition_date, in_service_date, cost, vat_amount, salvage_value, useful_life_months,
     accumulated_depreciation, status, asset_account_id, accum_dep_account_id, dep_expense_account_id,
     funding_source, source, source_reference_id, batch_id, depreciation_method, notes, created_by)
  VALUES
    (v_plan.tenant_id, v_plan.branch_id, v_plan.asset_class_id, p_asset_tag, v_plan.description,
     'Installment purchase - ' || v_plan.description, v_plan.supplier_name,
     v_plan.purchase_date, v_plan.purchase_date, v_net, COALESCE(v_plan.vat_amount, 0),
     ROUND(v_net * COALESCE(v_class.salvage_rate_pct, 0) / 100.0, 2),
     COALESCE(v_class.useful_life_months, 60), 0, 'active',
     COALESCE(v_class.asset_account_id, v_plan.target_account_id),
     v_class.accum_dep_account_id, v_class.dep_expense_account_id,
     'company', 'installment', v_plan.id, v_plan.batch_id,
     COALESCE(v_class.depreciation_method, 'straight_line'),
     'Acquired on an installment plan (' || v_plan.provider || ')', auth.uid())
  RETURNING id INTO v_asset;

  UPDATE public.installment_plans SET asset_id = v_asset WHERE id = p_plan_id;
  RETURN v_asset;
END;
$function$;

-- Repair assets whose cost had VAT deducted twice
UPDATE public.fixed_assets fa
SET cost = ROUND(p.cash_price, 2),
    vat_amount = COALESCE(p.vat_amount, 0),
    salvage_value = ROUND(ROUND(p.cash_price, 2) * COALESCE(c.salvage_rate_pct, 0) / 100.0, 2),
    updated_at = now()
FROM public.installment_plans p
LEFT JOIN public.fixed_asset_classes c ON c.id = p.asset_class_id
WHERE fa.id = p.asset_id
  AND fa.source = 'installment'
  AND fa.accumulated_depreciation = 0
  AND fa.status = 'active'
  AND ROUND(fa.cost, 2) = ROUND(p.cash_price - COALESCE(p.vat_amount, 0), 2)
  AND COALESCE(p.vat_amount, 0) > 0;

-- The refrigerator plan totals were computed VAT-exclusive; align the flag
UPDATE public.installment_plans
SET price_includes_vat = false
WHERE id = 'b1f71c58-8112-40c2-ba71-278052e803c2'
  AND ROUND(total_payable, 2) = ROUND(cash_price + COALESCE(vat_amount, 0) + COALESCE(finance_charge, 0) + COALESCE(finance_vat_amount, 0), 2);