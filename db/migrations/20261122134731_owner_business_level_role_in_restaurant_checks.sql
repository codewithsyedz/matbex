-- Three functions now check a role in one restaurant (3-argument has_role). Owners (and, for the AP
-- backfill, accountants) can hold their role at business level only: on the production copy
-- (2026-11-22) 2 owner and 1 accountant business/restaurant pairs have no per-restaurant row. Before
-- 20261122102225 two of these accepted a role in ANY restaurant, so those users would now be refused.
-- Business-level owners/accountants of the restaurant's own business pass again; managers stay
-- per restaurant.

-- request_terminal_state_refresh
CREATE OR REPLACE FUNCTION public.request_terminal_state_refresh(_restaurant_id uuid, _branch_id uuid DEFAULT NULL::uuid, _terminal_uid text DEFAULT NULL::text)
 RETURNS TABLE(branch_id uuid, menu_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- user_tenant_roles has no restaurant_id column (every call failed); check the restaurant role.
  IF NOT (
    public.has_role(v_uid, _restaurant_id, 'owner'::app_role)
    OR public.has_role(v_uid, _restaurant_id, 'manager'::app_role)
    OR public.is_superadmin(v_uid)
    -- owners may hold their role at business level only (no row for each restaurant)
    OR public.has_role_in_tenant(public.get_restaurant_tenant_id(_restaurant_id), ARRAY['owner']::public.app_role[])
  ) THEN
    RAISE EXCEPTION 'Only owners or managers can refresh terminal state';
  END IF;

  RETURN QUERY
  WITH targets AS (
    SELECT b.id AS bid
    FROM public.branches b
    WHERE b.restaurant_id = _restaurant_id
      AND (_branch_id IS NULL OR b.id = _branch_id)
  ), bumped AS (
    INSERT INTO public.pos_entity_versions AS pev
      (restaurant_id, entity_type, entity_id, version, updated_at)
    SELECT _restaurant_id, 'menu_prices', t.bid::text, 1, now()
    FROM targets t
    ON CONFLICT (restaurant_id, entity_type, entity_id)
    DO UPDATE SET version = pev.version + 1, updated_at = now()
    RETURNING (pev.entity_id)::uuid AS bid, pev.version
  )
  SELECT bumped.bid, bumped.version::integer FROM bumped;  -- version is bigint

  -- audit_logs columns are tenant_id / entity_type / entity_id / new_data.
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, new_data)
  VALUES (
    public.get_restaurant_tenant_id(_restaurant_id),
    v_uid,
    'terminal_state_refresh',
    'pos_terminals',
    NULL,
    jsonb_build_object(
      'branch_id', _branch_id,
      'terminal_uid', _terminal_uid,
      'requested_at', now()
    )
  );
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
    -- owners and accountants may hold their role at business level only
    OR public.has_role_in_tenant(public.get_restaurant_tenant_id(p_tenant_id), ARRAY['owner','accountant']::public.app_role[])
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
    -- owners may hold their role at business level only (no row for each restaurant)
    OR public.has_role_in_tenant(public.get_restaurant_tenant_id(v_adv.restaurant_id), ARRAY['owner']::public.app_role[])
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
