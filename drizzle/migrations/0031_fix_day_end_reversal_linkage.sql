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
  IF v_adj.tenant_id <> get_user_tenant_id(v_user) THEN
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

  IF NOT EXISTS (
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