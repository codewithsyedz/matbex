-- ============================================================
-- Fixed Asset Register
-- ============================================================

-- 1. Settings ------------------------------------------------
CREATE TABLE public.fixed_asset_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  capitalization_threshold numeric(15,2) NOT NULL DEFAULT 1500,
  auto_expense_below_threshold boolean NOT NULL DEFAULT true,
  default_useful_life_months integer NOT NULL DEFAULT 60,
  default_expense_account_id uuid REFERENCES public.chart_of_accounts(id),
  depreciation_method text NOT NULL DEFAULT 'straight_line',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_settings_threshold_chk CHECK (capitalization_threshold >= 0),
  CONSTRAINT fixed_asset_settings_life_chk CHECK (default_useful_life_months BETWEEN 1 AND 600),
  CONSTRAINT fixed_asset_settings_method_chk CHECK (depreciation_method IN ('straight_line'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_asset_settings TO authenticated;
GRANT ALL ON public.fixed_asset_settings TO service_role;
ALTER TABLE public.fixed_asset_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view asset settings"
  ON public.fixed_asset_settings FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.user_belongs_to_tenant(auth.uid(), tenant_id));
CREATE POLICY "Finance roles can manage asset settings"
  ON public.fixed_asset_settings FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id))
  WITH CHECK (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id));

CREATE TRIGGER update_fixed_asset_settings_updated_at
  BEFORE UPDATE ON public.fixed_asset_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Asset classes -------------------------------------------
CREATE TABLE public.fixed_asset_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  asset_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  accum_dep_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  dep_expense_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  useful_life_months integer NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_classes_code_uq UNIQUE (tenant_id, code),
  CONSTRAINT fixed_asset_classes_life_chk CHECK (useful_life_months BETWEEN 1 AND 600)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_asset_classes TO authenticated;
GRANT ALL ON public.fixed_asset_classes TO service_role;
ALTER TABLE public.fixed_asset_classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view asset classes"
  ON public.fixed_asset_classes FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.user_belongs_to_tenant(auth.uid(), tenant_id));
CREATE POLICY "Finance roles can manage asset classes"
  ON public.fixed_asset_classes FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id))
  WITH CHECK (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id));

CREATE TRIGGER update_fixed_asset_classes_updated_at
  BEFORE UPDATE ON public.fixed_asset_classes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Assets ---------------------------------------------------
CREATE TABLE public.fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id),
  class_id uuid REFERENCES public.fixed_asset_classes(id),
  asset_tag text,
  name text NOT NULL,
  description text,
  supplier_name text,
  acquisition_date date NOT NULL DEFAULT CURRENT_DATE,
  in_service_date date NOT NULL DEFAULT CURRENT_DATE,
  cost numeric(15,2) NOT NULL,
  vat_amount numeric(15,2) NOT NULL DEFAULT 0,
  salvage_value numeric(15,2) NOT NULL DEFAULT 0,
  useful_life_months integer NOT NULL DEFAULT 60,
  accumulated_depreciation numeric(15,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  asset_account_id uuid REFERENCES public.chart_of_accounts(id),
  accum_dep_account_id uuid REFERENCES public.chart_of_accounts(id),
  dep_expense_account_id uuid REFERENCES public.chart_of_accounts(id),
  funding_source text NOT NULL DEFAULT 'company',
  payment_account_id uuid REFERENCES public.chart_of_accounts(id),
  capital_account_id uuid,
  source text NOT NULL DEFAULT 'manual',
  source_reference_id uuid,
  batch_id uuid,
  disposal_date date,
  disposal_proceeds numeric(15,2),
  disposal_batch_id uuid,
  disposal_notes text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_assets_cost_chk CHECK (cost > 0),
  CONSTRAINT fixed_assets_salvage_chk CHECK (salvage_value >= 0 AND salvage_value < cost),
  CONSTRAINT fixed_assets_life_chk CHECK (useful_life_months BETWEEN 1 AND 600),
  CONSTRAINT fixed_assets_status_chk CHECK (status IN ('active','fully_depreciated','disposed')),
  CONSTRAINT fixed_assets_funding_chk CHECK (funding_source IN ('company','partner','credit','installment')),
  CONSTRAINT fixed_assets_source_chk CHECK (source IN ('manual','expense','installment'))
);

CREATE INDEX idx_fixed_assets_tenant ON public.fixed_assets(tenant_id, status);
CREATE INDEX idx_fixed_assets_branch ON public.fixed_assets(branch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_assets TO authenticated;
GRANT ALL ON public.fixed_assets TO service_role;
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles can view assets"
  ON public.fixed_assets FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id));
CREATE POLICY "Finance roles can manage assets"
  ON public.fixed_assets FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id))
  WITH CHECK (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id));

CREATE TRIGGER update_fixed_assets_updated_at
  BEFORE UPDATE ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Depreciation history -------------------------------------
CREATE TABLE public.fixed_asset_depreciation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id),
  period_month date NOT NULL,
  amount numeric(15,2) NOT NULL,
  batch_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_dep_uq UNIQUE (asset_id, period_month)
);

CREATE INDEX idx_fixed_asset_dep_tenant_period ON public.fixed_asset_depreciation(tenant_id, period_month);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_asset_depreciation TO authenticated;
GRANT ALL ON public.fixed_asset_depreciation TO service_role;
ALTER TABLE public.fixed_asset_depreciation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles can view depreciation"
  ON public.fixed_asset_depreciation FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id));
CREATE POLICY "Finance roles can manage depreciation"
  ON public.fixed_asset_depreciation FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id))
  WITH CHECK (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id));

-- 5. Account + class provisioning ------------------------------
CREATE OR REPLACE FUNCTION public.ensure_fixed_asset_accounts(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_expense uuid;
BEGIN
  INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
  VALUES
    (_tenant_id, '1500', 'Kitchen Equipment', 'asset', 'Capitalized kitchen equipment', true),
    (_tenant_id, '1510', 'Furniture & Fixtures', 'asset', 'Capitalized furniture and fixtures', true),
    (_tenant_id, '1520', 'POS & Technology Equipment', 'asset', 'Capitalized POS and IT hardware', true),
    (_tenant_id, '1530', 'Vehicles', 'asset', 'Capitalized vehicles', true),
    (_tenant_id, '1540', 'Leasehold Improvements', 'asset', 'Capitalized fit-out and improvements', true),
    (_tenant_id, '1600', 'Accumulated Depreciation - Equipment', 'asset', 'Contra-asset', true),
    (_tenant_id, '1610', 'Accumulated Depreciation - Furniture', 'asset', 'Contra-asset', true),
    (_tenant_id, '1620', 'Accumulated Depreciation - Vehicles', 'asset', 'Contra-asset', true),
    (_tenant_id, '1630', 'Accumulated Depreciation - Leasehold', 'asset', 'Contra-asset', true),
    (_tenant_id, '1640', 'Accumulated Depreciation - Technology', 'asset', 'Contra-asset', true),
    (_tenant_id, '6700', 'Depreciation - Kitchen Equipment', 'expense', 'Monthly depreciation charge', true),
    (_tenant_id, '6710', 'Depreciation - Furniture & Fixtures', 'expense', 'Monthly depreciation charge', true),
    (_tenant_id, '6720', 'Depreciation - Vehicles', 'expense', 'Monthly depreciation charge', true),
    (_tenant_id, '6730', 'Amortization - Leasehold Improvements', 'expense', 'Monthly amortization charge', true),
    (_tenant_id, '6740', 'Depreciation - POS & Technology', 'expense', 'Monthly depreciation charge', true),
    (_tenant_id, '6240', 'Kitchen Smallwares', 'expense', 'Below-threshold equipment expensed on purchase', true),
    (_tenant_id, '6960', 'Loss on Disposal of Assets', 'expense', 'Net book value written off on disposal', true),
    (_tenant_id, '4900', 'Gain on Disposal of Assets', 'revenue', 'Proceeds above net book value', true)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  -- default asset classes
  INSERT INTO public.fixed_asset_classes (tenant_id, code, name, asset_account_id, accum_dep_account_id, dep_expense_account_id, useful_life_months)
  VALUES
    (_tenant_id, 'kitchen_equipment', 'Kitchen Equipment',
      public.get_account_id_by_code(_tenant_id, '1500'), public.get_account_id_by_code(_tenant_id, '1600'), public.get_account_id_by_code(_tenant_id, '6700'), 84),
    (_tenant_id, 'furniture', 'Furniture & Fixtures',
      public.get_account_id_by_code(_tenant_id, '1510'), public.get_account_id_by_code(_tenant_id, '1610'), public.get_account_id_by_code(_tenant_id, '6710'), 60),
    (_tenant_id, 'technology', 'POS & Technology',
      public.get_account_id_by_code(_tenant_id, '1520'), public.get_account_id_by_code(_tenant_id, '1640'), public.get_account_id_by_code(_tenant_id, '6740'), 36),
    (_tenant_id, 'vehicles', 'Vehicles',
      public.get_account_id_by_code(_tenant_id, '1530'), public.get_account_id_by_code(_tenant_id, '1620'), public.get_account_id_by_code(_tenant_id, '6720'), 60),
    (_tenant_id, 'leasehold', 'Leasehold Improvements',
      public.get_account_id_by_code(_tenant_id, '1540'), public.get_account_id_by_code(_tenant_id, '1630'), public.get_account_id_by_code(_tenant_id, '6730'), 60)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  v_expense := public.get_account_id_by_code(_tenant_id, '6240');
  INSERT INTO public.fixed_asset_settings (tenant_id, default_expense_account_id)
  VALUES (_tenant_id, v_expense)
  ON CONFLICT (tenant_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_fixed_asset_accounts(uuid) TO authenticated;

-- 6. Record an equipment purchase -------------------------------
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
  p_salvage_value numeric DEFAULT 0,
  p_vat_rate numeric DEFAULT 0,
  p_price_includes_vat boolean DEFAULT false,
  p_asset_tag text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_force_capitalize boolean DEFAULT false,
  p_force_expense boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  -- VAT split (VAT is never capitalized when recoverable)
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

  -- capitalization decision
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
    END IF;
    IF v_class.id IS NULL THEN
      SELECT * INTO v_class FROM public.fixed_asset_classes
      WHERE tenant_id = p_tenant_id AND code = 'kitchen_equipment';
    END IF;
    IF v_class.id IS NULL THEN
      RAISE EXCEPTION 'NO_ASSET_CLASS: configure at least one asset class first';
    END IF;
    v_debit_acc := v_class.asset_account_id;
    v_life := COALESCE(p_useful_life_months, v_class.useful_life_months, v_set.default_useful_life_months, 60);
  ELSE
    v_debit_acc := COALESCE(p_expense_account_id, v_set.default_expense_account_id,
                            public.get_account_id_by_code(p_tenant_id, '6240'));
    IF v_debit_acc IS NULL THEN
      RAISE EXCEPTION 'NO_EXPENSE_ACCOUNT: set a default expense account for below-threshold purchases';
    END IF;
    v_life := NULL;
  END IF;

  -- funding / credit side
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
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
  VALUES
    (p_tenant_id, p_purchase_date, v_desc, 'FA-' || to_char(now(), 'YYYYMMDDHH24MISS'),
     'purchase', 'purchase', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), v_branch)
  RETURNING id INTO v_batch;

  IF v_capitalize THEN
    INSERT INTO public.fixed_assets
      (tenant_id, branch_id, class_id, asset_tag, name, supplier_name, acquisition_date, in_service_date,
       cost, vat_amount, salvage_value, useful_life_months, asset_account_id, accum_dep_account_id,
       dep_expense_account_id, funding_source, payment_account_id, capital_account_id, batch_id, notes, created_by)
    VALUES
      (p_tenant_id, v_branch, v_class.id, p_asset_tag, p_name, p_supplier_name, p_purchase_date, p_purchase_date,
       v_net, v_vat, LEAST(COALESCE(p_salvage_value, 0), GREATEST(v_net - 0.01, 0)), v_life,
       v_class.asset_account_id, v_class.accum_dep_account_id, v_class.dep_expense_account_id,
       p_funding_source, CASE WHEN p_funding_source = 'company' THEN v_credit_acc ELSE NULL END,
       p_capital_account_id, v_batch, p_notes, auth.uid())
    RETURNING id INTO v_asset;
  END IF;

  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description,
     reference_type, reference_id, created_by, batch_id, branch_id)
  VALUES
    (p_tenant_id, v_debit_acc, p_purchase_date, v_net, 0, v_desc,
     'fixed_asset', COALESCE(v_asset, v_batch), auth.uid(), v_batch, v_branch);

  IF v_vat > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (p_tenant_id, v_vat_acc, p_purchase_date, v_vat, 0, v_desc || ' - input VAT',
       'fixed_asset', COALESCE(v_asset, v_batch), auth.uid(), v_batch, v_branch);
  END IF;

  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description,
     reference_type, reference_id, created_by, batch_id, branch_id)
  VALUES
    (p_tenant_id, v_credit_acc, p_purchase_date, 0, ROUND(v_net + v_vat, 2), v_desc,
     'fixed_asset', COALESCE(v_asset, v_batch), auth.uid(), v_batch, v_branch);

  RETURN jsonb_build_object(
    'decision', CASE WHEN v_capitalize THEN 'capitalized' ELSE 'expensed' END,
    'asset_id', v_asset,
    'batch_id', v_batch,
    'net_amount', v_net,
    'vat_amount', v_vat,
    'threshold', COALESCE(v_set.capitalization_threshold, 1500)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_equipment_purchase(uuid, text, numeric, uuid, uuid, date, text, text, uuid, uuid, uuid, integer, numeric, numeric, boolean, text, text, boolean, boolean) TO authenticated;

-- 7. Monthly depreciation ---------------------------------------
CREATE OR REPLACE FUNCTION public.post_monthly_depreciation(
  p_tenant_id uuid,
  p_period_month date,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period date := date_trunc('month', p_period_month)::date;
  v_period_end date := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  v_a record;
  v_batch uuid;
  v_monthly numeric(15,2);
  v_remaining numeric(15,2);
  v_total numeric(15,2) := 0;
  v_count integer := 0;
BEGIN
  IF NOT public.can_manage_capital(p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can post depreciation';
  END IF;

  FOR v_a IN
    SELECT * FROM public.fixed_assets
    WHERE tenant_id = p_tenant_id
      AND status = 'active'
      AND in_service_date <= v_period_end
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.fixed_asset_depreciation d
        WHERE d.asset_id = fixed_assets.id AND d.period_month = v_period
      )
    ORDER BY acquisition_date
  LOOP
    v_monthly := ROUND((v_a.cost - v_a.salvage_value) / GREATEST(v_a.useful_life_months, 1), 2);
    v_remaining := ROUND(v_a.cost - v_a.salvage_value - v_a.accumulated_depreciation, 2);
    IF v_remaining <= 0 THEN
      UPDATE public.fixed_assets SET status = 'fully_depreciated' WHERE id = v_a.id;
      CONTINUE;
    END IF;
    IF v_monthly > v_remaining THEN v_monthly := v_remaining; END IF;
    IF v_monthly <= 0 THEN CONTINUE; END IF;

    IF v_batch IS NULL THEN
      INSERT INTO public.journal_entry_batches
        (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
         created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
      VALUES
        (p_tenant_id, v_period_end, 'Monthly depreciation - ' || to_char(v_period, 'Mon YYYY'),
         'DEP-' || to_char(v_period, 'YYYYMM'), 'adjustment', 'adjustment', auth.uid(), true, now(), auth.uid(),
         'approved', auth.uid(), now(), p_branch_id)
      RETURNING id INTO v_batch;
    END IF;

    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (p_tenant_id, v_a.dep_expense_account_id, v_period_end, v_monthly, 0,
       'Depreciation - ' || v_a.name, 'fixed_asset', v_a.id, auth.uid(), v_batch, v_a.branch_id),
      (p_tenant_id, v_a.accum_dep_account_id, v_period_end, 0, v_monthly,
       'Depreciation - ' || v_a.name, 'fixed_asset', v_a.id, auth.uid(), v_batch, v_a.branch_id);

    INSERT INTO public.fixed_asset_depreciation
      (tenant_id, asset_id, branch_id, period_month, amount, batch_id, created_by)
    VALUES (p_tenant_id, v_a.id, v_a.branch_id, v_period, v_monthly, v_batch, auth.uid());

    UPDATE public.fixed_assets
    SET accumulated_depreciation = ROUND(accumulated_depreciation + v_monthly, 2),
        status = CASE WHEN ROUND(cost - salvage_value - accumulated_depreciation - v_monthly, 2) <= 0
                      THEN 'fully_depreciated' ELSE status END
    WHERE id = v_a.id;

    v_total := v_total + v_monthly;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('period', v_period, 'assets', v_count, 'amount', v_total, 'batch_id', v_batch);
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_monthly_depreciation(uuid, date, uuid) TO authenticated;

-- 8. Disposal ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispose_fixed_asset(
  p_asset_id uuid,
  p_disposal_date date,
  p_proceeds numeric DEFAULT 0,
  p_proceeds_account_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_a public.fixed_assets%ROWTYPE;
  v_batch uuid;
  v_nbv numeric(15,2);
  v_proceeds numeric(15,2) := ROUND(COALESCE(p_proceeds, 0), 2);
  v_cash uuid;
  v_result numeric(15,2);
  v_desc text;
BEGIN
  SELECT * INTO v_a FROM public.fixed_assets WHERE id = p_asset_id;
  IF v_a.id IS NULL THEN RAISE EXCEPTION 'ASSET_NOT_FOUND'; END IF;
  IF NOT public.can_manage_capital(v_a.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can dispose assets';
  END IF;
  IF v_a.status = 'disposed' THEN RAISE EXCEPTION 'ALREADY_DISPOSED'; END IF;

  PERFORM public.ensure_fixed_asset_accounts(v_a.tenant_id);
  v_nbv := ROUND(v_a.cost - v_a.accumulated_depreciation, 2);
  v_result := ROUND(v_proceeds - v_nbv, 2); -- >0 gain, <0 loss
  v_desc := 'Asset disposal - ' || v_a.name;

  IF v_proceeds > 0 THEN
    v_cash := COALESCE(p_proceeds_account_id, public.get_account_id_by_code(v_a.tenant_id, '1000'));
    IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                   WHERE id = v_cash AND tenant_id = v_a.tenant_id AND is_active) THEN
      RAISE EXCEPTION 'INVALID_PROCEEDS_ACCOUNT';
    END IF;
  END IF;

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
  VALUES
    (v_a.tenant_id, p_disposal_date, v_desc, 'FAD-' || to_char(now(), 'YYYYMMDDHH24MISS'),
     'adjustment', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), v_a.branch_id)
  RETURNING id INTO v_batch;

  -- DR accumulated depreciation
  IF v_a.accumulated_depreciation > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES (v_a.tenant_id, v_a.accum_dep_account_id, p_disposal_date, v_a.accumulated_depreciation, 0,
            v_desc || ' - accumulated depreciation', 'fixed_asset', v_a.id, auth.uid(), v_batch, v_a.branch_id);
  END IF;

  -- DR proceeds
  IF v_proceeds > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES (v_a.tenant_id, v_cash, p_disposal_date, v_proceeds, 0,
            v_desc || ' - proceeds', 'fixed_asset', v_a.id, auth.uid(), v_batch, v_a.branch_id);
  END IF;

  -- loss / gain
  IF v_result < 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES (v_a.tenant_id, public.get_account_id_by_code(v_a.tenant_id, '6960'), p_disposal_date, ABS(v_result), 0,
            v_desc || ' - loss on disposal', 'fixed_asset', v_a.id, auth.uid(), v_batch, v_a.branch_id);
  ELSIF v_result > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES (v_a.tenant_id, public.get_account_id_by_code(v_a.tenant_id, '4900'), p_disposal_date, 0, v_result,
            v_desc || ' - gain on disposal', 'fixed_asset', v_a.id, auth.uid(), v_batch, v_a.branch_id);
  END IF;

  -- CR asset cost
  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description,
     reference_type, reference_id, created_by, batch_id, branch_id)
  VALUES (v_a.tenant_id, v_a.asset_account_id, p_disposal_date, 0, v_a.cost,
          v_desc || ' - cost removed', 'fixed_asset', v_a.id, auth.uid(), v_batch, v_a.branch_id);

  UPDATE public.fixed_assets
  SET status = 'disposed', disposal_date = p_disposal_date, disposal_proceeds = v_proceeds,
      disposal_batch_id = v_batch, disposal_notes = p_notes
  WHERE id = v_a.id;

  RETURN jsonb_build_object('asset_id', v_a.id, 'batch_id', v_batch, 'net_book_value', v_nbv,
                            'proceeds', v_proceeds, 'gain_loss', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset(uuid, date, numeric, uuid, text) TO authenticated;