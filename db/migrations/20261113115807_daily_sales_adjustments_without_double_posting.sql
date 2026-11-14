-- daily_sales_adjustments_without_double_posting
--
-- A day-end adjustment on the daily-sales scope (Day-End screen, e.g. "unrecorded sales": cash
-- collected but not rung in POS) explains why the counted cash/card differ from the POS total.
-- End of Day posts the counted figures as sales with VAT (post_daily_sales_to_ledger), and the
-- adjustment ALSO posted DR 1000 Cash / CR 6999 Cash Over/Short: the same money twice. On the
-- production copy (Smoke Grill) that overstated Cash in Hand and profit by 285,194.64 SAR, June to
-- November 2026. Found in the CFO review of 2026-11-13.
--
-- Daily-sales adjustments are now recorded without a journal entry; shift and expense-day
-- adjustments (true cash over/short, not in End of Day) keep their Cash / 6999 entry. Reversing a
-- daily-sales adjustment records the reversal only. Past double postings are corrected by a draft
-- journal at cutover (server/scripts/cutover-ledger-fixes.mjs, CUTOVER-DEA) for the accountant.

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

  -- A daily-sales adjustment explains why the counted cash/card differ from POS. End of Day
  -- (post_daily_sales_to_ledger) posts those counted figures as sales with VAT, so the money is
  -- already in Cash on Hand and revenue: record the adjustment, make no journal entry.
  IF v_adj.scope = 'daily_sales' THEN
    UPDATE public.day_end_adjustments SET ledger_posted = true, ledger_batch_id = NULL WHERE id = p_adjustment_id;
    RETURN NULL;
  END IF;

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
