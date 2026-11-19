-- add_tenant_checks_to_definer_readers
--
-- Second half of the SECURITY DEFINER review (docs/self-hosting/FUNCTION_ACCESS_REVIEW.md):
-- functions that only read data but never checked the caller. Being SECURITY DEFINER they
-- bypass RLS, so a logged-in user of one tenant could read another tenant's data by id,
-- e.g. get_tenant_owner_emails(other_tenant) listed its owners' email addresses, and
-- sales_price_variance / get_weekly_cogs_items / scan_sale_posting_vat_integrity returned
-- another restaurant's sales, costs and postings.
--
-- 1) The 13 called from logged-in pages now start with assert_restaurant_access /
--    assert_tenant_access (added in 20261109120650); the rest of each body is unchanged.
--    Calls without a user (service role, cron, other SECURITY DEFINER functions) are not
--    affected.
--    compliance_branch_score also gets a fix: with no compliance_settings row it fell back
--    to row(25,25,25,25), which has no field names, so the score page errored (42703).
-- 2) The 32 that no page calls as a user (internal helpers used by other
--    SECURITY DEFINER functions, cron, or server functions with the service-role key) lose
--    authenticated EXECUTE. None is referenced by an RLS policy or a SECURITY INVOKER
--    function. Several were oracles, e.g. verify_terminal_key(key) and
--    verify_cron_token(token) let any logged-in user test guessed secrets.

-- check_quota
CREATE OR REPLACE FUNCTION public.check_quota(p_tenant_id uuid, p_quota_type text, p_increment integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_limits jsonb;
  v_current_usage integer;
  v_limit integer;
  v_allowed boolean := true;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_tenant_access(p_tenant_id);

  -- Get plan limits for tenant
  SELECT p.quota_limits INTO v_plan_limits
  FROM public.tenants t
  JOIN public.plans p ON t.plan_id = p.id
  WHERE t.id = p_tenant_id;

  IF v_plan_limits IS NULL OR v_plan_limits = '{}'::jsonb THEN
    RETURN jsonb_build_object('allowed', true, 'current', 0, 'limit', null, 'remaining', null);
  END IF;

  -- Get current usage
  SELECT 
    CASE p_quota_type
      WHEN 'users' THEN user_count
      WHEN 'menu_items' THEN menu_item_count
      WHEN 'image_uploads' THEN image_upload_count
      WHEN 'email_reminders' THEN email_reminder_count
      WHEN 'owner' THEN owner_count
      WHEN 'manager' THEN manager_count
      WHEN 'cashier' THEN cashier_count
      ELSE 0
    END INTO v_current_usage
  FROM public.tenant_usage
  WHERE tenant_id = p_tenant_id;

  v_current_usage := COALESCE(v_current_usage, 0);

  -- Get limit from plan
  v_limit := (v_plan_limits->>p_quota_type)::integer;

  -- Check if action is allowed
  IF v_limit IS NOT NULL AND (v_current_usage + p_increment) > v_limit THEN
    v_allowed := false;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'current', v_current_usage,
    'limit', v_limit,
    'remaining', CASE WHEN v_limit IS NOT NULL THEN GREATEST(0, v_limit - v_current_usage) ELSE null END
  );
END;
$function$;

-- classify_unposted_expense
CREATE OR REPLACE FUNCTION public.classify_unposted_expense(p_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exp RECORD; v_acct RECORD; v_locked boolean; v_vis_count int; v_branch_match int;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.expenses WHERE id = p_expense_id));

  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found','reason_code','not_found','reason_detail','Expense not found');
  END IF;
  IF v_exp.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','blocked','reason_code','deleted','reason_detail','Expense was soft-deleted');
  END IF;
  IF COALESCE(v_exp.ledger_posted, false) THEN
    RETURN jsonb_build_object('status','posted','reason_code','already_posted','reason_detail','Already posted to ledger');
  END IF;
  IF COALESCE(v_exp.approval_status,'pending') <> 'approved' THEN
    RETURN jsonb_build_object('status','blocked','reason_code','pending_approval',
      'reason_detail','Expense is ' || COALESCE(v_exp.approval_status,'pending') || ' — approve it first',
      'suggested_action','approve_expense');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.fiscal_period_locks
    WHERE tenant_id = v_exp.tenant_id AND COALESCE(is_locked, true) = true
      AND v_exp.expense_date BETWEEN period_start AND period_end
  ) INTO v_locked;
  IF v_locked THEN
    RETURN jsonb_build_object('status','blocked','reason_code','period_locked',
      'reason_detail','Fiscal period covering ' || v_exp.expense_date || ' is locked',
      'suggested_action','unlock_period');
  END IF;

  IF v_exp.account_id IS NULL THEN
    RETURN jsonb_build_object('status','blocked','reason_code','missing_account',
      'reason_detail','No Chart of Accounts mapping on this expense',
      'suggested_action','assign_account');
  END IF;

  SELECT id, account_code, account_name, account_type::text AS account_type INTO v_acct
  FROM public.chart_of_accounts WHERE id = v_exp.account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','blocked','reason_code','missing_account',
      'reason_detail','Mapped account no longer exists','suggested_action','assign_account');
  END IF;

  IF v_acct.account_type = 'cogs' THEN
    RETURN jsonb_build_object('status','blocked','reason_code','cogs_routed',
      'reason_detail','Account ' || v_acct.account_code || ' ' || v_acct.account_name ||
                     ' is COGS — record via Inventory Purchase, not direct expense posting',
      'suggested_action','open_inventory_purchase','target_account_id', v_acct.id);
  END IF;

  IF v_exp.branch_id IS NOT NULL THEN
    SELECT count(*) INTO v_vis_count FROM public.account_branch_visibility WHERE account_id = v_acct.id;
    IF v_vis_count > 0 THEN
      SELECT count(*) INTO v_branch_match FROM public.account_branch_visibility
        WHERE account_id = v_acct.id AND branch_id = v_exp.branch_id;
      IF v_branch_match = 0 THEN
        RETURN jsonb_build_object('status','blocked','reason_code','missing_branch_visibility',
          'reason_detail','Account ' || v_acct.account_code || ' is hidden for the expense branch',
          'suggested_action','update_visibility','target_account_id', v_acct.id);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('status','ready','reason_code','ready',
    'reason_detail','Ready to post','target_account_id', v_acct.id);
END; $function$;

-- compliance_branch_score
CREATE OR REPLACE FUNCTION public.compliance_branch_score(_restaurant_id uuid, _branch_id uuid, _from date, _to date)
 RETURNS TABLE(branch_id uuid, branch_name text, score numeric, cleanliness numeric, food_safety numeric, employee_sop numeric, checklists numeric, open_violations integer, overdue_violations integer, municipality_fines_total numeric, internal_violations integer, repeat_violations integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare w record;
begin
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access(_restaurant_id);

  select coalesce(s.weight_cleanliness,25) wc, coalesce(s.weight_food_safety,25) wf,
         coalesce(s.weight_employee_sop,25) we, coalesce(s.weight_checklists,25) wk
  into w from public.compliance_settings s where s.restaurant_id = _restaurant_id;
  -- Default weights when the restaurant has no compliance_settings row. A bare row(...)
  -- has no field names, so w.wc etc. failed with 42703 (fixed 20261109).
  if w is null then select 25 as wc, 25 as wf, 25 as we, 25 as wk into w; end if;

  return query
  with b as (
    select br.id, br.name from public.branches br
    where br.restaurant_id = _restaurant_id and br.deleted_at is null
      and (_branch_id is null or br.id = _branch_id)
  ),
  v as (
    select cv.*, cat.code as cat_code
    from public.compliance_violations cv
    left join public.compliance_violation_categories cat on cat.id = cv.category_id
    where cv.restaurant_id = _restaurant_id and cv.deleted_at is null
      and cv.violation_date between _from and _to
  ),
  agg as (
    select b.id, b.name,
      count(*) filter (where v.cat_code = 'cleanliness') as c_cnt,
      count(*) filter (where v.cat_code = 'food_safety') as f_cnt,
      count(*) filter (where v.cat_code in ('employee_compliance','sop')) as e_cnt,
      count(*) filter (where v.status not in ('closed','cancelled'))::int as open_cnt,
      count(*) filter (where v.is_overdue and v.status not in ('closed','cancelled'))::int as overdue_cnt,
      count(*) filter (where not v.is_municipality_fine)::int as internal_cnt
    from b left join v on v.branch_id = b.id
    group by b.id, b.name
  ),
  chk as (
    select b.id, 
      coalesce(avg(case when r.approved_at is not null then 100 when r.completed_at is not null then 70 else 0 end), 100) as pct
    from b left join public.compliance_checklist_runs r
      on r.branch_id = b.id and r.run_date between _from and _to
    group by b.id
  ),
  fines as (
    select b.id, coalesce(sum(mf.amount),0) as total
    from b left join public.municipality_fines mf
      on mf.branch_id = b.id and mf.deleted_at is null and mf.received_date between _from and _to
    group by b.id
  ),
  reps as (
    select b.id, coalesce(count(*),0)::int as cnt from b
    left join (
      select cv.branch_id, cv.violation_type_id
      from public.compliance_violations cv
      where cv.restaurant_id = _restaurant_id and cv.deleted_at is null
        and cv.violation_date between _from and _to
      group by cv.branch_id, cv.violation_type_id having count(*) > 1
    ) r on r.branch_id = b.id
    group by b.id
  )
  select a.id, a.name,
    round((greatest(0, 100 - a.c_cnt * 5) * w.wc + greatest(0, 100 - a.f_cnt * 5) * w.wf
      + greatest(0, 100 - a.e_cnt * 5) * w.we + chk.pct * w.wk)
      / nullif(w.wc + w.wf + w.we + w.wk, 0), 1),
    round(greatest(0, 100 - a.c_cnt * 5), 1),
    round(greatest(0, 100 - a.f_cnt * 5), 1),
    round(greatest(0, 100 - a.e_cnt * 5), 1),
    round(chk.pct, 1),
    a.open_cnt, a.overdue_cnt, fines.total, a.internal_cnt, reps.cnt
  from agg a
  join chk on chk.id = a.id
  join fines on fines.id = a.id
  join reps on reps.id = a.id
  order by a.name;
end $function$;

-- compliance_repeat_info
CREATE OR REPLACE FUNCTION public.compliance_repeat_info(_violation_id uuid)
 RETURNS TABLE(occurrences integer, last_occurrence date, recommended_action text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v record; v_days integer; v_count integer; v_last date; v_action text;
begin
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.compliance_violations WHERE id = _violation_id));

  select * into v from public.compliance_violations where id = _violation_id;
  if not found then return; end if;
  select coalesce(repeat_lookback_days, 90) into v_days from public.compliance_settings where restaurant_id = v.restaurant_id;
  v_days := coalesce(v_days, 90);

  select count(*)::int, max(violation_date) into v_count, v_last
  from public.compliance_violations
  where restaurant_id = v.restaurant_id
    and branch_id = v.branch_id
    and violation_type_id is not distinct from v.violation_type_id
    and id <> v.id
    and deleted_at is null
    and violation_date >= v.violation_date - v_days;

  select action_label into v_action from public.compliance_escalation_rules
  where restaurant_id = v.restaurant_id
    and (branch_id is null or branch_id = v.branch_id)
    and is_active
    and occurrence_count <= v_count + 1
  order by occurrence_count desc limit 1;

  return query select v_count, v_last, v_action;
end $function$;

-- get_branch_menu_prices
CREATE OR REPLACE FUNCTION public.get_branch_menu_prices(_branch_id uuid, _at date DEFAULT CURRENT_DATE)
 RETURNS TABLE(menu_item_id uuid, quarter_price numeric, half_price numeric, full_price numeric, cost_override numeric, effective_from date, effective_to date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [access check added 20261109]
  SELECT public.assert_restaurant_access((SELECT restaurant_id FROM public.branches WHERE id = _branch_id));
  SELECT DISTINCT ON (p.menu_item_id)
    p.menu_item_id,
    p.quarter_price,
    p.half_price,
    p.full_price,
    p.cost_override,
    p.effective_from,
    p.effective_to
  FROM public.menu_item_branch_prices p
  WHERE p.branch_id = _branch_id
    AND p.effective_from <= _at
    AND (p.effective_to IS NULL OR p.effective_to >= _at)
  ORDER BY p.menu_item_id,
           p.effective_from DESC,
           p.created_at DESC,
           p.id DESC;
$function$;

-- get_employee_fine_capacity
CREATE OR REPLACE FUNCTION public.get_employee_fine_capacity(p_staff_id uuid, p_payroll_month date, p_exclude_fine_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff public.staff;
  v_set public.payroll_deduction_settings;
  v_month date := date_trunc('month', p_payroll_month)::date;
  v_wage numeric;
  v_existing numeric;
  v_monthly_cap numeric;
  v_days_cap numeric;
  v_advances numeric;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.staff WHERE id = p_staff_id));

  SELECT * INTO v_staff FROM public.staff WHERE id = p_staff_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','STAFF_NOT_FOUND'); END IF;

  v_set := public.get_deduction_settings(v_staff.restaurant_id, COALESCE(v_staff.branch_id, v_staff.assigned_branch_id), v_month);
  v_wage := public.get_staff_monthly_wage(p_staff_id);

  SELECT COALESCE(SUM(amount),0) INTO v_existing
  FROM public.employee_fines
  WHERE staff_id = p_staff_id
    AND date_trunc('month', payroll_month)::date = v_month
    AND status IN ('approved','applied')
    AND deleted_at IS NULL
    AND (p_exclude_fine_id IS NULL OR id <> p_exclude_fine_id);

  SELECT COALESCE(SUM(amount),0) INTO v_advances
  FROM public.staff_advances
  WHERE staff_id = p_staff_id AND status = 'pending';

  v_days_cap := CASE WHEN v_set.max_days_wage_per_month IS NULL OR v_wage = 0 THEN NULL
                     ELSE ROUND(v_wage / 30.0 * v_set.max_days_wage_per_month, 2) END;
  v_monthly_cap := NULLIF(COALESCE(v_set.max_fine_per_month, 0), 0);
  v_monthly_cap := LEAST(COALESCE(v_monthly_cap, v_days_cap, 0), COALESCE(v_days_cap, v_monthly_cap, 0));

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'payroll_month', v_month,
    'monthly_wage', v_wage,
    'max_fine_per_violation', COALESCE(v_set.max_fine_per_violation, 0),
    'max_days_wage_per_month', COALESCE(v_set.max_days_wage_per_month, 0),
    'max_total_deduction_pct', COALESCE(v_set.max_total_deduction_pct, 50),
    'monthly_fine_limit', COALESCE(v_monthly_cap, 0),
    'existing_fines', v_existing,
    'remaining_fine_capacity', GREATEST(COALESCE(v_monthly_cap,0) - v_existing, 0),
    'max_total_deduction', ROUND(v_wage * COALESCE(v_set.max_total_deduction_pct, 50) / 100.0, 2),
    'pending_advances', v_advances,
    'settings_effective_from', v_set.effective_from
  );
END;
$function$;

-- get_overdue_installments
CREATE OR REPLACE FUNCTION public.get_overdue_installments(p_tenant_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(installment_id uuid, plan_id uuid, branch_id uuid, provider text, supplier_name text, description text, installment_no integer, due_date date, amount numeric, days_overdue integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [access check added 20261109]
  SELECT public.assert_tenant_access(p_tenant_id);
  SELECT ip.id, ip.plan_id, ip.branch_id, pl.provider, pl.supplier_name, pl.description,
         ip.installment_no, ip.due_date, ip.amount,
         (p_as_of - ip.due_date)::int
  FROM public.installment_payments ip
  JOIN public.installment_plans pl ON pl.id = ip.plan_id
  WHERE ip.tenant_id = p_tenant_id
    AND ip.voided_at IS NULL
    AND ip.status <> 'paid'
    AND ip.due_date < p_as_of
    AND pl.status = 'active'
  ORDER BY ip.due_date;
$function$;

-- get_tenant_owner_emails
CREATE OR REPLACE FUNCTION public.get_tenant_owner_emails(p_tenant_id uuid)
 RETURNS TABLE(email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_tenant_access(p_tenant_id);

  RETURN QUERY
  SELECT au.email::TEXT
  FROM public.user_tenant_roles utr
  JOIN auth.users au ON au.id = utr.user_id
  WHERE utr.tenant_id = p_tenant_id
    AND utr.role = 'owner';
END;
$function$;

-- get_weekly_cogs_items
CREATE OR REPLACE FUNCTION public.get_weekly_cogs_items(p_restaurant_id uuid, p_week_start date, p_week_end date)
 RETURNS TABLE(item_id uuid, item_name text, unit text, unit_cost numeric, opening_qty numeric, opening_value numeric, purchases_qty numeric, purchases_value numeric, current_stock numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access(p_restaurant_id);

  RETURN QUERY
  SELECT 
    i.id AS item_id,
    i.name AS item_name,
    i.unit,
    i.unit_cost,
    -- Opening stock: current stock + usage during period - purchases during period
    COALESCE(
      i.current_stock + 
      COALESCE((SELECT SUM(u.quantity_used) FROM inventory_usage u 
                WHERE u.inventory_item_id = i.id 
                AND u.usage_date BETWEEN p_week_start AND p_week_end), 0) -
      COALESCE((SELECT SUM(p.quantity_received) FROM purchases p 
                WHERE p.inventory_item_id = i.id 
                AND p.received_at::date BETWEEN p_week_start AND p_week_end), 0),
      0
    )::NUMERIC AS opening_qty,
    -- Opening value
    COALESCE(
      (i.current_stock + 
       COALESCE((SELECT SUM(u.quantity_used) FROM inventory_usage u 
                 WHERE u.inventory_item_id = i.id 
                 AND u.usage_date BETWEEN p_week_start AND p_week_end), 0) -
       COALESCE((SELECT SUM(p.quantity_received) FROM purchases p 
                 WHERE p.inventory_item_id = i.id 
                 AND p.received_at::date BETWEEN p_week_start AND p_week_end), 0)) * i.unit_cost,
      0
    )::NUMERIC AS opening_value,
    -- Purchases during week
    COALESCE((SELECT SUM(p.quantity_received) FROM purchases p 
              WHERE p.inventory_item_id = i.id 
              AND p.received_at::date BETWEEN p_week_start AND p_week_end), 0)::NUMERIC AS purchases_qty,
    COALESCE((SELECT SUM(p.total_cost) FROM purchases p 
              WHERE p.inventory_item_id = i.id 
              AND p.received_at::date BETWEEN p_week_start AND p_week_end), 0)::NUMERIC AS purchases_value,
    i.current_stock
  FROM inventory_items i
  WHERE i.restaurant_id = p_restaurant_id
    AND i.cogs_frequency = 'weekly'
  ORDER BY i.name;
END;
$function$;

-- preview_payroll_deduction_allocation
CREATE OR REPLACE FUNCTION public.preview_payroll_deduction_allocation(p_payroll_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pay public.payroll_records;
  v_set public.payroll_deduction_settings;
  v_branch uuid;
  v_pct numeric;
  v_gross numeric;
  v_max numeric;
  v_fines jsonb := '[]'::jsonb;
  v_fine_total numeric := 0;
  v_total numeric;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_restaurant_access((SELECT restaurant_id FROM public.payroll_records WHERE id = p_payroll_id));

  SELECT * INTO v_pay FROM public.payroll_records WHERE id = p_payroll_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_NOT_FOUND'; END IF;

  SELECT COALESCE(v_pay.branch_id, s.branch_id, s.assigned_branch_id) INTO v_branch
  FROM public.staff s WHERE s.id = v_pay.staff_id;

  v_set := public.get_deduction_settings(v_pay.restaurant_id, v_branch, v_pay.period_end);
  v_pct := COALESCE(v_set.max_total_deduction_pct, 50);
  v_gross := COALESCE(NULLIF(v_pay.gross_wage,0), v_pay.amount, 0);
  v_max := ROUND(v_gross * v_pct / 100.0, 2);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind','fine',
           'id', f.id,
           'label', COALESCE(f.fine_number,'Fine') || ' — ' || COALESCE(vt.name_en,'Violation')
                    || CASE WHEN f.installment_count > 1
                            THEN ' (inst. ' || f.installment_number || '/' || f.installment_count || ')'
                            ELSE '' END,
           'amount', f.amount,
           'payroll_month', f.payroll_month
         ) ORDER BY f.payroll_month, f.violation_date), '[]'::jsonb),
         COALESCE(SUM(f.amount),0)
  INTO v_fines, v_fine_total
  FROM public.employee_fines f
  LEFT JOIN public.fine_violation_types vt ON vt.id = f.violation_type_id
  WHERE f.staff_id = v_pay.staff_id
    AND f.status = 'approved'
    AND f.deleted_at IS NULL
    AND f.payroll_month <= v_pay.period_end;

  v_total := COALESCE(v_pay.deductions,0) + COALESCE(v_pay.advance_recovered,0) + v_fine_total;

  RETURN jsonb_build_object(
    'payroll_id', p_payroll_id,
    'staff_id', v_pay.staff_id,
    'branch_id', v_branch,
    'gross_wage', v_gross,
    'max_deduction_pct', v_pct,
    'max_deduction', v_max,
    'other_deductions', COALESCE(v_pay.deductions,0),
    'advance_recovered', COALESCE(v_pay.advance_recovered,0),
    'fines_total', v_fine_total,
    'requested_total', v_total,
    'excess_amount', GREATEST(ROUND(v_total - v_max, 2), 0),
    'requires_allocation', (v_gross > 0 AND v_total > v_max + 0.01),
    'fines', v_fines
  );
END;
$function$;

-- resolve_branch_account
CREATE OR REPLACE FUNCTION public.resolve_branch_account(_parent_account_id uuid, _branch_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_name text;
  v_child_id uuid;
BEGIN
  -- [access check added 20261109]
  PERFORM public.assert_tenant_access((SELECT tenant_id FROM public.chart_of_accounts WHERE id = _parent_account_id));

  IF _parent_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF _branch_id IS NULL THEN
    RETURN _parent_account_id;
  END IF;

  SELECT name INTO v_branch_name FROM public.branches WHERE id = _branch_id;
  IF v_branch_name IS NULL THEN
    RETURN _parent_account_id;
  END IF;

  -- Prefer an active child account whose name contains the branch name.
  SELECT id INTO v_child_id
  FROM public.chart_of_accounts
  WHERE parent_id = _parent_account_id
    AND is_active = true
    AND account_name ILIKE '%' || v_branch_name || '%'
  ORDER BY account_code
  LIMIT 1;

  RETURN COALESCE(v_child_id, _parent_account_id);
END;
$function$;

-- sales_price_variance
CREATE OR REPLACE FUNCTION public.sales_price_variance(_restaurant_id uuid, _from date, _to date, _branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(sale_item_id uuid, transaction_id uuid, receipt_number text, sold_at timestamp with time zone, sale_date date, branch_id uuid, branch_name text, menu_item_id uuid, item_name text, quantity integer, unit_price numeric, line_total numeric, expected_quarter numeric, expected_half numeric, expected_full numeric, nearest_expected numeric, variance_per_unit numeric, variance_total numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [access check added 20261109]
  SELECT public.assert_restaurant_access(_restaurant_id);
  WITH tz AS (
    SELECT COALESCE(r.timezone, 'Asia/Riyadh') AS name
    FROM public.restaurants r WHERE r.id = _restaurant_id
  ),
  lines AS (
    SELECT
      si.id,
      si.transaction_id,
      st.receipt_number,
      st.created_at AS sold_at,
      (st.created_at AT TIME ZONE (SELECT name FROM tz))::date AS sale_date,
      COALESCE(si.branch_id, st.branch_id) AS branch_id,
      si.menu_item_id,
      mi.name AS item_name,
      si.quantity,
      si.unit_price,
      COALESCE(si.total_price, si.unit_price * si.quantity) AS line_total,
      mi.quarter_price AS base_quarter,
      mi.half_price AS base_half,
      mi.full_price AS base_full,
      mi.selling_price AS base_selling
    FROM public.sales_items si
    JOIN public.sales_transactions st ON st.id = si.transaction_id
    JOIN public.menu_items mi ON mi.id = si.menu_item_id
    WHERE si.restaurant_id = _restaurant_id
      AND (st.created_at AT TIME ZONE (SELECT name FROM tz))::date BETWEEN _from AND _to
      AND (_branch_id IS NULL OR COALESCE(si.branch_id, st.branch_id) = _branch_id)
  ),
  priced AS (
    SELECT
      l.*,
      b.name AS branch_name,
      COALESCE(p.quarter_price, l.base_quarter) AS exp_quarter,
      COALESCE(p.half_price, l.base_half) AS exp_half,
      COALESCE(p.full_price, l.base_full, l.base_selling) AS exp_full
    FROM lines l
    LEFT JOIN public.branches b ON b.id = l.branch_id
    LEFT JOIN LATERAL (
      SELECT mp.quarter_price, mp.half_price, mp.full_price
      FROM public.menu_item_branch_prices mp
      WHERE mp.branch_id = l.branch_id
        AND mp.menu_item_id = l.menu_item_id
        AND mp.effective_from <= l.sale_date
        AND (mp.effective_to IS NULL OR mp.effective_to >= l.sale_date)
      ORDER BY mp.effective_from DESC, mp.created_at DESC, mp.id DESC
      LIMIT 1
    ) p ON TRUE
  ),
  flagged AS (
    SELECT
      pr.*,
      (
        SELECT v FROM (
          SELECT unnest(ARRAY[pr.exp_quarter, pr.exp_half, pr.exp_full]) AS v
        ) c
        WHERE c.v IS NOT NULL AND c.v > 0
        ORDER BY abs(c.v - pr.unit_price)
        LIMIT 1
      ) AS nearest
    FROM priced pr
  )
  SELECT
    f.id,
    f.transaction_id,
    f.receipt_number,
    f.sold_at,
    f.sale_date,
    f.branch_id,
    f.branch_name,
    f.menu_item_id,
    f.item_name,
    f.quantity,
    f.unit_price,
    f.line_total,
    f.exp_quarter,
    f.exp_half,
    f.exp_full,
    f.nearest,
    round(f.unit_price - f.nearest, 2),
    round((f.unit_price - f.nearest) * f.quantity, 2)
  FROM flagged f
  WHERE f.nearest IS NOT NULL
    AND abs(f.unit_price - f.nearest) > 0.005
  ORDER BY f.sold_at DESC;
$function$;

-- scan_sale_posting_vat_integrity
CREATE OR REPLACE FUNCTION public.scan_sale_posting_vat_integrity(p_tenant_id uuid, p_from date, p_to date, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(batch_id uuid, branch_id uuid, branch_name text, posting_date date, reference_number text, description text, vat_rate numeric, revenue_credit numeric, vat_recorded numeric, vat_expected numeric, variance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [access check added 20261109]
  SELECT public.assert_tenant_access(p_tenant_id);
  WITH legs AS (
    SELECT t.batch_id,
           COALESCE(jb.branch_id, (MAX(t.branch_id::text))::uuid) AS branch_id,
           jb.batch_date,
           jb.reference_number,
           jb.description,
           SUM(CASE WHEN coa.account_type = 'revenue' THEN COALESCE(t.credit,0) - COALESCE(t.debit,0) ELSE 0 END) AS revenue_credit,
           SUM(CASE WHEN coa.account_code = '2200' THEN COALESCE(t.credit,0) - COALESCE(t.debit,0) ELSE 0 END) AS vat_recorded
    FROM account_transactions t
    JOIN journal_entry_batches jb ON jb.id = t.batch_id
    JOIN chart_of_accounts coa ON coa.id = t.account_id
    WHERE t.tenant_id = p_tenant_id
      AND COALESCE(t.is_voided, false) = false
      AND jb.batch_date BETWEEN p_from AND p_to
      AND (p_branch_id IS NULL OR COALESCE(jb.branch_id, t.branch_id) = p_branch_id)
      AND EXISTS (
        SELECT 1 FROM account_transactions t2
        WHERE t2.batch_id = t.batch_id AND t2.reference_type IN ('sale', 'night_summary')
      )
    GROUP BY t.batch_id, jb.branch_id, jb.batch_date, jb.reference_number, jb.description
  )
  SELECT l.batch_id,
         l.branch_id,
         b.name,
         l.batch_date,
         l.reference_number,
         l.description,
         b.vat_rate,
         ROUND(l.revenue_credit, 2),
         ROUND(l.vat_recorded, 2),
         ROUND(l.revenue_credit * b.vat_rate / 100.0, 2),
         ROUND(l.vat_recorded - ROUND(l.revenue_credit * b.vat_rate / 100.0, 2), 2)
  FROM legs l
  JOIN branches b ON b.id = l.branch_id
  WHERE b.vat_rate IS NOT NULL
    AND l.revenue_credit <> 0
    AND ABS(l.vat_recorded - ROUND(l.revenue_credit * b.vat_rate / 100.0, 2)) > COALESCE(
      (SELECT s.tolerance FROM vat_posting_integrity_settings s WHERE s.tenant_id = p_tenant_id), 1.00)
  ORDER BY l.batch_date DESC;
$function$;

-- 2) internal / server-only readers
DO $$
DECLARE
  sig text;
  fn regprocedure;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.account_has_transactions(uuid)',
    'public.assert_branch_vat_rate_configured(uuid,text)',
    'public.assert_expense_funding_account_valid(uuid,uuid)',
    'public.assert_night_summary_vat_consistent(uuid)',
    'public.calculate_daily_system_total(uuid,date)',
    'public.can_reverse_ap_settlement(uuid)',
    'public.find_open_shift_for_cash(uuid,uuid)',
    'public.get_account_id_by_code(uuid,text)',
    'public.get_deduction_settings(uuid,uuid,date)',
    'public.get_staff_monthly_wage(uuid)',
    'public.get_tenant_device_seat_cap(uuid)',
    'public.guest_get_order(uuid,uuid)',
    'public.is_account_visible_for_branch(uuid,uuid)',
    'public.is_branch_emailable(uuid)',
    'public.is_cash_on_hand_account(uuid)',
    'public.is_cash_or_bank_account(uuid)',
    'public.is_demo_tenant(uuid)',
    'public.is_period_locked(uuid,date)',
    'public.is_settlement_batch(uuid)',
    'public.pick_latest_reconcilable_stocktake(uuid,text)',
    'public.resolve_asset_class(uuid,uuid,text)',
    'public.resolve_daily_overhead_accounts(uuid,uuid)',
    'public.resolve_expense_funding_account(uuid)',
    'public.resolve_inventory_account_for_cogs(uuid,uuid)',
    'public.resolve_menu_item_price(uuid,uuid,text)',
    'public.resolve_slug_redirect(text)',
    'public.resolve_vat_account(uuid,text)',
    'public.reverse_provisional_cogs_for_sale(uuid,text)',
    'public.run_daily_reconciliation_all(date)',
    'public.verify_cron_token(text)',
    'public.verify_terminal_key(text)',
    'public.zatca_claim_clearance_jobs(integer,integer)'
  ]
  LOOP
    fn := to_regprocedure(sig);
    CONTINUE WHEN fn IS NULL;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
