-- 1. Extend asset classes with template metadata + branch scoping
ALTER TABLE public.fixed_asset_classes
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS depreciation_method text NOT NULL DEFAULT 'straight_line',
  ADD COLUMN IF NOT EXISTS salvage_rate_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.fixed_asset_classes
    ADD CONSTRAINT fixed_asset_classes_method_chk
    CHECK (depreciation_method IN ('straight_line','reducing_balance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.fixed_asset_classes
    ADD CONSTRAINT fixed_asset_classes_salvage_chk
    CHECK (salvage_rate_pct >= 0 AND salvage_rate_pct < 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.fixed_asset_classes DROP CONSTRAINT IF EXISTS fixed_asset_classes_code_uq;
CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_classes_scope_uq
  ON public.fixed_asset_classes (tenant_id, code, branch_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_fixed_asset_classes_branch
  ON public.fixed_asset_classes (tenant_id, branch_id);

UPDATE public.fixed_asset_classes SET template_key = code WHERE template_key IS NULL;

-- 2. Assets remember which method they depreciate on
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS depreciation_method text NOT NULL DEFAULT 'straight_line';

DO $$ BEGIN
  ALTER TABLE public.fixed_assets
    ADD CONSTRAINT fixed_assets_method_chk
    CHECK (depreciation_method IN ('straight_line','reducing_balance'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Seed / refresh the tenant-level templates
CREATE OR REPLACE FUNCTION public.ensure_fixed_asset_accounts(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  INSERT INTO public.fixed_asset_classes
    (tenant_id, branch_id, code, template_key, name, description, asset_account_id, accum_dep_account_id,
     dep_expense_account_id, useful_life_months, depreciation_method, salvage_rate_pct, sort_order)
  VALUES
    (_tenant_id, NULL, 'kitchen_equipment', 'kitchen_equipment', 'Kitchen Equipment',
      'Ovens, fryers, refrigeration, prep and cooking equipment',
      public.get_account_id_by_code(_tenant_id, '1500'), public.get_account_id_by_code(_tenant_id, '1600'),
      public.get_account_id_by_code(_tenant_id, '6700'), 84, 'straight_line', 5, 10),
    (_tenant_id, NULL, 'furniture', 'furniture', 'Furniture & Fixtures',
      'Dining tables, chairs, counters, shelving and light fixtures',
      public.get_account_id_by_code(_tenant_id, '1510'), public.get_account_id_by_code(_tenant_id, '1610'),
      public.get_account_id_by_code(_tenant_id, '6710'), 60, 'straight_line', 0, 20),
    (_tenant_id, NULL, 'technology', 'technology', 'POS & Technology',
      'POS terminals, tablets, printers, networking and IT hardware',
      public.get_account_id_by_code(_tenant_id, '1520'), public.get_account_id_by_code(_tenant_id, '1640'),
      public.get_account_id_by_code(_tenant_id, '6740'), 36, 'reducing_balance', 0, 30),
    (_tenant_id, NULL, 'leasehold', 'leasehold', 'Fit-out & Leasehold Improvements',
      'Branch fit-out, partitions, flooring and improvements to leased premises',
      public.get_account_id_by_code(_tenant_id, '1540'), public.get_account_id_by_code(_tenant_id, '1630'),
      public.get_account_id_by_code(_tenant_id, '6730'), 60, 'straight_line', 0, 40),
    (_tenant_id, NULL, 'vehicles', 'vehicles', 'Vehicles',
      'Delivery bikes, cars and vans',
      public.get_account_id_by_code(_tenant_id, '1530'), public.get_account_id_by_code(_tenant_id, '1620'),
      public.get_account_id_by_code(_tenant_id, '6720'), 60, 'straight_line', 10, 50)
  ON CONFLICT (tenant_id, code, branch_id) DO NOTHING;

  v_expense := public.get_account_id_by_code(_tenant_id, '6240');
  INSERT INTO public.fixed_asset_settings (tenant_id, default_expense_account_id)
  VALUES (_tenant_id, v_expense)
  ON CONFLICT (tenant_id) DO NOTHING;
END;
$function$;

-- 4. Copy tenant templates into a branch so they can be customized there
CREATE OR REPLACE FUNCTION public.copy_asset_classes_to_branch(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_class_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_copied integer := 0;
  v_skipped integer := 0;
BEGIN
  IF NOT public.can_manage_capital(p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can manage asset classes';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'BRANCH_REQUIRED: choose the branch to copy templates into';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE b.id = p_branch_id AND r.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'INVALID_BRANCH';
  END IF;

  PERFORM public.ensure_fixed_asset_accounts(p_tenant_id);

  SELECT count(*) INTO v_skipped
  FROM public.fixed_asset_classes src
  WHERE src.tenant_id = p_tenant_id AND src.branch_id IS NULL
    AND (p_class_ids IS NULL OR src.id = ANY(p_class_ids))
    AND EXISTS (
      SELECT 1 FROM public.fixed_asset_classes dst
      WHERE dst.tenant_id = p_tenant_id AND dst.branch_id = p_branch_id AND dst.code = src.code
    );

  WITH ins AS (
    INSERT INTO public.fixed_asset_classes
      (tenant_id, branch_id, code, template_key, name, description, asset_account_id, accum_dep_account_id,
       dep_expense_account_id, useful_life_months, depreciation_method, salvage_rate_pct, sort_order, is_active)
    SELECT src.tenant_id, p_branch_id, src.code, COALESCE(src.template_key, src.code), src.name, src.description,
           src.asset_account_id, src.accum_dep_account_id, src.dep_expense_account_id,
           src.useful_life_months, src.depreciation_method, src.salvage_rate_pct, src.sort_order, src.is_active
    FROM public.fixed_asset_classes src
    WHERE src.tenant_id = p_tenant_id AND src.branch_id IS NULL
      AND (p_class_ids IS NULL OR src.id = ANY(p_class_ids))
    ON CONFLICT (tenant_id, code, branch_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_copied FROM ins;

  RETURN jsonb_build_object('copied', v_copied, 'skipped', v_skipped, 'branch_id', p_branch_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.copy_asset_classes_to_branch(uuid, uuid, uuid[]) TO authenticated;

-- 5. Resolve the effective class for a branch (branch override wins)
CREATE OR REPLACE FUNCTION public.resolve_asset_class(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_code text
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id FROM public.fixed_asset_classes
  WHERE tenant_id = p_tenant_id AND code = p_code AND is_active
    AND (branch_id = p_branch_id OR branch_id IS NULL)
  ORDER BY (branch_id IS NOT NULL) DESC
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_asset_class(uuid, uuid, text) TO authenticated;

-- 6. Purchases honour the branch-level class, its method and salvage default
CREATE OR REPLACE FUNCTION public.record_equipment_purchase(p_tenant_id uuid, p_name text, p_cost numeric, p_class_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_purchase_date date DEFAULT CURRENT_DATE, p_supplier_name text DEFAULT NULL::text, p_funding_source text DEFAULT 'company'::text, p_payment_account_id uuid DEFAULT NULL::uuid, p_capital_account_id uuid DEFAULT NULL::uuid, p_expense_account_id uuid DEFAULT NULL::uuid, p_useful_life_months integer DEFAULT NULL::integer, p_salvage_value numeric DEFAULT NULL::numeric, p_vat_rate numeric DEFAULT 0, p_price_includes_vat boolean DEFAULT false, p_asset_tag text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_force_capitalize boolean DEFAULT false, p_force_expense boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

      -- prefer the branch-specific version of the same class template
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
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
  VALUES
    (p_tenant_id, p_purchase_date, v_desc, 'FA-' || to_char(now(), 'YYYYMMDDHH24MISS'),
     'purchase', 'purchase', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), v_branch)
  RETURNING id INTO v_batch;

  IF v_capitalize THEN
    INSERT INTO public.fixed_assets
      (tenant_id, branch_id, class_id, asset_tag, name, supplier_name, acquisition_date, in_service_date,
       cost, vat_amount, salvage_value, useful_life_months, depreciation_method, asset_account_id, accum_dep_account_id,
       dep_expense_account_id, funding_source, payment_account_id, capital_account_id, batch_id, notes, created_by)
    VALUES
      (p_tenant_id, v_branch, v_class.id, p_asset_tag, p_name, p_supplier_name, p_purchase_date, p_purchase_date,
       v_net, v_vat, v_salvage, v_life, COALESCE(v_class.depreciation_method, 'straight_line'),
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
$function$;

-- 7. Depreciation engine supports reducing balance
CREATE OR REPLACE FUNCTION public.post_monthly_depreciation_internal(p_tenant_id uuid, p_period_month date, p_branch_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    v_remaining := ROUND(v_a.cost - v_a.salvage_value - v_a.accumulated_depreciation, 2);
    IF v_remaining <= 0 THEN
      UPDATE public.fixed_assets SET status = 'fully_depreciated' WHERE id = v_a.id;
      CONTINUE;
    END IF;

    IF COALESCE(v_a.depreciation_method, 'straight_line') = 'reducing_balance' THEN
      -- double-declining balance on net book value, monthly rate = 2 / useful life
      v_monthly := ROUND((v_a.cost - v_a.accumulated_depreciation) * (2.0 / GREATEST(v_a.useful_life_months, 1)), 2);
      -- switch to straight line once it charges less than the remaining even spread
      v_monthly := GREATEST(v_monthly, ROUND(v_remaining / GREATEST(v_a.useful_life_months, 1), 2));
    ELSE
      v_monthly := ROUND((v_a.cost - v_a.salvage_value) / GREATEST(v_a.useful_life_months, 1), 2);
    END IF;

    IF v_monthly > v_remaining THEN v_monthly := v_remaining; END IF;
    IF v_monthly <= 0 THEN CONTINUE; END IF;

    IF v_batch IS NULL THEN
      INSERT INTO public.journal_entry_batches
        (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
         created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
      VALUES
        (p_tenant_id, v_period_end, 'Monthly depreciation - ' || to_char(v_period, 'Mon YYYY'),
         'DEP-' || to_char(v_period, 'YYYYMM'), 'adjustment', 'adjustment', p_actor, true, now(), p_actor,
         'approved', p_actor, now(), p_branch_id)
      RETURNING id INTO v_batch;
    END IF;

    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (p_tenant_id, v_a.dep_expense_account_id, v_period_end, v_monthly, 0,
       'Depreciation - ' || v_a.name, 'fixed_asset', v_a.id, p_actor, v_batch, v_a.branch_id),
      (p_tenant_id, v_a.accum_dep_account_id, v_period_end, 0, v_monthly,
       'Depreciation - ' || v_a.name, 'fixed_asset', v_a.id, p_actor, v_batch, v_a.branch_id);

    INSERT INTO public.fixed_asset_depreciation
      (tenant_id, asset_id, branch_id, period_month, amount, batch_id, created_by)
    VALUES
      (p_tenant_id, v_a.id, v_a.branch_id, v_period, v_monthly, v_batch, p_actor);

    UPDATE public.fixed_assets
    SET accumulated_depreciation = ROUND(accumulated_depreciation + v_monthly, 2),
        status = CASE WHEN ROUND(cost - salvage_value - accumulated_depreciation - v_monthly, 2) <= 0
                      THEN 'fully_depreciated' ELSE status END
    WHERE id = v_a.id;

    v_total := v_total + v_monthly;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('period', v_period, 'assets', v_count, 'total', v_total, 'batch_id', v_batch);
END;
$function$;