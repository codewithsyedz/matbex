-- ============================================================
-- PROJECT / COST CENTER EXTENSION (Karahi GUYZ)
-- Extends the existing journal engine. No parallel accounting system.
-- ============================================================

-- 0. Branch lifecycle -----------------------------------------------------
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_lifecycle_status_check;
ALTER TABLE public.branches ADD CONSTRAINT branches_lifecycle_status_check
  CHECK (lifecycle_status IN ('under_construction','pre_opening','active','closed'));

-- 1. Projects -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  phase text NOT NULL DEFAULT 'acquisition',
  status text NOT NULL DEFAULT 'active',
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  target_open_date date,
  completed_at timestamptz,
  total_budget numeric(15,2) NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_phase_check CHECK (phase IN ('acquisition','construction','renovation','equipment','pre_opening','opening','operational')),
  CONSTRAINT projects_status_check CHECK (status IN ('active','on_hold','completed','cancelled')),
  CONSTRAINT projects_code_unique UNIQUE (tenant_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members view projects" ON public.projects FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Finance roles manage projects" ON public.projects FOR ALL TO authenticated
  USING (public.can_manage_capital(tenant_id)) WITH CHECK (public.can_manage_capital(tenant_id));

-- 2. Project partners -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  partner_name text NOT NULL,
  ownership_pct numeric(6,3) NOT NULL DEFAULT 0,
  user_id uuid,
  capital_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  payable_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  loan_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  owner_capital_account_id uuid REFERENCES public.owner_capital_accounts(id) ON DELETE SET NULL,
  opening_capital numeric(15,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_partners_pct_check CHECK (ownership_pct >= 0 AND ownership_pct <= 100),
  CONSTRAINT project_partners_unique UNIQUE (tenant_id, project_id, partner_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_partners TO authenticated;
GRANT ALL ON public.project_partners TO service_role;
ALTER TABLE public.project_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance roles manage project partners" ON public.project_partners FOR ALL TO authenticated
  USING (public.can_manage_capital(tenant_id)) WITH CHECK (public.can_manage_capital(tenant_id));

-- 3. Acquisition ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_acquisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  acquisition_date date NOT NULL DEFAULT CURRENT_DATE,
  seller_name text NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  payment_method text,
  paid_by text NOT NULL DEFAULT 'company',
  partner_id uuid REFERENCES public.project_partners(id) ON DELETE SET NULL,
  funding_classification text,
  payment_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  agreement_url text,
  document_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  classification_status text NOT NULL DEFAULT 'pending',
  batch_id uuid REFERENCES public.journal_entry_batches(id),
  posted_at timestamptz,
  posted_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acq_paid_by_check CHECK (paid_by IN ('company','partner')),
  CONSTRAINT acq_funding_check CHECK (funding_classification IS NULL OR funding_classification IN ('capital','loan','payable')),
  CONSTRAINT acq_class_status_check CHECK (classification_status IN ('pending','classified','posted'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_acquisitions TO authenticated;
GRANT ALL ON public.project_acquisitions TO service_role;
ALTER TABLE public.project_acquisitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance roles manage acquisitions" ON public.project_acquisitions FOR ALL TO authenticated
  USING (public.can_manage_capital(tenant_id)) WITH CHECK (public.can_manage_capital(tenant_id));

CREATE TABLE IF NOT EXISTS public.project_acquisition_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  acquisition_id uuid NOT NULL REFERENCES public.project_acquisitions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  label text NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_acquisition_allocations TO authenticated;
GRANT ALL ON public.project_acquisition_allocations TO service_role;
ALTER TABLE public.project_acquisition_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance roles manage acquisition allocations" ON public.project_acquisition_allocations FOR ALL TO authenticated
  USING (public.can_manage_capital(tenant_id)) WITH CHECK (public.can_manage_capital(tenant_id));

-- 4. Budget lines & commitments ------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category text NOT NULL,
  account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  budget_amount numeric(15,2) NOT NULL DEFAULT 0,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_budget_lines_unique UNIQUE (project_id, category)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_budget_lines TO authenticated;
GRANT ALL ON public.project_budget_lines TO service_role;
ALTER TABLE public.project_budget_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members view budget lines" ON public.project_budget_lines FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Finance roles manage budget lines" ON public.project_budget_lines FOR ALL TO authenticated
  USING (public.can_manage_capital(tenant_id)) WITH CHECK (public.can_manage_capital(tenant_id));

CREATE TABLE IF NOT EXISTS public.project_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  vendor_name text,
  category text NOT NULL,
  contract_amount numeric(15,2) NOT NULL CHECK (contract_amount > 0),
  contract_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'open',
  document_url text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_commitments_status_check CHECK (status IN ('open','partially_delivered','completed','cancelled'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_commitments TO authenticated;
GRANT ALL ON public.project_commitments TO service_role;
ALTER TABLE public.project_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members view commitments" ON public.project_commitments FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Finance roles manage commitments" ON public.project_commitments FOR ALL TO authenticated
  USING (public.can_manage_capital(tenant_id)) WITH CHECK (public.can_manage_capital(tenant_id));

-- 5. Project transactions (review queue -> ledger) ------------------------
CREATE TABLE IF NOT EXISTS public.project_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  commitment_id uuid REFERENCES public.project_commitments(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  vendor_name text,
  txn_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  description text,
  category text,
  treatment text,
  debit_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  paid_by text NOT NULL DEFAULT 'company',
  partner_id uuid REFERENCES public.project_partners(id) ON DELETE SET NULL,
  payment_source text,
  payment_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  funding_classification text,
  is_paid boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'needs_review',
  source text NOT NULL DEFAULT 'manual',
  import_batch text,
  document_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  batch_id uuid REFERENCES public.journal_entry_batches(id),
  posted_at timestamptz,
  posted_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pt_paid_by_check CHECK (paid_by IN ('company','partner')),
  CONSTRAINT pt_treatment_check CHECK (treatment IS NULL OR treatment IN ('capex','opex','inventory','acquisition','pre_opening','license','deposit','other')),
  CONSTRAINT pt_funding_check CHECK (funding_classification IS NULL OR funding_classification IN ('capital','loan','payable')),
  CONSTRAINT pt_status_check CHECK (status IN ('needs_review','classified','posted','rejected','voided')),
  CONSTRAINT pt_payment_source_check CHECK (payment_source IS NULL OR payment_source IN ('company_bank','company_cash','partner_bank','partner_cash','partner_card','other'))
);
CREATE INDEX IF NOT EXISTS idx_project_txn_project ON public.project_transactions(project_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_project_txn_status ON public.project_transactions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_project_txn_partner ON public.project_transactions(partner_id) WHERE partner_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_transactions TO authenticated;
GRANT ALL ON public.project_transactions TO service_role;
ALTER TABLE public.project_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members view project transactions" ON public.project_transactions FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Tenant members create project transactions" ON public.project_transactions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Finance roles manage project transactions" ON public.project_transactions FOR ALL TO authenticated
  USING (public.can_manage_capital(tenant_id)) WITH CHECK (public.can_manage_capital(tenant_id));

CREATE TABLE IF NOT EXISTS public.project_transaction_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.project_transactions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  category text,
  treatment text,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pts_treatment_check CHECK (treatment IS NULL OR treatment IN ('capex','opex','inventory','acquisition','pre_opening','license','deposit','other'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_transaction_splits TO authenticated;
GRANT ALL ON public.project_transaction_splits TO service_role;
ALTER TABLE public.project_transaction_splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members view splits" ON public.project_transaction_splits FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Finance roles manage splits" ON public.project_transaction_splits FOR ALL TO authenticated
  USING (public.can_manage_capital(tenant_id)) WITH CHECK (public.can_manage_capital(tenant_id));

-- 6. Classification audit trail ------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_classification_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES public.project_transactions(id) ON DELETE CASCADE,
  acquisition_id uuid REFERENCES public.project_acquisitions(id) ON DELETE CASCADE,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  reason text,
  batch_id uuid REFERENCES public.journal_entry_batches(id),
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.project_classification_audit TO authenticated;
GRANT ALL ON public.project_classification_audit TO service_role;
ALTER TABLE public.project_classification_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance roles view classification audit" ON public.project_classification_audit FOR SELECT TO authenticated
  USING (public.can_manage_capital(tenant_id));
CREATE POLICY "Finance roles insert classification audit" ON public.project_classification_audit FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_capital(tenant_id));

-- 7. Project dimension on existing tables (nullable = backward compatible)
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.account_transactions ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.journal_entry_batches ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS project_partner_id uuid REFERENCES public.project_partners(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_invoices ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_project ON public.expenses(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_acct_txn_project ON public.account_transactions(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fixed_assets_project ON public.fixed_assets(project_id) WHERE project_id IS NOT NULL;

-- 8. updated_at triggers --------------------------------------------------
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_project_partners_updated BEFORE UPDATE ON public.project_partners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_project_acquisitions_updated BEFORE UPDATE ON public.project_acquisitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_project_budget_lines_updated BEFORE UPDATE ON public.project_budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_project_commitments_updated BEFORE UPDATE ON public.project_commitments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_project_transactions_updated BEFORE UPDATE ON public.project_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Split integrity: split total must equal parent amount ---------------
CREATE OR REPLACE FUNCTION public.validate_project_split_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_txn_id uuid;
  v_total numeric(15,2);
  v_amount numeric(15,2);
  v_count integer;
  v_status text;
BEGIN
  v_txn_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  SELECT amount, status INTO v_amount, v_status FROM project_transactions WHERE id = v_txn_id;
  IF v_amount IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'POSTED_LOCKED: Splits cannot be changed after the transaction is posted. Reverse or reclassify instead.';
  END IF;
  SELECT COUNT(*), COALESCE(SUM(amount),0) INTO v_count, v_total
    FROM project_transaction_splits WHERE transaction_id = v_txn_id;
  IF v_count > 0 AND ABS(v_total - v_amount) > 0.005 THEN
    RAISE EXCEPTION 'SPLIT_MISMATCH: Split total (%) must equal the transaction amount (%).', v_total, v_amount;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE CONSTRAINT TRIGGER trg_validate_project_split_total
  AFTER INSERT OR UPDATE OR DELETE ON public.project_transaction_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_split_total();

-- 10. Acquisition allocation integrity -----------------------------------
CREATE OR REPLACE FUNCTION public.validate_acquisition_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_acq_id uuid;
  v_total numeric(15,2);
  v_amount numeric(15,2);
  v_status text;
BEGIN
  v_acq_id := COALESCE(NEW.acquisition_id, OLD.acquisition_id);
  SELECT amount, classification_status INTO v_amount, v_status FROM project_acquisitions WHERE id = v_acq_id;
  IF v_amount IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'POSTED_LOCKED: Allocations cannot be changed after the acquisition is posted.';
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_total FROM project_acquisition_allocations WHERE acquisition_id = v_acq_id;
  IF v_total > v_amount + 0.005 THEN
    RAISE EXCEPTION 'ALLOCATION_EXCEEDS: Allocated total (%) exceeds the acquisition price (%).', v_total, v_amount;
  END IF;
  UPDATE project_acquisitions
     SET classification_status = CASE WHEN ABS(v_total - v_amount) <= 0.005 THEN 'classified' ELSE 'pending' END
   WHERE id = v_acq_id AND classification_status <> 'posted';
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE CONSTRAINT TRIGGER trg_validate_acquisition_allocation
  AFTER INSERT OR UPDATE OR DELETE ON public.project_acquisition_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_acquisition_allocation();

-- 11. Account provisioning ------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_project_accounts(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, is_system_account, is_active)
  SELECT p_tenant_id, v.code, v.name, v.atype::account_type, true, true
  FROM (VALUES
    ('1550','Construction in Progress','asset'),
    ('1560','Business Acquisition Cost','asset'),
    ('1570','Goodwill','asset'),
    ('6960','Pre-opening Expenses','expense')
  ) AS v(code,name,atype)
  WHERE NOT EXISTS (
    SELECT 1 FROM chart_of_accounts c WHERE c.tenant_id = p_tenant_id AND c.account_code = v.code
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_project_accounts(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ensure_partner_funding_accounts(p_partner_id uuid)
RETURNS public.project_partners LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p project_partners;
  v_code text;
  v_id uuid;
BEGIN
  SELECT * INTO v_p FROM project_partners WHERE id = p_partner_id;
  IF v_p IS NULL THEN RAISE EXCEPTION 'PARTNER_NOT_FOUND'; END IF;

  -- Equity capital account (3401-3499)
  IF v_p.capital_account_id IS NULL THEN
    SELECT COALESCE(MAX(account_code)::int, 3400) + 1 INTO v_code
      FROM chart_of_accounts WHERE tenant_id = v_p.tenant_id AND account_code ~ '^34[0-9]{2}$';
    IF v_code::int > 3499 THEN RAISE EXCEPTION 'NO_CODE_AVAILABLE: capital account range 3401-3499 exhausted'; END IF;
    INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, is_system_account, is_active)
    VALUES (v_p.tenant_id, v_code, 'Partner Capital - ' || v_p.partner_name, 'equity', true, true)
    RETURNING id INTO v_id;
    UPDATE project_partners SET capital_account_id = v_id WHERE id = p_partner_id;
    v_p.capital_account_id := v_id;
  END IF;

  -- Due to Partner liability (2410-2419)
  IF v_p.payable_account_id IS NULL THEN
    SELECT COALESCE(MAX(account_code)::int, 2410) + CASE WHEN COUNT(*) = 0 THEN 0 ELSE 1 END INTO v_code
      FROM chart_of_accounts WHERE tenant_id = v_p.tenant_id AND account_code ~ '^241[0-9]$';
    IF v_code::int > 2419 THEN RAISE EXCEPTION 'NO_CODE_AVAILABLE: due-to-partner range 2410-2419 exhausted'; END IF;
    INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, is_system_account, is_active)
    VALUES (v_p.tenant_id, v_code, 'Due to Partner - ' || v_p.partner_name, 'liability', true, true)
    RETURNING id INTO v_id;
    UPDATE project_partners SET payable_account_id = v_id WHERE id = p_partner_id;
    v_p.payable_account_id := v_id;
  END IF;

  -- Partner Loan liability (2420-2429)
  IF v_p.loan_account_id IS NULL THEN
    SELECT COALESCE(MAX(account_code)::int, 2420) + CASE WHEN COUNT(*) = 0 THEN 0 ELSE 1 END INTO v_code
      FROM chart_of_accounts WHERE tenant_id = v_p.tenant_id AND account_code ~ '^242[0-9]$';
    IF v_code::int > 2429 THEN RAISE EXCEPTION 'NO_CODE_AVAILABLE: partner-loan range 2420-2429 exhausted'; END IF;
    INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, is_system_account, is_active)
    VALUES (v_p.tenant_id, v_code, 'Partner Loan - ' || v_p.partner_name, 'liability', true, true)
    RETURNING id INTO v_id;
    UPDATE project_partners SET loan_account_id = v_id WHERE id = p_partner_id;
    v_p.loan_account_id := v_id;
  END IF;

  SELECT * INTO v_p FROM project_partners WHERE id = p_partner_id;
  RETURN v_p;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_partner_funding_accounts(uuid) TO authenticated, service_role;

-- 12. Resolve the credit (funding) account for a project cost ------------
CREATE OR REPLACE FUNCTION public.resolve_project_funding_account(
  p_tenant_id uuid, p_paid_by text, p_partner_id uuid,
  p_funding_classification text, p_payment_account_id uuid, p_is_paid boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p project_partners;
  v_acct uuid;
BEGIN
  IF p_paid_by = 'company' THEN
    IF NOT COALESCE(p_is_paid, true) THEN
      SELECT id INTO v_acct FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND account_code = '2000' LIMIT 1;
      IF v_acct IS NULL THEN RAISE EXCEPTION 'ACCOUNT_MISSING: Accounts Payable (2000) not found.'; END IF;
      RETURN v_acct;
    END IF;
    IF p_payment_account_id IS NULL THEN
      SELECT id INTO v_acct FROM chart_of_accounts WHERE tenant_id = p_tenant_id AND account_code = '1000' LIMIT 1;
      IF v_acct IS NULL THEN RAISE EXCEPTION 'ACCOUNT_MISSING: Cash (1000) not found.'; END IF;
      RETURN v_acct;
    END IF;
    RETURN p_payment_account_id;
  END IF;

  IF p_partner_id IS NULL THEN
    RAISE EXCEPTION 'PARTNER_REQUIRED: Select which partner paid this transaction.';
  END IF;
  IF p_funding_classification IS NULL THEN
    RAISE EXCEPTION 'CLASSIFICATION_REQUIRED: Classify partner funding as capital, loan or payable before posting.';
  END IF;
  v_p := public.ensure_partner_funding_accounts(p_partner_id);
  RETURN CASE p_funding_classification
    WHEN 'capital' THEN v_p.capital_account_id
    WHEN 'loan' THEN v_p.loan_account_id
    ELSE v_p.payable_account_id
  END;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_project_funding_account(uuid,text,uuid,text,uuid,boolean) TO authenticated, service_role;

-- 13. Post a project transaction to the EXISTING journal engine ----------
CREATE OR REPLACE FUNCTION public.post_project_transaction(p_txn_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t project_transactions;
  v_batch uuid;
  v_credit uuid;
  v_split RECORD;
  v_n integer;
  v_ref text;
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
  IF v_n = 0 AND v_t.debit_account_id IS NULL THEN
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
    VALUES (v_t.tenant_id, v_t.debit_account_id, v_t.txn_date, v_t.amount, 0,
      COALESCE(v_t.description, 'Project cost'), 'project_transaction', p_txn_id,
      auth.uid(), v_batch, v_t.branch_id, v_t.project_id);
  END IF;

  INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, batch_id, branch_id, project_id)
  VALUES (v_t.tenant_id, v_credit, v_t.txn_date, 0, v_t.amount,
    COALESCE(v_t.description, 'Project cost') || ' (funding)', 'project_transaction', p_txn_id,
    auth.uid(), v_batch, v_t.branch_id, v_t.project_id);

  UPDATE project_transactions
     SET status = 'posted', batch_id = v_batch, posted_at = now(), posted_by = auth.uid()
   WHERE id = p_txn_id;

  INSERT INTO project_classification_audit (tenant_id, transaction_id, action, new_value, batch_id, performed_by)
  VALUES (v_t.tenant_id, p_txn_id, 'posted',
    jsonb_build_object('treatment', v_t.treatment, 'paid_by', v_t.paid_by,
      'funding_classification', v_t.funding_classification, 'amount', v_t.amount),
    v_batch, auth.uid());

  RETURN v_batch;
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_project_transaction(uuid) TO authenticated, service_role;

-- 14. Reclassify partner funding (capital <-> loan <-> payable) ----------
CREATE OR REPLACE FUNCTION public.reclassify_project_funding(
  p_txn_id uuid, p_new_classification text, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t project_transactions;
  v_old uuid; v_new uuid; v_batch uuid;
BEGIN
  SELECT * INTO v_t FROM project_transactions WHERE id = p_txn_id FOR UPDATE;
  IF v_t IS NULL THEN RAISE EXCEPTION 'TXN_NOT_FOUND'; END IF;
  IF NOT public.can_manage_capital(v_t.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only finance roles can reclassify partner funding.';
  END IF;
  IF v_t.paid_by <> 'partner' THEN RAISE EXCEPTION 'NOT_PARTNER_FUNDED'; END IF;
  IF p_new_classification NOT IN ('capital','loan','payable') THEN RAISE EXCEPTION 'INVALID_CLASSIFICATION'; END IF;
  IF COALESCE(p_reason,'') = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF v_t.funding_classification IS NOT DISTINCT FROM p_new_classification THEN RETURN NULL; END IF;

  IF v_t.status <> 'posted' THEN
    INSERT INTO project_classification_audit (tenant_id, transaction_id, action, old_value, new_value, reason, performed_by)
    VALUES (v_t.tenant_id, p_txn_id, 'reclassify',
      jsonb_build_object('funding_classification', v_t.funding_classification),
      jsonb_build_object('funding_classification', p_new_classification), p_reason, auth.uid());
    UPDATE project_transactions SET funding_classification = p_new_classification WHERE id = p_txn_id;
    RETURN NULL;
  END IF;

  v_old := public.resolve_project_funding_account(v_t.tenant_id, 'partner', v_t.partner_id,
             v_t.funding_classification, NULL, v_t.is_paid);
  v_new := public.resolve_project_funding_account(v_t.tenant_id, 'partner', v_t.partner_id,
             p_new_classification, NULL, v_t.is_paid);

  INSERT INTO journal_entry_batches (tenant_id, batch_date, description, reference_number,
    entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status, branch_id, project_id)
  VALUES (v_t.tenant_id, CURRENT_DATE,
    'Reclassify partner funding: ' || COALESCE(v_t.funding_classification,'?') || ' -> ' || p_new_classification,
    'PRJ-RC-' || left(replace(p_txn_id::text,'-',''), 8), 'adjustment', 'adjustment',
    auth.uid(), true, now(), auth.uid(), 'approved', v_t.branch_id, v_t.project_id)
  RETURNING id INTO v_batch;

  INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, batch_id, branch_id, project_id)
  VALUES
    (v_t.tenant_id, v_old, CURRENT_DATE, v_t.amount, 0, 'Reclassification: ' || p_reason,
     'project_transaction', p_txn_id, auth.uid(), v_batch, v_t.branch_id, v_t.project_id),
    (v_t.tenant_id, v_new, CURRENT_DATE, 0, v_t.amount, 'Reclassification: ' || p_reason,
     'project_transaction', p_txn_id, auth.uid(), v_batch, v_t.branch_id, v_t.project_id);

  INSERT INTO project_classification_audit (tenant_id, transaction_id, action, old_value, new_value, reason, batch_id, performed_by)
  VALUES (v_t.tenant_id, p_txn_id, 'reclassify_posted',
    jsonb_build_object('funding_classification', v_t.funding_classification),
    jsonb_build_object('funding_classification', p_new_classification), p_reason, v_batch, auth.uid());

  UPDATE project_transactions SET funding_classification = p_new_classification WHERE id = p_txn_id;
  RETURN v_batch;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reclassify_project_funding(uuid,text,text) TO authenticated, service_role;

-- 15. Post the acquisition using its allocation lines --------------------
CREATE OR REPLACE FUNCTION public.post_project_acquisition(p_acq_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_a project_acquisitions;
  v_total numeric(15,2);
  v_batch uuid; v_credit uuid; v_line RECORD;
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
GRANT EXECUTE ON FUNCTION public.post_project_acquisition(uuid) TO authenticated, service_role;

-- 16. Reimburse a partner (settle Due to Partner) ------------------------
CREATE OR REPLACE FUNCTION public.reimburse_project_partner(
  p_partner_id uuid, p_amount numeric, p_payment_account_id uuid,
  p_date date DEFAULT CURRENT_DATE, p_kind text DEFAULT 'payable', p_notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p project_partners; v_batch uuid; v_debit uuid; v_branch uuid;
BEGIN
  v_p := public.ensure_partner_funding_accounts(p_partner_id);
  IF NOT public.can_manage_capital(v_p.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only finance roles can reimburse partners.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_kind NOT IN ('payable','loan','capital') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;

  v_debit := CASE p_kind WHEN 'payable' THEN v_p.payable_account_id
                         WHEN 'loan' THEN v_p.loan_account_id
                         ELSE v_p.capital_account_id END;
  SELECT branch_id INTO v_branch FROM projects WHERE id = v_p.project_id;

  INSERT INTO journal_entry_batches (tenant_id, batch_date, description, reference_number,
    entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status, branch_id, project_id)
  VALUES (v_p.tenant_id, p_date,
    'Partner settlement (' || p_kind || ') - ' || v_p.partner_name,
    'PRT-' || to_char(p_date,'YYYYMMDD'), 'adjustment', 'adjustment', auth.uid(), true, now(),
    auth.uid(), 'approved', v_branch, v_p.project_id)
  RETURNING id INTO v_batch;

  INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, batch_id, branch_id, project_id)
  VALUES
    (v_p.tenant_id, v_debit, p_date, p_amount, 0, COALESCE(p_notes, 'Partner settlement'),
     'partner_settlement', p_partner_id, auth.uid(), v_batch, v_branch, v_p.project_id),
    (v_p.tenant_id, p_payment_account_id, p_date, 0, p_amount, COALESCE(p_notes, 'Partner settlement'),
     'partner_settlement', p_partner_id, auth.uid(), v_batch, v_branch, v_p.project_id);

  RETURN v_batch;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reimburse_project_partner(uuid,numeric,uuid,date,text,text) TO authenticated, service_role;

-- 17. Partner funding summary (capital / loan / payable / total funded) --
CREATE OR REPLACE FUNCTION public.get_partner_funding_summary(p_project_id uuid)
RETURNS TABLE (
  partner_id uuid, partner_name text, ownership_pct numeric,
  capital_balance numeric, loan_balance numeric, payable_balance numeric,
  total_funded numeric, unclassified_amount numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id, p.partner_name, p.ownership_pct,
    COALESCE(p.opening_capital,0) + COALESCE((
      SELECT SUM(t.credit - t.debit) FROM account_transactions t
      WHERE t.account_id = p.capital_account_id AND NOT COALESCE(t.is_voided,false)),0),
    COALESCE((SELECT SUM(t.credit - t.debit) FROM account_transactions t
      WHERE t.account_id = p.loan_account_id AND NOT COALESCE(t.is_voided,false)),0),
    COALESCE((SELECT SUM(t.credit - t.debit) FROM account_transactions t
      WHERE t.account_id = p.payable_account_id AND NOT COALESCE(t.is_voided,false)),0),
    COALESCE((SELECT SUM(x.amount) FROM project_transactions x
      WHERE x.partner_id = p.id AND x.status = 'posted'),0)
      + COALESCE((SELECT SUM(a.amount) FROM project_acquisitions a
      WHERE a.partner_id = p.id AND a.classification_status = 'posted'),0),
    COALESCE((SELECT SUM(x.amount) FROM project_transactions x
      WHERE x.partner_id = p.id AND x.status IN ('needs_review','classified')),0)
  FROM project_partners p
  WHERE (p_project_id IS NULL OR p.project_id = p_project_id)
    AND p.is_active
    AND public.can_manage_capital(p.tenant_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_partner_funding_summary(uuid) TO authenticated, service_role;