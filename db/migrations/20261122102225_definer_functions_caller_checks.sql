-- Caller checks for SECURITY DEFINER functions (audit of 2026-11-22, after the lock_fiscal_period hole).
-- Every definer function a signed-in user can call was reviewed; see docs/self-hosting/FUNCTION_ACCESS_REVIEW.md,
-- "Second pass (2026-11-22)". Part A adds structural rules that close whole classes of gaps; part B patches each
-- function whose check was missing, used the wrong id, passed on NULL, or accepted a role held in any business.
-- Function bodies are the previous definitions with only the marked checks added.

-- ---------------------------------------------------------------------------------------------
-- A. Shared helper and structural rules
-- ---------------------------------------------------------------------------------------------

-- Role check scoped to one business. Replaces the 2-argument has_role(uid, role), which is true
-- when the caller holds the role in ANY restaurant (anyone can sign up and own one).
-- Checks both role tables, like the rest of the schema does.
CREATE OR REPLACE FUNCTION public.has_role_in_tenant(_tenant_id uuid, _roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND _tenant_id IS NOT NULL AND (
    public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.restaurants r ON r.id = ur.restaurant_id
      WHERE ur.user_id = auth.uid() AND r.tenant_id = _tenant_id AND ur.role = ANY(_roles)
    )
    OR EXISTS (
      SELECT 1 FROM public.user_tenant_roles utr
      WHERE utr.user_id = auth.uid() AND utr.tenant_id = _tenant_id AND utr.role = ANY(_roles)
    )
  )
$$;
REVOKE ALL ON FUNCTION public.has_role_in_tenant(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role_in_tenant(uuid, public.app_role[]) TO authenticated, service_role;

-- A ledger line may only use an account of its own business. Several posting functions take an
-- account id from the caller (or from a row the caller can edit), and the balance trigger then
-- moved another business's chart_of_accounts.balance.
CREATE OR REPLACE FUNCTION public.enforce_ledger_account_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.account_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts a WHERE a.id = NEW.account_id AND a.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Account % does not belong to this business', NEW.account_id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_ledger_account_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aaa_enforce_ledger_account_tenant ON public.account_transactions;
-- Named to sort before trigger_update_account_balance (BEFORE triggers fire in name order).
CREATE TRIGGER aaa_enforce_ledger_account_tenant
  BEFORE INSERT OR UPDATE OF account_id, tenant_id ON public.account_transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ledger_account_tenant();

-- Browsers never choose a restaurant id. Checks that wrongly passed a business id where a
-- restaurant id belongs could be satisfied by creating a restaurant whose id equals another
-- business's id.
CREATE OR REPLACE FUNCTION public.restaurants_server_generated_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.id := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.restaurants_server_generated_id() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_restaurants_server_generated_id ON public.restaurants;
CREATE TRIGGER trg_restaurants_server_generated_id
  BEFORE INSERT ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.restaurants_server_generated_id();

-- Audit rows written by users may only be filed under a business they belong to.
DROP POLICY IF EXISTS "Authenticated users can insert their own audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert their own audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL AND user_id = auth.uid()
    AND (tenant_id IS NULL OR public.user_belongs_to_tenant(auth.uid(), tenant_id) OR public.is_superadmin(auth.uid()))
  );

-- Not called by the app as a user (only by other database functions, jobs or the server's own
-- connection). Service accounts keep their own grant.
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'public.dispose_fixed_asset(uuid,date,numeric,uuid,text)',
    'public.resolve_project_funding_account(uuid,text,uuid,text,uuid,boolean)',
    'public.create_project_fixed_asset(uuid,uuid,uuid,uuid,text,numeric,date,uuid,text,uuid,text,uuid,uuid,integer,text,text,text)',
    'public.log_tenant_activity(uuid,text,text,uuid,jsonb)',
    'public.rename_tenant_subdomain(uuid,text)',
    'public.reverse_staff_advance_ledger(uuid,text)',
    'public.get_cash_card_analysis_section(uuid,date,date,uuid,text)',
    'public.approve_failed_sync_item(uuid)',
    'public.calculate_and_post_monthly_cogs(uuid,uuid,date,date,numeric,numeric,uuid,uuid)',
    'public.finalize_daily_overhead(uuid,date,numeric,uuid,jsonb)',
    'public.post_daily_sales_to_ledger(uuid)',
    'public.post_inventory_purchase_to_ledger(uuid,text)',
    'public.post_settlement_to_ledger(uuid)',
    'public.reclassify_expense_credit_account(uuid,text)',
    'public.retry_failed_sync_item(uuid)',
    'public.reverse_daily_sales_posting(uuid,text)'
  ] LOOP
    IF to_regprocedure(s) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', s);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', s);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- B. Per-function checks
-- ---------------------------------------------------------------------------------------------

-- apply_expense_vat_split
CREATE OR REPLACE FUNCTION public.apply_expense_vat_split(p_expense_id uuid, p_rate_percent numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exp record;
  v_net numeric(15,2);
  v_vat numeric(15,2);
  v_vat_account uuid;
  v_debit_account uuid;
  v_batch uuid;
  v_ledger_before jsonb;
  v_ledger_after jsonb;
BEGIN
  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id AND deleted_at IS NULL;
  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'Expense not found.';
  END IF;
  -- Role must be held in the expense's own business and the caller must have access to its restaurant.
  IF NOT (public.has_role_in_tenant(v_exp.tenant_id, ARRAY['owner','accountant','manager']::public.app_role[])
          AND public.can_access_restaurant(v_exp.restaurant_id)) THEN
    RAISE EXCEPTION 'Only owners, accountants or managers can apply a VAT split.';
  END IF;
  IF v_exp.vat_split_status = 'applied' OR COALESCE(v_exp.vat_amount, 0) > 0 THEN
    RAISE EXCEPTION 'This expense already has a VAT split.';
  END IF;
  IF COALESCE(p_rate_percent, 0) <= 0 THEN
    RAISE EXCEPTION 'VAT rate must be greater than zero.';
  END IF;

  v_net := round(v_exp.amount / (1 + p_rate_percent / 100.0), 2);
  v_vat := round(v_exp.amount - v_net, 2);

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'account_code'), '[]'::jsonb) INTO v_ledger_before
  FROM (
    SELECT jsonb_build_object(
      'account_code', coa.account_code,
      'account_name', coa.account_name,
      'debit', at.debit,
      'credit', at.credit,
      'batch_id', at.batch_id,
      'transaction_date', at.transaction_date
    ) AS x
    FROM account_transactions at
    LEFT JOIN chart_of_accounts coa ON coa.id = at.account_id
    WHERE at.reference_id = p_expense_id
      AND at.reference_type IN ('expense','correction')
      AND COALESCE(at.is_voided, false) = false
  ) s;

  UPDATE expenses
  SET vat_amount = v_vat,
      net_amount = v_net,
      vat_rate = p_rate_percent,
      vat_inclusive = true,
      vat_split_status = 'applied',
      updated_at = now()
  WHERE id = p_expense_id;

  IF COALESCE(v_exp.ledger_posted, false) = true AND v_vat > 0 THEN
    SELECT id INTO v_vat_account
    FROM chart_of_accounts
    WHERE tenant_id = v_exp.tenant_id AND account_code = '1180' AND COALESCE(is_active, true)
    LIMIT 1;
    IF v_vat_account IS NULL THEN
      RAISE EXCEPTION 'Account 1180 Input VAT Recoverable is not configured.';
    END IF;

    SELECT account_id INTO v_debit_account
    FROM account_transactions
    WHERE reference_id = p_expense_id
      AND reference_type = 'expense'
      AND COALESCE(is_voided, false) = false
      AND debit > 0
    ORDER BY debit DESC
    LIMIT 1;
    v_debit_account := COALESCE(v_debit_account, v_exp.account_id);
    IF v_debit_account IS NULL THEN
      RAISE EXCEPTION 'Could not determine the expense account to reclassify.';
    END IF;

    INSERT INTO journal_entry_batches (
      tenant_id, branch_id, batch_date, description, reference_number,
      entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status
    ) VALUES (
      v_exp.tenant_id, v_exp.branch_id, v_exp.expense_date,
      'Retroactive VAT split - ' || COALESCE(v_exp.description, p_expense_id::text)
        || CASE WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN ' (' || trim(p_note) || ')' ELSE '' END,
      'VATSPLIT-' || to_char(v_exp.expense_date, 'YYYYMMDD') || '-' || substr(p_expense_id::text, 1, 8),
      'correction', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved'
    ) RETURNING id INTO v_batch;

    INSERT INTO account_transactions (
      tenant_id, branch_id, account_id, batch_id, transaction_date,
      debit, credit, description, reference_type, reference_id, created_by
    ) VALUES
      (v_exp.tenant_id, v_exp.branch_id, v_vat_account, v_batch, v_exp.expense_date,
       v_vat, 0, 'Input VAT recovered on retroactive split', 'correction', p_expense_id, auth.uid()),
      (v_exp.tenant_id, v_exp.branch_id, v_debit_account, v_batch, v_exp.expense_date,
       0, v_vat, 'Net-of-VAT restatement of expense', 'correction', p_expense_id, auth.uid());
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'account_code'), '[]'::jsonb) INTO v_ledger_after
  FROM (
    SELECT jsonb_build_object(
      'account_code', coa.account_code,
      'account_name', coa.account_name,
      'debit', at.debit,
      'credit', at.credit,
      'batch_id', at.batch_id,
      'transaction_date', at.transaction_date
    ) AS x
    FROM account_transactions at
    LEFT JOIN chart_of_accounts coa ON coa.id = at.account_id
    WHERE at.reference_id = p_expense_id
      AND at.reference_type IN ('expense','correction')
      AND COALESCE(at.is_voided, false) = false
  ) s;

  INSERT INTO expense_vat_split_audit (
    tenant_id, restaurant_id, branch_id, expense_id, action, rate_percent,
    amount_before, net_before, vat_before, status_before,
    amount_after, net_after, vat_after, status_after,
    ledger_posted, batch_id, ledger_before, ledger_after, note, performed_by
  ) VALUES (
    v_exp.tenant_id, v_exp.restaurant_id, v_exp.branch_id, p_expense_id, 'applied', p_rate_percent,
    v_exp.amount, v_exp.net_amount, COALESCE(v_exp.vat_amount, 0), COALESCE(v_exp.vat_split_status, 'pending'),
    v_exp.amount, v_net, v_vat, 'applied',
    COALESCE(v_exp.ledger_posted, false), v_batch, v_ledger_before, v_ledger_after, p_note, auth.uid()
  );

  RETURN jsonb_build_object('ok', true, 'net', v_net, 'vat', v_vat, 'batch_id', v_batch);
END;
$function$;


-- apply_installment_vat_correction
CREATE OR REPLACE FUNCTION public.apply_installment_vat_correction(p_plan_id uuid, p_note text DEFAULT NULL::text)
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
  -- role must be held in the plan's own business, not in any restaurant
  IF NOT public.has_role_in_tenant(
    (SELECT ip.tenant_id FROM installment_plans ip WHERE ip.id = p_plan_id),
    ARRAY['owner','accountant']::public.app_role[]
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


-- apply_payroll_deduction_allocation
CREATE OR REPLACE FUNCTION public.apply_payroll_deduction_allocation(p_payroll_id uuid, p_decisions jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pay public.payroll_records;
  v_preview jsonb;
  v_d jsonb;
  v_fine public.employee_fines;
  v_to_month date;
  v_kept numeric := 0;
  v_kept_ids uuid[] := '{}';
  v_advance numeric;
  v_other numeric;
  v_total numeric;
  v_max numeric;
BEGIN
  IF COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'ALLOCATION_REASON_REQUIRED: A written justification is mandatory when allocating deductions.';
  END IF;

  SELECT * INTO v_pay FROM public.payroll_records WHERE id = p_payroll_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_NOT_FOUND'; END IF;

  IF auth.uid() IS NOT NULL AND NOT (
       public.has_role(auth.uid(), v_pay.restaurant_id, 'owner'::public.app_role)
    OR public.has_role(auth.uid(), v_pay.restaurant_id, 'manager'::public.app_role)
    OR public.has_role(auth.uid(), v_pay.restaurant_id, 'accountant'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'ALLOCATION_FORBIDDEN: Only owners, managers or accountants can allocate deductions.';
  END IF;

  v_preview := public.preview_payroll_deduction_allocation(p_payroll_id);
  v_max := (v_preview->>'max_deduction')::numeric;
  v_other := COALESCE(v_pay.deductions,0);
  v_advance := COALESCE(v_pay.advance_recovered,0);

  FOR v_d IN SELECT * FROM jsonb_array_elements(COALESCE(p_decisions,'[]'::jsonb))
  LOOP
    IF v_d->>'kind' = 'fine' THEN
      SELECT * INTO v_fine FROM public.employee_fines WHERE id = (v_d->>'id')::uuid;
      CONTINUE WHEN NOT FOUND;

      -- Fine ids come from the caller: only this payroll's own restaurant and staff member's fines may be touched
      IF v_fine.restaurant_id IS DISTINCT FROM v_pay.restaurant_id OR v_fine.staff_id IS DISTINCT FROM v_pay.staff_id THEN
        RAISE EXCEPTION 'ALLOCATION_FORBIDDEN: Fine % does not belong to this payroll record.', v_fine.id USING ERRCODE = '42501';
      END IF;

      IF v_d->>'action' = 'defer' THEN
        v_to_month := COALESCE((v_d->>'defer_to')::date,
                               (date_trunc('month', v_fine.payroll_month) + interval '1 month')::date);

        UPDATE public.employee_fines SET payroll_month = v_to_month WHERE id = v_fine.id;

        INSERT INTO public.employee_fine_audit(fine_id, restaurant_id, action, old_status, new_status,
                                               old_amount, new_amount, reason, actor_id, metadata)
        VALUES (v_fine.id, v_fine.restaurant_id, 'deferred_by_allocation', v_fine.status, v_fine.status,
                v_fine.amount, v_fine.amount, p_reason, auth.uid(),
                jsonb_build_object('payroll_id', p_payroll_id,
                                   'from_month', v_fine.payroll_month,
                                   'to_month', v_to_month));
      ELSE
        v_kept := v_kept + v_fine.amount;
        v_kept_ids := array_append(v_kept_ids, v_fine.id);
      END IF;

    ELSIF v_d->>'kind' = 'advance' THEN
      v_advance := LEAST(v_advance, GREATEST(COALESCE((v_d->>'amount')::numeric, v_advance), 0));

    ELSIF v_d->>'kind' = 'other' THEN
      v_other := LEAST(v_other, GREATEST(COALESCE((v_d->>'amount')::numeric, v_other), 0));
    END IF;
  END LOOP;

  v_total := v_other + v_advance + v_kept;
  IF v_total > v_max + 0.01 THEN
    RAISE EXCEPTION 'ALLOCATION_STILL_EXCEEDS: The selected deductions total % but the permitted maximum is %. Defer or reduce % more.',
      ROUND(v_total,2), ROUND(v_max,2), ROUND(v_total - v_max, 2);
  END IF;

  UPDATE public.payroll_records
  SET deductions = v_other,
      advance_recovered = v_advance,
      fines_deducted = v_kept,
      deduction_override_reason = p_reason
  WHERE id = p_payroll_id;

  IF array_length(v_kept_ids,1) > 0 THEN
    UPDATE public.employee_fines
    SET status = 'applied', applied_payroll_id = p_payroll_id, applied_at = now()
    WHERE id = ANY(v_kept_ids);
  END IF;

  INSERT INTO public.payroll_deduction_allocations(
    restaurant_id, branch_id, payroll_id, staff_id, gross_wage, max_deduction_pct, max_deduction,
    requested_total, excess_amount, allocated_total, decisions, reason, decided_by)
  VALUES (
    v_pay.restaurant_id, (v_preview->>'branch_id')::uuid, p_payroll_id, v_pay.staff_id,
    (v_preview->>'gross_wage')::numeric, (v_preview->>'max_deduction_pct')::numeric, v_max,
    (v_preview->>'requested_total')::numeric, (v_preview->>'excess_amount')::numeric,
    v_total, COALESCE(p_decisions,'[]'::jsonb), p_reason, auth.uid());

  RETURN jsonb_build_object('allocated_total', v_total, 'fines_applied', COALESCE(array_length(v_kept_ids,1),0));
END;
$function$;


-- apply_vat_posting_correction
CREATE OR REPLACE FUNCTION public.apply_vat_posting_correction(p_batch_id uuid, p_note text DEFAULT NULL::text)
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
  -- Owner/accountant role must be held in the batch's own business, not in any restaurant.
  IF NOT public.has_role_in_tenant((SELECT b.tenant_id FROM journal_entry_batches b WHERE b.id = p_batch_id), ARRAY['owner','accountant']::public.app_role[]) THEN
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


-- auto_assign_rider
CREATE OR REPLACE FUNCTION public.auto_assign_rider_internal(_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_rider RECORD;
  v_dlat numeric;
  v_dlng numeric;
  v_assignment_id uuid;
BEGIN
  SELECT id, restaurant_id, order_type, delivery_address, payment_status
    INTO v_order
  FROM public.online_orders
  WHERE id = _order_id;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.order_type <> 'delivery' THEN
    RETURN NULL;
  END IF;

  -- Skip if already assigned & active
  IF EXISTS (
    SELECT 1 FROM public.delivery_assignments
    WHERE order_id = _order_id AND status IN ('assigned','picked_up')
  ) THEN
    RETURN NULL;
  END IF;

  v_dlat := NULLIF(v_order.delivery_address->>'lat','')::numeric;
  v_dlng := NULLIF(v_order.delivery_address->>'lng','')::numeric;

  -- Pick the nearest 'available' rider with a recent ping (15 min)
  -- If no coords on order or rider, fall back to any available rider.
  SELECT r.id, r.current_lat, r.current_lng
    INTO v_rider
  FROM public.riders r
  WHERE r.restaurant_id = v_order.restaurant_id
    AND r.active = true
    AND r.status = 'available'
    AND (r.last_ping_at IS NULL OR r.last_ping_at > now() - interval '15 minutes')
  ORDER BY
    CASE
      WHEN v_dlat IS NOT NULL AND v_dlng IS NOT NULL
       AND r.current_lat IS NOT NULL AND r.current_lng IS NOT NULL
      THEN public.haversine_km(r.current_lat, r.current_lng, v_dlat, v_dlng)
      ELSE 9999
    END ASC,
    r.last_ping_at DESC NULLS LAST
  LIMIT 1;

  IF v_rider.id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.delivery_assignments (
    restaurant_id, order_id, rider_id, status,
    delivery_address, delivery_lat, delivery_lng, created_by
  ) VALUES (
    v_order.restaurant_id, _order_id, v_rider.id, 'assigned',
    v_order.delivery_address->>'address', v_dlat, v_dlng, auth.uid()
  )
  RETURNING id INTO v_assignment_id;

  -- Bump rider status
  UPDATE public.riders SET status = 'on_delivery', updated_at = now() WHERE id = v_rider.id;

  -- Move order forward if still pending/confirmed
  UPDATE public.online_orders
     SET status = CASE WHEN status IN ('pending','confirmed','preparing','ready') THEN 'out_for_delivery' ELSE status END,
         updated_at = now()
   WHERE id = _order_id;

  RETURN v_assignment_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.auto_assign_rider_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_rider_internal(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_assign_rider(_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_restaurant_id uuid;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM public.online_orders
  WHERE id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- signed-in callers may only dispatch orders of a restaurant they can access
  IF auth.uid() IS NOT NULL AND NOT COALESCE(public.can_access_restaurant(v_restaurant_id), false) THEN
    RAISE EXCEPTION 'Not authorized to assign riders for this order' USING ERRCODE = '42501';
  END IF;

  RETURN public.auto_assign_rider_internal(_order_id);
END;
$function$;

-- trigger now calls the internal function; SECURITY DEFINER because callers (authenticated) no longer have EXECUTE on it
CREATE OR REPLACE FUNCTION public.trg_auto_dispatch_on_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.order_type = 'delivery'
     AND NEW.payment_status = 'paid'
     AND COALESCE(NEW.channel, 'direct') = 'direct'
     AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM NEW.payment_status)
  THEN
    PERFORM public.auto_assign_rider_internal(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;


-- auto_reconcile_imbalanced_expenses
CREATE OR REPLACE FUNCTION public.auto_reconcile_imbalanced_expenses(p_tenant_id uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD; v_dr numeric; v_cr numeric; v_diff numeric;
  v_credit_code text; v_credit_acct uuid;
  v_actor uuid := auth.uid(); v_batch_id uuid;
  v_fixed int := 0; v_manual int := 0; v_manual_review jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- Role must be held in the requested business (p_tenant_id), not in any restaurant.
  IF p_tenant_id IS NULL OR NOT public.has_role_in_tenant(p_tenant_id, ARRAY['owner','manager','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Insufficient privileges';
  END IF;

  FOR v_row IN
    SELECT e.id, e.tenant_id, e.branch_id, e.amount, e.expense_date, e.status, e.description
    FROM public.expenses e
    WHERE e.tenant_id = p_tenant_id
      AND COALESCE(e.ledger_posted, false) = true
      AND e.deleted_at IS NULL
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
  LOOP
    SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO v_dr, v_cr
    FROM public.account_transactions
    WHERE reference_type='expense' AND reference_id = v_row.id
      AND COALESCE(is_voided,false) = false;

    v_diff := round(v_dr - v_cr, 2);
    IF abs(v_diff) <= 0.005 THEN CONTINUE; END IF;

    SELECT batch_id INTO v_batch_id FROM public.account_transactions
    WHERE reference_type='expense' AND reference_id = v_row.id
    ORDER BY created_at ASC LIMIT 1;

    IF v_diff > 0 AND abs(v_diff - v_row.amount) <= 0.01 THEN
      v_credit_code := CASE WHEN COALESCE(v_row.status,'unpaid') = 'paid' THEN '1000' ELSE '2000' END;
      SELECT id INTO v_credit_acct FROM public.chart_of_accounts
        WHERE tenant_id = v_row.tenant_id AND account_code = v_credit_code LIMIT 1;

      IF v_credit_acct IS NULL THEN
        v_manual := v_manual + 1;
        v_manual_review := v_manual_review || jsonb_build_array(jsonb_build_object(
          'expense_id', v_row.id, 'diff', v_diff, 'fields', ARRAY['credit_account'],
          'reason','Counter account ' || v_credit_code || ' missing in CoA'));
        INSERT INTO public.expense_posting_audit (
          tenant_id, expense_id, branch_id, action, outcome,
          reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
        ) VALUES (p_tenant_id, v_row.id, v_row.branch_id, 'reconcile','needs_manual_review',
          'missing_account','Counter account '||v_credit_code||' missing', v_dr, v_cr, 'reconcile_job', v_actor);
        CONTINUE;
      END IF;

      INSERT INTO public.account_transactions (
        tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, branch_id, batch_id
      ) VALUES (v_row.tenant_id, v_credit_acct, v_row.expense_date, NULL, v_diff,
        COALESCE(v_row.description,'Expense') || ' — auto-reconcile credit leg',
        'expense', v_row.id, v_actor, v_row.branch_id, v_batch_id);
      v_fixed := v_fixed + 1;
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, batch_id, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (p_tenant_id, v_row.id, v_row.branch_id, 'reconcile','success',
        'auto_reconciled','Inserted missing credit leg of '||v_diff,
        v_batch_id, v_dr, v_cr + v_diff, 'reconcile_job', v_actor);
    ELSE
      v_manual := v_manual + 1;
      v_manual_review := v_manual_review || jsonb_build_array(jsonb_build_object(
        'expense_id', v_row.id, 'dr_total', v_dr, 'cr_total', v_cr, 'diff', v_diff,
        'fields', ARRAY['debit','credit'],
        'reason','Imbalance does not match a known auto-fix pattern'));
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (p_tenant_id, v_row.id, v_row.branch_id, 'reconcile','needs_manual_review',
        'ambiguous_imbalance','Diff '||v_diff||' does not match a single missing-leg pattern',
        v_dr, v_cr, 'reconcile_job', v_actor);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('fixed', v_fixed, 'manual_review_count', v_manual, 'manual_review', v_manual_review);
END; $function$;


-- auto_reconcile_single_expense
CREATE OR REPLACE FUNCTION public.auto_reconcile_single_expense(p_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_exp RECORD;
  v_dr numeric; v_cr numeric; v_diff numeric;
  v_credit_code text; v_credit_acct uuid;
  v_batch_id uuid; v_err text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('outcome','failed','error','Not authenticated');
  END IF;
  SELECT id, tenant_id, restaurant_id, branch_id, amount, expense_date, status, description
    INTO v_exp
  FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','failed','error','Expense not found');
  END IF;
  -- Role must be held in the expense's own business (no <> NULL bypass) and the caller must have access to its restaurant.
  IF NOT (public.has_role_in_tenant(v_exp.tenant_id, ARRAY['owner','manager','accountant']::public.app_role[])
          AND public.can_access_restaurant(v_exp.restaurant_id)) THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','forbidden','error','Insufficient privileges');
  END IF;

  SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO v_dr, v_cr
  FROM public.account_transactions
  WHERE reference_type='expense' AND reference_id = p_expense_id
    AND COALESCE(is_voided,false) = false;
  v_diff := round(v_dr - v_cr, 2);

  IF abs(v_diff) <= 0.005 THEN
    RETURN jsonb_build_object('outcome','already_balanced','dr_total',v_dr,'cr_total',v_cr);
  END IF;

  SELECT batch_id INTO v_batch_id FROM public.account_transactions
  WHERE reference_type='expense' AND reference_id = p_expense_id
  ORDER BY created_at ASC LIMIT 1;

  IF v_diff > 0 AND abs(v_diff - v_exp.amount) <= 0.01 THEN
    v_credit_code := CASE WHEN COALESCE(v_exp.status,'unpaid') = 'paid' THEN '1000' ELSE '2000' END;
    SELECT id INTO v_credit_acct FROM public.chart_of_accounts
      WHERE tenant_id = v_exp.tenant_id AND account_code = v_credit_code LIMIT 1;

    IF v_credit_acct IS NULL THEN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','needs_manual_review',
        'missing_account','Counter account '||v_credit_code||' missing in CoA',
        v_dr, v_cr, 'reconcile_job', v_actor);
      RETURN jsonb_build_object('outcome','needs_manual_review',
        'reason_code','missing_account','error','Counter account '||v_credit_code||' missing');
    END IF;

    BEGIN
      INSERT INTO public.account_transactions (
        tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, branch_id, batch_id
      ) VALUES (v_exp.tenant_id, v_credit_acct, v_exp.expense_date, NULL, v_diff,
        COALESCE(v_exp.description,'Expense') || ' — auto-reconcile credit leg',
        'expense', v_exp.id, v_actor, v_exp.branch_id, v_batch_id);
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, batch_id, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','success',
        'auto_reconciled','Inserted missing credit leg of '||v_diff||' to '||v_credit_code,
        v_batch_id, v_dr, v_cr + v_diff, 'reconcile_job', v_actor);
      RETURN jsonb_build_object('outcome','fixed','diff',v_diff,'batch_id',v_batch_id);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','failed',
        'validation_failed', v_err, v_dr, v_cr, 'reconcile_job', v_actor);
      RETURN jsonb_build_object('outcome','failed','error', v_err);
    END;
  END IF;

  INSERT INTO public.expense_posting_audit (
    tenant_id, expense_id, branch_id, action, outcome,
    reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
  ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','needs_manual_review',
    'ambiguous_imbalance','Diff '||v_diff||' does not match a single missing-leg pattern',
    v_dr, v_cr, 'reconcile_job', v_actor);
  RETURN jsonb_build_object('outcome','needs_manual_review',
    'reason_code','ambiguous_imbalance','diff', v_diff,
    'error','Imbalance does not match a known auto-fix pattern');
END;
$function$;


-- backfill_supplier_ap_accounts
CREATE OR REPLACE FUNCTION public.backfill_supplier_ap_accounts(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_created int := 0;
  v_acct uuid;
BEGIN
  IF NOT public.can_access_restaurant(p_tenant_id) THEN
    RAISE EXCEPTION 'Not authorised for this restaurant';
  END IF;

  -- Role must be held in this restaurant (p_tenant_id is a restaurant id), not in any restaurant.
  IF NOT (
    public.has_role(auth.uid(), p_tenant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), p_tenant_id, 'manager'::app_role)
    OR public.has_role(auth.uid(), p_tenant_id, 'accountant'::app_role)
    OR public.is_superadmin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants can create supplier AP heads';
  END IF;

  FOR r IN
    SELECT id FROM public.suppliers
    WHERE restaurant_id = p_tenant_id
      AND is_active = true
      AND ap_account_id IS NULL
  LOOP
    v_acct := public.resolve_supplier_ap_account(p_tenant_id, r.id);
    IF v_acct IS NOT NULL THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created', v_created);
END;
$function$;


-- bulk_fix_invoice_divergence
CREATE OR REPLACE FUNCTION public.bulk_fix_invoice_divergence(p_invoice_ids uuid[], p_dry_run boolean DEFAULT true)
 RETURNS TABLE(invoice_id uuid, invoice_number text, status text, removed_lines integer, old_total numeric, new_total numeric, duplicate_amount numeric, expense_id uuid, old_expense_amount numeric, new_expense_amount numeric, ledger_debit numeric, needs_ledger_repost boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_inv record;
  v_removed integer;
  v_new_total numeric;
  v_old_total numeric;
  v_dup_amount numeric;
  v_exp_id uuid;
  v_exp_amount numeric;
  v_new_exp_amount numeric;
  v_ledger numeric;
  v_legs integer;
  v_needs_repost boolean;
  v_dup_groups jsonb;
  v_status text;
  v_message text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  -- Role must be held in the caller's business, not in any restaurant (helper includes superadmin).
  IF NOT public.has_role_in_tenant(v_tenant, ARRAY['owner','manager','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants can run the bulk reconcile and fix';
  END IF;

  IF p_invoice_ids IS NULL OR array_length(p_invoice_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOR v_inv IN
    SELECT pi.id, pi.invoice_number, pi.total_amount, pi.tax_amount
    FROM public.purchase_invoices pi
    WHERE pi.id = ANY(p_invoice_ids)
      AND pi.restaurant_id = v_tenant
    ORDER BY pi.invoice_date, pi.invoice_number
    FOR UPDATE
  LOOP
    v_removed := 0;
    v_status := 'fixed';
    v_message := NULL;
    v_needs_repost := false;
    v_old_total := ROUND(COALESCE(v_inv.total_amount, 0), 2);

    -- Duplicate detection: identical description / quantity / unit price / total.
    WITH grouped AS (
      SELECT COALESCE(ii.description, '') AS description,
             COALESCE(ii.quantity, 0) AS quantity,
             COALESCE(ii.unit_price, 0) AS unit_price,
             ROUND(COALESCE(ii.total_price, 0), 2) AS line_total,
             COUNT(*)::int AS occurrences
      FROM public.invoice_items ii
      WHERE ii.invoice_id = v_inv.id
      GROUP BY 1, 2, 3, 4
      HAVING COUNT(*) > 1
    )
    SELECT COALESCE(SUM(line_total * (occurrences - 1)), 0),
           COALESCE(
             jsonb_agg(jsonb_build_object(
               'description', description,
               'quantity', quantity,
               'unit_price', unit_price,
               'line_total', line_total,
               'occurrences', occurrences,
               'excess_amount', ROUND(line_total * (occurrences - 1), 2)
             )), '[]'::jsonb)
    INTO v_dup_amount, v_dup_groups
    FROM grouped;

    v_dup_amount := ROUND(COALESCE(v_dup_amount, 0), 2);

    IF NOT p_dry_run AND v_dup_amount > 0 THEN
      PERFORM set_config('app.invoice_items_rewrite', 'on', true);

      WITH ranked AS (
        SELECT ii.id,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(ii.description, ''),
                              COALESCE(ii.quantity, 0),
                              COALESCE(ii.unit_price, 0),
                              ROUND(COALESCE(ii.total_price, 0), 2)
                 ORDER BY ii.created_at NULLS LAST, ii.id
               ) AS rn
        FROM public.invoice_items ii
        WHERE ii.invoice_id = v_inv.id
      )
      DELETE FROM public.invoice_items d
      USING ranked r
      WHERE d.id = r.id AND r.rn > 1;

      GET DIAGNOSTICS v_removed = ROW_COUNT;

      PERFORM set_config('app.invoice_items_rewrite', 'off', true);
    END IF;

    -- Recompute the total from the (deduplicated) remaining lines.
    IF p_dry_run THEN
      SELECT ROUND(COALESCE(SUM(x.line_total), 0), 2) INTO v_new_total
      FROM (
        SELECT DISTINCT ON (COALESCE(ii.description, ''), COALESCE(ii.quantity, 0),
                            COALESCE(ii.unit_price, 0), ROUND(COALESCE(ii.total_price, 0), 2))
               ROUND(COALESCE(ii.total_price, 0), 2) AS line_total
        FROM public.invoice_items ii
        WHERE ii.invoice_id = v_inv.id
        ORDER BY COALESCE(ii.description, ''), COALESCE(ii.quantity, 0),
                 COALESCE(ii.unit_price, 0), ROUND(COALESCE(ii.total_price, 0), 2),
                 ii.created_at NULLS LAST, ii.id
      ) x;
      SELECT COUNT(*)::int INTO v_removed
      FROM public.invoice_items ii WHERE ii.invoice_id = v_inv.id;
      v_removed := GREATEST(
        v_removed - (SELECT COUNT(DISTINCT (COALESCE(description,''), COALESCE(quantity,0),
                                            COALESCE(unit_price,0), ROUND(COALESCE(total_price,0),2)))
                     FROM public.invoice_items WHERE invoice_id = v_inv.id), 0);
    ELSE
      SELECT ROUND(COALESCE(SUM(COALESCE(ii.total_price, 0)), 0), 2) INTO v_new_total
      FROM public.invoice_items ii WHERE ii.invoice_id = v_inv.id;
    END IF;

    IF NOT p_dry_run AND ABS(v_new_total - v_old_total) > 0.005 THEN
      UPDATE public.purchase_invoices
      SET subtotal = v_new_total - COALESCE(tax_amount, 0),
          total_amount = v_new_total,
          updated_at = now()
      WHERE id = v_inv.id;
    END IF;

    -- Linked expense + ledger state.
    SELECT e.id, ROUND(COALESCE(e.amount, 0), 2)
    INTO v_exp_id, v_exp_amount
    FROM public.expenses e
    WHERE e.purchase_invoice_id = v_inv.id
      AND e.tenant_id = v_tenant
      AND e.deleted_at IS NULL
    ORDER BY e.created_at
    LIMIT 1;

    v_ledger := NULL;
    v_legs := 0;
    IF v_exp_id IS NOT NULL THEN
      SELECT ROUND(SUM(COALESCE(at.debit, 0)), 2), COUNT(*)::int
      INTO v_ledger, v_legs
      FROM public.account_transactions at
      LEFT JOIN public.journal_entry_batches b ON b.id = at.batch_id
      WHERE at.tenant_id = v_tenant
        AND at.reference_type = 'expense'
        AND at.reference_id = v_exp_id
        AND COALESCE(at.is_voided, false) = false
        AND COALESCE(b.entry_type::text, '') <> 'payment'
        AND COALESCE(b.reference_number, '') NOT LIKE 'EXPPAY-%'
        AND COALESCE(b.reference_number, '') NOT LIKE 'APREMAP%';
    END IF;

    v_new_exp_amount := v_exp_amount;
    IF v_exp_id IS NOT NULL AND ABS(COALESCE(v_exp_amount, 0) - v_new_total) > 0.005 THEN
      IF COALESCE(v_legs, 0) = 0 THEN
        v_new_exp_amount := v_new_total;
        IF NOT p_dry_run THEN
          UPDATE public.expenses
          SET amount = v_new_total, updated_at = now()
          WHERE id = v_exp_id;
        END IF;
      ELSE
        -- Already posted: never rewrite a posted expense silently.
        v_needs_repost := true;
      END IF;
    END IF;

    IF COALESCE(v_legs, 0) > 0 AND ABS(COALESCE(v_ledger, 0) - v_new_total) > 0.005 THEN
      v_needs_repost := true;
    END IF;

    IF v_dup_amount = 0 AND ABS(v_new_total - v_old_total) <= 0.005
       AND COALESCE(v_new_exp_amount, 0) = COALESCE(v_exp_amount, 0) THEN
      v_status := CASE WHEN v_needs_repost THEN 'needs_ledger_repost' ELSE 'no_change' END;
      v_message := CASE
        WHEN v_needs_repost THEN 'Bill lines are clean but the posted ledger amount differs — void and repost the expense.'
        ELSE 'Nothing to fix on this bill.'
      END;
    ELSIF p_dry_run THEN
      v_status := 'would_fix';
      v_message := format('Would remove %s duplicate line(s) and set the total to %s.', v_removed, v_new_total);
    ELSE
      v_status := CASE WHEN v_needs_repost THEN 'fixed_needs_repost' ELSE 'fixed' END;
      v_message := format('Removed %s duplicate line(s); total %s -> %s.', v_removed, v_old_total, v_new_total)
        || CASE WHEN v_needs_repost THEN ' Posted ledger still shows the old amount — void and repost the expense.' ELSE '' END;
    END IF;

    IF NOT p_dry_run AND v_status LIKE 'fixed%' THEN
      INSERT INTO public.audit_logs (user_id, tenant_id, action, entity_type, entity_id, old_data, new_data)
      VALUES (
        auth.uid(), v_tenant, 'BULK_INVOICE_RECONCILE_FIX', 'purchase_invoice', v_inv.id,
        jsonb_build_object('total_amount', v_old_total, 'expense_amount', v_exp_amount,
                           'ledger_debit', v_ledger, 'duplicate_groups', v_dup_groups),
        jsonb_build_object('total_amount', v_new_total, 'expense_amount', v_new_exp_amount,
                           'removed_lines', v_removed, 'needs_ledger_repost', v_needs_repost)
      );
    END IF;

    invoice_id := v_inv.id;
    invoice_number := v_inv.invoice_number;
    status := v_status;
    removed_lines := COALESCE(v_removed, 0);
    old_total := v_old_total;
    new_total := v_new_total;
    duplicate_amount := v_dup_amount;
    expense_id := v_exp_id;
    old_expense_amount := v_exp_amount;
    new_expense_amount := v_new_exp_amount;
    ledger_debit := v_ledger;
    needs_ledger_repost := v_needs_repost;
    message := v_message;
    RETURN NEXT;

    v_exp_id := NULL; v_exp_amount := NULL; v_new_exp_amount := NULL;
  END LOOP;
END;
$function$;


-- bulk_post_expenses
CREATE OR REPLACE FUNCTION public.bulk_post_expenses(p_tenant_id uuid, p_branch_id uuid DEFAULT NULL::uuid, p_expense_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD; v_classify jsonb; v_tx_id uuid; v_batch_id uuid;
  v_actor uuid := auth.uid();
  v_attempted int := 0; v_posted int := 0; v_skipped int := 0; v_failed int := 0;
  v_details jsonb := '[]'::jsonb; v_err text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- Role must be held in the target business, not in any restaurant.
  IF NOT public.has_role_in_tenant(p_tenant_id, ARRAY['owner','manager','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Insufficient privileges to bulk-post expenses';
  END IF;
  IF public.get_user_tenant_id(v_actor) IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Cannot post for another tenant';
  END IF;

  FOR v_row IN
    SELECT e.id, e.branch_id, e.account_id FROM public.expenses e
    WHERE e.tenant_id = p_tenant_id
      AND COALESCE(e.ledger_posted, false) = false
      AND e.deleted_at IS NULL
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
      AND (p_expense_ids IS NULL OR e.id = ANY(p_expense_ids))
    ORDER BY e.expense_date, e.created_at
  LOOP
    v_attempted := v_attempted + 1;
    v_classify := public.classify_unposted_expense(v_row.id);

    IF (v_classify->>'status') <> 'ready' THEN
      v_skipped := v_skipped + 1;
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, trigger_source, triggered_by
      ) VALUES (p_tenant_id, v_row.id, v_row.branch_id, 'skip', 'blocked',
        v_classify->>'reason_code', v_classify->>'reason_detail', 'bulk', v_actor);
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'expense_id', v_row.id, 'outcome','blocked',
        'reason_code', v_classify->>'reason_code',
        'reason_detail', v_classify->>'reason_detail'));
      CONTINUE;
    END IF;

    BEGIN
      v_tx_id := public.post_expense_to_ledger(v_row.id, (v_classify->>'target_account_id')::uuid);
      SELECT batch_id INTO v_batch_id FROM public.account_transactions WHERE id = v_tx_id;
      v_posted := v_posted + 1;
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, batch_id, transaction_ids,
        dr_total, cr_total, trigger_source, triggered_by
      )
      SELECT p_tenant_id, v_row.id, v_row.branch_id, 'post', 'success',
             'posted','Posted via bulk action', v_batch_id, array_agg(t.id),
             COALESCE(sum(t.debit),0), COALESCE(sum(t.credit),0),
             'bulk', v_actor
      FROM public.account_transactions t WHERE t.batch_id = v_batch_id;
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'expense_id', v_row.id, 'outcome','posted', 'batch_id', v_batch_id));
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_err := SQLERRM;
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, trigger_source, triggered_by
      ) VALUES (p_tenant_id, v_row.id, v_row.branch_id, 'post', 'failed',
        'validation_failed', v_err, 'bulk', v_actor);
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'expense_id', v_row.id, 'outcome','failed', 'reason_detail', v_err));
    END;
  END LOOP;

  RETURN jsonb_build_object('attempted', v_attempted, 'posted', v_posted,
    'skipped', v_skipped, 'failed', v_failed, 'details', v_details);
END; $function$;


-- convert_fine_to_installments
CREATE OR REPLACE FUNCTION public.convert_fine_to_installments(p_fine_id uuid, p_already_deducted numeric DEFAULT NULL::numeric, p_monthly_limit numeric DEFAULT NULL::numeric, p_start_month date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fine public.employee_fines;
  v_deducted numeric;
  v_remaining numeric;
  v_limit numeric;
  v_group uuid;
  v_start date;
  v_month date;
  v_idx integer := 1;
  v_created integer := 0;
  v_amounts numeric[] := '{}';
  v_amt numeric;
  v_left numeric;
BEGIN
  SELECT * INTO v_fine FROM public.employee_fines WHERE id = p_fine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINE_NOT_FOUND'; END IF;
  -- Caller must be owner/manager/accountant of the business that owns this fine
  IF auth.uid() IS NOT NULL AND NOT public.has_role_in_tenant(public.get_restaurant_tenant_id(v_fine.restaurant_id), ARRAY['owner','manager','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only owners, managers or accountants of this business can change this fine.' USING ERRCODE = '42501';
  END IF;
  IF v_fine.deleted_at IS NOT NULL OR v_fine.status = 'cancelled' THEN
    RAISE EXCEPTION 'FINE_NOT_CONVERTIBLE: This fine is cancelled or deleted.';
  END IF;
  IF v_fine.installment_count IS NOT NULL AND v_fine.installment_count > 1 THEN
    RAISE EXCEPTION 'FINE_ALREADY_INSTALLMENT: This fine is already part of an installment schedule.';
  END IF;

  v_deducted := ROUND(GREATEST(COALESCE(p_already_deducted, v_fine.recovered_amount, 0), 0), 2);
  IF v_deducted > ROUND(v_fine.amount, 2) THEN
    RAISE EXCEPTION 'DEDUCTED_EXCEEDS_FINE: Already deducted % is greater than the fine amount %.',
      v_deducted, v_fine.amount;
  END IF;

  v_remaining := ROUND(v_fine.amount - v_deducted, 2);

  IF v_remaining <= 0.004 THEN
    UPDATE public.employee_fines
    SET recovered_amount = v_deducted,
        status = CASE WHEN status = 'approved' THEN 'applied' ELSE status END,
        applied_at = COALESCE(applied_at, now())
    WHERE id = p_fine_id;
    RETURN jsonb_build_object('installments_created', 0, 'already_deducted', v_deducted, 'remaining', 0);
  END IF;

  v_limit := ROUND(COALESCE(NULLIF(p_monthly_limit, 0), v_remaining), 2);
  IF v_limit <= 0 THEN v_limit := v_remaining; END IF;

  v_start := COALESCE(p_start_month, (date_trunc('month', COALESCE(v_fine.payroll_month, CURRENT_DATE))::date + INTERVAL '1 month')::date);
  v_start := date_trunc('month', v_start)::date;

  v_group := COALESCE(v_fine.installment_group_id, gen_random_uuid());

  v_left := v_remaining;
  WHILE v_left > 0.004 AND COALESCE(array_length(v_amounts, 1), 0) < 60 LOOP
    v_amt := LEAST(v_limit, v_left);
    v_amounts := array_append(v_amounts, ROUND(v_amt, 2));
    v_left := ROUND(v_left - v_amt, 2);
  END LOOP;
  IF v_left > 0.004 THEN
    v_amounts[array_length(v_amounts,1)] := ROUND(v_amounts[array_length(v_amounts,1)] + v_left, 2);
  END IF;

  UPDATE public.employee_fines
  SET amount = v_deducted,
      recovered_amount = v_deducted,
      installment_group_id = v_group,
      installment_number = 1,
      installment_count = array_length(v_amounts, 1) + 1,
      installment_total_amount = v_fine.amount
  WHERE id = p_fine_id;

  FOREACH v_amt IN ARRAY v_amounts LOOP
    v_idx := v_idx + 1;
    v_month := (v_start + ((v_idx - 2) || ' month')::interval)::date;
    INSERT INTO public.employee_fines (
      restaurant_id, branch_id, staff_id, violation_type_id, violation_date, payroll_month,
      description, attendance_reference, amount, status, created_by,
      installment_group_id, installment_number, installment_count, installment_total_amount,
      recovered_amount
    ) VALUES (
      v_fine.restaurant_id, v_fine.branch_id, v_fine.staff_id, v_fine.violation_type_id,
      v_fine.violation_date, v_month,
      'Installment ' || v_idx::text || '/' || (array_length(v_amounts,1) + 1)::text ||
        ' of ' || v_fine.amount::text || ' (balance after ' || v_deducted::text || ' already deducted)',
      v_fine.attendance_reference, v_amt,
      CASE WHEN v_fine.status IN ('approved','applied') THEN 'approved' ELSE 'draft' END,
      COALESCE(auth.uid(), v_fine.created_by),
      v_group, v_idx, array_length(v_amounts,1) + 1, v_fine.amount, 0
    );
    v_created := v_created + 1;
  END LOOP;

  INSERT INTO public.employee_fine_audit (
    fine_id, restaurant_id, action, old_amount, new_amount, reason, actor_id, metadata
  ) VALUES (
    p_fine_id, v_fine.restaurant_id, 'converted_to_installments',
    v_fine.amount, v_deducted,
    'Already deducted ' || v_deducted::text || ' kept on the original fine; remaining ' ||
      v_remaining::text || ' split into ' || v_created || ' installments',
    auth.uid(),
    jsonb_build_object(
      'original_amount', v_fine.amount,
      'already_deducted', v_deducted,
      'remaining', v_remaining,
      'monthly_limit', v_limit,
      'installments_created', v_created,
      'installment_group_id', v_group
    )
  );

  RETURN jsonb_build_object(
    'installment_group_id', v_group,
    'already_deducted', v_deducted,
    'remaining', v_remaining,
    'installments_created', v_created,
    'monthly_limit', v_limit
  );
END;
$function$;


-- explain_imbalance
CREATE OR REPLACE FUNCTION public.explain_imbalance(p_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_exp RECORD;
  v_dr numeric; v_cr numeric; v_diff numeric;
  v_legs jsonb;
  v_batches jsonb;
  v_credit_code text; v_credit_acct_info jsonb;
  v_suggested jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT e.id, e.tenant_id, e.branch_id, e.amount, e.expense_date, e.status,
         e.description, e.account_id, b.name AS branch_name,
         coa.account_code, coa.account_name
    INTO v_exp
  FROM public.expenses e
  LEFT JOIN public.branches b ON b.id = e.branch_id
  LEFT JOIN public.chart_of_accounts coa ON coa.id = e.account_id
  WHERE e.id = p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  -- Caller must belong to the expense's business (the old <> check passed when either tenant was NULL).
  IF NOT (public.is_superadmin(v_actor) OR public.user_belongs_to_tenant(v_actor, v_exp.tenant_id)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT COALESCE(sum(t.debit),0), COALESCE(sum(t.credit),0)
    INTO v_dr, v_cr
  FROM public.account_transactions t
  WHERE t.reference_type='expense' AND t.reference_id = p_expense_id
    AND COALESCE(t.is_voided,false) = false;
  v_diff := round(v_dr - v_cr, 2);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'transaction_date', t.transaction_date,
    'debit', t.debit, 'credit', t.credit,
    'description', t.description, 'batch_id', t.batch_id,
    'is_voided', t.is_voided,
    'account_code', coa.account_code,
    'account_name', coa.account_name,
    'account_type', coa.account_type
  ) ORDER BY t.created_at), '[]'::jsonb) INTO v_legs
  FROM public.account_transactions t
  LEFT JOIN public.chart_of_accounts coa ON coa.id = t.account_id
  WHERE t.reference_type='expense' AND t.reference_id = p_expense_id;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
    'batch_id', jb.id, 'batch_number', jb.batch_number,
    'description', jb.description, 'entry_date', jb.entry_date,
    'status', jb.status, 'total_amount', jb.total_amount
  )), '[]'::jsonb) INTO v_batches
  FROM public.journal_entry_batches jb
  WHERE jb.id IN (
    SELECT DISTINCT batch_id FROM public.account_transactions
    WHERE reference_type='expense' AND reference_id = p_expense_id AND batch_id IS NOT NULL
  );

  IF v_diff > 0 AND abs(v_diff - v_exp.amount) <= 0.01 THEN
    v_credit_code := CASE WHEN COALESCE(v_exp.status,'unpaid') = 'paid' THEN '1000' ELSE '2000' END;
    SELECT jsonb_build_object(
      'id', id, 'account_code', account_code, 'account_name', account_name
    ) INTO v_credit_acct_info
    FROM public.chart_of_accounts
    WHERE tenant_id = v_exp.tenant_id AND account_code = v_credit_code LIMIT 1;

    v_suggested := jsonb_build_object(
      'pattern','missing_credit_leg',
      'fixable_automatically', v_credit_acct_info IS NOT NULL,
      'fields', ARRAY['credit'],
      'proposed_action',
        'Insert a credit of '||v_diff||' to account '||v_credit_code||
        ' ('||COALESCE(v_credit_acct_info->>'account_name','MISSING')||')',
      'credit_account', v_credit_acct_info,
      'credit_amount', v_diff
    );
  ELSE
    v_suggested := jsonb_build_object(
      'pattern','ambiguous',
      'fixable_automatically', false,
      'fields', ARRAY['debit','credit'],
      'proposed_action','Manual review required — diff does not match a known pattern.'
    );
  END IF;

  RETURN jsonb_build_object(
    'expense', jsonb_build_object(
      'id', v_exp.id,
      'description', v_exp.description,
      'amount', v_exp.amount,
      'expense_date', v_exp.expense_date,
      'status', v_exp.status,
      'branch_name', v_exp.branch_name,
      'account_code', v_exp.account_code,
      'account_name', v_exp.account_name
    ),
    'totals', jsonb_build_object('dr_total', v_dr, 'cr_total', v_cr, 'diff', v_diff),
    'batches', v_batches,
    'legs', v_legs,
    'suggested_fix', v_suggested
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

  -- Usage can only grow: a zero, negative or NULL amount would reset or wipe quota counters
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Usage amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tenant_usage
  SET
    image_upload_count = CASE WHEN p_quota_type = 'image_uploads' THEN image_upload_count + p_amount ELSE image_upload_count END,
    email_reminder_count = CASE WHEN p_quota_type = 'email_reminders' THEN email_reminder_count + p_amount ELSE email_reminder_count END,
    updated_at = now()
  WHERE tenant_id = p_tenant_id;
  
  RETURN FOUND;
END;
$function$;


-- inspect_zatca_audit_break
CREATE OR REPLACE FUNCTION public.inspect_zatca_audit_break(_tenant_id uuid)
 RETURNS TABLE(broken_row uuid, broken_seq bigint, entity_type text, entity_id uuid, action text, created_at timestamp with time zone, stored_hash text, expected_hash text, stored_prev_hash text, expected_prev_hash text, payload jsonb, prev_payload jsonb, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record;
  v_prev_hash text := repeat('0', 64);
  v_prev_payload jsonb := NULL;
  v_expected text;
BEGIN
  -- require an explicit tenant the caller belongs to (old <> check passed when caller had no profile tenant)
  IF _tenant_id IS NULL OR NOT COALESCE(public.is_superadmin(auth.uid()) OR public.user_belongs_to_tenant(auth.uid(), _tenant_id), false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN
    SELECT t.id, t.sequence_no, t.entity_type, t.entity_id, t.action, t.created_at,
           t.payload, t.payload_hash, t.prev_hash
    FROM public.zatca_audit_trail t
    WHERE t.tenant_id = _tenant_id
    ORDER BY t.sequence_no ASC
  LOOP
    IF r.prev_hash <> v_prev_hash THEN
      broken_row := r.id; broken_seq := r.sequence_no;
      entity_type := r.entity_type; entity_id := r.entity_id; action := r.action;
      created_at := r.created_at;
      stored_hash := r.payload_hash;
      expected_hash := encode(digest(v_prev_hash || public.zatca_canonical_json(r.payload), 'sha256'), 'hex');
      stored_prev_hash := r.prev_hash;
      expected_prev_hash := v_prev_hash;
      payload := r.payload;
      prev_payload := v_prev_payload;
      reason := 'prev_hash mismatch - chain broken before this row';
      RETURN NEXT; RETURN;
    END IF;

    v_expected := encode(digest(v_prev_hash || public.zatca_canonical_json(r.payload), 'sha256'), 'hex');
    IF v_expected <> r.payload_hash THEN
      broken_row := r.id; broken_seq := r.sequence_no;
      entity_type := r.entity_type; entity_id := r.entity_id; action := r.action;
      created_at := r.created_at;
      stored_hash := r.payload_hash;
      expected_hash := v_expected;
      stored_prev_hash := r.prev_hash;
      expected_prev_hash := v_prev_hash;
      payload := r.payload;
      prev_payload := v_prev_payload;
      reason := 'payload_hash mismatch - payload modified after sealing';
      RETURN NEXT; RETURN;
    END IF;

    v_prev_hash := r.payload_hash;
    v_prev_payload := r.payload;
  END LOOP;

  RETURN;
END;
$function$;


-- log_audit
CREATE OR REPLACE FUNCTION public.log_audit(_action text, _entity_type text, _entity_id uuid DEFAULT NULL::uuid, _old_data jsonb DEFAULT NULL::jsonb, _new_data jsonb DEFAULT NULL::jsonb, _tenant_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _log_id UUID;
  _user_tenant_id UUID;
BEGIN
  -- signed-in callers may only write audit rows for a business they belong to
  IF auth.uid() IS NOT NULL AND _tenant_id IS NOT NULL AND NOT (public.is_superadmin(auth.uid()) OR public.user_belongs_to_tenant(auth.uid(), _tenant_id)) THEN
    RAISE EXCEPTION 'Not authorized to write audit logs for this business' USING ERRCODE = '42501';
  END IF;

  -- Get user's tenant if not provided
  IF _tenant_id IS NULL THEN
    SELECT tenant_id INTO _user_tenant_id FROM public.profiles WHERE id = auth.uid();
  ELSE
    _user_tenant_id := _tenant_id;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, tenant_id, action, entity_type, entity_id, old_data, new_data
  ) VALUES (
    auth.uid(), _user_tenant_id, _action, _entity_type, _entity_id, _old_data, _new_data
  )
  RETURNING id INTO _log_id;
  
  RETURN _log_id;
END;
$function$;


-- mark_expense_vat_not_applicable
CREATE OR REPLACE FUNCTION public.mark_expense_vat_not_applicable(p_expense_id uuid, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exp record;
  v_ledger jsonb;
BEGIN
  SELECT * INTO v_exp FROM expenses
  WHERE id = p_expense_id AND deleted_at IS NULL AND vat_split_status = 'pending';
  IF v_exp.id IS NULL THEN
    RETURN false;
  END IF;
  -- Role must be held in the expense's own business and the caller must have access to its restaurant.
  IF NOT (public.has_role_in_tenant(v_exp.tenant_id, ARRAY['owner','accountant','manager']::public.app_role[])
          AND public.can_access_restaurant(v_exp.restaurant_id)) THEN
    RAISE EXCEPTION 'Not allowed.';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'account_code'), '[]'::jsonb) INTO v_ledger
  FROM (
    SELECT jsonb_build_object(
      'account_code', coa.account_code,
      'account_name', coa.account_name,
      'debit', at.debit,
      'credit', at.credit,
      'batch_id', at.batch_id,
      'transaction_date', at.transaction_date
    ) AS x
    FROM account_transactions at
    LEFT JOIN chart_of_accounts coa ON coa.id = at.account_id
    WHERE at.reference_id = p_expense_id
      AND at.reference_type IN ('expense','correction')
      AND COALESCE(at.is_voided, false) = false
  ) s;

  UPDATE expenses
  SET vat_split_status = 'not_applicable', updated_at = now()
  WHERE id = p_expense_id;

  INSERT INTO expense_vat_split_audit (
    tenant_id, restaurant_id, branch_id, expense_id, action, rate_percent,
    amount_before, net_before, vat_before, status_before,
    amount_after, net_after, vat_after, status_after,
    ledger_posted, batch_id, ledger_before, ledger_after, note, performed_by
  ) VALUES (
    v_exp.tenant_id, v_exp.restaurant_id, v_exp.branch_id, p_expense_id, 'marked_not_applicable', NULL,
    v_exp.amount, v_exp.net_amount, COALESCE(v_exp.vat_amount, 0), 'pending',
    v_exp.amount, v_exp.net_amount, COALESCE(v_exp.vat_amount, 0), 'not_applicable',
    COALESCE(v_exp.ledger_posted, false), NULL, v_ledger, v_ledger, p_note, auth.uid()
  );

  RETURN true;
END;
$function$;


-- post_expense_to_ledger
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
  v_supplier_ap uuid;
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
  -- Signed-in callers must belong to the expense's business.
  IF auth.uid() IS NOT NULL AND NOT public.can_access_restaurant(v_expense.restaurant_id) THEN
    RAISE EXCEPTION 'Not allowed to post expenses for this restaurant' USING ERRCODE = '42501';
  END IF;
  -- p_account_id is written to expenses.account_id, so it must belong to the expense's business.
  IF p_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts WHERE id = p_account_id AND tenant_id = v_expense.tenant_id
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Account does not belong to this business' USING ERRCODE = '42501';
  END IF;
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
    -- Prefer a supplier-specific payable head when the bill names a supplier.
    v_supplier_ap := public.resolve_supplier_ap_account(v_expense.tenant_id, v_expense.supplier_id);

    IF v_supplier_ap IS NOT NULL THEN
      v_credit_account_id := v_supplier_ap;
      SELECT account_code INTO v_credit_code FROM public.chart_of_accounts WHERE id = v_credit_account_id;
      v_credit_label := 'on credit (' || COALESCE(v_credit_code, 'AP') || ' supplier payable)';
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


-- post_municipality_fine_to_expense
CREATE OR REPLACE FUNCTION public.post_municipality_fine_to_expense(_fine_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare f record; v_cat uuid; v_expense uuid;
begin
  select * into f from public.municipality_fines where id = _fine_id for update;
  if not found then raise exception 'Fine not found'; end if;
  -- access check before the idempotent early return so other businesses cannot read the posted expense id
  if not public.can_access_restaurant(f.restaurant_id) then raise exception 'Not authorized'; end if;
  if f.expense_id is not null then return f.expense_id; end if;
  if coalesce(f.amount, 0) <= 0 then raise exception 'Fine amount must be greater than zero before posting'; end if;

  select id into v_cat from public.expense_categories
  where restaurant_id = f.restaurant_id and lower(name) = 'government & regulatory fines'
    and (branch_id is null or branch_id = f.branch_id)
  order by branch_id nulls last limit 1;

  if v_cat is null then
    insert into public.expense_categories(restaurant_id, name, color)
    values (f.restaurant_id, 'Government & Regulatory Fines', '#dc2626')
    returning id into v_cat;
  end if;

  insert into public.expenses(restaurant_id, branch_id, category_id, amount, description, expense_date, status, approval_status, created_by)
  values (f.restaurant_id, f.branch_id, v_cat, f.amount,
          concat('Municipality fine ', f.fine_reference, coalesce(' - ' || f.violation_summary, '')),
          coalesce(f.received_date, current_date), 'unpaid', 'pending', coalesce(auth.uid(), f.created_by))
  returning id into v_expense;

  update public.municipality_fines set expense_id = v_expense, posted_at = now() where id = _fine_id;
  return v_expense;
end $function$;


-- post_single_expense
CREATE OR REPLACE FUNCTION public.post_single_expense(p_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_exp RECORD;
  v_classify jsonb;
  v_tx_id uuid;
  v_batch_id uuid;
  v_dr numeric;
  v_cr numeric;
  v_err text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','unauthenticated','error','Not authenticated');
  END IF;
  SELECT id, tenant_id, branch_id, ledger_posted, deleted_at
    INTO v_exp
  FROM public.expenses
  WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','not_found','error','Expense not found');
  END IF;
  -- Role must be held in the expense's business, not in any restaurant.
  IF NOT public.has_role_in_tenant(v_exp.tenant_id, ARRAY['owner','manager','accountant']::public.app_role[]) THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','forbidden','error','Insufficient privileges');
  END IF;
  IF v_exp.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome','blocked','reason_code','deleted','error','Expense is deleted');
  END IF;
  IF public.get_user_tenant_id(v_actor) IS DISTINCT FROM v_exp.tenant_id THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','forbidden','error','Cannot post for another tenant');
  END IF;

  v_classify := public.classify_unposted_expense(p_expense_id);
  IF (v_classify->>'status') <> 'ready' THEN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, trigger_source, triggered_by
    ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'skip', 'blocked',
      v_classify->>'reason_code', v_classify->>'reason_detail', 'retry', v_actor);
    RETURN jsonb_build_object(
      'outcome','blocked',
      'reason_code', v_classify->>'reason_code',
      'reason_detail', v_classify->>'reason_detail',
      'error', v_classify->>'reason_detail');
  END IF;

  BEGIN
    v_tx_id := public.post_expense_to_ledger(p_expense_id, (v_classify->>'target_account_id')::uuid);
    SELECT batch_id INTO v_batch_id FROM public.account_transactions WHERE id = v_tx_id;
    SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO v_dr, v_cr
    FROM public.account_transactions WHERE batch_id = v_batch_id;
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, batch_id, transaction_ids,
      dr_total, cr_total, trigger_source, triggered_by
    )
    SELECT v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'post','success',
           'posted','Posted via single-row retry', v_batch_id, array_agg(t.id),
           v_dr, v_cr, 'retry', v_actor
    FROM public.account_transactions t WHERE t.batch_id = v_batch_id;
    RETURN jsonb_build_object('outcome','posted','batch_id', v_batch_id,
                              'dr_total', v_dr, 'cr_total', v_cr);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, trigger_source, triggered_by
    ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'post','failed',
      'validation_failed', v_err, 'retry', v_actor);
    RETURN jsonb_build_object('outcome','failed','reason_code','validation_failed','error', v_err);
  END;
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
    -- item ids on stocktake lines are user-editable: only touch this stocktake's restaurant's items
    WHERE id = v_item.inventory_item_id
      AND restaurant_id = v_stocktake.restaurant_id;
  END LOOP;
  
  RETURN v_batch_id;
END;
$function$;


-- quick_pay_installment
CREATE OR REPLACE FUNCTION public.quick_pay_installment(p_installment_id uuid, p_payment_account_id uuid DEFAULT NULL::uuid, p_paid_date date DEFAULT NULL::date, p_reference_number text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pay public.installment_payments%ROWTYPE;
  v_account uuid := p_payment_account_id;
BEGIN
  SELECT * INTO v_pay FROM public.installment_payments WHERE id = p_installment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Installment not found';
  END IF;

  -- tenant_id is a business id, not a restaurant id: require owner/manager/accountant of that business
  IF NOT public.can_manage_capital(v_pay.tenant_id) THEN
    RAISE EXCEPTION 'Not authorised for this installment';
  END IF;

  IF v_pay.status = 'paid' THEN
    RAISE EXCEPTION 'Installment % is already paid', v_pay.installment_no;
  END IF;

  IF v_account IS NULL THEN
    SELECT id INTO v_account
    FROM public.chart_of_accounts
    WHERE tenant_id = v_pay.tenant_id
      AND is_active = true
      AND account_type = 'asset'
      AND account_code BETWEEN '1000' AND '1019'
    ORDER BY account_code
    LIMIT 1;
  END IF;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'No cash or bank account configured. Open the Chart of Accounts and add a cash/bank account (1000-1019) first.';
  END IF;

  RETURN public.pay_installment(
    p_installment_id := p_installment_id,
    p_payment_account_id := v_account,
    p_paid_date := COALESCE(p_paid_date, CURRENT_DATE),
    p_funding_source := 'company',
    p_capital_account_id := NULL,
    p_reference_number := p_reference_number
  );
END;
$function$;


-- realign_advance_branch
CREATE OR REPLACE FUNCTION public.realign_advance_branch(p_advance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_adv record;
  v_staff_branch uuid;
  v_legs int;
BEGIN
  SELECT a.* INTO v_adv FROM public.staff_advances a WHERE a.id = p_advance_id;
  IF v_adv.id IS NULL THEN
    RAISE EXCEPTION 'Advance not found';
  END IF;

  IF NOT (
    -- Owner/manager role must be held in the advance's own restaurant, not any restaurant
    public.has_role(auth.uid(), v_adv.restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), v_adv.restaurant_id, 'manager'::app_role)
    OR public.is_superadmin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'Only owners or managers can realign an advance branch';
  END IF;

  IF NOT public.can_access_restaurant(v_adv.restaurant_id) THEN
    RAISE EXCEPTION 'Not authorised for this restaurant';
  END IF;

  SELECT s.branch_id INTO v_staff_branch FROM public.staff s WHERE s.id = v_adv.staff_id;
  IF v_staff_branch IS NULL THEN
    RAISE EXCEPTION 'Staff member has no branch assigned';
  END IF;

  IF v_staff_branch = v_adv.branch_id THEN
    RETURN jsonb_build_object('changed', false, 'branch_id', v_staff_branch, 'legs_updated', 0);
  END IF;

  UPDATE public.staff_advances
     SET branch_id = v_staff_branch
   WHERE id = p_advance_id;

  UPDATE public.account_transactions
     SET branch_id = v_staff_branch
   WHERE reference_id = p_advance_id
     AND reference_type IN ('staff_advance','staff_advance_reversal','staff_advance_repayment','advance_deduction')
     AND branch_id IS DISTINCT FROM v_staff_branch;
  GET DIAGNOSTICS v_legs = ROW_COUNT;

  UPDATE public.staff_advance_branch_audit
     SET ledger_legs_updated = v_legs,
         source = 'realign_rpc',
         note = 'Realigned to staff profile branch'
   WHERE id = (
     SELECT id FROM public.staff_advance_branch_audit
      WHERE advance_id = p_advance_id
      ORDER BY changed_at DESC
      LIMIT 1
   );

  RETURN jsonb_build_object(
    'changed', true,
    'from_branch_id', v_adv.branch_id,
    'branch_id', v_staff_branch,
    'legs_updated', v_legs
  );
END;
$function$;


-- reconcile_expense_ledger
CREATE OR REPLACE FUNCTION public.reconcile_expense_ledger(p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(expense_id uuid, expense_date date, amount numeric, debit_total numeric, credit_total numeric, action text, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_credit_code text;
  v_credit_account_id uuid;
  v_diff numeric;
  v_batch_id uuid;
  v_debit_tx_id uuid;
  v_post_dr numeric;
  v_post_cr numeric;
  v_actor_id uuid;
BEGIN
  -- Signed-in callers must name a business they manage; only service/job callers may reconcile all tenants.
  IF auth.uid() IS NOT NULL AND NOT (p_tenant_id IS NOT NULL AND public.can_manage_capital(p_tenant_id)) THEN
    RAISE EXCEPTION 'Not allowed to reconcile expenses for this business' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT e.*,
           COALESCE((SELECT SUM(at.debit) FROM public.account_transactions at
                     WHERE at.reference_type = 'expense'
                       AND at.reference_id = e.id
                       AND COALESCE(at.is_voided, false) = false), 0) AS dr,
           COALESCE((SELECT SUM(at.credit) FROM public.account_transactions at
                     WHERE at.reference_type = 'expense'
                       AND at.reference_id = e.id
                       AND COALESCE(at.is_voided, false) = false), 0) AS cr
    FROM public.expenses e
    WHERE e.deleted_at IS NULL
      AND (p_tenant_id IS NULL OR e.tenant_id = p_tenant_id)
      AND e.approval_status = 'approved'
      AND (
        COALESCE(e.ledger_posted, false) = false
        OR EXISTS (
          SELECT 1
          FROM public.account_transactions at
          WHERE at.reference_type = 'expense'
            AND at.reference_id = e.id
            AND COALESCE(at.is_voided, false) = false
        )
      )
  LOOP
    IF COALESCE(r.ledger_posted, false) = false AND r.dr = 0 AND r.cr = 0 THEN
      IF r.account_id IS NULL THEN
        expense_id := r.id;
        expense_date := r.expense_date;
        amount := r.amount;
        debit_total := 0;
        credit_total := 0;
        action := 'flagged';
        detail := 'Missing Chart of Accounts mapping; expense cannot be posted automatically';
        RETURN NEXT;
        CONTINUE;
      END IF;

      BEGIN
        v_debit_tx_id := public.post_expense_to_ledger(r.id, r.account_id);

        SELECT COALESCE(SUM(at.debit), 0), COALESCE(SUM(at.credit), 0)
          INTO v_post_dr, v_post_cr
        FROM public.account_transactions at
        WHERE at.reference_type = 'expense'
          AND at.reference_id = r.id
          AND COALESCE(at.is_voided, false) = false;

        expense_id := r.id;
        expense_date := r.expense_date;
        amount := r.amount;
        debit_total := v_post_dr;
        credit_total := v_post_cr;
        action := CASE WHEN ABS(v_post_dr - v_post_cr) <= 0.005 THEN 'posted' ELSE 'flagged' END;
        detail := CASE WHEN ABS(v_post_dr - v_post_cr) <= 0.005
          THEN 'Created balanced debit and credit ledger entries'
          ELSE 'Posted rows still do not balance; manual review required'
        END;
        RETURN NEXT;
      EXCEPTION WHEN OTHERS THEN
        expense_id := r.id;
        expense_date := r.expense_date;
        amount := r.amount;
        debit_total := r.dr;
        credit_total := r.cr;
        action := 'flagged';
        detail := SQLERRM;
        RETURN NEXT;
      END;

      CONTINUE;
    END IF;

    v_diff := r.dr - r.cr;
    IF ABS(v_diff) <= 0.005 THEN
      IF COALESCE(r.ledger_posted, false) = false THEN
        UPDATE public.expenses
        SET ledger_posted = true,
            ledger_transaction_id = (
              SELECT at.id
              FROM public.account_transactions at
              WHERE at.reference_type = 'expense'
                AND at.reference_id = r.id
                AND COALESCE(at.is_voided, false) = false
                AND COALESCE(at.debit, 0) > 0
              ORDER BY at.created_at ASC
              LIMIT 1
            )
        WHERE id = r.id;

        expense_id := r.id;
        expense_date := r.expense_date;
        amount := r.amount;
        debit_total := r.dr;
        credit_total := r.cr;
        action := 'marked_posted';
        detail := 'Existing ledger entries were already balanced; marked expense as posted';
        RETURN NEXT;
      END IF;
      CONTINUE;
    END IF;

    IF v_diff > 0.005 THEN
      v_credit_code := CASE WHEN COALESCE(r.status, 'unpaid') = 'paid' THEN '1000' ELSE '2000' END;

      SELECT id INTO v_credit_account_id
      FROM public.chart_of_accounts
      WHERE tenant_id = r.tenant_id
        AND account_code = v_credit_code
      LIMIT 1;

      IF v_credit_account_id IS NULL THEN
        expense_id := r.id;
        expense_date := r.expense_date;
        amount := r.amount;
        debit_total := r.dr;
        credit_total := r.cr;
        action := 'flagged';
        detail := 'Missing counter-account ' || v_credit_code || ' in chart of accounts';
        RETURN NEXT;
        CONTINUE;
      END IF;

      v_batch_id := (
        SELECT at.batch_id
        FROM public.account_transactions at
        WHERE at.reference_type = 'expense'
          AND at.reference_id = r.id
          AND at.batch_id IS NOT NULL
        LIMIT 1
      );

      IF v_batch_id IS NULL THEN
        v_actor_id := COALESCE(auth.uid(), r.approved_by, r.created_by);
        INSERT INTO public.journal_entry_batches (
          tenant_id,
          batch_date,
          description,
          reference_number,
          entry_type,
          created_by,
          is_posted,
          posted_at,
          posted_by,
          journal_type,
          approval_status,
          approved_by,
          approved_at
        ) VALUES (
          r.tenant_id,
          r.expense_date,
          'Expense reconciliation backfill: ' || COALESCE(r.description, r.id::text),
          'EXP-RECON-' || r.id::text,
          'expense',
          v_actor_id,
          true,
          now(),
          v_actor_id,
          'expense',
          'approved',
          v_actor_id,
          now()
        ) RETURNING id INTO v_batch_id;
      END IF;

      INSERT INTO public.account_transactions(
        tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, branch_id, batch_id
      ) VALUES (
        r.tenant_id, v_credit_account_id, r.expense_date, NULL, v_diff,
        COALESCE(r.description, 'Expense') || ' — reconciliation backfill (' ||
          CASE WHEN v_credit_code = '1000' THEN 'Cash' ELSE 'AP' END || ')',
        'expense', r.id, COALESCE(auth.uid(), r.approved_by, r.created_by), r.branch_id, v_batch_id
      );

      UPDATE public.expenses
      SET ledger_posted = true,
          ledger_transaction_id = COALESCE(ledger_transaction_id, (
            SELECT at.id
            FROM public.account_transactions at
            WHERE at.reference_type = 'expense'
              AND at.reference_id = r.id
              AND COALESCE(at.is_voided, false) = false
              AND COALESCE(at.debit, 0) > 0
            ORDER BY at.created_at ASC
            LIMIT 1
          ))
      WHERE id = r.id;

      expense_id := r.id;
      expense_date := r.expense_date;
      amount := r.amount;
      debit_total := r.dr;
      credit_total := r.cr + v_diff;
      action := 'backfilled';
      detail := 'Inserted missing credit leg of ' || v_diff::text || ' to account ' || v_credit_code;
      RETURN NEXT;
    ELSE
      expense_id := r.id;
      expense_date := r.expense_date;
      amount := r.amount;
      debit_total := r.dr;
      credit_total := r.cr;
      action := 'flagged';
      detail := 'Credits exceed debits by ' || ABS(v_diff)::text || ' — manual review required';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;


-- reconcile_provisional_cogs
CREATE OR REPLACE FUNCTION public.reconcile_provisional_cogs(_stocktake_id uuid, _kind text DEFAULT 'weekly'::text, _correct_wac boolean DEFAULT false, _reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid;
  v_existing uuid;
  v_tenant_id uuid;
  v_restaurant_id uuid;
  v_period_start date;
  v_period_end date;
  v_batch_id uuid;
  v_total_prov numeric(14,4) := 0;
  v_total_act  numeric(14,4) := 0;
  v_total_var  numeric(14,4) := 0;
  v_items_count int := 0;
  v_items_var int := 0;
  v_item record;
  v_prov numeric(14,4);
  v_actual numeric(14,4);
  v_variance numeric(14,4);
  v_inv record;
  v_inv_acct_code text;
  v_cogs_acct_code text;
  v_inv_acct_id uuid;
  v_cogs_acct_id uuid;
  v_new_wac numeric(14,6);
BEGIN
  IF _kind = 'weekly' THEN
    SELECT tenant_id, restaurant_id, week_start_date, COALESCE(week_end_date, stocktake_date)
      INTO v_tenant_id, v_restaurant_id, v_period_start, v_period_end
    FROM public.weekly_stocktakes WHERE id = _stocktake_id;
  ELSIF _kind = 'daily' THEN
    SELECT NULL::uuid, restaurant_id, NULL::date, stocktake_date
      INTO v_tenant_id, v_restaurant_id, v_period_start, v_period_end
    FROM public.stocktakes WHERE id = _stocktake_id;
    IF v_restaurant_id IS NOT NULL THEN
      SELECT tenant_id INTO v_tenant_id FROM public.restaurants WHERE id = v_restaurant_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid stocktake kind: %', _kind;
  END IF;

  IF v_restaurant_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Stocktake % not found', _stocktake_id;
  END IF;
  -- Access: a member of this business with the right to post journal entries (system callers,
  -- with no user, are the scheduled jobs).
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_tenant_access(v_tenant_id);
    PERFORM public.assert_restaurant_access(v_restaurant_id);
    IF NOT public.can_post_journal_entries(v_tenant_id) THEN
      RAISE EXCEPTION 'Not allowed to post cost of goods for this business' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- idempotency lookup moved below the access check so an existing run id is not returned to outsiders
  SELECT id INTO v_existing FROM public.cogs_trueup_runs
   WHERE stocktake_id = _stocktake_id AND stocktake_kind = _kind;
  IF FOUND THEN RETURN v_existing; END IF;


  INSERT INTO public.cogs_trueup_runs
    (tenant_id, restaurant_id, stocktake_id, stocktake_kind,
     period_start, period_end, wac_corrected, reason, created_by)
  VALUES
    (v_tenant_id, v_restaurant_id, _stocktake_id, _kind,
     v_period_start, v_period_end, _correct_wac, _reason, auth.uid())
  RETURNING id INTO v_run_id;

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number,
     entry_type, journal_type, is_posted, posted_at)
  VALUES
    (v_tenant_id, v_period_end,
     'COGS true-up for ' || _kind || ' stocktake ' || _stocktake_id::text,
     'TRUEUP-' || v_run_id::text,
     'cogs_trueup', 'cogs_trueup', true, now())
  RETURNING id INTO v_batch_id;

  UPDATE public.cogs_trueup_runs SET ledger_batch_id = v_batch_id WHERE id = v_run_id;

  FOR v_item IN
    SELECT
      sti.inventory_item_id,
      CASE WHEN _kind = 'weekly' THEN sti.consumption_value
           ELSE COALESCE(sti.variance_value, 0) END AS actual_cogs_val,
      CASE WHEN _kind = 'weekly' THEN sti.closing_qty   ELSE sti.counted_quantity END AS closing_qty,
      CASE WHEN _kind = 'weekly' THEN sti.closing_value ELSE (sti.counted_quantity * sti.unit_cost) END AS closing_val
    FROM (
      SELECT inventory_item_id,
             NULL::numeric AS consumption_value,
             NULL::numeric AS closing_qty,
             NULL::numeric AS closing_value,
             variance_value, counted_quantity, unit_cost
      FROM public.stocktake_items WHERE stocktake_id = _stocktake_id AND _kind = 'daily'
      UNION ALL
      SELECT inventory_item_id, consumption_value, closing_qty, closing_value,
             NULL::numeric, NULL::numeric, NULL::numeric
      FROM public.weekly_stocktake_items WHERE stocktake_id = _stocktake_id AND _kind = 'weekly'
    ) sti
  LOOP
    v_items_count := v_items_count + 1;

    SELECT COALESCE(SUM(cogs_amount), 0) INTO v_prov
    FROM public.provisional_cogs_postings
    WHERE inventory_item_id = v_item.inventory_item_id
      AND restaurant_id = v_restaurant_id
      AND status IN ('posted','negative_stock_flag')
      AND posted_at::date <= v_period_end
      AND (v_period_start IS NULL OR posted_at::date >= v_period_start);

    v_actual := COALESCE(v_item.actual_cogs_val, 0);
    v_variance := ROUND(v_actual - v_prov, 4);

    SELECT id, COALESCE(unit_cost,0) AS unit_cost, category_id,
           inventory_account_code, cogs_account_code
      INTO v_inv
    FROM public.inventory_items
    WHERE id = v_item.inventory_item_id
      AND restaurant_id = v_restaurant_id;

    v_inv_acct_code  := v_inv.inventory_account_code;
    v_cogs_acct_code := v_inv.cogs_account_code;
    IF v_inv_acct_code IS NULL OR v_cogs_acct_code IS NULL THEN
      SELECT COALESCE(v_inv_acct_code, ic.inventory_account_code),
             COALESCE(v_cogs_acct_code, ic.cogs_account_code)
        INTO v_inv_acct_code, v_cogs_acct_code
      FROM public.inventory_categories ic
      WHERE ic.id = v_inv.category_id;
    END IF;
    v_inv_acct_code  := COALESCE(v_inv_acct_code, '1200');
    v_cogs_acct_code := COALESCE(v_cogs_acct_code, '5000');

    v_inv_acct_id  := public.get_account_id_by_code(v_tenant_id, v_inv_acct_code);
    v_cogs_acct_id := public.get_account_id_by_code(v_tenant_id, v_cogs_acct_code);

    IF ABS(v_variance) >= 0.01 AND v_inv_acct_id IS NOT NULL AND v_cogs_acct_id IS NOT NULL THEN
      v_items_var := v_items_var + 1;
      IF v_variance > 0 THEN
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit,
           description, reference_type, reference_id, batch_id)
        VALUES
          (v_tenant_id, v_cogs_acct_id, v_period_end, v_variance, 0,
           'COGS true-up DR', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id),
          (v_tenant_id, v_inv_acct_id, v_period_end, 0, v_variance,
           'COGS true-up CR Inventory', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id);
      ELSE
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit,
           description, reference_type, reference_id, batch_id)
        VALUES
          (v_tenant_id, v_inv_acct_id, v_period_end, ABS(v_variance), 0,
           'COGS true-up DR Inventory', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id),
          (v_tenant_id, v_cogs_acct_id, v_period_end, 0, ABS(v_variance),
           'COGS true-up CR COGS reversal', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id);
      END IF;
    END IF;

    v_new_wac := NULL;
    IF _correct_wac AND v_item.closing_qty IS NOT NULL AND v_item.closing_qty > 0 AND v_item.closing_val IS NOT NULL THEN
      v_new_wac := ROUND(v_item.closing_val / v_item.closing_qty, 6);
      UPDATE public.inventory_items
         SET unit_cost = v_new_wac, updated_at = now()
       WHERE id = v_item.inventory_item_id
         -- item ids on stocktake lines are user-editable: only this stocktake's restaurant's items
         AND restaurant_id = v_restaurant_id
         AND ABS(COALESCE(unit_cost,0) - v_new_wac) >= 0.0001;
    END IF;

    INSERT INTO public.cogs_trueup_adjustments
      (trueup_run_id, inventory_item_id,
       provisional_cogs, actual_cogs, variance,
       prev_wac, new_wac, wac_corrected,
       inventory_account_code, cogs_account_code)
    VALUES
      (v_run_id, v_item.inventory_item_id,
       v_prov, v_actual, v_variance,
       v_inv.unit_cost, v_new_wac, (v_new_wac IS NOT NULL),
       v_inv_acct_code, v_cogs_acct_code);

    v_total_prov := v_total_prov + v_prov;
    v_total_act  := v_total_act + v_actual;
    v_total_var  := v_total_var + v_variance;
  END LOOP;

  UPDATE public.cogs_trueup_runs
     SET total_provisional_cogs = v_total_prov,
         total_actual_cogs = v_total_act,
         total_variance = v_total_var,
         items_count = v_items_count,
         items_with_variance = v_items_var
   WHERE id = v_run_id;

  RETURN v_run_id;
END;
$function$;


-- record_staff_advance_repayment
CREATE OR REPLACE FUNCTION public.record_staff_advance_repayment(p_advance_id uuid, p_amount numeric, p_repayment_date date DEFAULT CURRENT_DATE, p_source text DEFAULT 'cash'::text, p_account_id uuid DEFAULT NULL::uuid, p_payroll_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_advance RECORD;
  v_outstanding numeric;
  v_advance_account_id uuid;
  v_debit_account_id uuid;
  v_debit_label text := 'Cash';
  v_txn_id uuid;
  v_repayment_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Repayment amount must be greater than zero';
  END IF;
  IF p_source NOT IN ('cash','bank','payroll') THEN
    RAISE EXCEPTION 'Invalid repayment source: %', p_source;
  END IF;

  SELECT sa.*, s.name AS staff_name INTO v_advance
  FROM staff_advances sa
  JOIN staff s ON s.id = sa.staff_id
  WHERE sa.id = p_advance_id
  FOR UPDATE OF sa;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff advance record not found';
  END IF;

  -- Caller must be owner/manager/accountant of the business that owns this advance
  IF auth.uid() IS NOT NULL AND NOT public.has_role_in_tenant(v_advance.tenant_id, ARRAY['owner','manager','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants of this business can change this advance' USING ERRCODE = '42501';
  END IF;

  IF v_advance.status = 'forgiven' THEN
    RAISE EXCEPTION 'This advance was forgiven and cannot be repaid';
  END IF;

  IF COALESCE(v_advance.ledger_reversed, false) THEN
    RAISE EXCEPTION 'This advance ledger entry was reversed and cannot be repaid';
  END IF;

  v_outstanding := v_advance.amount - COALESCE(v_advance.repaid_amount, 0);
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'This advance is already fully repaid';
  END IF;
  IF p_amount > v_outstanding + 0.005 THEN
    RAISE EXCEPTION 'Repayment (%) exceeds the outstanding balance (%)', p_amount, v_outstanding;
  END IF;

  SELECT id INTO v_advance_account_id FROM chart_of_accounts
  WHERE tenant_id = v_advance.tenant_id AND account_code = '1150' AND is_active = true LIMIT 1;
  IF v_advance_account_id IS NULL THEN
    RAISE EXCEPTION 'Employee advances account (1150) is not configured';
  END IF;

  -- Payroll-sourced repayments are credited to 1150 by post_payroll_to_ledger,
  -- so we only post a journal for cash/bank repayments here.
  IF p_source <> 'payroll' THEN
    IF p_account_id IS NOT NULL THEN
      SELECT id, account_name INTO v_debit_account_id, v_debit_label
      FROM chart_of_accounts
      WHERE id = p_account_id AND tenant_id = v_advance.tenant_id AND is_active = true;
    END IF;
    IF v_debit_account_id IS NULL THEN
      SELECT id, account_name INTO v_debit_account_id, v_debit_label
      FROM chart_of_accounts
      WHERE tenant_id = v_advance.tenant_id
        AND account_code = CASE WHEN p_source = 'bank' THEN '1010' ELSE '1000' END
        AND is_active = true
      LIMIT 1;
    END IF;
    IF v_debit_account_id IS NULL THEN
      RAISE EXCEPTION 'No cash/bank account configured to receive the repayment';
    END IF;

    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, debit,
      description, reference_type, reference_id, created_by, branch_id
    ) VALUES (
      v_advance.tenant_id, v_debit_account_id, p_repayment_date, p_amount,
      'Advance repayment - ' || v_advance.staff_name || ' (' || COALESCE(v_debit_label,'Cash') || ')',
      'staff_advance_repayment', p_advance_id, auth.uid(), v_advance.branch_id
    ) RETURNING id INTO v_txn_id;

    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit,
      description, reference_type, reference_id, created_by, branch_id
    ) VALUES (
      v_advance.tenant_id, v_advance_account_id, p_repayment_date, p_amount,
      'Advance repayment - ' || v_advance.staff_name,
      'staff_advance_repayment', p_advance_id, auth.uid(), v_advance.branch_id
    );
  END IF;

  INSERT INTO staff_advance_repayments (
    tenant_id, restaurant_id, branch_id, advance_id, amount, repayment_date,
    source, account_id, payroll_id, notes, ledger_transaction_id, created_by
  ) VALUES (
    v_advance.tenant_id, v_advance.restaurant_id, v_advance.branch_id, p_advance_id, p_amount, p_repayment_date,
    p_source, v_debit_account_id, p_payroll_id, p_notes, v_txn_id, auth.uid()
  ) RETURNING id INTO v_repayment_id;

  UPDATE staff_advances
  SET repaid_amount = COALESCE(repaid_amount, 0) + p_amount,
      status = CASE WHEN COALESCE(repaid_amount, 0) + p_amount >= amount - 0.005 THEN 'deducted' ELSE status END,
      deducted_from_payroll_id = CASE
        WHEN COALESCE(repaid_amount, 0) + p_amount >= amount - 0.005 THEN COALESCE(p_payroll_id, deducted_from_payroll_id)
        ELSE deducted_from_payroll_id END,
      deducted_at = CASE WHEN COALESCE(repaid_amount, 0) + p_amount >= amount - 0.005 THEN now() ELSE deducted_at END,
      updated_at = now()
  WHERE id = p_advance_id;

  RETURN v_repayment_id;
END;
$function$;


-- replace_invoice_items
CREATE OR REPLACE FUNCTION public.replace_invoice_items(p_invoice_id uuid, p_items jsonb, p_auto_create_purchase boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_restaurant_id uuid;
  v_total numeric := 0;
  v_count integer := 0;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM public.purchase_invoices WHERE id = p_invoice_id FOR UPDATE;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;

  IF NOT public.user_belongs_to_restaurant(auth.uid(), v_restaurant_id) THEN
    RAISE EXCEPTION 'Not authorized to edit this invoice';
  END IF;

  -- inventory_item_id values come from the caller: each must be an item of this invoice's restaurant
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i
    WHERE NULLIF(i->>'inventory_item_id','') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_items ii
        WHERE ii.id = NULLIF(i->>'inventory_item_id','')::uuid
          AND ii.restaurant_id = v_restaurant_id
      )
  ) THEN
    RAISE EXCEPTION 'Not authorized to use one or more of these inventory items' USING ERRCODE = '42501';
  END IF;

  -- Mark this transaction as an authorised line rewrite so the guard trigger
  -- lets the delete + insert pair through.
  PERFORM set_config('app.invoice_items_rewrite', 'on', true);

  DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, inventory_item_id, description, quantity, unit_price, total_price, auto_create_purchase
  )
  SELECT
    p_invoice_id,
    NULLIF(i->>'inventory_item_id','')::uuid,
    COALESCE(i->>'description',''),
    COALESCE((i->>'quantity')::numeric, 0),
    COALESCE((i->>'unit_price')::numeric, 0),
    ROUND(COALESCE((i->>'quantity')::numeric,0) * COALESCE((i->>'unit_price')::numeric,0), 2),
    COALESCE((i->>'auto_create_purchase')::boolean, p_auto_create_purchase)
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  SELECT COALESCE(SUM(total_price), 0) INTO v_total
  FROM public.invoice_items WHERE invoice_id = p_invoice_id;

  UPDATE public.purchase_invoices
  SET subtotal = v_total - COALESCE(tax_amount, 0),
      total_amount = v_total,
      updated_at = now()
  WHERE id = p_invoice_id;

  PERFORM set_config('app.invoice_items_rewrite', 'off', true);

  RETURN v_count;
END;
$function$;


-- request_ap_settlement_reversal
CREATE OR REPLACE FUNCTION public.request_ap_settlement_reversal(p_expense_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exp RECORD;
  v_result jsonb;
BEGIN
  IF NOT public.can_reverse_ap_settlement(auth.uid()) THEN
    RAISE EXCEPTION 'Only owners or accountants can reverse a posted AP settlement'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'A reversal reason of at least 5 characters is required';
  END IF;

  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF v_exp.tenant_id IS DISTINCT FROM public.get_user_tenant_id(auth.uid()) THEN
    RAISE EXCEPTION 'Expense belongs to another tenant' USING ERRCODE = '42501';
  END IF;

  -- Owner/accountant role must be held in the expense's business, not in any restaurant.
  IF auth.uid() IS NOT NULL AND NOT public.has_role_in_tenant(v_exp.tenant_id, ARRAY['owner','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only owners or accountants can reverse a posted AP settlement' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_exp.status,'unpaid') <> 'paid' THEN
    RAISE EXCEPTION 'This expense is not marked as paid — there is no settlement to reverse';
  END IF;

  UPDATE public.expenses
     SET status = 'unpaid',
         paid_amount = 0,
         updated_at = now()
   WHERE id = p_expense_id;

  SELECT public.reclassify_expense_credit_account(p_expense_id, 'approved reversal: ' || btrim(p_reason))
    INTO v_result;

  BEGIN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, target_type, target_id, details)
    VALUES (
      v_exp.tenant_id, auth.uid(), 'AP_SETTLEMENT_REVERSAL', 'other', p_expense_id,
      jsonb_build_object('reason', btrim(p_reason), 'result', v_result, 'branch_id', v_exp.branch_id)
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN COALESCE(v_result, jsonb_build_object('outcome','unchanged'));
END;
$function$;


-- reschedule_fine_installments
CREATE OR REPLACE FUNCTION public.reschedule_fine_installments(p_fine_id uuid, p_monthly_limit numeric DEFAULT NULL::numeric, p_start_month date DEFAULT NULL::date, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fine public.employee_fines;
  v_group uuid;
  v_total numeric;
  v_settled numeric := 0;
  v_remaining numeric;
  v_limit numeric;
  v_start date;
  v_month date;
  v_kept integer := 0;
  v_cancelled integer := 0;
  v_created integer := 0;
  v_max_no integer := 0;
  v_amounts numeric[] := '{}';
  v_amt numeric;
  v_left numeric;
  v_idx integer;
  v_anchor uuid;
  v_reason text;
BEGIN
  SELECT * INTO v_fine FROM public.employee_fines WHERE id = p_fine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINE_NOT_FOUND'; END IF;
  -- Caller must be owner/manager/accountant of the business that owns this fine
  IF auth.uid() IS NOT NULL AND NOT public.has_role_in_tenant(public.get_restaurant_tenant_id(v_fine.restaurant_id), ARRAY['owner','manager','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only owners, managers or accountants of this business can change this fine.' USING ERRCODE = '42501';
  END IF;

  v_group := v_fine.installment_group_id;
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'NOT_AN_INSTALLMENT_PLAN: This fine is not part of an installment schedule. Use "Split into installments" instead.';
  END IF;

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'Installment schedule re-planned');

  PERFORM 1 FROM public.employee_fines
   WHERE installment_group_id = v_group FOR UPDATE;

  -- Anchor = first installment of the group (keeps audit history in one place)
  SELECT id INTO v_anchor FROM public.employee_fines
   WHERE installment_group_id = v_group
   ORDER BY installment_number NULLS LAST, created_at
   LIMIT 1;

  SELECT COALESCE(MAX(installment_total_amount), SUM(amount)) INTO v_total
    FROM public.employee_fines
   WHERE installment_group_id = v_group AND deleted_at IS NULL;

  -- Amounts already recovered / applied to a payroll stay untouched
  SELECT COALESCE(SUM(GREATEST(
           COALESCE(recovered_amount, 0),
           CASE WHEN status = 'applied' OR applied_payroll_id IS NOT NULL THEN amount ELSE 0 END
         )), 0),
         COUNT(*) FILTER (
           WHERE status = 'applied' OR applied_payroll_id IS NOT NULL OR COALESCE(recovered_amount,0) > 0
         )
    INTO v_settled, v_kept
    FROM public.employee_fines
   WHERE installment_group_id = v_group
     AND deleted_at IS NULL
     AND status <> 'cancelled';

  SELECT COALESCE(MAX(installment_number), 0) INTO v_max_no
    FROM public.employee_fines WHERE installment_group_id = v_group;

  -- Cancel the untouched (unpaid) future installments
  UPDATE public.employee_fines
     SET status = 'cancelled',
         cancellation_reason = v_reason
   WHERE installment_group_id = v_group
     AND deleted_at IS NULL
     AND status IN ('draft','submitted','under_review','approved','rejected')
     AND applied_payroll_id IS NULL
     AND COALESCE(recovered_amount, 0) = 0;
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  v_remaining := ROUND(COALESCE(v_total, 0) - v_settled, 2);

  IF v_remaining > 0.004 THEN
    v_limit := ROUND(COALESCE(NULLIF(p_monthly_limit, 0), v_remaining), 2);
    IF v_limit <= 0 THEN v_limit := v_remaining; END IF;

    v_start := date_trunc('month',
      COALESCE(p_start_month, (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month')::date)
    )::date;

    v_left := v_remaining;
    WHILE v_left > 0.004 AND COALESCE(array_length(v_amounts, 1), 0) < 60 LOOP
      v_amt := LEAST(v_limit, v_left);
      v_amounts := array_append(v_amounts, ROUND(v_amt, 2));
      v_left := ROUND(v_left - v_amt, 2);
    END LOOP;
    IF v_left > 0.004 THEN
      v_amounts[array_length(v_amounts,1)] := ROUND(v_amounts[array_length(v_amounts,1)] + v_left, 2);
    END IF;

    v_idx := 0;
    FOREACH v_amt IN ARRAY v_amounts LOOP
      v_month := (v_start + (v_idx || ' month')::interval)::date;
      INSERT INTO public.employee_fines (
        restaurant_id, branch_id, staff_id, violation_type_id, violation_date, payroll_month,
        description, attendance_reference, amount, status, created_by,
        installment_group_id, installment_number, installment_count, installment_total_amount,
        recovered_amount
      ) VALUES (
        v_fine.restaurant_id, v_fine.branch_id, v_fine.staff_id, v_fine.violation_type_id,
        v_fine.violation_date, v_month,
        'Re-planned installment ' || (v_idx + 1)::text || '/' || array_length(v_amounts,1)::text ||
          ' of remaining ' || v_remaining::text,
        v_fine.attendance_reference, v_amt,
        CASE WHEN v_fine.status IN ('approved','applied') THEN 'approved' ELSE 'draft' END,
        COALESCE(auth.uid(), v_fine.created_by),
        v_group, v_max_no + v_idx + 1, v_kept + array_length(v_amounts,1),
        COALESCE(v_total, v_fine.amount), 0
      );
      v_idx := v_idx + 1;
      v_created := v_created + 1;
    END LOOP;
  END IF;

  UPDATE public.employee_fines
     SET installment_count = v_kept + v_created
   WHERE installment_group_id = v_group
     AND deleted_at IS NULL
     AND status <> 'cancelled';

  INSERT INTO public.employee_fine_audit (
    fine_id, restaurant_id, action, old_amount, new_amount, reason, actor_id, metadata
  ) VALUES (
    COALESCE(v_anchor, p_fine_id), v_fine.restaurant_id, 'installments_rescheduled',
    COALESCE(v_total, 0), v_remaining,
    v_reason || ' — ' || v_settled::text || ' already recovered kept, ' ||
      v_cancelled || ' unpaid installment(s) cancelled, ' || v_created || ' new installment(s) created',
    auth.uid(),
    jsonb_build_object(
      'installment_group_id', v_group,
      'plan_total', v_total,
      'already_recovered', v_settled,
      'remaining', v_remaining,
      'monthly_limit', v_limit,
      'kept_installments', v_kept,
      'cancelled_installments', v_cancelled,
      'installments_created', v_created,
      'start_month', v_start
    )
  );

  RETURN jsonb_build_object(
    'installment_group_id', v_group,
    'plan_total', v_total,
    'already_recovered', v_settled,
    'remaining', v_remaining,
    'kept_installments', v_kept,
    'cancelled_installments', v_cancelled,
    'installments_created', v_created,
    'monthly_limit', v_limit
  );
END;
$function$;


-- reschedule_installment_plan
CREATE OR REPLACE FUNCTION public.reschedule_installment_plan(p_plan_id uuid, p_installment_count integer, p_first_due_date date DEFAULT NULL::date, p_frequency text DEFAULT NULL::text, p_finance_charge numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_paid_count integer;
  v_paid_amount numeric := 0;
  v_remaining numeric;
  v_new_pending integer;
  v_freq text;
  v_start date;
  v_each numeric;
  v_last numeric;
  v_i integer;
  v_no integer;
  v_due date;
  v_step interval;
  v_new_fee numeric(15,2);
  v_new_fee_vat numeric(15,2);
  v_new_total numeric(15,2);
  v_delta_fee numeric(15,2);
  v_delta_fee_vat numeric(15,2);
  v_delta_total numeric(15,2);
  v_adjustment_batch uuid;
  v_description text;
BEGIN
  SELECT * INTO v_plan
  FROM public.installment_plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Installment plan not found'; END IF;
  -- tenant_id is a business id, not a restaurant id: require owner/manager/accountant of that business
  IF NOT public.can_manage_capital(v_plan.tenant_id) THEN
    RAISE EXCEPTION 'Not authorised to modify this installment plan';
  END IF;
  IF p_installment_count IS NULL OR p_installment_count < 1 THEN
    RAISE EXCEPTION 'Installment count must be at least 1';
  END IF;

  SELECT count(*), COALESCE(sum(paid_amount), 0)
  INTO v_paid_count, v_paid_amount
  FROM public.installment_payments
  WHERE plan_id = p_plan_id AND status = 'paid' AND voided_at IS NULL;

  IF p_installment_count <= v_paid_count THEN
    RAISE EXCEPTION 'New installment count (%) must be greater than the % already-paid installment(s)',
      p_installment_count, v_paid_count;
  END IF;

  v_new_fee := ROUND(COALESCE(p_finance_charge, v_plan.finance_charge, 0), 2);
  IF v_new_fee < 0 THEN RAISE EXCEPTION 'Finance charge cannot be negative'; END IF;
  v_new_fee_vat := CASE
    WHEN COALESCE(v_plan.vat_on_finance_charge, false)
      THEN ROUND(v_new_fee * COALESCE(v_plan.vat_rate, 0) / 100.0, 2)
    ELSE 0
  END;
  v_new_total := ROUND(COALESCE(v_plan.cash_price, 0) + COALESCE(v_plan.vat_amount, 0) + v_new_fee + v_new_fee_vat, 2);
  v_delta_fee := ROUND(v_new_fee - COALESCE(v_plan.finance_charge, 0), 2);
  v_delta_fee_vat := ROUND(v_new_fee_vat - COALESCE(v_plan.finance_vat_amount, 0), 2);
  v_delta_total := ROUND(v_new_total - COALESCE(v_plan.total_payable, 0), 2);

  IF v_new_total < v_paid_amount THEN
    RAISE EXCEPTION 'Revised total payable cannot be less than the amount already paid';
  END IF;

  IF v_delta_total <> 0 THEN
    v_description := 'Installment finance charge adjustment - ' || v_plan.description;
    INSERT INTO public.journal_entry_batches
      (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
       created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
    VALUES
      (v_plan.tenant_id, CURRENT_DATE, v_description,
       'INST-ADJ-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
       'adjustment', 'adjustment', auth.uid(), true, now(), auth.uid(),
       'approved', auth.uid(), now(), v_plan.branch_id)
    RETURNING id INTO v_adjustment_batch;

    IF v_delta_total > 0 THEN
      IF v_delta_fee > 0 THEN
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit, description,
           reference_type, reference_id, created_by, batch_id, branch_id)
        VALUES
          (v_plan.tenant_id, v_plan.finance_account_id, CURRENT_DATE, v_delta_fee, 0,
           v_description, 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
      END IF;
      IF v_delta_fee_vat > 0 THEN
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit, description,
           reference_type, reference_id, created_by, batch_id, branch_id)
        VALUES
          (v_plan.tenant_id, v_plan.vat_account_id, CURRENT_DATE, v_delta_fee_vat, 0,
           v_description || ' - input VAT', 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
      END IF;
      INSERT INTO public.account_transactions
        (tenant_id, account_id, transaction_date, debit, credit, description,
         reference_type, reference_id, created_by, batch_id, branch_id)
      VALUES
        (v_plan.tenant_id, v_plan.liability_account_id, CURRENT_DATE, 0, v_delta_total,
         v_description, 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
    ELSE
      INSERT INTO public.account_transactions
        (tenant_id, account_id, transaction_date, debit, credit, description,
         reference_type, reference_id, created_by, batch_id, branch_id)
      VALUES
        (v_plan.tenant_id, v_plan.liability_account_id, CURRENT_DATE, ABS(v_delta_total), 0,
         v_description, 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
      IF v_delta_fee < 0 THEN
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit, description,
           reference_type, reference_id, created_by, batch_id, branch_id)
        VALUES
          (v_plan.tenant_id, v_plan.finance_account_id, CURRENT_DATE, 0, ABS(v_delta_fee),
           v_description, 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
      END IF;
      IF v_delta_fee_vat < 0 THEN
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit, description,
           reference_type, reference_id, created_by, batch_id, branch_id)
        VALUES
          (v_plan.tenant_id, v_plan.vat_account_id, CURRENT_DATE, 0, ABS(v_delta_fee_vat),
           v_description || ' - input VAT', 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
      END IF;
    END IF;
  END IF;

  v_freq := COALESCE(p_frequency, v_plan.frequency);
  v_step := CASE v_freq WHEN 'weekly' THEN interval '7 days' WHEN 'biweekly' THEN interval '14 days' ELSE interval '1 month' END;
  v_start := COALESCE(p_first_due_date, v_plan.first_due_date);
  v_remaining := ROUND(v_new_total - v_paid_amount, 2);
  v_new_pending := p_installment_count - v_paid_count;
  v_each := ROUND(v_remaining / v_new_pending, 2);
  v_last := ROUND(v_remaining - (v_each * (v_new_pending - 1)), 2);

  DELETE FROM public.installment_payments
  WHERE plan_id = p_plan_id AND status <> 'paid';

  FOR v_i IN 1..v_new_pending LOOP
    v_no := v_paid_count + v_i;
    v_due := (v_start + (v_step * (v_no - 1)))::date;
    INSERT INTO public.installment_payments
      (tenant_id, plan_id, branch_id, installment_no, due_date, amount, paid_amount, status, funding_source)
    VALUES
      (v_plan.tenant_id, p_plan_id, v_plan.branch_id, v_no, v_due,
       CASE WHEN v_i = v_new_pending THEN v_last ELSE v_each END, 0, 'pending', 'company');
  END LOOP;

  UPDATE public.installment_plans
  SET installment_count = p_installment_count,
      first_due_date = v_start,
      frequency = v_freq,
      finance_charge = v_new_fee,
      finance_vat_amount = v_new_fee_vat,
      total_payable = v_new_total
  WHERE id = p_plan_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (
    v_plan.tenant_id, auth.uid(), 'installment_plan_rescheduled', 'installment_plan', p_plan_id,
    jsonb_build_object('installment_count', v_plan.installment_count, 'first_due_date', v_plan.first_due_date,
      'frequency', v_plan.frequency, 'finance_charge', v_plan.finance_charge, 'total_payable', v_plan.total_payable),
    jsonb_build_object('installment_count', p_installment_count, 'first_due_date', v_start,
      'frequency', v_freq, 'finance_charge', v_new_fee, 'total_payable', v_new_total,
      'remaining_amount', v_remaining, 'adjustment_batch_id', v_adjustment_batch)
  );

  RETURN p_plan_id;
END;
$function$;


-- retry_ap_settlement
CREATE OR REPLACE FUNCTION public.retry_ap_settlement(p_expense_id uuid, p_reason text DEFAULT 'manual retry'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exp RECORD;
  v_ap_parent uuid;
  v_ap_account uuid;
  v_ap_net numeric;
  v_existing uuid;
  v_result jsonb;
BEGIN
  -- Serialize retries per expense so concurrent clicks cannot double-post.
  PERFORM pg_advisory_xact_lock(hashtextextended('ap_settlement', 0), hashtextextended(p_expense_id::text, 0));

  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','not_found','error','Expense not found');
  END IF;

  -- Check the expense's restaurant (was passed the tenant id) and require a finance role in its business.
  IF NOT (public.can_access_restaurant(v_exp.restaurant_id)
          AND public.has_role_in_tenant(v_exp.tenant_id, ARRAY['owner','manager','accountant']::public.app_role[])) THEN
    RAISE EXCEPTION 'Not allowed to retry settlements for this tenant' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_exp.ledger_posted,false) = false THEN
    RETURN jsonb_build_object('outcome','skipped','reason_code','not_posted',
      'reason_detail','Post the expense to the ledger before settling it');
  END IF;

  IF COALESCE(v_exp.status,'unpaid') <> 'paid' THEN
    RETURN jsonb_build_object('outcome','skipped','reason_code','not_paid',
      'reason_detail','Expense is not marked as paid, nothing to settle');
  END IF;

  -- Idempotency guard: a live settlement batch with open lines means it already posted.
  SELECT b.id INTO v_existing
  FROM public.journal_entry_batches b
  WHERE b.tenant_id = v_exp.tenant_id
    AND b.reference_number = 'EXPPAY-' || p_expense_id::text
    AND EXISTS (
      SELECT 1 FROM public.account_transactions t
      WHERE t.batch_id = b.id AND COALESCE(t.is_voided,false) = false
    )
  LIMIT 1;

  SELECT id INTO v_ap_parent FROM public.chart_of_accounts
   WHERE tenant_id = v_exp.tenant_id AND account_code = '2000' AND is_active = true LIMIT 1;
  v_ap_account := CASE WHEN v_ap_parent IS NULL THEN NULL
                       ELSE public.resolve_branch_account(v_ap_parent, v_exp.branch_id) END;

  SELECT COALESCE(sum(COALESCE(credit,0) - COALESCE(debit,0)), 0)
    INTO v_ap_net
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = p_expense_id
    AND v_ap_parent IS NOT NULL
    AND account_id IN (v_ap_account, v_ap_parent)
    AND COALESCE(is_voided,false) = false;

  IF v_existing IS NOT NULL AND COALESCE(v_ap_net,0) <= 0.005 THEN
    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        batch_id, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success', 'retry_already_settled',
        'Retry skipped — settlement already posted, no duplicate created (' || p_reason || ')',
        v_existing, 0, 0, 'manual', auth.uid()
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN jsonb_build_object('outcome','unchanged','reason_code','already_settled','batch_id',v_existing);
  END IF;

  BEGIN
    v_result := public.reclassify_expense_credit_account(p_expense_id, 'retry: ' || p_reason);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'failed', 'retry_failed',
        left(SQLERRM, 500), 0, 0, 'manual', auth.uid()
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE;
  END;

  RETURN COALESCE(v_result, jsonb_build_object('outcome','failed','reason_code','no_result'))
         || jsonb_build_object('retried', true);
END;
$function$;


-- reverse_staff_advance_atomic
CREATE OR REPLACE FUNCTION public.reverse_staff_advance_atomic(p_advance_id uuid, p_reason text DEFAULT NULL::text, p_settlement text DEFAULT 'none'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_advance RECORD;
  v_reason text := COALESCE(NULLIF(trim(p_reason), ''), 'Staff advance reversed');
  v_reversal_id uuid;
  v_did_reverse boolean := false;
BEGIN
  IF p_settlement NOT IN ('none', 'forgive', 'delete') THEN
    RAISE EXCEPTION 'Invalid settlement action: %', p_settlement
      USING ERRCODE = '22023';
  END IF;

  -- Lock the source row for the whole transaction so a concurrent reversal
  -- cannot slip between the status check and the ledger write.
  SELECT * INTO v_advance
  FROM staff_advances
  WHERE id = p_advance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff advance record not found' USING ERRCODE = 'P0002';
  END IF;

  -- Caller must be owner/manager/accountant of the business that owns this advance
  IF auth.uid() IS NOT NULL AND NOT public.has_role_in_tenant(v_advance.tenant_id, ARRAY['owner','manager','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants of this business can change this advance' USING ERRCODE = '42501';
  END IF;

  IF v_advance.ledger_posted AND COALESCE(v_advance.ledger_reversed, false) THEN
    IF p_settlement = 'none' THEN
      RAISE EXCEPTION 'REVERSAL_ALREADY_POSTED: this advance is already reversed'
        USING ERRCODE = '23505';
    END IF;
  ELSIF v_advance.ledger_posted THEN
    v_reversal_id := public.reverse_staff_advance_ledger(p_advance_id, v_reason);
    v_did_reverse := true;
  ELSIF p_settlement = 'none' THEN
    RAISE EXCEPTION 'REVERSAL_NOT_POSTED: this advance has no ledger entry to reverse'
      USING ERRCODE = '22023';
  END IF;

  IF p_settlement = 'forgive' THEN
    UPDATE staff_advances
    SET status = 'forgiven', updated_at = now()
    WHERE id = p_advance_id;
  ELSIF p_settlement = 'delete' THEN
    DELETE FROM staff_advances WHERE id = p_advance_id;
  END IF;

  RETURN jsonb_build_object(
    'advance_id', p_advance_id,
    'reversed', v_did_reverse,
    'reversal_transaction_id', COALESCE(v_reversal_id, v_advance.ledger_reversal_transaction_id),
    'settlement', p_settlement,
    'reason', v_reason
  );
END;
$function$;


-- settle_fixed_asset_disposal
CREATE OR REPLACE FUNCTION public.settle_fixed_asset_disposal(p_disposal_id uuid, p_settled_on date DEFAULT CURRENT_DATE, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- asset_id is user-editable: the disposed asset must belong to this disposal's business
  IF NOT EXISTS (SELECT 1 FROM public.fixed_assets WHERE id = v_d.asset_id AND tenant_id = v_d.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: the disposed asset does not belong to this business' USING ERRCODE = '42501';
  END IF;
  -- settlement_account_id is user-editable: it must be an account of this disposal's business
  IF v_d.settlement_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts WHERE id = v_d.settlement_account_id AND tenant_id = v_d.tenant_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: the settlement account does not belong to this business' USING ERRCODE = '42501';
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
$function$;


-- submit_pending_journal_entry
CREATE OR REPLACE FUNCTION public.submit_pending_journal_entry(p_description text, p_entry_type text, p_journal_type text, p_batch_date date, p_reference_number text, p_lines jsonb, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_batch_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_user;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant for current user';
  END IF;

  IF NOT public.can_post_journal_entries(v_tenant) THEN
    RAISE EXCEPTION 'Not authorised to submit journal entries';
  END IF;

  -- the branch must belong to a restaurant of the caller's business
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b
    JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE b.id = p_branch_id AND r.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'Branch does not belong to your business' USING ERRCODE = '42501';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'Journal entry must have at least two lines';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF (v_line->>'account_id') IS NULL THEN
      RAISE EXCEPTION 'Each line must include account_id';
    END IF;
    -- pending lines are posted later as-is: each account must belong to the caller's business
    IF NOT EXISTS (
      SELECT 1 FROM public.chart_of_accounts
      WHERE id = (v_line->>'account_id')::uuid AND tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'Account does not belong to your business' USING ERRCODE = '42501';
    END IF;
    v_total_debit  := v_total_debit  + COALESCE((v_line->>'debit')::numeric,  0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::numeric, 0);
  END LOOP;

  IF abs(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Unbalanced entry: debits=% credits=%', v_total_debit, v_total_credit;
  END IF;

  INSERT INTO public.journal_entry_batches (
    tenant_id, batch_date, description, reference_number,
    entry_type, journal_type, created_by, is_posted,
    approval_status, pending_lines, branch_id
  ) VALUES (
    v_tenant, COALESCE(p_batch_date, CURRENT_DATE), p_description, p_reference_number,
    COALESCE(p_entry_type, 'adjustment'), COALESCE(p_journal_type, 'adjustment'),
    v_user, false, 'pending', p_lines, p_branch_id
  )
  RETURNING id INTO v_batch_id;

  RETURN v_batch_id;
END;
$function$;


-- suggest_installment_vat_correction
CREATE OR REPLACE FUNCTION public.suggest_installment_vat_correction(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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

  -- tenant_id is a business id, not a restaurant id: require owner/manager/accountant of that business
  IF NOT public.can_manage_capital(v_plan.tenant_id) THEN
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


-- suggest_vat_posting_correction
CREATE OR REPLACE FUNCTION public.suggest_vat_posting_correction(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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

  -- Caller must belong to the batch's business (the old <> check passed when the caller had no profile tenant).
  IF auth.uid() IS NOT NULL AND NOT (public.is_superadmin(auth.uid()) OR public.user_belongs_to_tenant(auth.uid(), v_batch.tenant_id)) THEN
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


-- undo_project_transaction_posting
CREATE OR REPLACE FUNCTION public.undo_project_transaction_posting(p_txn_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t project_transactions;
  v_batch uuid;
  v_line RECORD;
  v_rev_batch uuid;
  v_ref text;
BEGIN
  SELECT * INTO v_t FROM project_transactions WHERE id = p_txn_id FOR UPDATE;
  IF v_t IS NULL THEN RAISE EXCEPTION 'TXN_NOT_FOUND'; END IF;
  IF NOT public.can_manage_capital(v_t.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only finance roles can undo project postings.';
  END IF;
  IF v_t.status <> 'posted' THEN
    RAISE EXCEPTION 'NOT_POSTED: Only posted transactions can be reverted to pending.';
  END IF;
  IF v_t.asset_id IS NOT NULL THEN
    RAISE EXCEPTION 'ASSET_CREATED: This posting created a fixed asset. Dispose or reverse the asset first.';
  END IF;

  v_batch := v_t.batch_id;

  -- batch_id is user-editable: it must be a journal batch of this transaction's own business
  IF v_batch IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM journal_entry_batches WHERE id = v_batch AND tenant_id = v_t.tenant_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: The linked journal batch does not belong to this business.' USING ERRCODE = '42501';
  END IF;
  v_ref := 'PRJ-UNDO-' || to_char(now(), 'YYYYMMDD') || '-' || left(replace(p_txn_id::text,'-',''), 6);

  IF v_batch IS NOT NULL THEN
    INSERT INTO journal_entry_batches (tenant_id, batch_date, description, reference_number,
      entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status,
      branch_id, project_id)
    VALUES (v_t.tenant_id, CURRENT_DATE,
      'Undo posting - ' || COALESCE(v_t.description, 'Project cost'), v_ref,
      'reversal', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved',
      v_t.branch_id, v_t.project_id)
    RETURNING id INTO v_rev_batch;

    FOR v_line IN
      SELECT * FROM account_transactions
       WHERE batch_id = v_batch AND COALESCE(is_voided, false) = false
         AND tenant_id = v_t.tenant_id
    LOOP
      INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, batch_id, branch_id, project_id,
        original_transaction_id)
      VALUES (v_t.tenant_id, v_line.account_id, CURRENT_DATE, v_line.credit, v_line.debit,
        'Reversal - ' || COALESCE(v_line.description, 'Project cost'), 'project_transaction',
        p_txn_id, auth.uid(), v_rev_batch, v_line.branch_id, v_line.project_id, v_line.id);

      UPDATE account_transactions
         SET is_voided = true, void_reason = 'Undo confirm posting'
       WHERE id = v_line.id AND tenant_id = v_t.tenant_id;
    END LOOP;

    UPDATE journal_entry_batches
       SET is_posted = false, approval_status = 'voided'
     WHERE id = v_batch AND tenant_id = v_t.tenant_id;
  END IF;

  UPDATE project_transactions
     SET status = 'classified', batch_id = NULL, posted_at = NULL, posted_by = NULL
   WHERE id = p_txn_id;

  INSERT INTO project_classification_audit (tenant_id, transaction_id, action, new_value, batch_id, performed_by)
  VALUES (v_t.tenant_id, p_txn_id, 'unposted',
    jsonb_build_object('amount', v_t.amount, 'reversed_batch', v_batch),
    v_rev_batch, auth.uid());

  RETURN v_rev_batch;
END;
$function$;


-- undo_stock_adjustment
CREATE OR REPLACE FUNCTION public.undo_stock_adjustment(_movement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mov           public.stock_movements%ROWTYPE;
  v_current_stock numeric;
  v_reverse_delta numeric;
  v_stock_after   numeric;
  v_new_id        uuid;
  v_age_seconds   numeric;
  v_linked_expense_locked boolean := false;
BEGIN
  -- Load original movement
  SELECT * INTO v_mov
  FROM public.stock_movements
  WHERE id = _movement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found' USING ERRCODE = 'P0002';
  END IF;

  -- caller must have access to the restaurant that owns the movement (fall back to its inventory item)
  IF auth.uid() IS NOT NULL AND NOT COALESCE(public.can_access_restaurant(COALESCE(v_mov.restaurant_id, (SELECT ii.restaurant_id FROM public.inventory_items ii WHERE ii.id = v_mov.inventory_item_id))), false) THEN
    RAISE EXCEPTION 'Not authorized to undo this adjustment' USING ERRCODE = '42501';
  END IF;

  -- Only manual adjustments are undoable
  IF v_mov.movement_type <> 'adjustment' THEN
    RAISE EXCEPTION 'Only manual adjustments can be undone' USING ERRCODE = 'P0001';
  END IF;

  -- Server-side lock check: movement locked by closed shift
  IF v_mov.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This stock movement is locked because its shift has been closed. Undo is not allowed.'
      USING ERRCODE = 'P0001', HINT = 'locked';
  END IF;

  -- Server-side lock check: any linked expense that is locked
  IF v_mov.reference_type = 'expense' AND v_mov.reference_id IS NOT NULL THEN
    SELECT (locked_at IS NOT NULL) INTO v_linked_expense_locked
    FROM public.expenses
    WHERE id = v_mov.reference_id  -- reference_id is uuid (the ::text comparison failed with 42804)
    LIMIT 1;

    IF COALESCE(v_linked_expense_locked, false) THEN
      RAISE EXCEPTION 'The linked expense is locked because its shift has been closed. Undo is not allowed.'
        USING ERRCODE = 'P0001', HINT = 'locked';
    END IF;
  END IF;

  -- 5-minute undo window enforced server-side
  v_age_seconds := EXTRACT(EPOCH FROM (now() - v_mov.created_at));
  IF v_age_seconds > 300 THEN
    RAISE EXCEPTION 'Undo window (5 minutes) has expired for this adjustment.'
      USING ERRCODE = 'P0001', HINT = 'expired';
  END IF;

  -- Apply reverse delta against current stock
  SELECT current_stock INTO v_current_stock
  FROM public.inventory_items
  WHERE id = v_mov.inventory_item_id
  FOR UPDATE;

  v_reverse_delta := -1 * v_mov.quantity_change;
  v_stock_after   := COALESCE(v_current_stock, 0) + v_reverse_delta;

  UPDATE public.inventory_items
  SET current_stock = v_stock_after,
      updated_at = now()
  WHERE id = v_mov.inventory_item_id;

  -- Write reversing audit row
  INSERT INTO public.stock_movements (
    tenant_id, restaurant_id, inventory_item_id, movement_type,
    quantity_change, stock_before, stock_after,
    reason, reference_type, reference_id, created_by
  ) VALUES (
    v_mov.tenant_id, v_mov.restaurant_id, v_mov.inventory_item_id, 'adjustment',
    v_reverse_delta, COALESCE(v_current_stock, 0), v_stock_after,
    'Undo of adjustment from ' || to_char(v_mov.created_at, 'Mon DD, HH24:MI'),
    'undo_adjustment', v_mov.id, auth.uid()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'undo_movement_id', v_new_id,
    'stock_after', v_stock_after,
    'reversed_delta', v_reverse_delta
  );
END;
$function$;


-- update_installment_plan_details
CREATE OR REPLACE FUNCTION public.update_installment_plan_details(p_plan_id uuid, p_invoice_url text DEFAULT NULL::text, p_clear_invoice boolean DEFAULT false, p_asset_class_id uuid DEFAULT NULL::uuid, p_asset_tag text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_class public.fixed_asset_classes%ROWTYPE;
  v_asset public.fixed_assets%ROWTYPE;
  v_net numeric(15,2);
  v_new_asset uuid;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND';
  END IF;

  IF NOT public.can_manage_capital(v_plan.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can edit installment purchases';
  END IF;

  -- asset_id is user-editable: refuse a plan linked to another business's fixed asset
  IF v_plan.asset_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.fixed_assets
    WHERE id = v_plan.asset_id AND tenant_id IS DISTINCT FROM v_plan.tenant_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: the linked asset does not belong to this business' USING ERRCODE = '42501';
  END IF;

  -- invoice attachment
  IF p_clear_invoice THEN
    UPDATE public.installment_plans SET invoice_url = NULL, updated_at = now() WHERE id = p_plan_id;
  ELSIF p_invoice_url IS NOT NULL THEN
    UPDATE public.installment_plans SET invoice_url = p_invoice_url, updated_at = now() WHERE id = p_plan_id;
  END IF;

  -- nothing else to do when the asset class is unchanged
  IF p_asset_class_id IS NOT DISTINCT FROM v_plan.asset_class_id THEN
    IF p_asset_class_id IS NOT NULL AND p_asset_tag IS NOT NULL AND v_plan.asset_id IS NOT NULL THEN
      UPDATE public.fixed_assets SET asset_tag = p_asset_tag, updated_at = now() WHERE id = v_plan.asset_id AND tenant_id = v_plan.tenant_id;
    END IF;
    RETURN p_plan_id;
  END IF;

  IF v_plan.asset_id IS NOT NULL THEN
    SELECT * INTO v_asset FROM public.fixed_assets WHERE id = v_plan.asset_id AND tenant_id = v_plan.tenant_id;
    IF FOUND THEN
      IF v_asset.status <> 'active' THEN
        RAISE EXCEPTION 'ASSET_NOT_EDITABLE: the linked asset has been disposed and can no longer be reclassified';
      END IF;
      IF EXISTS (SELECT 1 FROM public.fixed_asset_depreciation WHERE asset_id = v_asset.id) THEN
        RAISE EXCEPTION 'DEPRECIATION_POSTED: depreciation has already been recorded for this asset; reverse it before changing the asset class';
      END IF;
    END IF;
  END IF;

  -- removing the asset class entirely
  IF p_asset_class_id IS NULL THEN
    IF v_plan.asset_id IS NOT NULL THEN
      DELETE FROM public.fixed_assets WHERE id = v_plan.asset_id AND tenant_id = v_plan.tenant_id;
    END IF;
    UPDATE public.installment_plans
    SET asset_class_id = NULL, asset_id = NULL, updated_at = now()
    WHERE id = p_plan_id;
    RETURN p_plan_id;
  END IF;

  SELECT * INTO v_class FROM public.fixed_asset_classes
  WHERE id = p_asset_class_id AND tenant_id = v_plan.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_ASSET_CLASS';
  END IF;

  v_net := ROUND(v_plan.cash_price - COALESCE(v_plan.vat_amount, 0), 2);

  IF v_plan.asset_id IS NOT NULL AND v_asset.id IS NOT NULL THEN
    UPDATE public.fixed_assets
    SET class_id = p_asset_class_id,
        asset_tag = COALESCE(p_asset_tag, asset_tag),
        salvage_value = ROUND(v_net * COALESCE(v_class.salvage_rate_pct, 0) / 100.0, 2),
        useful_life_months = COALESCE(v_class.useful_life_months, 60),
        asset_account_id = COALESCE(v_class.asset_account_id, v_plan.target_account_id),
        accum_dep_account_id = v_class.accum_dep_account_id,
        dep_expense_account_id = v_class.dep_expense_account_id,
        depreciation_method = COALESCE(v_class.depreciation_method, 'straight_line'),
        updated_at = now()
    WHERE id = v_plan.asset_id AND tenant_id = v_plan.tenant_id;

    UPDATE public.installment_plans
    SET asset_class_id = p_asset_class_id, updated_at = now()
    WHERE id = p_plan_id;
    RETURN p_plan_id;
  END IF;

  INSERT INTO public.fixed_assets
    (tenant_id, branch_id, class_id, asset_tag, name, description, supplier_name,
     acquisition_date, in_service_date, cost, vat_amount, salvage_value, useful_life_months,
     accumulated_depreciation, status, asset_account_id, accum_dep_account_id, dep_expense_account_id,
     funding_source, source, source_reference_id, batch_id, depreciation_method, notes, created_by)
  VALUES
    (v_plan.tenant_id, v_plan.branch_id, p_asset_class_id, p_asset_tag, v_plan.description,
     'Installment purchase - ' || v_plan.description, v_plan.supplier_name,
     v_plan.purchase_date, v_plan.purchase_date, v_net, COALESCE(v_plan.vat_amount, 0),
     ROUND(v_net * COALESCE(v_class.salvage_rate_pct, 0) / 100.0, 2),
     COALESCE(v_class.useful_life_months, 60), 0, 'active',
     COALESCE(v_class.asset_account_id, v_plan.target_account_id),
     v_class.accum_dep_account_id, v_class.dep_expense_account_id,
     'company', 'installment', v_plan.id, v_plan.batch_id,
     COALESCE(v_class.depreciation_method, 'straight_line'),
     'Acquired on an installment plan (' || v_plan.provider || ')', auth.uid())
  RETURNING id INTO v_new_asset;

  UPDATE public.installment_plans
  SET asset_class_id = p_asset_class_id, asset_id = v_new_asset, updated_at = now()
  WHERE id = p_plan_id;

  RETURN p_plan_id;
END;
$function$;


-- update_installment_plan_details__2
CREATE OR REPLACE FUNCTION public.update_installment_plan_details(p_plan_id uuid, p_invoice_url text DEFAULT NULL::text, p_asset_class_id uuid DEFAULT NULL::uuid, p_asset_tag text DEFAULT NULL::text, p_clear_invoice boolean DEFAULT false, p_clear_asset_class boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
  v_class public.fixed_asset_classes%ROWTYPE;
  v_net numeric(15,2);
  v_asset uuid;
BEGIN
  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND';
  END IF;
  IF NOT public.can_manage_capital(v_plan.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can edit installment purchases';
  END IF;

  -- asset_id is user-editable: refuse a plan linked to another business's fixed asset
  IF v_plan.asset_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.fixed_assets
    WHERE id = v_plan.asset_id AND tenant_id IS DISTINCT FROM v_plan.tenant_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: the linked asset does not belong to this business' USING ERRCODE = '42501';
  END IF;

  UPDATE public.installment_plans
  SET invoice_url = CASE WHEN p_clear_invoice THEN NULL
                         WHEN p_invoice_url IS NOT NULL THEN p_invoice_url
                         ELSE invoice_url END,
      asset_class_id = CASE WHEN p_clear_asset_class THEN NULL
                            WHEN p_asset_class_id IS NOT NULL THEN p_asset_class_id
                            ELSE asset_class_id END
  WHERE id = p_plan_id;

  SELECT * INTO v_plan FROM public.installment_plans WHERE id = p_plan_id;

  IF v_plan.asset_class_id IS NULL THEN
    IF v_plan.invoice_url IS NOT NULL AND v_plan.asset_id IS NOT NULL THEN
      UPDATE public.fixed_assets SET updated_at = now() WHERE id = v_plan.asset_id AND tenant_id = v_plan.tenant_id;
    END IF;
    RETURN v_plan.asset_id;
  END IF;

  SELECT * INTO v_class FROM public.fixed_asset_classes
  WHERE id = v_plan.asset_class_id AND tenant_id = v_plan.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_ASSET_CLASS';
  END IF;

  -- cash_price is already stored NET of VAT by create_installment_plan.
  -- Subtracting vat_amount here would remove VAT twice and desync the
  -- register from the ledger debit, so use the stored net directly.
  v_net := ROUND(v_plan.cash_price, 2);

  IF v_plan.asset_id IS NOT NULL THEN
    UPDATE public.fixed_assets
    SET class_id = v_plan.asset_class_id,
        asset_tag = COALESCE(p_asset_tag, asset_tag),
        cost = v_net,
        vat_amount = COALESCE(v_plan.vat_amount, 0),
        salvage_value = ROUND(v_net * COALESCE(v_class.salvage_rate_pct, 0) / 100.0, 2),
        useful_life_months = COALESCE(v_class.useful_life_months, useful_life_months),
        depreciation_method = COALESCE(v_class.depreciation_method, depreciation_method),
        asset_account_id = COALESCE(v_class.asset_account_id, asset_account_id),
        accum_dep_account_id = COALESCE(v_class.accum_dep_account_id, accum_dep_account_id),
        dep_expense_account_id = COALESCE(v_class.dep_expense_account_id, dep_expense_account_id),
        updated_at = now()
    WHERE id = v_plan.asset_id AND tenant_id = v_plan.tenant_id;
    RETURN v_plan.asset_id;
  END IF;

  INSERT INTO public.fixed_assets
    (tenant_id, branch_id, class_id, asset_tag, name, description, supplier_name,
     acquisition_date, in_service_date, cost, vat_amount, salvage_value, useful_life_months,
     accumulated_depreciation, status, asset_account_id, accum_dep_account_id, dep_expense_account_id,
     funding_source, source, source_reference_id, batch_id, depreciation_method, notes, created_by)
  VALUES
    (v_plan.tenant_id, v_plan.branch_id, v_plan.asset_class_id, p_asset_tag, v_plan.description,
     'Installment purchase - ' || v_plan.description, v_plan.supplier_name,
     v_plan.purchase_date, v_plan.purchase_date, v_net, COALESCE(v_plan.vat_amount, 0),
     ROUND(v_net * COALESCE(v_class.salvage_rate_pct, 0) / 100.0, 2),
     COALESCE(v_class.useful_life_months, 60), 0, 'active',
     COALESCE(v_class.asset_account_id, v_plan.target_account_id),
     v_class.accum_dep_account_id, v_class.dep_expense_account_id,
     'company', 'installment', v_plan.id, v_plan.batch_id,
     COALESCE(v_class.depreciation_method, 'straight_line'),
     'Acquired on an installment plan (' || v_plan.provider || ')', auth.uid())
  RETURNING id INTO v_asset;

  UPDATE public.installment_plans SET asset_id = v_asset WHERE id = p_plan_id;
  RETURN v_asset;
END;
$function$;


-- void_installment_payment
CREATE OR REPLACE FUNCTION public.void_installment_payment(p_installment_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
  v_plan RECORD;
  v_batch uuid;
  v_desc text;
  v_line RECORD;
  v_cash RECORD;
  v_shift RECORD;
BEGIN
  SELECT * INTO v_row FROM public.installment_payments WHERE id = p_installment_id;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'INSTALLMENT_NOT_FOUND';
  END IF;
  IF NOT public.can_manage_capital(v_row.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_row.status <> 'paid' OR v_row.batch_id IS NULL THEN
    RAISE EXCEPTION 'NOT_SETTLED: only a settled installment can be voided';
  END IF;
  -- batch_id is user-editable: it must be a journal batch of this installment's own business
  IF v_row.batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.journal_entry_batches WHERE id = v_row.batch_id AND tenant_id = v_row.tenant_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_plan FROM public.installment_plans WHERE id = v_row.plan_id AND tenant_id = v_row.tenant_id;
  v_desc := 'REVERSAL - Installment ' || v_row.installment_no || '/' || v_plan.installment_count ||
            ' - ' || v_plan.description || COALESCE(' (' || p_reason || ')', '');

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
  VALUES
    (v_row.tenant_id, CURRENT_DATE, v_desc, 'INSTV-' || to_char(now(), 'YYYYMMDDHH24MISS'),
     'reversal', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), v_row.branch_id)
  RETURNING id INTO v_batch;

  FOR v_line IN
    SELECT * FROM public.account_transactions WHERE batch_id = v_row.batch_id AND tenant_id = v_row.tenant_id
  LOOP
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (v_line.tenant_id, v_line.account_id, CURRENT_DATE, COALESCE(v_line.credit, 0), COALESCE(v_line.debit, 0),
       v_desc, 'installment_payment_void', v_row.id, auth.uid(), v_batch, v_line.branch_id);
  END LOOP;

  -- Reverse the drawer movement if one was recorded for this installment.
  SELECT * INTO v_cash
  FROM public.cash_events
  WHERE reference_type = 'installment_payment' AND reference_id = v_row.id
    AND public.get_restaurant_tenant_id(restaurant_id) = v_row.tenant_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_cash.id IS NOT NULL THEN
    SELECT * INTO v_shift FROM public.find_open_shift_for_cash(v_row.tenant_id, v_row.branch_id);
    INSERT INTO public.cash_events
      (shift_id, restaurant_id, branch_id, event_type, amount, payment_method,
       description, created_by, reference_type, reference_id)
    VALUES
      (COALESCE(v_shift.shift_id, v_cash.shift_id), v_cash.restaurant_id, v_cash.branch_id,
       'adjustment', -1 * v_cash.amount, 'cash',
       'Reversal of BNPL installment payout - ' || v_desc, auth.uid(),
       'installment_payment_void', v_row.id);
  END IF;

  UPDATE public.installment_payments
  SET status = 'pending', paid_amount = 0, paid_date = NULL, batch_id = NULL,
      payment_account_id = NULL, capital_account_id = NULL, paid_by = NULL,
      voided_at = now(), void_reason = p_reason
  WHERE id = p_installment_id;

  UPDATE public.installment_plans SET status = 'active' WHERE id = v_row.plan_id AND tenant_id = v_row.tenant_id;

  RETURN v_batch;
END;
$function$;


-- reverse_day_end_adjustment
CREATE OR REPLACE FUNCTION public.reverse_day_end_adjustment(p_adjustment_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_adj        RECORD;
  v_line       RECORD;
  v_user       uuid := auth.uid();
  v_batch_id   uuid;
  v_new_adj_id uuid;
  v_desc       text;
  v_count      int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Reversal reason must be at least 10 characters';
  END IF;

  SELECT * INTO v_adj FROM public.day_end_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Day-end adjustment not found'; END IF;
  -- IS DISTINCT FROM: a caller without a profile business must not pass
  IF v_adj.tenant_id IS DISTINCT FROM get_user_tenant_id(v_user) THEN
    RAISE EXCEPTION 'Not authorized for this tenant';
  END IF;
  IF NOT (is_superadmin(v_user)
          OR tenant_has_role(v_adj.tenant_id, 'owner')
          OR tenant_has_role(v_adj.tenant_id, 'manager')) THEN
    RAISE EXCEPTION 'Only owners or managers can reverse day-end adjustments';
  END IF;
  IF NOT v_adj.ledger_posted THEN
    RAISE EXCEPTION 'Cannot reverse: original adjustment was not posted to the ledger';
  END IF;
  IF v_adj.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'This adjustment has already been reversed'; END IF;
  IF v_adj.reversal_of_id IS NOT NULL THEN RAISE EXCEPTION 'A reversal entry cannot itself be reversed'; END IF;

  -- Daily-sales adjustments have no ledger lines (End of Day posts the money): reversing one
  -- records the reversal only.
  IF v_adj.scope <> 'daily_sales' AND NOT EXISTS (
    SELECT 1 FROM public.account_transactions
     WHERE reference_type = 'day_end_adjustment' AND reference_id = v_adj.id
       AND tenant_id = v_adj.tenant_id AND COALESCE(is_voided,false) = false
  ) THEN
    RAISE EXCEPTION 'Cannot reverse: no ledger lines found for the original adjustment';
  END IF;

  v_desc := 'REVERSAL of Day-End Adjustment [' || v_adj.reason::text || ']: ' || p_reason;

  INSERT INTO public.day_end_adjustments (
    tenant_id, restaurant_id, branch_id, scope, scope_ref_id, business_date,
    reason, notes, amount, ledger_posted, created_by, reversal_of_id
  ) VALUES (
    v_adj.tenant_id, v_adj.restaurant_id, v_adj.branch_id, v_adj.scope, v_adj.scope_ref_id, v_adj.business_date,
    v_adj.reason, ('REVERSAL: ' || p_reason), (v_adj.amount * -1), false, v_user, v_adj.id
  ) RETURNING id INTO v_new_adj_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.account_transactions
     WHERE reference_type = 'day_end_adjustment' AND reference_id = v_adj.id
       AND tenant_id = v_adj.tenant_id AND COALESCE(is_voided,false) = false
  ) THEN
    UPDATE public.day_end_adjustments SET ledger_posted = true, ledger_batch_id = NULL WHERE id = v_new_adj_id;
    UPDATE public.day_end_adjustments
       SET reversed_at = now(), reversed_by = v_user, reversal_reason = p_reason, reversed_adjustment_id = v_new_adj_id
     WHERE id = p_adjustment_id;
    RETURN v_new_adj_id;
  END IF;
  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, batch_date, description, reference_number, entry_type,
    journal_type, created_by, is_posted, posted_at, posted_by
  ) VALUES (
    v_adj.tenant_id, v_adj.branch_id, current_date, v_desc,
    'DEA-REV-' || to_char(now(),'YYYYMMDD') || '-' || substr(v_new_adj_id::text,1,8),
    'adjustment', 'reversal', v_user, true, now(), v_user
  ) RETURNING id INTO v_batch_id;

  -- Mirror every original ledger line, linked to the line it reverses.
  FOR v_line IN
    SELECT * FROM public.account_transactions
     WHERE reference_type = 'day_end_adjustment' AND reference_id = v_adj.id
       AND tenant_id = v_adj.tenant_id AND COALESCE(is_voided,false) = false
  LOOP
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id, original_transaction_id)
    VALUES
      (v_line.tenant_id, v_line.account_id, current_date, COALESCE(v_line.credit,0), COALESCE(v_line.debit,0), v_desc,
       'day_end_adjustment_reversal', v_line.reference_id, v_user, v_batch_id, v_line.branch_id, v_line.id);
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.day_end_adjustments SET ledger_posted = true, ledger_batch_id = v_batch_id WHERE id = v_new_adj_id;
  UPDATE public.day_end_adjustments
     SET reversed_at = now(), reversed_by = v_user, reversal_reason = p_reason, reversed_adjustment_id = v_new_adj_id
   WHERE id = p_adjustment_id;

  RETURN v_new_adj_id;
END;
$function$;
