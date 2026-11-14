-- add_tenant_checks_to_definer_writers
--
-- These SECURITY DEFINER functions are called from logged-in pages and change data, but
-- never checked whose data they were given. Being SECURITY DEFINER they bypass RLS, so a
-- user of one tenant could post another tenant's payroll to its ledger, delete its staff
-- advance repayments, seed its chart of accounts, bump its usage counters, provision its
-- subdomain, and so on. log_superadmin_event trusted a caller-supplied _actor_id, so any
-- user could write audit events as a real superadmin.
--
-- Each function now starts with an access check derived from the row it is given; the
-- rest of every body is unchanged. Calls without a user (service role, cron, other
-- SECURITY DEFINER functions) have auth.uid() = NULL and are not affected. anon cannot
-- execute any of these (20261109104352). A missing row is left to the function's own
-- "not found" handling.

CREATE OR REPLACE FUNCTION public.assert_restaurant_access(_restaurant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR _restaurant_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.can_access_restaurant(_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied to restaurant %', _restaurant_id USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_tenant_access(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR _tenant_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT (public.is_superadmin(auth.uid()) OR public.user_belongs_to_tenant(auth.uid(), _tenant_id)) THEN
    RAISE EXCEPTION 'Access denied to tenant %', _tenant_id USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_restaurant_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_tenant_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_restaurant_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_tenant_access(uuid) TO authenticated, service_role;


-- apply_fines_to_payroll
CREATE OR REPLACE FUNCTION public.apply_fines_to_payroll(p_payroll_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pay public.payroll_records;
  v_total numeric := 0;
  v_ids uuid[];
  v_preview jsonb;
  v_mode text := 'installment_date';
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.payroll_records WHERE id = p_payroll_id));

  SELECT * INTO v_pay FROM public.payroll_records WHERE id = p_payroll_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_NOT_FOUND'; END IF;

  v_preview := public.preview_payroll_deduction_allocation(p_payroll_id);
  IF (v_preview->>'requires_allocation')::boolean THEN
    RAISE EXCEPTION 'DEDUCTION_ALLOCATION_REQUIRED: Total deductions % exceed the permitted maximum % (% percent of %). Excess: %. Choose which deductions to defer.',
      v_preview->>'requested_total', v_preview->>'max_deduction',
      v_preview->>'max_deduction_pct', v_preview->>'gross_wage', v_preview->>'excess_amount';
  END IF;

  SELECT COALESCE(fs.fine_allocation_mode, 'installment_date')
  INTO v_mode
  FROM public.fiscal_settings fs
  WHERE fs.restaurant_id = v_pay.restaurant_id
  LIMIT 1;

  v_mode := COALESCE(v_mode, 'installment_date');

  -- Allocation basis is configurable: either the installment schedule
  -- (payroll_month) or the date the fine was created.
  SELECT COALESCE(SUM(GREATEST(amount - COALESCE(recovered_amount, 0), 0)), 0),
         COALESCE(array_agg(id), '{}')
  INTO v_total, v_ids
  FROM public.employee_fines
  WHERE staff_id = v_pay.staff_id
    AND status = 'approved'
    AND deleted_at IS NULL
    AND (
      (v_mode = 'created_date' AND created_at::date <= v_pay.period_end)
      OR (v_mode <> 'created_date' AND payroll_month <= v_pay.period_end)
    )
    AND GREATEST(amount - COALESCE(recovered_amount, 0), 0) > 0;

  UPDATE public.payroll_records SET fines_deducted = v_total WHERE id = p_payroll_id;

  UPDATE public.employee_fines
  SET status = 'applied',
      recovered_amount = amount,
      applied_payroll_id = p_payroll_id,
      applied_at = now()
  WHERE id = ANY(v_ids);

  RETURN jsonb_build_object('applied_count', COALESCE(array_length(v_ids,1),0), 'total', v_total, 'mode', v_mode);
END;
$function$;


-- deduct_advance_from_payroll
CREATE OR REPLACE FUNCTION public.deduct_advance_from_payroll(p_advance_id uuid, p_payroll_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_advance RECORD;
  v_restaurant RECORD;
  v_advance_account_id uuid;
  v_cash_account_id uuid;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.staff_advances WHERE id = p_advance_id));
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.payroll_records WHERE id = p_payroll_id));

  SELECT sa.*, s.name AS staff_name INTO v_advance
  FROM staff_advances sa
  JOIN staff s ON sa.staff_id = s.id
  WHERE sa.id = p_advance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff advance record not found';
  END IF;

  IF v_advance.status = 'deducted' THEN
    RAISE EXCEPTION 'Advance already deducted';
  END IF;

  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_advance.restaurant_id;

  -- When recovered outside payroll, the employee repays in cash:
  -- DR Cash / CR Advance to Employees Against Salary.
  -- When linked to a payroll record, post_payroll_to_ledger already credits 1150,
  -- so no journal is created here (avoids double-counting wages).
  IF p_payroll_id IS NULL THEN
    SELECT id INTO v_advance_account_id FROM chart_of_accounts
    WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1150' AND is_active = true LIMIT 1;

    SELECT id INTO v_cash_account_id FROM chart_of_accounts
    WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;

    IF v_advance_account_id IS NOT NULL AND v_cash_account_id IS NOT NULL THEN
      INSERT INTO account_transactions (
        tenant_id, account_id, transaction_date, debit,
        description, reference_type, reference_id
      )
      VALUES (
        v_restaurant.tenant_id, v_cash_account_id, CURRENT_DATE, v_advance.amount,
        'Advance repaid by employee - ' || v_advance.staff_name, 'advance_deduction', p_advance_id
      );

      INSERT INTO account_transactions (
        tenant_id, account_id, transaction_date, credit,
        description, reference_type, reference_id
      )
      VALUES (
        v_restaurant.tenant_id, v_advance_account_id, CURRENT_DATE, v_advance.amount,
        'Advance repaid by employee - ' || v_advance.staff_name, 'advance_deduction', p_advance_id
      );
    END IF;
  END IF;

  UPDATE staff_advances
  SET status = 'deducted',
      deducted_from_payroll_id = p_payroll_id,
      deducted_at = now(),
      updated_at = now()
  WHERE id = p_advance_id;
END;
$function$;


-- delete_staff_advance_repayment
CREATE OR REPLACE FUNCTION public.delete_staff_advance_repayment(p_repayment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rep RECORD;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_tenant_access((SELECT tenant_id FROM public.staff_advance_repayments WHERE id = p_repayment_id));

  SELECT * INTO v_rep FROM staff_advance_repayments WHERE id = p_repayment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repayment not found';
  END IF;

  DELETE FROM account_transactions
  WHERE reference_type = 'staff_advance_repayment'
    AND reference_id = v_rep.advance_id
    AND tenant_id = v_rep.tenant_id
    AND transaction_date = v_rep.repayment_date
    AND (debit = v_rep.amount OR credit = v_rep.amount)
    AND (id = v_rep.ledger_transaction_id OR v_rep.ledger_transaction_id IS NULL OR true);

  UPDATE staff_advances
  SET repaid_amount = GREATEST(COALESCE(repaid_amount, 0) - v_rep.amount, 0),
      status = CASE WHEN status = 'deducted' AND GREATEST(COALESCE(repaid_amount,0) - v_rep.amount, 0) < amount - 0.005 THEN 'pending' ELSE status END,
      deducted_at = CASE WHEN GREATEST(COALESCE(repaid_amount,0) - v_rep.amount, 0) < amount - 0.005 THEN NULL ELSE deducted_at END,
      updated_at = now()
  WHERE id = v_rep.advance_id;

  DELETE FROM staff_advance_repayments WHERE id = p_repayment_id;
END;
$function$;


-- ensure_fixed_asset_accounts
CREATE OR REPLACE FUNCTION public.ensure_fixed_asset_accounts(_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expense uuid;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_tenant_access(_tenant_id);

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


-- ensure_partner_funding_accounts
CREATE OR REPLACE FUNCTION public.ensure_partner_funding_accounts(p_partner_id uuid)
 RETURNS project_partners
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p project_partners;
  v_code text;
  v_id uuid;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_tenant_access((SELECT tenant_id FROM public.project_partners WHERE id = p_partner_id));

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
$function$;


-- ensure_project_accounts
CREATE OR REPLACE FUNCTION public.ensure_project_accounts(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_tenant_access(p_tenant_id);

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
$function$;


-- increment_usage
CREATE OR REPLACE FUNCTION public.increment_usage(p_tenant_id uuid, p_quota_type text, p_amount integer DEFAULT 1)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_tenant_access(p_tenant_id);

  UPDATE public.tenant_usage
  SET
    image_upload_count = CASE WHEN p_quota_type = 'image_uploads' THEN image_upload_count + p_amount ELSE image_upload_count END,
    email_reminder_count = CASE WHEN p_quota_type = 'email_reminders' THEN email_reminder_count + p_amount ELSE email_reminder_count END,
    updated_at = now()
  WHERE tenant_id = p_tenant_id;
  
  RETURN FOUND;
END;
$function$;


-- log_superadmin_event
CREATE OR REPLACE FUNCTION public.log_superadmin_event(_actor_id uuid, _actor_email text, _action_type superadmin_action_type, _target_type audit_target_type, _target_id uuid DEFAULT NULL::uuid, _target_identifier text DEFAULT NULL::text, _metadata_before jsonb DEFAULT '{}'::jsonb, _metadata_after jsonb DEFAULT '{}'::jsonb, _context jsonb DEFAULT '{}'::jsonb, _summary text DEFAULT NULL::text, _ip_address text DEFAULT NULL::text, _user_agent text DEFAULT NULL::text, _correlation_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _event_id UUID;
  _previous_id UUID;
  _hash_input TEXT;
  _event_hash TEXT;
BEGIN
  -- [access check added 20261109]
  IF auth.uid() IS NOT NULL AND _actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Audit events can only be logged for yourself' USING ERRCODE = '42501';
  END IF;

  -- Verify the actor is actually a SuperAdmin
  IF NOT is_superadmin(_actor_id) THEN
    RAISE EXCEPTION 'Actor is not a SuperAdmin';
  END IF;

  -- Get the previous event for hash chain
  SELECT id INTO _previous_id
  FROM public.superadmin_audit_events
  ORDER BY timestamp DESC
  LIMIT 1;

  -- Create hash input (simplified hash chain)
  _hash_input := COALESCE(_previous_id::text, 'genesis') || '|' || 
                 _actor_id::text || '|' || 
                 _action_type::text || '|' || 
                 now()::text;
  _event_hash := encode(sha256(_hash_input::bytea), 'hex');

  -- Insert the audit event
  INSERT INTO public.superadmin_audit_events (
    actor_id,
    actor_email,
    actor_role,
    action_type,
    target_type,
    target_id,
    target_identifier,
    metadata_before,
    metadata_after,
    context,
    summary,
    ip_address,
    user_agent,
    correlation_id,
    previous_event_id,
    event_hash
  ) VALUES (
    _actor_id,
    _actor_email,
    'superadmin',
    _action_type,
    _target_type,
    _target_id,
    _target_identifier,
    _metadata_before,
    _metadata_after,
    _context,
    _summary,
    _ip_address,
    _user_agent,
    _correlation_id,
    _previous_id,
    _event_hash
  )
  RETURNING id INTO _event_id;

  RETURN _event_id;
END;
$function$;


-- post_day_end_adjustment_to_ledger
CREATE OR REPLACE FUNCTION public.post_day_end_adjustment_to_ledger(p_adjustment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_adj            RECORD;
  v_cash_id        uuid;
  v_overshort_id   uuid;
  v_batch_id       uuid;
  v_abs            numeric(14,2);
  v_desc           text;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_tenant_access((SELECT tenant_id FROM public.day_end_adjustments WHERE id = p_adjustment_id));
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.day_end_adjustments WHERE id = p_adjustment_id));

  SELECT * INTO v_adj FROM public.day_end_adjustments WHERE id = p_adjustment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Day-end adjustment not found'; END IF;
  IF v_adj.ledger_posted THEN RAISE EXCEPTION 'Day-end adjustment already posted'; END IF;
  IF v_adj.amount = 0 THEN RAISE EXCEPTION 'Day-end adjustment amount cannot be zero'; END IF;

  SELECT id INTO v_cash_id FROM public.chart_of_accounts
   WHERE tenant_id = v_adj.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
  SELECT id INTO v_overshort_id FROM public.chart_of_accounts
   WHERE tenant_id = v_adj.tenant_id AND account_code = '6999' AND is_active = true LIMIT 1;

  IF v_cash_id IS NULL THEN RAISE EXCEPTION 'Cash on Hand (1000) not configured'; END IF;
  IF v_overshort_id IS NULL THEN RAISE EXCEPTION 'Cash Over/Short (6999) not configured'; END IF;

  v_abs := abs(v_adj.amount);
  v_desc := 'Day-End Adjustment [' || v_adj.reason::text || ']: ' || v_adj.notes;

  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, batch_date, description, reference_number, entry_type,
    journal_type, created_by, is_posted, posted_at, posted_by
  ) VALUES (
    v_adj.tenant_id, v_adj.branch_id, v_adj.business_date, v_desc,
    'DEA-' || to_char(v_adj.business_date,'YYYYMMDD') || '-' || substr(p_adjustment_id::text,1,8),
    'adjustment', 'manual', v_adj.created_by, true, now(), v_adj.created_by
  ) RETURNING id INTO v_batch_id;

  IF v_adj.amount > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (v_adj.tenant_id, v_cash_id, v_adj.business_date, v_abs, v_desc, 'day_end_adjustment', p_adjustment_id, v_adj.created_by, v_batch_id, v_adj.branch_id);
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (v_adj.tenant_id, v_overshort_id, v_adj.business_date, v_abs, v_desc, 'day_end_adjustment', p_adjustment_id, v_adj.created_by, v_batch_id, v_adj.branch_id);
  ELSE
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (v_adj.tenant_id, v_overshort_id, v_adj.business_date, v_abs, v_desc, 'day_end_adjustment', p_adjustment_id, v_adj.created_by, v_batch_id, v_adj.branch_id);
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (v_adj.tenant_id, v_cash_id, v_adj.business_date, v_abs, v_desc, 'day_end_adjustment', p_adjustment_id, v_adj.created_by, v_batch_id, v_adj.branch_id);
  END IF;

  UPDATE public.day_end_adjustments
     SET ledger_posted = true, ledger_batch_id = v_batch_id
   WHERE id = p_adjustment_id;

  RETURN v_batch_id;
END;
$function$;


-- post_night_summary_to_ledger
CREATE OR REPLACE FUNCTION public.post_night_summary_to_ledger(p_summary_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_summary record;
  v_batch_id uuid;
  v_cash_account_id uuid;
  v_card_account_id uuid;
  v_revenue_account_id uuid;
  v_vat_account_id uuid;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.night_shift_summaries WHERE id = p_summary_id));

  -- Get summary details
  SELECT * INTO v_summary FROM night_shift_summaries WHERE id = p_summary_id;

  IF v_summary IS NULL THEN
    RAISE EXCEPTION 'Night shift summary not found';
  END IF;

  IF v_summary.ledger_posted THEN
    RAISE EXCEPTION 'Summary already posted to ledger';
  END IF;

  -- Branch VAT rate must exist and agree with the VAT recorded on the summary
  PERFORM public.assert_night_summary_vat_consistent(p_summary_id);

  -- Get account IDs
  SELECT id INTO v_cash_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '1000' LIMIT 1;
  
  SELECT id INTO v_card_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '1020' LIMIT 1;
  
  SELECT id INTO v_revenue_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '4000' LIMIT 1;
  
  SELECT id INTO v_vat_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '2200' LIMIT 1;
  
  -- Create journal batch
  INSERT INTO journal_entry_batches (
    tenant_id, description, journal_type, reference_type, reference_id, status
  ) VALUES (
    v_summary.tenant_id,
    'Night Shift Summary - ' || v_summary.business_date,
    'sale',
    'night_summary',
    p_summary_id,
    'posted'
  ) RETURNING id INTO v_batch_id;
  
  -- Dr Cash
  IF v_summary.cash_collected > 0 AND v_cash_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, debit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_cash_account_id, v_batch_id, v_summary.business_date,
      v_summary.cash_collected, 'Night summary cash', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Dr Card Clearing
  IF v_summary.card_collected > 0 AND v_card_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, debit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_card_account_id, v_batch_id, v_summary.business_date,
      v_summary.card_collected, 'Night summary card', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Cr Revenue
  IF v_summary.net_sales > 0 AND v_revenue_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, credit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_revenue_account_id, v_batch_id, v_summary.business_date,
      v_summary.net_sales, 'Night summary revenue', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Cr VAT (if applicable)
  IF v_summary.vat_amount > 0 AND v_vat_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, credit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_vat_account_id, v_batch_id, v_summary.business_date,
      v_summary.vat_amount, 'Night summary VAT', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Mark as posted
  UPDATE night_shift_summaries 
  SET ledger_posted = true, ledger_batch_id = v_batch_id
  WHERE id = p_summary_id;
  
  PERFORM public.check_sale_posting_vat_integrity(v_batch_id, 'night_summary', p_summary_id);

  RETURN v_batch_id;
END;
$function$;


-- post_overhead_payment_to_ledger
CREATE OR REPLACE FUNCTION public.post_overhead_payment_to_ledger(p_payment_id uuid, p_payment_method text DEFAULT 'cash'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment RECORD;
  v_overhead RECORD;
  v_batch_id UUID;
  v_expense_account_id UUID;
  v_credit_account_id UUID;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.overhead_payments WHERE id = p_payment_id));

  SELECT * INTO v_payment FROM overhead_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  
  IF v_payment.ledger_posted = true THEN
    RAISE EXCEPTION 'Payment already posted to ledger';
  END IF;
  
  SELECT * INTO v_overhead FROM overhead_allocation WHERE id = v_payment.overhead_allocation_id;
  
  IF v_overhead.account_id IS NOT NULL THEN
    v_expense_account_id := v_overhead.account_id;
  ELSE
    SELECT id INTO v_expense_account_id FROM chart_of_accounts 
    WHERE tenant_id = v_payment.tenant_id 
    AND account_code = CASE 
      WHEN LOWER(v_overhead.name) LIKE '%rent%' THEN '6000'
      WHEN LOWER(v_overhead.name) LIKE '%utilit%' OR LOWER(v_overhead.name) LIKE '%electric%' OR LOWER(v_overhead.name) LIKE '%water%' OR LOWER(v_overhead.name) LIKE '%gas%' THEN '6050'
      WHEN LOWER(v_overhead.name) LIKE '%insurance%' THEN '6100'
      WHEN LOWER(v_overhead.name) LIKE '%internet%' OR LOWER(v_overhead.name) LIKE '%phone%' THEN '6150'
      ELSE '6200'
    END
    AND is_active = true
    LIMIT 1;
  END IF;
  
  SELECT id INTO v_credit_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_payment.tenant_id 
  AND account_code = CASE 
    WHEN p_payment_method = 'cash' THEN '1000'
    WHEN p_payment_method IN ('card', 'bank') THEN '1010'
    ELSE '2000'
  END
  AND is_active = true
  LIMIT 1;
  
  IF v_expense_account_id IS NULL OR v_credit_account_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts not found';
  END IF;
  
  INSERT INTO journal_entry_batches (
    tenant_id, description, reference_type, reference_id, entry_date, is_approved
  ) VALUES (
    v_payment.tenant_id,
    'Overhead Payment: ' || v_overhead.name || ' for ' || TO_CHAR(v_payment.payment_month, 'Mon YYYY'),
    'overhead_payment',
    p_payment_id,
    v_payment.payment_date,
    true
  ) RETURNING id INTO v_batch_id;
  
  INSERT INTO account_transactions (
    tenant_id, account_id, batch_id, transaction_date, debit, description, reference_type, reference_id
  ) VALUES (
    v_payment.tenant_id, v_expense_account_id, v_batch_id, v_payment.payment_date,
    v_payment.amount_paid, 'Overhead: ' || v_overhead.name, 'overhead_payment', p_payment_id
  );
  
  INSERT INTO account_transactions (
    tenant_id, account_id, batch_id, transaction_date, credit, description, reference_type, reference_id
  ) VALUES (
    v_payment.tenant_id, v_credit_account_id, v_batch_id, v_payment.payment_date,
    v_payment.amount_paid, 'Overhead: ' || v_overhead.name, 'overhead_payment', p_payment_id
  );
  
  UPDATE chart_of_accounts SET balance = COALESCE(balance, 0) + v_payment.amount_paid 
  WHERE id = v_expense_account_id;
  
  UPDATE chart_of_accounts SET balance = COALESCE(balance, 0) - v_payment.amount_paid 
  WHERE id = v_credit_account_id;
  
  UPDATE overhead_payments SET 
    ledger_posted = true,
    ledger_transaction_id = v_batch_id,
    updated_at = now()
  WHERE id = p_payment_id;
  
  RETURN v_batch_id;
END;
$function$;


-- post_payroll_to_ledger
CREATE OR REPLACE FUNCTION public.post_payroll_to_ledger(p_payroll_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payroll RECORD;
  v_restaurant RECORD;
  v_wages_account_id uuid;
  v_cash_account_id uuid;
  v_advance_account_id uuid;
  v_fines_account_id uuid;
  v_transaction_id uuid;
  v_gross numeric;
  v_advance numeric;
  v_fines numeric;
  v_net numeric;
  v_remaining numeric;
  v_leg numeric;
  r RECORD;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.payroll_records WHERE id = p_payroll_id));

  SELECT pr.*, s.name AS staff_name INTO v_payroll
  FROM payroll_records pr
  JOIN staff s ON pr.staff_id = s.id
  WHERE pr.id = p_payroll_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll record not found';
  END IF;

  IF v_payroll.ledger_posted THEN
    RAISE EXCEPTION 'Payroll already posted to ledger';
  END IF;

  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_payroll.restaurant_id;

  SELECT id INTO v_wages_account_id FROM chart_of_accounts
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '6100' AND is_active = true LIMIT 1;

  SELECT id INTO v_cash_account_id FROM chart_of_accounts
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;

  IF v_wages_account_id IS NULL OR v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts (6100, 1000) not configured';
  END IF;

  v_gross := COALESCE(v_payroll.amount, 0);
  v_advance := LEAST(COALESCE(v_payroll.advance_recovered, 0), v_gross);
  v_fines := LEAST(GREATEST(COALESCE(v_payroll.fines_deducted, 0), 0), v_gross - v_advance);
  v_net := v_gross - v_advance - v_fines;

  IF v_advance > 0 THEN
    SELECT id INTO v_advance_account_id FROM chart_of_accounts
    WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1150' AND is_active = true LIMIT 1;

    IF v_advance_account_id IS NULL THEN
      INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
      VALUES (v_restaurant.tenant_id, '1150', 'Advance to Employees Against Salary', 'asset',
              'Advances given to employees pending deduction from salary')
      RETURNING id INTO v_advance_account_id;
    END IF;
  END IF;

  IF v_fines > 0 THEN
    SELECT id INTO v_fines_account_id FROM chart_of_accounts
    WHERE tenant_id = v_restaurant.tenant_id AND account_code = '4910' AND is_active = true LIMIT 1;

    IF v_fines_account_id IS NULL THEN
      INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
      VALUES (v_restaurant.tenant_id, '4910', 'Employee Fines Recovered', 'revenue',
              'Disciplinary fines and deductions recovered from employee salaries')
      RETURNING id INTO v_fines_account_id;
    END IF;
  END IF;

  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit,
    description, reference_type, reference_id, branch_id
  )
  VALUES (
    v_restaurant.tenant_id, v_wages_account_id, v_payroll.payment_date, v_gross,
    'Salary Payment (gross) - ' || v_payroll.staff_name, 'expense', p_payroll_id, v_payroll.branch_id
  )
  RETURNING id INTO v_transaction_id;

  -- CREDIT: advance recovered. Legs stay on the payroll reference so the
  -- per-expense balance check sees a complete, balanced journal; individual
  -- advances remain traceable through the description.
  IF v_advance > 0 THEN
    v_remaining := v_advance;

    FOR r IN
      SELECT sa.id, GREATEST(COALESCE(sa.amount, 0) - COALESCE(sa.repaid_amount, 0), 0) AS outstanding,
             COALESCE(sa.amount, 0) AS amount
      FROM staff_advances sa
      WHERE sa.deducted_from_payroll_id = p_payroll_id
      ORDER BY sa.created_at
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_leg := LEAST(v_remaining, GREATEST(r.outstanding, r.amount));
      IF v_leg > 0 THEN
        INSERT INTO account_transactions (
          tenant_id, account_id, transaction_date, credit,
          description, reference_type, reference_id, branch_id
        )
        VALUES (
          v_restaurant.tenant_id, v_advance_account_id, v_payroll.payment_date, v_leg,
          'Advance recovered from salary - ' || v_payroll.staff_name || ' (advance ' || left(r.id::text, 8) || ')',
          'expense', p_payroll_id, v_payroll.branch_id
        );
        v_remaining := v_remaining - v_leg;
      END IF;
    END LOOP;

    IF v_remaining > 0 THEN
      INSERT INTO account_transactions (
        tenant_id, account_id, transaction_date, credit,
        description, reference_type, reference_id, branch_id
      )
      VALUES (
        v_restaurant.tenant_id, v_advance_account_id, v_payroll.payment_date, v_remaining,
        'Advance recovered from salary - ' || v_payroll.staff_name, 'expense', p_payroll_id, v_payroll.branch_id
      );
    END IF;
  END IF;

  IF v_fines > 0 THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit,
      description, reference_type, reference_id, branch_id
    )
    VALUES (
      v_restaurant.tenant_id, v_fines_account_id, v_payroll.payment_date, v_fines,
      'Employee fines deducted from salary - ' || v_payroll.staff_name, 'expense', p_payroll_id, v_payroll.branch_id
    );
  END IF;

  IF v_net > 0 THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit,
      description, reference_type, reference_id, branch_id
    )
    VALUES (
      v_restaurant.tenant_id, v_cash_account_id, v_payroll.payment_date, v_net,
      'Salary Payment (net) - ' || v_payroll.staff_name, 'expense', p_payroll_id, v_payroll.branch_id
    );
  END IF;

  UPDATE payroll_records
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_payroll_id;

  RETURN v_transaction_id;
END;
$function$;


-- post_staff_advance_to_ledger
CREATE OR REPLACE FUNCTION public.post_staff_advance_to_ledger(p_advance_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_advance RECORD;
  v_restaurant RECORD;
  v_advance_account_id uuid;
  v_credit_account_id uuid;
  v_transaction_id uuid;
  v_credit_label text := 'Cash';
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.staff_advances WHERE id = p_advance_id));

  SELECT sa.*, s.name as staff_name INTO v_advance
  FROM staff_advances sa
  JOIN staff s ON sa.staff_id = s.id
  WHERE sa.id = p_advance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff advance record not found';
  END IF;

  IF v_advance.ledger_posted THEN
    RAISE EXCEPTION 'Advance already posted to ledger';
  END IF;

  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_advance.restaurant_id;

  SELECT id INTO v_advance_account_id FROM chart_of_accounts
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1150' AND is_active = true LIMIT 1;

  IF v_advance_account_id IS NULL THEN
    INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
    VALUES (v_restaurant.tenant_id, '1150', 'Advance to Employees Against Salary', 'asset', 'Advances given to employees pending deduction from salary')
    RETURNING id INTO v_advance_account_id;
  END IF;

  -- Credit side depends on who funded the advance
  IF COALESCE(v_advance.funding_source, 'company') <> 'company' THEN
    IF v_advance.capital_account_id IS NULL THEN
      RAISE EXCEPTION 'An owner/partner capital account must be selected for this advance';
    END IF;
    SELECT oca.equity_account_id,
           oca.partner_name || ' capital'
      INTO v_credit_account_id, v_credit_label
    FROM owner_capital_accounts oca
    WHERE oca.id = v_advance.capital_account_id
      AND oca.tenant_id = v_restaurant.tenant_id;
    IF v_credit_account_id IS NULL THEN
      RAISE EXCEPTION 'Selected owner/partner capital account is not linked to an equity account';
    END IF;
  ELSE
    IF v_advance.funding_account_id IS NOT NULL THEN
      SELECT id, account_name INTO v_credit_account_id, v_credit_label
      FROM chart_of_accounts
      WHERE id = v_advance.funding_account_id
        AND tenant_id = v_restaurant.tenant_id
        AND is_active = true;
    END IF;
    IF v_credit_account_id IS NULL THEN
      SELECT id, account_name INTO v_credit_account_id, v_credit_label
      FROM chart_of_accounts
      WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
    END IF;
    IF v_credit_account_id IS NULL THEN
      RAISE EXCEPTION 'Cash account (1000) not configured';
    END IF;
  END IF;

  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit,
    description, reference_type, reference_id, created_by, branch_id
  )
  VALUES (
    v_restaurant.tenant_id, v_advance_account_id, v_advance.advance_date, v_advance.amount,
    'Staff Advance - ' || v_advance.staff_name, 'staff_advance', p_advance_id, v_advance.created_by, v_advance.branch_id
  )
  RETURNING id INTO v_transaction_id;

  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, credit,
    description, reference_type, reference_id, created_by, branch_id
  )
  VALUES (
    v_restaurant.tenant_id, v_credit_account_id, v_advance.advance_date, v_advance.amount,
    'Staff Advance - ' || v_advance.staff_name || ' (paid from ' || COALESCE(v_credit_label, 'Cash') || ')',
    'staff_advance', p_advance_id, v_advance.created_by, v_advance.branch_id
  );

  UPDATE staff_advances
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_advance_id;

  RETURN v_transaction_id;
END;
$function$;


-- post_weekly_cogs_to_ledger
CREATE OR REPLACE FUNCTION public.post_weekly_cogs_to_ledger(p_stocktake_id uuid, p_posted_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stocktake RECORD;
  v_tenant_id UUID;
  v_batch_id UUID;
  v_cogs_account_id UUID;
  v_inventory_account_id UUID;
  v_item RECORD;
  v_total_cogs NUMERIC := 0;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.weekly_stocktakes WHERE id = p_stocktake_id));
  IF auth.uid() IS NOT NULL AND p_posted_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_posted_by must be the calling user' USING ERRCODE = '42501';
  END IF;

  -- Get stocktake details
  SELECT ws.*, r.tenant_id 
  INTO v_stocktake
  FROM weekly_stocktakes ws
  JOIN restaurants r ON r.id = ws.restaurant_id
  WHERE ws.id = p_stocktake_id;
  
  IF v_stocktake IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Stocktake not found';
  END IF;
  
  IF v_stocktake.status = 'posted' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Stocktake already posted to ledger';
  END IF;
  
  v_tenant_id := v_stocktake.tenant_id;
  
  -- Get COGS account (5000 for Food)
  SELECT id INTO v_cogs_account_id
  FROM chart_of_accounts
  WHERE tenant_id = v_tenant_id
    AND account_code = '5000'
    AND is_active = true;
    
  IF v_cogs_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: COGS account 5000 not found. Please ensure COA is properly seeded.';
  END IF;
  
  -- Get Inventory account (1200 for Food)
  SELECT id INTO v_inventory_account_id
  FROM chart_of_accounts
  WHERE tenant_id = v_tenant_id
    AND account_code = '1200'
    AND is_active = true;
    
  IF v_inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Inventory account 1200 not found. Please ensure COA is properly seeded.';
  END IF;
  
  -- Calculate total COGS from stocktake items
  SELECT COALESCE(SUM(consumption_value), 0) INTO v_total_cogs
  FROM weekly_stocktake_items
  WHERE stocktake_id = p_stocktake_id;
  
  IF v_total_cogs <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: No consumption to post. Total COGS must be greater than zero.';
  END IF;
  
  -- Create journal entry batch
  INSERT INTO journal_entry_batches (
    tenant_id,
    entry_type,
    source_type,
    source_id,
    description,
    total_debit,
    total_credit,
    status,
    created_by
  ) VALUES (
    v_tenant_id,
    'cogs',
    'weekly_stocktake',
    p_stocktake_id,
    'Weekly COGS: ' || v_stocktake.week_start_date || ' to ' || v_stocktake.week_end_date,
    v_total_cogs,
    v_total_cogs,
    'posted',
    p_posted_by
  )
  RETURNING id INTO v_batch_id;
  
  -- DR 5000 Cost of Food (COGS expense)
  INSERT INTO account_transactions (
    tenant_id,
    account_id,
    batch_id,
    transaction_date,
    debit,
    description,
    reference_type,
    reference_id,
    created_by
  ) VALUES (
    v_tenant_id,
    v_cogs_account_id,
    v_batch_id,
    v_stocktake.stocktake_date,
    v_total_cogs,
    'Weekly COGS consumption: Week ' || v_stocktake.week_start_date || ' - ' || v_stocktake.week_end_date,
    'weekly_stocktake',
    p_stocktake_id,
    p_posted_by
  );
  
  -- CR 1200 Inventory - Food (reduce asset)
  INSERT INTO account_transactions (
    tenant_id,
    account_id,
    batch_id,
    transaction_date,
    credit,
    description,
    reference_type,
    reference_id,
    created_by
  ) VALUES (
    v_tenant_id,
    v_inventory_account_id,
    v_batch_id,
    v_stocktake.stocktake_date,
    v_total_cogs,
    'Weekly COGS consumption: Week ' || v_stocktake.week_start_date || ' - ' || v_stocktake.week_end_date,
    'weekly_stocktake',
    p_stocktake_id,
    p_posted_by
  );
  
  -- Update account balances
  UPDATE chart_of_accounts
  SET balance = COALESCE(balance, 0) + v_total_cogs
  WHERE id = v_cogs_account_id;
  
  UPDATE chart_of_accounts
  SET balance = COALESCE(balance, 0) - v_total_cogs
  WHERE id = v_inventory_account_id;
  
  -- Update stocktake status
  UPDATE weekly_stocktakes
  SET status = 'posted',
      posted_at = now(),
      posted_by = p_posted_by,
      ledger_batch_id = v_batch_id,
      total_cogs = v_total_cogs
  WHERE id = p_stocktake_id;
  
  -- Update inventory item current stock from closing values
  FOR v_item IN 
    SELECT wsi.inventory_item_id, wsi.closing_qty
    FROM weekly_stocktake_items wsi
    WHERE wsi.stocktake_id = p_stocktake_id
  LOOP
    UPDATE inventory_items
    SET current_stock = v_item.closing_qty,
        updated_at = now()
    WHERE id = v_item.inventory_item_id;
  END LOOP;
  
  RETURN v_batch_id;
END;
$function$;


-- provision_tenant_subdomain
CREATE OR REPLACE FUNCTION public.provision_tenant_subdomain(_tenant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   record;
  v_base     text;
  v_final    text;
  v_attempt  int := 0;
  v_existing record;
  v_page_id  uuid;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_tenant_access(_tenant_id);

  SELECT id, name, slug INTO v_tenant
  FROM public.tenants
  WHERE id = _tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant % not found', _tenant_id;
  END IF;

  -- Already provisioned? Return existing subdomain.
  SELECT subdomain INTO v_existing
  FROM public.tenant_domains
  WHERE tenant_id = _tenant_id AND subdomain IS NOT NULL
  LIMIT 1;

  IF v_existing.subdomain IS NOT NULL THEN
    v_final := v_existing.subdomain;
  ELSE
    -- Compute candidate base slug
    v_base := public.slugify_subdomain(COALESCE(v_tenant.slug, v_tenant.name));
    IF v_base IS NULL THEN
      v_base := 't-' || substring(replace(v_tenant.id::text, '-', '') from 1 for 8);
    END IF;

    v_final := v_base;
    LOOP
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.reserved_subdomains WHERE name = v_final
      ) AND NOT EXISTS (
        SELECT 1 FROM public.tenant_domains WHERE subdomain = v_final
      ) AND NOT EXISTS (
        SELECT 1 FROM public.tenant_slug_history WHERE old_subdomain = v_final AND redirect_until > now()
      );
      v_attempt := v_attempt + 1;
      EXIT WHEN v_attempt > 50;
      v_final := v_base || '-' || (v_attempt + 1)::text;
    END LOOP;

    INSERT INTO public.tenant_domains (tenant_id, subdomain, domain_status, ssl_status)
    VALUES (_tenant_id, v_final, 'active', 'active');
  END IF;

  -- Seed landing page if missing
  SELECT id INTO v_page_id
  FROM public.tenant_pages
  WHERE tenant_id = _tenant_id AND page_type = 'landing'
  LIMIT 1;

  IF v_page_id IS NULL THEN
    INSERT INTO public.tenant_pages (
      tenant_id, page_type, theme, hero_title, hero_subtitle,
      show_menu_sync, show_hours, show_location, is_published, published_at
    ) VALUES (
      _tenant_id, 'landing', 'urban-cafe',
      v_tenant.name,
      'Order online for delivery or pickup',
      true, true, true, true, now()
    )
    RETURNING id INTO v_page_id;

    -- Seed default blocks (idempotent block-by-block)
    INSERT INTO public.tenant_page_blocks (page_id, block_type, block_order, content) VALUES
      (v_page_id, 'hero',     0, jsonb_build_object('title', v_tenant.name, 'cta_label', 'Order online')),
      (v_page_id, 'menu',     1, jsonb_build_object('limit', 6, 'show_top_selling', true)),
      (v_page_id, 'hours',    2, '{}'::jsonb),
      (v_page_id, 'location', 3, jsonb_build_object('show_map', true, 'show_phone', true)),
      (v_page_id, 'cta',      4, jsonb_build_object('label', 'Order now', 'style', 'primary'));
  END IF;

  RETURN v_final;
END;
$function$;


-- seed_sample_inventory_items
CREATE OR REPLACE FUNCTION public.seed_sample_inventory_items(p_restaurant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access(p_restaurant_id);

  -- Get tenant_id from restaurant
  SELECT tenant_id INTO v_tenant_id FROM restaurants WHERE id = p_restaurant_id;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found or has no tenant';
  END IF;

  -- First seed the COA for this tenant
  PERFORM seed_hybrid_pos_coa(v_tenant_id);
  
  -- Seed category mappings
  PERFORM seed_inventory_category_mappings(v_tenant_id);

  -- Insert sample inventory items
  INSERT INTO inventory_items (restaurant_id, name, current_stock, unit, unit_cost, vat_percentage, reorder_level, cogs_frequency, inventory_account_code, cogs_account_code)
  VALUES 
    -- Weekly items (fresh produce)
    (p_restaurant_id, 'Whole Chicken', 50, 'kg', 18.00, 15, 15, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Chicken Breast', 30, 'kg', 28.00, 15, 10, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Mixed Vegetables', 20, 'kg', 8.00, 15, 8, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Tomatoes', 25, 'kg', 5.00, 15, 10, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Onions', 30, 'kg', 3.00, 15, 12, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Cooking Oil', 40, 'L', 12.00, 15, 15, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Fresh Milk', 20, 'L', 6.00, 15, 10, 'weekly', '1200', '5000'),
    
    -- Monthly items (dry goods)
    (p_restaurant_id, 'Basmati Rice', 100, 'kg', 8.00, 15, 25, 'monthly', '1200', '5000'),
    (p_restaurant_id, 'White Flour', 50, 'kg', 4.00, 15, 15, 'monthly', '1200', '5000'),
    (p_restaurant_id, 'Mixed Spices', 10, 'kg', 45.00, 15, 3, 'monthly', '1200', '5000'),
    (p_restaurant_id, 'Salt', 20, 'kg', 2.00, 15, 5, 'monthly', '1200', '5000'),
    
    -- Beverages (monthly)
    (p_restaurant_id, 'Soft Drinks Carton', 30, 'carton', 35.00, 15, 10, 'monthly', '1210', '5010'),
    (p_restaurant_id, 'Bottled Water', 50, 'pack', 8.00, 15, 15, 'monthly', '1210', '5010'),
    (p_restaurant_id, 'Tea Bags', 20, 'box', 15.00, 15, 5, 'monthly', '1210', '5010'),
    
    -- Packaging (monthly)
    (p_restaurant_id, 'Takeaway Containers', 500, 'pcs', 0.50, 15, 150, 'monthly', '1220', '5020'),
    (p_restaurant_id, 'Paper Bags', 300, 'pcs', 0.25, 15, 100, 'monthly', '1220', '5020'),
    (p_restaurant_id, 'Plastic Forks/Spoons', 400, 'pcs', 0.10, 15, 150, 'monthly', '1220', '5020')
  ON CONFLICT DO NOTHING;
END;
$function$;
