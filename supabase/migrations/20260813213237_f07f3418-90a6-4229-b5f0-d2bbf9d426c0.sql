CREATE OR REPLACE FUNCTION public.suggest_installment_vat_correction(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan record;
  v_vat_account record;
  v_contra record;
  v_posted numeric := 0;
  v_expected numeric := 0;
  v_goods numeric := 0;
  v_finance numeric := 0;
  v_delta numeric := 0;
  v_existing uuid;
  v_lines jsonb;
  v_label text;
BEGIN
  SELECT * INTO v_plan FROM installment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_found');
  END IF;

  IF NOT public.can_access_restaurant(v_plan.tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  v_label := COALESCE(NULLIF(v_plan.description, ''), NULLIF(v_plan.supplier_name, ''),
                      NULLIF(v_plan.provider, ''), 'Installment purchase');

  IF v_plan.batch_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_batch', 'plan_label', v_label);
  END IF;

  v_goods := ROUND(COALESCE(v_plan.vat_amount, 0), 2);
  v_finance := ROUND(COALESCE(v_plan.finance_vat_amount, 0), 2);
  IF lower(COALESCE(v_plan.status, '')) = 'cancelled' THEN
    v_goods := 0;
    v_finance := 0;
  END IF;
  v_expected := ROUND(v_goods + v_finance, 2);

  -- Input VAT account: the plan's own VAT account, else 1180/1181/1182 or a
  -- named Input VAT / VAT recoverable account for the tenant.
  SELECT coa.id, coa.account_code, coa.account_name INTO v_vat_account
  FROM chart_of_accounts coa
  WHERE coa.tenant_id = v_plan.tenant_id
    AND coa.is_active = true
    AND (
      coa.id = v_plan.vat_account_id
      OR coa.account_code IN ('1180', '1181', '1182')
      OR lower(coa.account_name) LIKE '%input vat%'
      OR lower(coa.account_name) LIKE '%vat recoverable%'
    )
  ORDER BY (coa.id = v_plan.vat_account_id) DESC, coa.account_code
  LIMIT 1;

  IF v_vat_account.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_vat_account', 'plan_label', v_label);
  END IF;

  SELECT COALESCE(SUM(COALESCE(at.debit, 0) - COALESCE(at.credit, 0)), 0)
  INTO v_posted
  FROM account_transactions at
  JOIN chart_of_accounts coa ON coa.id = at.account_id
  WHERE at.batch_id = v_plan.batch_id
    AND COALESCE(at.is_voided, false) = false
    AND (
      coa.account_code IN ('1180', '1181', '1182')
      OR lower(coa.account_name) LIKE '%input vat%'
      OR lower(coa.account_name) LIKE '%vat recoverable%'
    );
  v_posted := ROUND(v_posted, 2);
  v_delta := ROUND(v_expected - v_posted, 2);

  SELECT id INTO v_existing
  FROM journal_entry_batches
  WHERE tenant_id = v_plan.tenant_id
    AND reference_number = 'IVATFIX-' || substr(p_plan_id::text, 1, 8)
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_corrected',
      'plan_label', v_label, 'existing_correction_batch_id', v_existing,
      'expected_vat', v_expected, 'posted_vat', v_posted, 'delta', v_delta);
  END IF;

  IF abs(v_delta) <= 0.02 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_variance',
      'plan_label', v_label, 'expected_vat', v_expected, 'posted_vat', v_posted, 'delta', v_delta);
  END IF;

  -- Contra leg: the asset / cost account the purchase was capitalised to.
  -- Reclassifying between it and Input VAT keeps the purchase total unchanged.
  SELECT coa.id, coa.account_code, coa.account_name INTO v_contra
  FROM chart_of_accounts coa
  WHERE coa.id = v_plan.target_account_id;

  IF v_contra.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_target_account', 'plan_label', v_label,
      'expected_vat', v_expected, 'posted_vat', v_posted, 'delta', v_delta);
  END IF;

  IF v_delta > 0 THEN
    -- Too little input VAT recognised: move value out of the asset cost.
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_vat_account.id, 'account_code', v_vat_account.account_code,
        'account_name', v_vat_account.account_name, 'debit', abs(v_delta), 'credit', 0),
      jsonb_build_object('account_id', v_contra.id, 'account_code', v_contra.account_code,
        'account_name', v_contra.account_name, 'debit', 0, 'credit', abs(v_delta))
    );
  ELSE
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_contra.id, 'account_code', v_contra.account_code,
        'account_name', v_contra.account_name, 'debit', abs(v_delta), 'credit', 0),
      jsonb_build_object('account_id', v_vat_account.id, 'account_code', v_vat_account.account_code,
        'account_name', v_vat_account.account_name, 'debit', 0, 'credit', abs(v_delta))
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', '',
    'plan_id', p_plan_id,
    'plan_label', v_label,
    'branch_id', v_plan.branch_id,
    'purchase_date', v_plan.purchase_date,
    'batch_id', v_plan.batch_id,
    'status', v_plan.status,
    'goods_vat', v_goods,
    'finance_vat', v_finance,
    'expected_vat', v_expected,
    'posted_vat', v_posted,
    'delta', v_delta,
    'direction', CASE WHEN v_delta > 0 THEN 'increase_input_vat' ELSE 'decrease_input_vat' END,
    'narrative', CASE WHEN v_delta > 0
      THEN 'Input VAT is understated by ' || to_char(abs(v_delta), 'FM999999990.00')
           || '. Reclassify that amount out of ' || v_contra.account_code || ' ' || v_contra.account_name
           || ' into ' || v_vat_account.account_code || ' ' || v_vat_account.account_name || '.'
      ELSE 'Input VAT is overstated by ' || to_char(abs(v_delta), 'FM999999990.00')
           || '. Reclassify that amount back from ' || v_vat_account.account_code || ' ' || v_vat_account.account_name
           || ' into ' || v_contra.account_code || ' ' || v_contra.account_name || '.' END,
    'lines', v_lines
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.suggest_installment_vat_correction(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_installment_vat_correction(p_plan_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_proposal jsonb;
  v_plan record;
  v_new_batch uuid;
  v_line jsonb;
  v_date date;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner'::app_role, 'accountant'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only owners and accountants can apply installment VAT corrections.';
  END IF;

  v_proposal := public.suggest_installment_vat_correction(p_plan_id);
  IF COALESCE((v_proposal->>'ok')::boolean, false) = false THEN
    RAISE EXCEPTION 'Installment VAT correction not applicable: %', COALESCE(v_proposal->>'reason', 'unknown');
  END IF;

  SELECT * INTO v_plan FROM installment_plans WHERE id = p_plan_id;
  v_date := COALESCE(v_plan.purchase_date, CURRENT_DATE);

  INSERT INTO journal_entry_batches (
    tenant_id, branch_id, batch_date, description, reference_number,
    entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status
  ) VALUES (
    v_plan.tenant_id,
    v_plan.branch_id,
    v_date,
    'Installment input VAT correction - ' || (v_proposal->>'plan_label')
      || CASE WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN ' (' || trim(p_note) || ')' ELSE '' END,
    'IVATFIX-' || substr(p_plan_id::text, 1, 8),
    'correction',
    'adjustment',
    auth.uid(), true, now(), auth.uid(), 'approved'
  ) RETURNING id INTO v_new_batch;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_proposal->'lines')
  LOOP
    INSERT INTO account_transactions (
      tenant_id, branch_id, account_id, batch_id, transaction_date,
      debit, credit, description, reference_type, reference_id
    ) VALUES (
      v_plan.tenant_id,
      v_plan.branch_id,
      (v_line->>'account_id')::uuid,
      v_new_batch,
      v_date,
      NULLIF((v_line->>'debit')::numeric, 0),
      NULLIF((v_line->>'credit')::numeric, 0),
      'Input VAT reclassification for ' || (v_proposal->>'plan_label'),
      'installment_vat_correction',
      p_plan_id::text
    );
  END LOOP;

  PERFORM public.detect_installment_vat_mismatch(p_plan_id);

  RETURN jsonb_build_object(
    'ok', true,
    'correction_batch_id', v_new_batch,
    'delta', (v_proposal->>'delta')::numeric,
    'expected_vat', (v_proposal->>'expected_vat')::numeric,
    'posted_vat', (v_proposal->>'posted_vat')::numeric
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_installment_vat_correction(uuid, text) TO authenticated;