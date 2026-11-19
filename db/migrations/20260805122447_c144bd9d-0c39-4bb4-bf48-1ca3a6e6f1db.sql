-- 1. Disposal register
CREATE TABLE IF NOT EXISTS public.fixed_asset_disposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id),
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  disposal_date date NOT NULL DEFAULT CURRENT_DATE,
  disposal_type text NOT NULL DEFAULT 'sale',
  settlement_method text NOT NULL DEFAULT 'none',
  settlement_account_id uuid REFERENCES public.chart_of_accounts(id),
  settlement_status text NOT NULL DEFAULT 'settled',
  settled_on date,
  settled_account_id uuid REFERENCES public.chart_of_accounts(id),
  settlement_batch_id uuid REFERENCES public.journal_entry_batches(id),
  counterparty_name text,
  reference_number text,
  proceeds numeric(15,2) NOT NULL DEFAULT 0,
  vat_amount numeric(15,2) NOT NULL DEFAULT 0,
  cost numeric(15,2) NOT NULL DEFAULT 0,
  accumulated_depreciation numeric(15,2) NOT NULL DEFAULT 0,
  net_book_value numeric(15,2) NOT NULL DEFAULT 0,
  gain_loss numeric(15,2) NOT NULL DEFAULT 0,
  batch_id uuid REFERENCES public.journal_entry_batches(id),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fad_type_chk CHECK (disposal_type = ANY (ARRAY['sale','trade_in','scrap','write_off','theft','donation'])),
  CONSTRAINT fad_settlement_chk CHECK (settlement_method = ANY (ARRAY['none','cash','bank','receivable'])),
  CONSTRAINT fad_status_chk CHECK (settlement_status = ANY (ARRAY['settled','pending'])),
  CONSTRAINT fad_amount_chk CHECK (proceeds >= 0 AND vat_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_fad_tenant ON public.fixed_asset_disposals(tenant_id, disposal_date DESC);
CREATE INDEX IF NOT EXISTS idx_fad_asset ON public.fixed_asset_disposals(asset_id);
CREATE INDEX IF NOT EXISTS idx_fad_pending ON public.fixed_asset_disposals(tenant_id, settlement_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_asset_disposals TO authenticated;
GRANT ALL ON public.fixed_asset_disposals TO service_role;

ALTER TABLE public.fixed_asset_disposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles can view disposals" ON public.fixed_asset_disposals
FOR SELECT TO authenticated
USING (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id));

CREATE POLICY "Finance roles can manage disposals" ON public.fixed_asset_disposals
FOR ALL TO authenticated
USING (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id))
WITH CHECK (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id));

DROP TRIGGER IF EXISTS update_fad_updated_at ON public.fixed_asset_disposals;
CREATE TRIGGER update_fad_updated_at BEFORE UPDATE ON public.fixed_asset_disposals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Extra summary columns on the asset
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS disposal_type text,
  ADD COLUMN IF NOT EXISTS disposal_gain_loss numeric(15,2);

-- 3. Extra standard accounts
CREATE OR REPLACE FUNCTION public.ensure_fixed_asset_disposal_accounts(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
  VALUES
    (_tenant_id, '6965', 'Asset Write-off & Shrinkage Loss', 'expense', 'Net book value written off for scrapped, stolen or donated assets', true),
    (_tenant_id, '1105', 'Asset Disposal Receivable', 'asset', 'Amounts owed by buyers of disposed fixed assets', true)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;
END;
$$;

-- 4. Disposal engine
CREATE OR REPLACE FUNCTION public.dispose_fixed_asset_v2(
  p_asset_id uuid,
  p_disposal_date date,
  p_disposal_type text DEFAULT 'sale',
  p_proceeds numeric DEFAULT 0,
  p_vat_amount numeric DEFAULT 0,
  p_settlement_method text DEFAULT 'none',
  p_settlement_account_id uuid DEFAULT NULL,
  p_counterparty text DEFAULT NULL,
  p_reference text DEFAULT NULL,
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
  v_disposal uuid;
  v_nbv numeric(15,2);
  v_proceeds numeric(15,2) := ROUND(COALESCE(p_proceeds, 0), 2);
  v_vat numeric(15,2) := ROUND(COALESCE(p_vat_amount, 0), 2);
  v_gross numeric(15,2);
  v_result numeric(15,2);
  v_settle_acct uuid;
  v_method text := COALESCE(p_settlement_method, 'none');
  v_type text := COALESCE(p_disposal_type, 'sale');
  v_status text;
  v_loss_acct uuid;
  v_desc text;
BEGIN
  SELECT * INTO v_a FROM public.fixed_assets WHERE id = p_asset_id;
  IF v_a.id IS NULL THEN RAISE EXCEPTION 'ASSET_NOT_FOUND'; END IF;
  IF NOT public.can_manage_capital(v_a.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can dispose assets';
  END IF;
  IF v_a.status = 'disposed' THEN RAISE EXCEPTION 'ALREADY_DISPOSED'; END IF;
  IF v_type NOT IN ('sale','trade_in','scrap','write_off','theft','donation') THEN
    RAISE EXCEPTION 'INVALID_DISPOSAL_TYPE';
  END IF;
  IF p_disposal_date < v_a.acquisition_date THEN
    RAISE EXCEPTION 'DISPOSAL_BEFORE_ACQUISITION: disposal date cannot be before the acquisition date';
  END IF;

  PERFORM public.ensure_fixed_asset_accounts(v_a.tenant_id);
  PERFORM public.ensure_fixed_asset_disposal_accounts(v_a.tenant_id);

  -- non-sale disposals never carry proceeds or VAT
  IF v_type IN ('scrap','write_off','theft','donation') THEN
    v_proceeds := 0;
    v_vat := 0;
    v_method := 'none';
  END IF;

  IF v_proceeds = 0 THEN
    v_vat := 0;
    v_method := 'none';
  ELSIF v_method = 'none' THEN
    RAISE EXCEPTION 'SETTLEMENT_REQUIRED: choose how the sale proceeds were received';
  END IF;

  v_gross := ROUND(v_proceeds + v_vat, 2);
  v_nbv := ROUND(v_a.cost - v_a.accumulated_depreciation, 2);
  v_result := ROUND(v_proceeds - v_nbv, 2);   -- >0 gain, <0 loss (VAT excluded)
  v_status := CASE WHEN v_method = 'receivable' THEN 'pending' ELSE 'settled' END;
  v_desc := CASE WHEN v_type = 'sale' THEN 'Asset disposal - ' ELSE 'Asset ' || replace(v_type, '_', ' ') || ' - ' END || v_a.name;

  IF v_gross > 0 THEN
    v_settle_acct := COALESCE(
      p_settlement_account_id,
      CASE v_method
        WHEN 'cash' THEN public.get_account_id_by_code(v_a.tenant_id, '1000')
        WHEN 'bank' THEN public.get_account_id_by_code(v_a.tenant_id, '1010')
        ELSE public.get_account_id_by_code(v_a.tenant_id, '1105')
      END);
    IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                   WHERE id = v_settle_acct AND tenant_id = v_a.tenant_id AND is_active) THEN
      RAISE EXCEPTION 'INVALID_SETTLEMENT_ACCOUNT';
    END IF;
  END IF;

  v_loss_acct := CASE WHEN v_type IN ('write_off','theft','scrap','donation')
                      THEN public.get_account_id_by_code(v_a.tenant_id, '6965')
                      ELSE public.get_account_id_by_code(v_a.tenant_id, '6960') END;

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
            v_desc || ' - accumulated depreciation reversed', 'fixed_asset', v_a.id, auth.uid(), v_batch, v_a.branch_id);
  END IF;

  -- DR cash / bank / receivable for gross proceeds
  IF v_gross > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES (v_a.tenant_id, v_settle_acct, p_disposal_date, v_gross, 0,
            v_desc || ' - proceeds' || COALESCE(' from ' || p_counterparty, ''),
            'fixed_asset', v_a.id, auth.uid(), v_batch, v_a.branch_id);
  END IF;

  -- CR output VAT on the sale
  IF v_vat > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES (v_a.tenant_id, public.get_account_id_by_code(v_a.tenant_id, '2200'), p_disposal_date, 0, v_vat,
            v_desc || ' - output VAT on disposal', 'fixed_asset', v_a.id, auth.uid(), v_batch, v_a.branch_id);
  END IF;

  -- gain / loss
  IF v_result < 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES (v_a.tenant_id, v_loss_acct, p_disposal_date, ABS(v_result), 0,
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

  INSERT INTO public.fixed_asset_disposals
    (tenant_id, branch_id, asset_id, disposal_date, disposal_type, settlement_method,
     settlement_account_id, settlement_status, settled_on, settled_account_id,
     counterparty_name, reference_number, proceeds, vat_amount, cost,
     accumulated_depreciation, net_book_value, gain_loss, batch_id, notes, created_by)
  VALUES
    (v_a.tenant_id, v_a.branch_id, v_a.id, p_disposal_date, v_type, v_method,
     v_settle_acct, v_status,
     CASE WHEN v_status = 'settled' AND v_gross > 0 THEN p_disposal_date END,
     CASE WHEN v_status = 'settled' AND v_gross > 0 THEN v_settle_acct END,
     NULLIF(TRIM(COALESCE(p_counterparty, '')), ''), NULLIF(TRIM(COALESCE(p_reference, '')), ''),
     v_proceeds, v_vat, v_a.cost, v_a.accumulated_depreciation, v_nbv, v_result,
     v_batch, p_notes, auth.uid())
  RETURNING id INTO v_disposal;

  UPDATE public.fixed_assets
  SET status = 'disposed', disposal_date = p_disposal_date, disposal_proceeds = v_proceeds,
      disposal_batch_id = v_batch, disposal_notes = p_notes,
      disposal_type = v_type, disposal_gain_loss = v_result
  WHERE id = v_a.id;

  RETURN jsonb_build_object('asset_id', v_a.id, 'disposal_id', v_disposal, 'batch_id', v_batch,
                            'net_book_value', v_nbv, 'proceeds', v_proceeds, 'vat_amount', v_vat,
                            'gain_loss', v_result, 'settlement_status', v_status);
END;
$$;

-- keep the legacy signature working
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
BEGIN
  RETURN public.dispose_fixed_asset_v2(
    p_asset_id, p_disposal_date,
    CASE WHEN COALESCE(p_proceeds, 0) > 0 THEN 'sale' ELSE 'write_off' END,
    p_proceeds, 0,
    CASE WHEN COALESCE(p_proceeds, 0) > 0 THEN 'cash' ELSE 'none' END,
    p_proceeds_account_id, NULL, NULL, p_notes);
END;
$$;

-- 5. Settle an outstanding disposal receivable
CREATE OR REPLACE FUNCTION public.settle_fixed_asset_disposal(
  p_disposal_id uuid,
  p_settled_on date DEFAULT CURRENT_DATE,
  p_account_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_d public.fixed_asset_disposals%ROWTYPE;
  v_batch uuid;
  v_acct uuid;
  v_gross numeric(15,2);
  v_desc text;
  v_name text;
BEGIN
  SELECT * INTO v_d FROM public.fixed_asset_disposals WHERE id = p_disposal_id;
  IF v_d.id IS NULL THEN RAISE EXCEPTION 'DISPOSAL_NOT_FOUND'; END IF;
  IF NOT public.can_manage_capital(v_d.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can settle disposals';
  END IF;
  IF v_d.settlement_status = 'settled' THEN RAISE EXCEPTION 'ALREADY_SETTLED'; END IF;
  IF p_settled_on < v_d.disposal_date THEN
    RAISE EXCEPTION 'SETTLEMENT_BEFORE_DISPOSAL: settlement date cannot be before the disposal date';
  END IF;

  v_acct := COALESCE(p_account_id, public.get_account_id_by_code(v_d.tenant_id, '1000'));
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                 WHERE id = v_acct AND tenant_id = v_d.tenant_id AND is_active) THEN
    RAISE EXCEPTION 'INVALID_SETTLEMENT_ACCOUNT';
  END IF;

  SELECT name INTO v_name FROM public.fixed_assets WHERE id = v_d.asset_id;
  v_gross := ROUND(v_d.proceeds + v_d.vat_amount, 2);
  v_desc := 'Asset disposal settlement - ' || COALESCE(v_name, 'asset');

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
  VALUES
    (v_d.tenant_id, p_settled_on, v_desc, 'FADS-' || to_char(now(), 'YYYYMMDDHH24MISS'),
     'adjustment', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), v_d.branch_id)
  RETURNING id INTO v_batch;

  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description,
     reference_type, reference_id, created_by, batch_id, branch_id)
  VALUES
    (v_d.tenant_id, v_acct, p_settled_on, v_gross, 0, v_desc || ' - received',
     'fixed_asset', v_d.asset_id, auth.uid(), v_batch, v_d.branch_id),
    (v_d.tenant_id, COALESCE(v_d.settlement_account_id, public.get_account_id_by_code(v_d.tenant_id, '1105')),
     p_settled_on, 0, v_gross, v_desc || ' - receivable cleared',
     'fixed_asset', v_d.asset_id, auth.uid(), v_batch, v_d.branch_id);

  UPDATE public.fixed_asset_disposals
  SET settlement_status = 'settled', settled_on = p_settled_on,
      settled_account_id = v_acct, settlement_batch_id = v_batch
  WHERE id = v_d.id;

  RETURN jsonb_build_object('disposal_id', v_d.id, 'batch_id', v_batch, 'amount', v_gross);
END;
$$;