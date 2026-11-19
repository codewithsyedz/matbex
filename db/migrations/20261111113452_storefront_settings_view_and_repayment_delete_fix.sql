-- 0) void_transaction
--    * Any signed-in user could call it (SECURITY DEFINER, no tenant check) and void
--      another business's ledger rows; it now requires can_post_journal_entries for the
--      transaction's tenant, the same right as posting entries.
--    * The reversal wrote p_transaction_id::text into the uuid reference_id column, so
--      every void failed (journal "Void" button, repayment undo).
CREATE OR REPLACE FUNCTION public.void_transaction(p_transaction_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_original RECORD;
  v_reversal_id UUID;
BEGIN
  -- Get original transaction
  SELECT * INTO v_original
  FROM public.account_transactions
  WHERE id = p_transaction_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  
  -- Caller must be allowed to post ledger entries for this tenant (a void posts a reversal).
  IF NOT public.can_post_journal_entries(v_original.tenant_id) THEN
    RAISE EXCEPTION 'Not allowed to void transactions for this business' USING ERRCODE = '42501';
  END IF;
  IF v_original.is_voided THEN
    RAISE EXCEPTION 'Transaction is already voided';
  END IF;
  
  -- Mark original as voided
  UPDATE public.account_transactions
  SET 
    is_voided = TRUE,
    voided_at = now(),
    voided_by = auth.uid(),
    void_reason = p_reason
  WHERE id = p_transaction_id;
  
  -- Create reversing entry
  INSERT INTO public.account_transactions (
    tenant_id,
    account_id,
    transaction_date,
    debit,
    credit,
    description,
    reference_type,
    reference_id,
    created_by,
    original_transaction_id
  ) VALUES (
    v_original.tenant_id,
    v_original.account_id,
    CURRENT_DATE, -- Reversal dated today
    v_original.credit, -- Swap debit/credit
    v_original.debit,
    'VOID: ' || COALESCE(v_original.description, 'Transaction') || ' - ' || p_reason,
    'adjustment',
    p_transaction_id,
    auth.uid(),
    p_transaction_id
  )
  RETURNING id INTO v_reversal_id;
  
  -- Log to audit
  PERFORM public.log_audit(
    'TRANSACTION_VOIDED',
    'account_transaction',
    p_transaction_id,
    to_jsonb(v_original),
    jsonb_build_object('void_reason', p_reason, 'reversal_id', v_reversal_id),
    v_original.tenant_id
  );
  
  RETURN v_reversal_id;
END;
$function$;

-- 1) delete_staff_advance_repayment
--    * Only an owner of the repayment's restaurant (with access to its branch) or a
--      superadmin may undo a repayment, the same rule as the table's DELETE policy; before,
--      any tenant member could.
--    * It hard-deleted ledger rows with a match ending in "OR true" (every leg of the
--      advance with that date and amount, including other repayments' legs). Ledger rows
--      cannot be deleted (prevent_locked_period_modifications), so the undo failed whenever
--      legs existed. It now voids exactly this repayment's two legs through void_transaction
--      (reversing entries dated today, history kept): the linked debit leg and the credit
--      leg written with it. Payroll-sourced repayments have no legs of their own here.
CREATE OR REPLACE FUNCTION public.delete_staff_advance_repayment(p_repayment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rep RECORD;
  v_leg RECORD;
  v_pair uuid;
  v_uid uuid := auth.uid();
  v_reason text := 'Advance repayment removed';
BEGIN
  SELECT * INTO v_rep FROM staff_advance_repayments WHERE id = p_repayment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repayment not found';
  END IF;

  PERFORM public.assert_tenant_access(v_rep.tenant_id);
  IF NOT (
    public.is_superadmin(v_uid)
    OR (public.has_role(v_uid, v_rep.restaurant_id, 'owner'::app_role)
        AND (v_rep.branch_id IS NULL OR public.user_can_access_branch(v_uid, v_rep.restaurant_id, v_rep.branch_id)))
  ) THEN
    RAISE EXCEPTION 'Only the restaurant owner can delete advance repayments' USING ERRCODE = '42501';
  END IF;

  IF v_rep.ledger_transaction_id IS NOT NULL THEN
    SELECT * INTO v_leg FROM account_transactions
    WHERE id = v_rep.ledger_transaction_id AND tenant_id = v_rep.tenant_id;
    IF FOUND AND NOT COALESCE(v_leg.is_voided, false) THEN
      PERFORM public.void_transaction(v_leg.id, v_reason);
    END IF;
    IF FOUND THEN
      -- The credit leg is inserted right after the debit leg, in the same transaction.
      SELECT id INTO v_pair FROM account_transactions
      WHERE tenant_id = v_rep.tenant_id
        AND reference_type = 'staff_advance_repayment'
        AND reference_id = v_rep.advance_id
        AND transaction_date = v_rep.repayment_date
        AND credit = v_rep.amount AND COALESCE(debit, 0) = 0
        AND created_at = v_leg.created_at
        AND id <> v_leg.id
        AND NOT COALESCE(is_voided, false)
        AND original_transaction_id IS NULL
      LIMIT 1;
      IF v_pair IS NOT NULL THEN
        PERFORM public.void_transaction(v_pair, v_reason);
      END IF;
    END IF;
  END IF;

  UPDATE staff_advances
  SET repaid_amount = GREATEST(COALESCE(repaid_amount, 0) - v_rep.amount, 0),
      status = CASE WHEN status = 'deducted' AND GREATEST(COALESCE(repaid_amount,0) - v_rep.amount, 0) < amount - 0.005 THEN 'pending' ELSE status END,
      deducted_at = CASE WHEN GREATEST(COALESCE(repaid_amount,0) - v_rep.amount, 0) < amount - 0.005 THEN NULL ELSE deducted_at END,
      updated_at = now()
  WHERE id = v_rep.advance_id;

  DELETE FROM staff_advance_repayments WHERE id = p_repayment_id;
END;
$function$;

-- 2) Storefront settings without the internal rider commission.
--    online_ordering_settings was readable by everyone (USING true), exposing
--    rider_commission_pct. Logged-out storefronts now read this view (owned by the
--    migration role, so it does not depend on the table's policies); the table itself is
--    readable by restaurant staff only, and owners/managers still manage it.
CREATE OR REPLACE VIEW public.storefront_settings WITH (security_barrier = true) AS
SELECT id, restaurant_id, accepting_orders, accept_delivery, accept_pickup, min_order_amount,
       delivery_fee_flat, delivery_fee_tiers, delivery_radius_km, prep_time_minutes,
       online_payment_enabled, storefront_message, created_at, updated_at
FROM public.online_ordering_settings;
REVOKE ALL ON public.storefront_settings FROM PUBLIC;
GRANT SELECT ON public.storefront_settings TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Public can view storefront settings" ON public.online_ordering_settings;
DROP POLICY IF EXISTS "Staff can view storefront settings" ON public.online_ordering_settings;
CREATE POLICY "Staff can view storefront settings" ON public.online_ordering_settings
  FOR SELECT TO authenticated USING (public.can_access_restaurant(restaurant_id));

-- 3) public_create_online_order also stores the rider commission, from server settings
--    (the storefront used to compute it in the browser and the function ignored it).
CREATE OR REPLACE FUNCTION public.public_create_online_order(p_payload jsonb, p_items jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_restaurant_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_order_type text;
  v_menu_item_id uuid;
  v_variant text;
  v_qty int;
  v_unit_price numeric;
  v_line_total numeric;
  v_items_total numeric := 0;
  v_delivery_fee numeric := 0;
  v_rider_pct numeric := 0;
  v_tax_rate numeric;
  v_gross numeric;
  v_subtotal numeric;
  v_tax numeric;
BEGIN
  v_restaurant_id := (p_payload->>'restaurant_id')::uuid;
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'restaurant_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = v_restaurant_id
      AND r.status = 'active'
      AND r.suspended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Restaurant not available';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Too many items';
  END IF;

  v_order_type := COALESCE(p_payload->>'order_type', 'pickup');

  -- Delivery fee is taken from server-side settings, never from the caller.
  IF v_order_type = 'delivery' THEN
    SELECT COALESCE(delivery_fee_flat, 0), COALESCE(rider_commission_pct, 0)
      INTO v_delivery_fee, v_rider_pct
    FROM public.online_ordering_settings
    WHERE restaurant_id = v_restaurant_id
    LIMIT 1;
    v_delivery_fee := COALESCE(v_delivery_fee, 0);
    v_rider_pct := COALESCE(v_rider_pct, 0);
  END IF;

  INSERT INTO public.online_orders (
    restaurant_id, channel, order_type, status,
    customer_name, customer_phone, customer_email,
    delivery_address, delivery_notes,
    subtotal, delivery_fee, tax, total,
    payment_method, payment_status, external_order_id
  ) VALUES (
    v_restaurant_id,
    COALESCE(p_payload->>'channel', 'direct'),
    v_order_type,
    'pending',
    COALESCE(NULLIF(p_payload->>'customer_name',''), 'Guest'),
    COALESCE(NULLIF(p_payload->>'customer_phone',''), ''),
    NULLIF(p_payload->>'customer_email',''),
    CASE WHEN p_payload ? 'delivery_address' THEN p_payload->'delivery_address' END,
    NULLIF(p_payload->>'delivery_notes',''),
    0, v_delivery_fee, 0, 0,
    COALESCE(p_payload->>'payment_method', 'cash'),
    'pending',
    NULLIF(p_payload->>'external_order_id','')
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_menu_item_id := NULLIF(v_item->>'menu_item_id','')::uuid;
    v_variant := NULLIF(v_item->>'variant','');
    v_qty := GREATEST(COALESCE((v_item->>'qty')::int, 1), 1);
    IF v_qty > 99 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;

    IF v_menu_item_id IS NULL THEN
      RAISE EXCEPTION 'Each item must reference a valid menu item';
    END IF;

    -- Authoritative price: ignores any caller-supplied unit_price/line_total.
    v_unit_price := public.resolve_menu_item_price(v_restaurant_id, v_menu_item_id, v_variant);
    IF v_unit_price IS NULL THEN
      RAISE EXCEPTION 'Menu item is unavailable for this restaurant';
    END IF;

    v_line_total := round(v_unit_price * v_qty, 2);
    v_items_total := v_items_total + v_line_total;

    INSERT INTO public.online_order_items (
      order_id, menu_item_id, name_snapshot, variant, qty, unit_price, line_total, notes
    )
    SELECT v_order_id, v_menu_item_id, mi.name, v_variant, v_qty, v_unit_price, v_line_total,
           NULLIF(v_item->>'notes','')
    FROM public.menu_items mi
    WHERE mi.id = v_menu_item_id;
  END LOOP;

  -- Menu prices are VAT-inclusive: gross is the payable total.
  SELECT COALESCE(b.vat_rate, 0.15) INTO v_tax_rate
  FROM public.branches b
  WHERE b.restaurant_id = v_restaurant_id
    AND b.deleted_at IS NULL
  ORDER BY b.is_primary DESC NULLS LAST, b.created_at ASC
  LIMIT 1;
  v_tax_rate := COALESCE(v_tax_rate, 0.15);
  IF v_tax_rate > 1 THEN
    v_tax_rate := v_tax_rate / 100.0;
  END IF;

  v_gross := round(v_items_total + v_delivery_fee, 2);
  v_subtotal := round(v_gross / (1 + v_tax_rate), 2);
  v_tax := round(v_gross - v_subtotal, 2);

  UPDATE public.online_orders
  SET subtotal = v_subtotal,
      tax = v_tax,
      total = v_gross,
      rider_commission = CASE WHEN v_rider_pct > 0 AND v_delivery_fee > 0
                              THEN round(v_delivery_fee * v_rider_pct / 100, 2) ELSE 0 END
  WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.public_create_online_order(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_create_online_order(jsonb, jsonb) TO anon, authenticated, service_role;
