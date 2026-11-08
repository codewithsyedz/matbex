-- 1. widen fixed_assets source
ALTER TABLE public.fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_source_chk;
ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_source_chk
  CHECK (source = ANY (ARRAY['manual','expense','installment','project','acquisition']));

-- 2. capex intent on project transactions
ALTER TABLE public.project_transactions
  ADD COLUMN IF NOT EXISTS capitalize boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS asset_class_id uuid REFERENCES public.fixed_asset_classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asset_name text,
  ADD COLUMN IF NOT EXISTS asset_tag text,
  ADD COLUMN IF NOT EXISTS asset_useful_life_months integer,
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.fixed_assets(id) ON DELETE SET NULL;

-- 3. capex intent on acquisition allocation lines
ALTER TABLE public.project_acquisition_allocations
  ADD COLUMN IF NOT EXISTS capitalize boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS asset_class_id uuid REFERENCES public.fixed_asset_classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asset_useful_life_months integer,
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.fixed_assets(id) ON DELETE SET NULL;

-- 4. shared helper: create a fixed asset from a project-driven posting
CREATE OR REPLACE FUNCTION public.create_project_fixed_asset(
  p_tenant_id uuid,
  p_project_id uuid,
  p_branch_id uuid,
  p_class_id uuid,
  p_name text,
  p_cost numeric,
  p_date date,
  p_batch_id uuid,
  p_source text,
  p_source_reference_id uuid,
  p_funding_source text DEFAULT 'company',
  p_payment_account_id uuid DEFAULT NULL,
  p_project_partner_id uuid DEFAULT NULL,
  p_useful_life_months integer DEFAULT NULL,
  p_asset_tag text DEFAULT NULL,
  p_supplier_name text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class public.fixed_asset_classes%ROWTYPE;
  v_asset uuid;
  v_salvage numeric(15,2);
  v_cost numeric(15,2) := ROUND(COALESCE(p_cost,0), 2);
BEGIN
  IF v_cost <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: asset cost must be greater than zero';
  END IF;

  PERFORM public.ensure_fixed_asset_accounts(p_tenant_id);

  IF p_class_id IS NOT NULL THEN
    SELECT * INTO v_class FROM public.fixed_asset_classes
     WHERE id = p_class_id AND tenant_id = p_tenant_id AND is_active;
  END IF;
  IF v_class.id IS NULL THEN
    SELECT * INTO v_class FROM public.fixed_asset_classes
     WHERE id = public.resolve_asset_class(p_tenant_id, p_branch_id, 'kitchen_equipment');
  END IF;
  IF v_class.id IS NULL THEN
    RAISE EXCEPTION 'NO_ASSET_CLASS: configure at least one asset class before capitalizing project costs';
  END IF;

  v_salvage := ROUND(v_cost * COALESCE(v_class.salvage_rate_pct, 0) / 100.0, 2);
  v_salvage := LEAST(GREATEST(v_salvage, 0), GREATEST(v_cost - 0.01, 0));

  INSERT INTO public.fixed_assets
    (tenant_id, branch_id, class_id, asset_tag, name, supplier_name, acquisition_date, in_service_date,
     cost, vat_amount, salvage_value, useful_life_months, depreciation_method,
     asset_account_id, accum_dep_account_id, dep_expense_account_id,
     funding_source, payment_account_id, source, source_reference_id, batch_id,
     project_id, project_partner_id, notes, created_by)
  VALUES
    (p_tenant_id, p_branch_id, v_class.id, p_asset_tag, p_name, p_supplier_name, p_date, p_date,
     v_cost, 0, v_salvage,
     COALESCE(p_useful_life_months, v_class.useful_life_months, 60),
     COALESCE(v_class.depreciation_method, 'straight_line'),
     v_class.asset_account_id, v_class.accum_dep_account_id, v_class.dep_expense_account_id,
     CASE WHEN p_funding_source IN ('company','partner','credit','installment') THEN p_funding_source ELSE 'company' END,
     p_payment_account_id, p_source, p_source_reference_id, p_batch_id,
     p_project_id, p_project_partner_id, p_notes, auth.uid())
  RETURNING id INTO v_asset;

  RETURN v_asset;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_fixed_asset(uuid,uuid,uuid,uuid,text,numeric,date,uuid,text,uuid,text,uuid,uuid,integer,text,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_project_fixed_asset(uuid,uuid,uuid,uuid,text,numeric,date,uuid,text,uuid,text,uuid,uuid,integer,text,text,text) TO authenticated, service_role;

-- 5. post project transaction: CAPEX routing + asset creation
CREATE OR REPLACE FUNCTION public.post_project_transaction(p_txn_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t project_transactions;
  v_batch uuid;
  v_credit uuid;
  v_split RECORD;
  v_n integer;
  v_ref text;
  v_class public.fixed_asset_classes%ROWTYPE;
  v_debit uuid;
  v_asset uuid;
BEGIN
  SELECT * INTO v_t FROM project_transactions WHERE id = p_txn_id FOR UPDATE;
  IF v_t IS NULL THEN RAISE EXCEPTION 'TXN_NOT_FOUND'; END IF;
  IF NOT public.can_manage_capital(v_t.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only finance roles can post project transactions.';
  END IF;
  IF v_t.status = 'posted' THEN RAISE EXCEPTION 'ALREADY_POSTED'; END IF;
  IF v_t.status = 'needs_review' THEN
    RAISE EXCEPTION 'NEEDS_REVIEW: Classify this transaction before posting.';
  END IF;
  IF v_t.treatment IS NULL THEN RAISE EXCEPTION 'TREATMENT_REQUIRED: Set CAPEX/OPEX/etc before posting.'; END IF;

  SELECT COUNT(*) INTO v_n FROM project_transaction_splits WHERE transaction_id = p_txn_id;

  v_debit := v_t.debit_account_id;

  -- CAPEX routing: capitalized costs must debit the asset class account
  IF v_t.capitalize THEN
    IF v_t.treatment <> 'capex' THEN
      RAISE EXCEPTION 'CAPEX_REQUIRED: only CAPEX transactions can create a fixed asset.';
    END IF;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'SPLIT_NOT_SUPPORTED: remove split lines to capitalize this cost as a single asset.';
    END IF;
    PERFORM public.ensure_fixed_asset_accounts(v_t.tenant_id);
    IF v_t.asset_class_id IS NOT NULL THEN
      SELECT * INTO v_class FROM public.fixed_asset_classes
       WHERE id = v_t.asset_class_id AND tenant_id = v_t.tenant_id AND is_active;
    END IF;
    IF v_class.id IS NULL THEN
      SELECT * INTO v_class FROM public.fixed_asset_classes
       WHERE id = public.resolve_asset_class(v_t.tenant_id, v_t.branch_id, 'kitchen_equipment');
    END IF;
    IF v_class.id IS NULL THEN
      RAISE EXCEPTION 'NO_ASSET_CLASS: configure at least one asset class before capitalizing project costs.';
    END IF;
    v_debit := v_class.asset_account_id;
  END IF;

  IF v_n = 0 AND v_debit IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_REQUIRED: Choose a cost account or add split lines.';
  END IF;

  v_credit := public.resolve_project_funding_account(
    v_t.tenant_id, v_t.paid_by, v_t.partner_id, v_t.funding_classification,
    v_t.payment_account_id, v_t.is_paid);

  v_ref := 'PRJ-' || to_char(v_t.txn_date, 'YYYYMMDD') || '-' || left(replace(p_txn_id::text,'-',''), 6);

  INSERT INTO journal_entry_batches (tenant_id, batch_date, description, reference_number,
    entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status,
    branch_id, project_id)
  VALUES (v_t.tenant_id, v_t.txn_date,
    COALESCE(v_t.description, 'Project cost') || COALESCE(' - ' || v_t.vendor_name, ''),
    v_ref, 'adjustment', 'adjustment', COALESCE(auth.uid(), v_t.created_by), true, now(),
    auth.uid(), 'approved', v_t.branch_id, v_t.project_id)
  RETURNING id INTO v_batch;

  IF v_n > 0 THEN
    FOR v_split IN SELECT * FROM project_transaction_splits WHERE transaction_id = p_txn_id LOOP
      INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, batch_id, branch_id, project_id)
      VALUES (v_t.tenant_id, v_split.account_id, v_t.txn_date, v_split.amount, 0,
        COALESCE(v_split.category, v_t.description, 'Project cost'), 'project_transaction', p_txn_id,
        auth.uid(), v_batch, v_t.branch_id, v_t.project_id);
    END LOOP;
  ELSE
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by, batch_id, branch_id, project_id)
    VALUES (v_t.tenant_id, v_debit, v_t.txn_date, v_t.amount, 0,
      COALESCE(v_t.description, 'Project cost'), 'project_transaction', p_txn_id,
      auth.uid(), v_batch, v_t.branch_id, v_t.project_id);
  END IF;

  INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, batch_id, branch_id, project_id)
  VALUES (v_t.tenant_id, v_credit, v_t.txn_date, 0, v_t.amount,
    COALESCE(v_t.description, 'Project cost') || ' (funding)', 'project_transaction', p_txn_id,
    auth.uid(), v_batch, v_t.branch_id, v_t.project_id);

  IF v_t.capitalize THEN
    v_asset := public.create_project_fixed_asset(
      v_t.tenant_id, v_t.project_id, v_t.branch_id, v_class.id,
      COALESCE(v_t.asset_name, v_t.description, 'Project asset'),
      v_t.amount, v_t.txn_date, v_batch, 'project', p_txn_id,
      CASE WHEN v_t.paid_by = 'partner' THEN 'partner'
           WHEN NOT v_t.is_paid THEN 'credit' ELSE 'company' END,
      CASE WHEN v_t.paid_by = 'company' AND v_t.is_paid THEN v_t.payment_account_id ELSE NULL END,
      v_t.partner_id, v_t.asset_useful_life_months, v_t.asset_tag, v_t.vendor_name,
      'Capitalized from project transaction');
  END IF;

  UPDATE project_transactions
     SET status = 'posted', batch_id = v_batch, posted_at = now(), posted_by = auth.uid(),
         debit_account_id = COALESCE(v_debit, debit_account_id), asset_id = v_asset
   WHERE id = p_txn_id;

  INSERT INTO project_classification_audit (tenant_id, transaction_id, action, new_value, batch_id, performed_by)
  VALUES (v_t.tenant_id, p_txn_id, 'posted',
    jsonb_build_object('treatment', v_t.treatment, 'paid_by', v_t.paid_by,
      'funding_classification', v_t.funding_classification, 'amount', v_t.amount,
      'capitalized', v_t.capitalize, 'asset_id', v_asset),
    v_batch, auth.uid());

  RETURN v_batch;
END;
$$;

-- 6. acquisition posting creates assets for capitalized allocation lines
CREATE OR REPLACE FUNCTION public.post_project_acquisition(p_acq_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a project_acquisitions;
  v_total numeric(15,2);
  v_batch uuid; v_credit uuid; v_line RECORD; v_asset uuid;
BEGIN
  SELECT * INTO v_a FROM project_acquisitions WHERE id = p_acq_id FOR UPDATE;
  IF v_a IS NULL THEN RAISE EXCEPTION 'ACQUISITION_NOT_FOUND'; END IF;
  IF NOT public.can_manage_capital(v_a.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only finance roles can post an acquisition.';
  END IF;
  IF v_a.classification_status = 'posted' THEN RAISE EXCEPTION 'ALREADY_POSTED'; END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_total FROM project_acquisition_allocations WHERE acquisition_id = p_acq_id;
  IF ABS(v_total - v_a.amount) > 0.005 THEN
    RAISE EXCEPTION 'ALLOCATION_INCOMPLETE: Allocated % of %. The allocation must equal the purchase price exactly.', v_total, v_a.amount;
  END IF;

  v_credit := public.resolve_project_funding_account(v_a.tenant_id, v_a.paid_by, v_a.partner_id,
                v_a.funding_classification, v_a.payment_account_id, true);

  INSERT INTO journal_entry_batches (tenant_id, batch_date, description, reference_number,
    entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status, branch_id, project_id)
  VALUES (v_a.tenant_id, v_a.acquisition_date,
    'Business acquisition - ' || v_a.seller_name, 'ACQ-' || to_char(v_a.acquisition_date,'YYYYMMDD'),
    'adjustment', 'adjustment', COALESCE(auth.uid(), v_a.created_by), true, now(), auth.uid(),
    'approved', v_a.branch_id, v_a.project_id)
  RETURNING id INTO v_batch;

  FOR v_line IN SELECT * FROM project_acquisition_allocations WHERE acquisition_id = p_acq_id LOOP
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by, batch_id, branch_id, project_id)
    VALUES (v_a.tenant_id, v_line.account_id, v_a.acquisition_date, v_line.amount, 0,
      'Acquisition: ' || v_line.label, 'project_acquisition', p_acq_id, auth.uid(), v_batch,
      v_a.branch_id, v_a.project_id);

    IF v_line.capitalize THEN
      v_asset := public.create_project_fixed_asset(
        v_a.tenant_id, v_a.project_id, v_a.branch_id, v_line.asset_class_id,
        v_line.label, v_line.amount, v_a.acquisition_date, v_batch, 'acquisition', p_acq_id,
        CASE WHEN v_a.paid_by = 'partner' THEN 'partner' ELSE 'company' END,
        CASE WHEN v_a.paid_by = 'company' THEN v_a.payment_account_id ELSE NULL END,
        v_a.partner_id, v_line.asset_useful_life_months, NULL, v_a.seller_name,
        'Acquired with business purchase');
      UPDATE project_acquisition_allocations SET asset_id = v_asset WHERE id = v_line.id;
    END IF;
  END LOOP;

  INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, batch_id, branch_id, project_id)
  VALUES (v_a.tenant_id, v_credit, v_a.acquisition_date, 0, v_a.amount,
    'Acquisition funding - ' || v_a.seller_name, 'project_acquisition', p_acq_id, auth.uid(),
    v_batch, v_a.branch_id, v_a.project_id);

  UPDATE project_acquisitions SET classification_status = 'posted', batch_id = v_batch,
    posted_at = now(), posted_by = auth.uid() WHERE id = p_acq_id;

  INSERT INTO project_classification_audit (tenant_id, acquisition_id, action, new_value, batch_id, performed_by)
  VALUES (v_a.tenant_id, p_acq_id, 'acquisition_posted',
    jsonb_build_object('amount', v_a.amount, 'seller', v_a.seller_name), v_batch, auth.uid());

  RETURN v_batch;
END;
$$;
