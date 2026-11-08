
-- 1. VAT columns
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vat_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric(15,2),
  ADD COLUMN IF NOT EXISTS vat_inclusive boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vat_rate numeric(6,3);

ALTER TABLE public.project_acquisitions
  ADD COLUMN IF NOT EXISTS vat_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_inclusive boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vat_rate numeric(6,3);

UPDATE public.expenses SET net_amount = amount WHERE net_amount IS NULL;

-- 2. VAT account resolver
CREATE OR REPLACE FUNCTION public.resolve_vat_account(p_tenant_id uuid, p_kind text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM public.chart_of_accounts
  WHERE tenant_id = p_tenant_id
    AND account_code = CASE WHEN p_kind = 'output' THEN '2200' ELSE '1180' END
    AND COALESCE(is_active, true)
  LIMIT 1
$$;

-- 3. Allocation total is checked against the NET price
CREATE OR REPLACE FUNCTION public.enforce_acquisition_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_price numeric;
  v_total numeric;
BEGIN
  SELECT amount - COALESCE(vat_amount, 0) INTO v_price
  FROM public.project_acquisitions WHERE id = NEW.acquisition_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_total
  FROM public.project_acquisition_allocations
  WHERE acquisition_id = NEW.acquisition_id AND id <> NEW.id;
  v_total := v_total + NEW.amount;
  IF v_price IS NOT NULL AND v_total > v_price + 0.01 THEN
    RAISE EXCEPTION 'Purchase price allocation (%.2f) exceeds the net acquisition price (%.2f)', v_total, v_price;
  END IF;
  RETURN NEW;
END;
$function$;

-- 4. Expense posting: split net vs input VAT
CREATE OR REPLACE FUNCTION public.post_expense_to_ledger(p_expense_id uuid, p_account_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expense RECORD;
  v_debit_tx_id uuid;
  v_account_type text;
  v_debit_account_id uuid;
  v_credit_account_id uuid;
  v_credit_parent_id uuid;
  v_credit_code text;
  v_credit_label text;
  v_batch_id uuid;
  v_actor_id uuid;
  v_journal_type text;
  v_dr numeric;
  v_cr numeric;
  v_vat numeric;
  v_net numeric;
  v_vat_account uuid;
BEGIN
  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF v_expense.approval_status != 'approved' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted to ledger';
  END IF;
  IF COALESCE(v_expense.ledger_posted, false) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense has already been posted to ledger';
  END IF;

  v_vat := ROUND(COALESCE(v_expense.vat_amount, 0), 2);
  IF v_vat < 0 OR v_vat > v_expense.amount + 0.005 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: VAT amount % is not valid for an expense of %', v_vat, v_expense.amount;
  END IF;
  v_net := ROUND(v_expense.amount - v_vat, 2);

  SELECT account_type::text INTO v_account_type
  FROM public.chart_of_accounts WHERE id = p_account_id;

  IF v_account_type = 'cogs' THEN
    v_debit_account_id := public.resolve_inventory_account_for_cogs(v_expense.tenant_id, p_account_id);
    v_journal_type := 'purchase';
    IF v_debit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: No inventory asset account found for COGS routing';
    END IF;
  ELSE
    v_debit_account_id := p_account_id;
    v_journal_type := 'expense';
  END IF;

  IF v_debit_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense must have a Chart of Accounts mapping before posting to ledger';
  END IF;

  v_debit_account_id := public.resolve_branch_account(v_debit_account_id, v_expense.branch_id);

  IF v_vat > 0 THEN
    v_vat_account := public.resolve_vat_account(v_expense.tenant_id, 'input');
    IF v_vat_account IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Input VAT account (1180) not found in chart of accounts';
    END IF;
    v_vat_account := public.resolve_branch_account(v_vat_account, v_expense.branch_id);
  END IF;

  IF COALESCE(v_expense.status, 'unpaid') = 'paid' THEN
    v_credit_account_id := public.resolve_expense_funding_account(p_expense_id);
    IF v_credit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: No funding account resolved for this paid expense';
    END IF;
    SELECT account_code INTO v_credit_code FROM public.chart_of_accounts WHERE id = v_credit_account_id;
    v_credit_label := CASE
      WHEN v_expense.capital_account_id IS NOT NULL THEN 'paid by partner (Capital)'
      ELSE 'paid (' || COALESCE(v_credit_code, 'Cash') || ')'
    END;
  ELSE
    v_credit_code := '2000';
    SELECT id INTO v_credit_parent_id
    FROM public.chart_of_accounts
    WHERE tenant_id = v_expense.tenant_id AND account_code = '2000' LIMIT 1;
    IF v_credit_parent_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Counter-account 2000 not found in chart of accounts for this tenant';
    END IF;
    v_credit_account_id := public.resolve_branch_account(v_credit_parent_id, v_expense.branch_id);
    v_credit_label := 'on credit (AP)';
  END IF;

  v_actor_id := COALESCE(auth.uid(), v_expense.approved_by, v_expense.created_by);

  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, batch_date, description, reference_number, entry_type, created_by,
    is_posted, posted_at, posted_by, journal_type, approval_status, approved_by, approved_at
  ) VALUES (
    v_expense.tenant_id, v_expense.branch_id, v_expense.expense_date,
    CASE WHEN v_journal_type = 'purchase' THEN 'Inventory purchase from expense: ' ELSE 'Expense posting: ' END
      || COALESCE(v_expense.description, v_expense.id::text),
    'EXP-' || v_expense.id::text, v_journal_type, v_actor_id,
    true, now(), v_actor_id, v_journal_type, 'approved', v_actor_id, now()
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_expense.tenant_id, v_debit_account_id, v_expense.expense_date, v_net, NULL,
    CASE WHEN v_journal_type = 'purchase'
         THEN COALESCE(v_expense.description, 'Inventory purchase') || ' — inventory purchase (net)'
         ELSE COALESCE(v_expense.description, 'Expense') END,
    'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
  ) RETURNING id INTO v_debit_tx_id;

  IF v_vat > 0 THEN
    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by, branch_id, batch_id
    ) VALUES (
      v_expense.tenant_id, v_vat_account, v_expense.expense_date, v_vat, NULL,
      COALESCE(v_expense.description, 'Expense') || ' — input VAT recoverable',
      'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
    );
  END IF;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_expense.tenant_id, v_credit_account_id, v_expense.expense_date, NULL, v_expense.amount,
    COALESCE(v_expense.description, 'Expense') || ' — ' || v_credit_label,
    'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
  );

  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
    INTO v_dr, v_cr
  FROM public.account_transactions
  WHERE batch_id = v_batch_id AND COALESCE(is_voided, false) = false;

  IF abs(v_dr - v_cr) > 0.005 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense posting is unbalanced (DR % vs CR %)', v_dr, v_cr;
  END IF;

  UPDATE public.expenses
  SET ledger_posted = true, ledger_transaction_id = v_debit_tx_id, account_id = p_account_id,
      net_amount = v_net
  WHERE id = p_expense_id;

  BEGIN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, batch_id, transaction_ids,
      dr_total, cr_total, trigger_source, triggered_by
    )
    SELECT v_expense.tenant_id, p_expense_id, v_expense.branch_id, 'post', 'success',
           'posted', 'Posted via post_expense_to_ledger, credit account ' || COALESCE(v_credit_code,'?')
             || CASE WHEN v_vat > 0 THEN ', input VAT ' || v_vat::text ELSE '' END, v_batch_id,
           array_agg(t.id),
           COALESCE(sum(t.debit),0), COALESCE(sum(t.credit),0),
           CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END,
           v_actor_id
    FROM public.account_transactions t WHERE t.batch_id = v_batch_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_debit_tx_id;
END;
$function$;

-- 5. Acquisition posting: allocations = net, VAT booked to 1180
CREATE OR REPLACE FUNCTION public.post_project_acquisition(p_acq_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_a project_acquisitions;
  v_total numeric(15,2);
  v_funded numeric(15,2);
  v_batch uuid; v_credit uuid; v_line RECORD; v_asset uuid;
  v_has_funders boolean;
  v_primary_partner uuid;
  v_vat numeric(15,2);
  v_net numeric(15,2);
  v_vat_account uuid;
BEGIN
  SELECT * INTO v_a FROM project_acquisitions WHERE id = p_acq_id FOR UPDATE;
  IF v_a IS NULL THEN RAISE EXCEPTION 'ACQUISITION_NOT_FOUND'; END IF;
  IF NOT public.can_manage_capital(v_a.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only finance roles can post an acquisition.';
  END IF;
  IF v_a.classification_status = 'posted' THEN RAISE EXCEPTION 'ALREADY_POSTED'; END IF;

  v_vat := ROUND(COALESCE(v_a.vat_amount, 0), 2);
  IF v_vat < 0 OR v_vat > v_a.amount + 0.005 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: VAT amount % is not valid for a purchase price of %', v_vat, v_a.amount;
  END IF;
  v_net := ROUND(v_a.amount - v_vat, 2);

  SELECT COALESCE(SUM(amount),0) INTO v_total FROM project_acquisition_allocations WHERE acquisition_id = p_acq_id;
  IF ABS(v_total - v_net) > 0.005 THEN
    RAISE EXCEPTION 'ALLOCATION_INCOMPLETE: Allocated % of %. The allocation must equal the net purchase price exactly.', v_total, v_net;
  END IF;

  SELECT EXISTS(SELECT 1 FROM project_acquisition_funders WHERE acquisition_id = p_acq_id) INTO v_has_funders;
  IF v_has_funders THEN
    SELECT COALESCE(SUM(amount),0) INTO v_funded FROM project_acquisition_funders WHERE acquisition_id = p_acq_id;
    IF ABS(v_funded - v_a.amount) > 0.005 THEN
      RAISE EXCEPTION 'FUNDING_INCOMPLETE: Funding split totals % of %. The funding sources must equal the purchase price exactly.', v_funded, v_a.amount;
    END IF;
  END IF;

  INSERT INTO journal_entry_batches (tenant_id, batch_date, description, reference_number,
    entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status, branch_id, project_id)
  VALUES (v_a.tenant_id, v_a.acquisition_date,
    'Business acquisition - ' || v_a.seller_name, 'ACQ-' || to_char(v_a.acquisition_date,'YYYYMMDD'),
    'adjustment', 'adjustment', COALESCE(auth.uid(), v_a.created_by), true, now(), auth.uid(),
    'approved', v_a.branch_id, v_a.project_id)
  RETURNING id INTO v_batch;

  SELECT CASE WHEN v_has_funders THEN (
      SELECT partner_id FROM project_acquisition_funders
      WHERE acquisition_id = p_acq_id AND paid_by = 'partner'
      ORDER BY amount DESC LIMIT 1)
    ELSE v_a.partner_id END INTO v_primary_partner;

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
        CASE WHEN v_primary_partner IS NOT NULL THEN 'partner' ELSE 'company' END,
        CASE WHEN v_primary_partner IS NULL THEN v_a.payment_account_id ELSE NULL END,
        v_primary_partner, v_line.asset_useful_life_months, NULL, v_a.seller_name,
        'Acquired with business purchase');
      UPDATE project_acquisition_allocations SET asset_id = v_asset WHERE id = v_line.id;
    END IF;
  END LOOP;

  IF v_vat > 0 THEN
    v_vat_account := public.resolve_vat_account(v_a.tenant_id, 'input');
    IF v_vat_account IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Input VAT account (1180) not found in chart of accounts';
    END IF;
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by, batch_id, branch_id, project_id)
    VALUES (v_a.tenant_id, v_vat_account, v_a.acquisition_date, v_vat, 0,
      'Acquisition input VAT - ' || v_a.seller_name, 'project_acquisition', p_acq_id, auth.uid(),
      v_batch, v_a.branch_id, v_a.project_id);
  END IF;

  IF v_has_funders THEN
    FOR v_line IN SELECT f.*, p.partner_name
      FROM project_acquisition_funders f
      LEFT JOIN project_partners p ON p.id = f.partner_id
      WHERE f.acquisition_id = p_acq_id LOOP
      v_credit := public.resolve_project_funding_account(v_a.tenant_id, v_line.paid_by, v_line.partner_id,
                    v_line.funding_classification, v_line.payment_account_id, true);
      INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, batch_id, branch_id, project_id)
      VALUES (v_a.tenant_id, v_credit, v_a.acquisition_date, 0, v_line.amount,
        'Acquisition funding (' || COALESCE(v_line.partner_name, 'Company') || ') - ' || v_a.seller_name,
        'project_acquisition', p_acq_id, auth.uid(), v_batch, v_a.branch_id, v_a.project_id);
    END LOOP;
  ELSE
    v_credit := public.resolve_project_funding_account(v_a.tenant_id, v_a.paid_by, v_a.partner_id,
                  v_a.funding_classification, v_a.payment_account_id, true);
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by, batch_id, branch_id, project_id)
    VALUES (v_a.tenant_id, v_credit, v_a.acquisition_date, 0, v_a.amount,
      'Acquisition funding - ' || v_a.seller_name, 'project_acquisition', p_acq_id, auth.uid(),
      v_batch, v_a.branch_id, v_a.project_id);
  END IF;

  UPDATE project_acquisitions SET classification_status = 'posted', batch_id = v_batch,
    posted_at = now(), posted_by = auth.uid() WHERE id = p_acq_id;

  INSERT INTO project_classification_audit (tenant_id, acquisition_id, action, new_value, batch_id, performed_by)
  VALUES (v_a.tenant_id, p_acq_id, 'acquisition_posted',
    jsonb_build_object('amount', v_a.amount, 'vat', v_vat, 'seller', v_a.seller_name, 'funders', v_has_funders), v_batch, auth.uid());

  RETURN v_batch;
END;
$function$;
