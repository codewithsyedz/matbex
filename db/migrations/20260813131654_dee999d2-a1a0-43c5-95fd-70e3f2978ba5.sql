CREATE OR REPLACE FUNCTION public.suggest_vat_posting_correction(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_batch record;
  v_branch_id uuid;
  v_branch_name text;
  v_rate numeric;
  v_revenue numeric := 0;
  v_vat numeric := 0;
  v_gross numeric := 0;
  v_vat_target numeric := 0;
  v_delta numeric := 0;
  v_vat_account uuid;
  v_lines jsonb := '[]'::jsonb;
  v_alloc numeric := 0;
  v_running numeric := 0;
  v_rec record;
  v_existing uuid;
  v_idx int := 0;
  v_count int := 0;
BEGIN
  SELECT * INTO v_batch FROM journal_entry_batches WHERE id = p_batch_id;
  IF v_batch IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'batch_not_found');
  END IF;

  IF v_batch.tenant_id <> public.get_user_tenant_id(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT COALESCE(SUM(CASE WHEN coa.account_type = 'revenue' THEN COALESCE(t.credit,0) - COALESCE(t.debit,0) ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN coa.account_code = '2200' THEN COALESCE(t.credit,0) - COALESCE(t.debit,0) ELSE 0 END), 0),
         COALESCE(v_batch.branch_id, (MAX(t.branch_id::text))::uuid)
    INTO v_revenue, v_vat, v_branch_id
  FROM account_transactions t
  JOIN chart_of_accounts coa ON coa.id = t.account_id
  WHERE t.batch_id = p_batch_id
    AND COALESCE(t.is_voided, false) = false;

  SELECT b.vat_rate, b.name INTO v_rate, v_branch_name FROM branches b WHERE b.id = v_branch_id;

  IF v_branch_id IS NULL OR v_rate IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_branch_rate', 'branch_id', v_branch_id);
  END IF;

  SELECT t.batch_id INTO v_existing
  FROM account_transactions t
  WHERE t.tenant_id = v_batch.tenant_id
    AND t.reference_type = 'vat_correction'
    AND t.reference_id = p_batch_id::text
    AND COALESCE(t.is_voided, false) = false
  LIMIT 1;

  v_gross := ROUND(v_revenue + v_vat, 2);
  v_vat_target := ROUND(v_gross * v_rate / (100.0 + v_rate), 2);
  v_delta := ROUND(v_vat_target - v_vat, 2);

  SELECT t.account_id INTO v_vat_account
  FROM account_transactions t
  JOIN chart_of_accounts coa ON coa.id = t.account_id
  WHERE t.batch_id = p_batch_id AND coa.account_code = '2200'
    AND COALESCE(t.is_voided, false) = false
  LIMIT 1;

  IF v_vat_account IS NULL THEN
    SELECT id INTO v_vat_account
    FROM chart_of_accounts
    WHERE tenant_id = v_batch.tenant_id AND account_code = '2200'
      AND COALESCE(is_active, true) = true
    ORDER BY created_at
    LIMIT 1;
  END IF;

  IF v_vat_account IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_vat_account');
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT t.account_id
    FROM account_transactions t
    JOIN chart_of_accounts coa ON coa.id = t.account_id
    WHERE t.batch_id = p_batch_id AND coa.account_type = 'revenue'
      AND COALESCE(t.is_voided, false) = false
    GROUP BY t.account_id
    HAVING SUM(COALESCE(t.credit,0) - COALESCE(t.debit,0)) <> 0
  ) x;

  IF v_delta <> 0 AND v_revenue > 0 AND v_count > 0 THEN
    FOR v_rec IN
      SELECT t.account_id,
             coa.account_code,
             coa.account_name,
             SUM(COALESCE(t.credit,0) - COALESCE(t.debit,0)) AS net_credit
      FROM account_transactions t
      JOIN chart_of_accounts coa ON coa.id = t.account_id
      WHERE t.batch_id = p_batch_id AND coa.account_type = 'revenue'
        AND COALESCE(t.is_voided, false) = false
      GROUP BY t.account_id, coa.account_code, coa.account_name
      HAVING SUM(COALESCE(t.credit,0) - COALESCE(t.debit,0)) <> 0
      ORDER BY 4 DESC
    LOOP
      v_idx := v_idx + 1;
      IF v_idx = v_count THEN
        v_alloc := ROUND(ABS(v_delta) - v_running, 2);
      ELSE
        v_alloc := ROUND(ABS(v_delta) * (v_rec.net_credit / v_revenue), 2);
        v_running := v_running + v_alloc;
      END IF;

      IF v_alloc <> 0 THEN
        v_lines := v_lines || jsonb_build_object(
          'account_id', v_rec.account_id,
          'account_code', v_rec.account_code,
          'account_name', v_rec.account_name,
          'debit', CASE WHEN v_delta > 0 THEN v_alloc ELSE 0 END,
          'credit', CASE WHEN v_delta > 0 THEN 0 ELSE v_alloc END
        );
      END IF;
    END LOOP;

    v_lines := v_lines || jsonb_build_object(
      'account_id', v_vat_account,
      'account_code', '2200',
      'account_name', (SELECT account_name FROM chart_of_accounts WHERE id = v_vat_account),
      'debit', CASE WHEN v_delta > 0 THEN 0 ELSE ABS(v_delta) END,
      'credit', CASE WHEN v_delta > 0 THEN ABS(v_delta) ELSE 0 END
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', v_delta <> 0 AND jsonb_array_length(v_lines) > 1 AND v_existing IS NULL,
    'reason', CASE
      WHEN v_existing IS NOT NULL THEN 'already_corrected'
      WHEN v_delta = 0 THEN 'no_variance'
      WHEN jsonb_array_length(v_lines) < 2 THEN 'no_revenue_legs'
      ELSE 'fixable'
    END,
    'batch_id', p_batch_id,
    'existing_correction_batch_id', v_existing,
    'branch_id', v_branch_id,
    'branch_name', v_branch_name,
    'posting_date', v_batch.batch_date,
    'vat_rate', v_rate,
    'gross_takings', v_gross,
    'revenue_current', ROUND(v_revenue, 2),
    'vat_current', ROUND(v_vat, 2),
    'vat_target', v_vat_target,
    'revenue_target', ROUND(v_gross - v_vat_target, 2),
    'delta', v_delta,
    'direction', CASE WHEN v_delta > 0 THEN 'increase_vat' ELSE 'decrease_vat' END,
    'narrative', format(
      'Gross takings of %s stay unchanged. Net revenue moves from %s to %s and output VAT from %s to %s at %s%%.',
      v_gross, ROUND(v_revenue,2), ROUND(v_gross - v_vat_target, 2), ROUND(v_vat,2), v_vat_target, ROUND(v_rate,2)
    ),
    'lines', v_lines
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_vat_posting_correction(
  p_batch_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan jsonb;
  v_batch record;
  v_new_batch uuid;
  v_line jsonb;
  v_tenant uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner'::app_role, 'accountant'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only owners and accountants can apply VAT corrections.';
  END IF;

  v_plan := public.suggest_vat_posting_correction(p_batch_id);

  IF COALESCE((v_plan->>'ok')::boolean, false) = false THEN
    RAISE EXCEPTION 'VAT correction not applicable: %', COALESCE(v_plan->>'reason', 'unknown');
  END IF;

  SELECT * INTO v_batch FROM journal_entry_batches WHERE id = p_batch_id;
  v_tenant := v_batch.tenant_id;

  INSERT INTO journal_entry_batches (
    tenant_id, branch_id, batch_date, description, reference_number,
    entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status
  ) VALUES (
    v_tenant,
    (v_plan->>'branch_id')::uuid,
    COALESCE(v_batch.batch_date, CURRENT_DATE),
    'Output VAT correction - ' || COALESCE(v_batch.description, p_batch_id::text)
      || CASE WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN ' (' || trim(p_note) || ')' ELSE '' END,
    'VATFIX-' || to_char(COALESCE(v_batch.batch_date, CURRENT_DATE), 'YYYYMMDD') || '-' || substr(p_batch_id::text, 1, 8),
    'correction',
    'adjustment',
    auth.uid(), true, now(), auth.uid(), 'approved'
  ) RETURNING id INTO v_new_batch;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_plan->'lines')
  LOOP
    INSERT INTO account_transactions (
      tenant_id, branch_id, account_id, batch_id, transaction_date,
      debit, credit, description, reference_type, reference_id
    ) VALUES (
      v_tenant,
      (v_plan->>'branch_id')::uuid,
      (v_line->>'account_id')::uuid,
      v_new_batch,
      COALESCE(v_batch.batch_date, CURRENT_DATE),
      NULLIF((v_line->>'debit')::numeric, 0),
      NULLIF((v_line->>'credit')::numeric, 0),
      'Output VAT reclassification for ' || COALESCE(v_batch.description, p_batch_id::text),
      'vat_correction',
      p_batch_id::text
    );
  END LOOP;

  INSERT INTO vat_posting_integrity_incidents (
    tenant_id, branch_id, batch_id, source, source_id, posting_date, vat_rate,
    revenue_credit, vat_recorded, vat_expected, variance, tolerance, was_blocked, details
  ) VALUES (
    v_tenant, (v_plan->>'branch_id')::uuid, p_batch_id, 'vat_correction', v_new_batch,
    COALESCE(v_batch.batch_date, CURRENT_DATE), (v_plan->>'vat_rate')::numeric,
    (v_plan->>'revenue_current')::numeric, (v_plan->>'vat_current')::numeric,
    (v_plan->>'vat_target')::numeric, (v_plan->>'delta')::numeric, 0, false,
    'Suggested correction applied. ' || COALESCE(v_plan->>'narrative', '')
  );

  RETURN jsonb_build_object(
    'ok', true,
    'correction_batch_id', v_new_batch,
    'delta', (v_plan->>'delta')::numeric,
    'vat_target', (v_plan->>'vat_target')::numeric,
    'revenue_target', (v_plan->>'revenue_target')::numeric
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.suggest_vat_posting_correction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_vat_posting_correction(uuid, text) TO authenticated;