
CREATE TABLE IF NOT EXISTS public.project_acquisition_funders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  acquisition_id uuid not null references public.project_acquisitions(id) on delete cascade,
  paid_by text not null default 'partner',
  partner_id uuid,
  funding_classification text,
  payment_account_id uuid,
  amount numeric(15,2) not null,
  notes text,
  created_at timestamptz not null default now(),
  CONSTRAINT acq_funder_paid_by_check CHECK (paid_by = ANY (ARRAY['company','partner'])),
  CONSTRAINT acq_funder_funding_check CHECK (funding_classification IS NULL OR funding_classification = ANY (ARRAY['capital','loan','payable'])),
  CONSTRAINT acq_funder_partner_check CHECK (paid_by <> 'partner' OR partner_id IS NOT NULL),
  CONSTRAINT acq_funder_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_acq_funders_acq ON public.project_acquisition_funders(acquisition_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_acquisition_funders TO authenticated;
GRANT ALL ON public.project_acquisition_funders TO service_role;

ALTER TABLE public.project_acquisition_funders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance roles manage acquisition funders" ON public.project_acquisition_funders;
CREATE POLICY "Finance roles manage acquisition funders"
ON public.project_acquisition_funders
FOR ALL TO authenticated
USING (public.can_manage_capital(tenant_id))
WITH CHECK (public.can_manage_capital(tenant_id));

CREATE OR REPLACE FUNCTION public.post_project_acquisition(p_acq_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_a project_acquisitions;
  v_total numeric(15,2);
  v_funded numeric(15,2);
  v_batch uuid; v_credit uuid; v_line RECORD; v_asset uuid;
  v_has_funders boolean;
  v_primary_partner uuid;
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
    jsonb_build_object('amount', v_a.amount, 'seller', v_a.seller_name, 'funders', v_has_funders), v_batch, auth.uid());

  RETURN v_batch;
END;
$fn$;
