
ALTER TABLE public.day_end_adjustments
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversed_adjustment_id uuid REFERENCES public.day_end_adjustments(id),
  ADD COLUMN IF NOT EXISTS reversal_of_id uuid REFERENCES public.day_end_adjustments(id);

CREATE INDEX IF NOT EXISTS idx_dea_reversal_of ON public.day_end_adjustments(reversal_of_id);

CREATE OR REPLACE FUNCTION public.reverse_day_end_adjustment(
  p_adjustment_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_adj            RECORD;
  v_user           uuid := auth.uid();
  v_cash_id        uuid;
  v_overshort_id   uuid;
  v_batch_id       uuid;
  v_new_adj_id     uuid;
  v_abs            numeric(14,2);
  v_desc           text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Reversal reason must be at least 10 characters';
  END IF;

  SELECT * INTO v_adj
    FROM public.day_end_adjustments
   WHERE id = p_adjustment_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Day-end adjustment not found'; END IF;

  -- Tenant + permission check
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
  IF v_adj.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This adjustment has already been reversed';
  END IF;
  IF v_adj.reversal_of_id IS NOT NULL THEN
    RAISE EXCEPTION 'A reversal entry cannot itself be reversed';
  END IF;

  SELECT id INTO v_cash_id FROM public.chart_of_accounts
   WHERE tenant_id = v_adj.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
  SELECT id INTO v_overshort_id FROM public.chart_of_accounts
   WHERE tenant_id = v_adj.tenant_id AND account_code = '6999' AND is_active = true LIMIT 1;
  IF v_cash_id IS NULL OR v_overshort_id IS NULL THEN
    RAISE EXCEPTION 'Cash (1000) or Cash Over/Short (6999) account missing';
  END IF;

  v_abs := abs(v_adj.amount);
  v_desc := 'REVERSAL of Day-End Adjustment [' || v_adj.reason::text || ']: ' || p_reason;

  -- Create the mirrored adjustment record (amount sign flipped)
  INSERT INTO public.day_end_adjustments (
    tenant_id, restaurant_id, scope, scope_ref_id, business_date,
    reason, notes, amount, ledger_posted, created_by, reversal_of_id
  ) VALUES (
    v_adj.tenant_id, v_adj.restaurant_id, v_adj.scope, v_adj.scope_ref_id, v_adj.business_date,
    v_adj.reason, ('REVERSAL: ' || p_reason), (v_adj.amount * -1), false, v_user, v_adj.id
  ) RETURNING id INTO v_new_adj_id;

  -- Build the reversing journal batch (opposite legs of the original)
  INSERT INTO public.journal_entry_batches (
    tenant_id, batch_date, description, reference_number, entry_type,
    journal_type, created_by, is_posted, posted_at, posted_by
  ) VALUES (
    v_adj.tenant_id, current_date, v_desc,
    'DEA-REV-' || to_char(now(),'YYYYMMDD') || '-' || substr(v_new_adj_id::text,1,8),
    'adjustment', 'reversal', v_user, true, now(), v_user
  ) RETURNING id INTO v_batch_id;

  IF v_adj.amount > 0 THEN
    -- Original was overage (DR Cash, CR Over/Short) -> reverse: DR Over/Short, CR Cash
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, created_by, batch_id, original_transaction_id)
    VALUES
      (v_adj.tenant_id, v_overshort_id, current_date, v_abs, v_desc, 'day_end_adjustment_reversal', v_new_adj_id, v_user, v_batch_id, NULL);
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, created_by, batch_id)
    VALUES
      (v_adj.tenant_id, v_cash_id, current_date, v_abs, v_desc, 'day_end_adjustment_reversal', v_new_adj_id, v_user, v_batch_id);
  ELSE
    -- Original was shortage -> reverse: DR Cash, CR Over/Short
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, created_by, batch_id)
    VALUES
      (v_adj.tenant_id, v_cash_id, current_date, v_abs, v_desc, 'day_end_adjustment_reversal', v_new_adj_id, v_user, v_batch_id);
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, created_by, batch_id)
    VALUES
      (v_adj.tenant_id, v_overshort_id, current_date, v_abs, v_desc, 'day_end_adjustment_reversal', v_new_adj_id, v_user, v_batch_id);
  END IF;

  -- Link new reversal back into the original adjustment row + audit fields
  UPDATE public.day_end_adjustments
     SET ledger_posted = true,
         ledger_batch_id = v_batch_id
   WHERE id = v_new_adj_id;

  UPDATE public.day_end_adjustments
     SET reversed_at = now(),
         reversed_by = v_user,
         reversal_reason = p_reason,
         reversed_adjustment_id = v_new_adj_id
   WHERE id = p_adjustment_id;

  RETURN v_new_adj_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reverse_day_end_adjustment(uuid, text) TO authenticated;
