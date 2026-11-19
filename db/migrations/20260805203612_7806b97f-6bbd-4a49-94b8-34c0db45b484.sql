CREATE OR REPLACE FUNCTION public.update_installment_plan_details(
  p_plan_id uuid,
  p_invoice_url text DEFAULT NULL,
  p_clear_invoice boolean DEFAULT false,
  p_asset_class_id uuid DEFAULT NULL,
  p_asset_tag text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_class public.fixed_asset_classes%ROWTYPE;
  v_asset public.fixed_assets%ROWTYPE;
  v_net numeric(15,2);
  v_new_asset uuid;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND';
  END IF;

  IF NOT public.can_manage_capital(v_plan.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can edit installment purchases';
  END IF;

  -- invoice attachment
  IF p_clear_invoice THEN
    UPDATE public.installment_plans SET invoice_url = NULL, updated_at = now() WHERE id = p_plan_id;
  ELSIF p_invoice_url IS NOT NULL THEN
    UPDATE public.installment_plans SET invoice_url = p_invoice_url, updated_at = now() WHERE id = p_plan_id;
  END IF;

  -- nothing else to do when the asset class is unchanged
  IF p_asset_class_id IS NOT DISTINCT FROM v_plan.asset_class_id THEN
    IF p_asset_class_id IS NOT NULL AND p_asset_tag IS NOT NULL AND v_plan.asset_id IS NOT NULL THEN
      UPDATE public.fixed_assets SET asset_tag = p_asset_tag, updated_at = now() WHERE id = v_plan.asset_id;
    END IF;
    RETURN p_plan_id;
  END IF;

  IF v_plan.asset_id IS NOT NULL THEN
    SELECT * INTO v_asset FROM public.fixed_assets WHERE id = v_plan.asset_id;
    IF FOUND THEN
      IF v_asset.status <> 'active' THEN
        RAISE EXCEPTION 'ASSET_NOT_EDITABLE: the linked asset has been disposed and can no longer be reclassified';
      END IF;
      IF EXISTS (SELECT 1 FROM public.fixed_asset_depreciation WHERE asset_id = v_asset.id) THEN
        RAISE EXCEPTION 'DEPRECIATION_POSTED: depreciation has already been recorded for this asset; reverse it before changing the asset class';
      END IF;
    END IF;
  END IF;

  -- removing the asset class entirely
  IF p_asset_class_id IS NULL THEN
    IF v_plan.asset_id IS NOT NULL THEN
      DELETE FROM public.fixed_assets WHERE id = v_plan.asset_id;
    END IF;
    UPDATE public.installment_plans
    SET asset_class_id = NULL, asset_id = NULL, updated_at = now()
    WHERE id = p_plan_id;
    RETURN p_plan_id;
  END IF;

  SELECT * INTO v_class FROM public.fixed_asset_classes
  WHERE id = p_asset_class_id AND tenant_id = v_plan.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_ASSET_CLASS';
  END IF;

  v_net := ROUND(v_plan.cash_price - COALESCE(v_plan.vat_amount, 0), 2);

  IF v_plan.asset_id IS NOT NULL AND v_asset.id IS NOT NULL THEN
    UPDATE public.fixed_assets
    SET class_id = p_asset_class_id,
        asset_tag = COALESCE(p_asset_tag, asset_tag),
        salvage_value = ROUND(v_net * COALESCE(v_class.salvage_rate_pct, 0) / 100.0, 2),
        useful_life_months = COALESCE(v_class.useful_life_months, 60),
        asset_account_id = COALESCE(v_class.asset_account_id, v_plan.target_account_id),
        accum_dep_account_id = v_class.accum_dep_account_id,
        dep_expense_account_id = v_class.dep_expense_account_id,
        depreciation_method = COALESCE(v_class.depreciation_method, 'straight_line'),
        updated_at = now()
    WHERE id = v_plan.asset_id;

    UPDATE public.installment_plans
    SET asset_class_id = p_asset_class_id, updated_at = now()
    WHERE id = p_plan_id;
    RETURN p_plan_id;
  END IF;

  INSERT INTO public.fixed_assets
    (tenant_id, branch_id, class_id, asset_tag, name, description, supplier_name,
     acquisition_date, in_service_date, cost, vat_amount, salvage_value, useful_life_months,
     accumulated_depreciation, status, asset_account_id, accum_dep_account_id, dep_expense_account_id,
     funding_source, source, source_reference_id, batch_id, depreciation_method, notes, created_by)
  VALUES
    (v_plan.tenant_id, v_plan.branch_id, p_asset_class_id, p_asset_tag, v_plan.description,
     'Installment purchase - ' || v_plan.description, v_plan.supplier_name,
     v_plan.purchase_date, v_plan.purchase_date, v_net, COALESCE(v_plan.vat_amount, 0),
     ROUND(v_net * COALESCE(v_class.salvage_rate_pct, 0) / 100.0, 2),
     COALESCE(v_class.useful_life_months, 60), 0, 'active',
     COALESCE(v_class.asset_account_id, v_plan.target_account_id),
     v_class.accum_dep_account_id, v_class.dep_expense_account_id,
     'company', 'installment', v_plan.id, v_plan.batch_id,
     COALESCE(v_class.depreciation_method, 'straight_line'),
     'Acquired on an installment plan (' || v_plan.provider || ')', auth.uid())
  RETURNING id INTO v_new_asset;

  UPDATE public.installment_plans
  SET asset_class_id = p_asset_class_id, asset_id = v_new_asset, updated_at = now()
  WHERE id = p_plan_id;

  RETURN p_plan_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_installment_plan_details(uuid, text, boolean, uuid, text) TO authenticated;