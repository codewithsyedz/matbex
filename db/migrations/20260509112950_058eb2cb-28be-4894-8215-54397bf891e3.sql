
-- =========================================================================
-- 1. Reverse the two duplicate day_end_adjustments for daily_sales
--    a606e131-0a22-4d20-8091-59a34121d41e on 2026-05-07
-- =========================================================================
DO $$
DECLARE
  v_dup_ids uuid[] := ARRAY[
    '7e392c3e-037e-4493-9461-214f4dd6c1c2'::uuid,
    'a7c7229b-e9df-4259-8f2f-c6e08e687e30'::uuid
  ];
  v_id uuid;
  v_adj RECORD;
  v_cash_id uuid;
  v_overshort_id uuid;
  v_batch_id uuid;
  v_new_adj_id uuid;
  v_abs numeric(14,2);
  v_desc text;
  v_actor uuid;
BEGIN
  FOREACH v_id IN ARRAY v_dup_ids LOOP
    SELECT * INTO v_adj FROM public.day_end_adjustments WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_adj.reversed_at IS NOT NULL THEN CONTINUE; END IF;

    v_actor := v_adj.created_by;

    SELECT id INTO v_cash_id FROM public.chart_of_accounts
      WHERE tenant_id = v_adj.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
    SELECT id INTO v_overshort_id FROM public.chart_of_accounts
      WHERE tenant_id = v_adj.tenant_id AND account_code = '6999' AND is_active = true LIMIT 1;
    IF v_cash_id IS NULL OR v_overshort_id IS NULL THEN
      RAISE EXCEPTION 'Cash (1000) or Cash Over/Short (6999) account missing for tenant %', v_adj.tenant_id;
    END IF;

    v_abs := abs(v_adj.amount);
    v_desc := 'REVERSAL of duplicate Day-End Adjustment ['
              || v_adj.reason::text || ']: cleanup of accidental duplicate post (kept one of three identical entries).';

    -- Mirrored adjustment record (sign flipped, marked as reversal)
    INSERT INTO public.day_end_adjustments (
      tenant_id, restaurant_id, scope, scope_ref_id, business_date,
      reason, notes, amount, ledger_posted, created_by, reversal_of_id
    ) VALUES (
      v_adj.tenant_id, v_adj.restaurant_id, v_adj.scope, v_adj.scope_ref_id, v_adj.business_date,
      v_adj.reason, ('REVERSAL (duplicate cleanup): ' || COALESCE(v_adj.notes, '')),
      (v_adj.amount * -1), false, v_actor, v_adj.id
    ) RETURNING id INTO v_new_adj_id;

    -- Reversing journal batch
    INSERT INTO public.journal_entry_batches (
      tenant_id, batch_date, description, reference_number, entry_type,
      journal_type, created_by, is_posted, posted_at, posted_by
    ) VALUES (
      v_adj.tenant_id, current_date, v_desc,
      'DEA-REV-' || to_char(now(),'YYYYMMDD') || '-' || substr(v_new_adj_id::text,1,8),
      'adjustment', 'reversal', v_actor, true, now(), v_actor
    ) RETURNING id INTO v_batch_id;

    IF v_adj.amount > 0 THEN
      -- Original overage (DR Cash, CR Over/Short) -> reverse: DR Over/Short, CR Cash
      INSERT INTO public.account_transactions
        (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, created_by, batch_id)
      VALUES
        (v_adj.tenant_id, v_overshort_id, current_date, v_abs, v_desc, 'day_end_adjustment_reversal', v_new_adj_id, v_actor, v_batch_id);
      INSERT INTO public.account_transactions
        (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, created_by, batch_id)
      VALUES
        (v_adj.tenant_id, v_cash_id, current_date, v_abs, v_desc, 'day_end_adjustment_reversal', v_new_adj_id, v_actor, v_batch_id);
    ELSE
      INSERT INTO public.account_transactions
        (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, created_by, batch_id)
      VALUES
        (v_adj.tenant_id, v_cash_id, current_date, v_abs, v_desc, 'day_end_adjustment_reversal', v_new_adj_id, v_actor, v_batch_id);
      INSERT INTO public.account_transactions
        (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, created_by, batch_id)
      VALUES
        (v_adj.tenant_id, v_overshort_id, current_date, v_abs, v_desc, 'day_end_adjustment_reversal', v_new_adj_id, v_actor, v_batch_id);
    END IF;

    -- Mark original as reversed
    UPDATE public.day_end_adjustments
       SET reversed_at = now(),
           reversed_by = v_actor,
           reversal_reason = 'Duplicate post cleanup - three identical adjustments were posted in error; one kept, two reversed.'
     WHERE id = v_adj.id;
  END LOOP;
END $$;

-- =========================================================================
-- 2. Trigger: prevent inserting a new (non-reversal) day-end adjustment
--    when an active unreversed one already exists for same
--    scope + scope_ref_id + business_date.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.prevent_duplicate_day_end_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow reversal entries themselves through
  IF NEW.reversal_of_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.day_end_adjustments a
     WHERE a.scope = NEW.scope
       AND a.scope_ref_id IS NOT DISTINCT FROM NEW.scope_ref_id
       AND a.business_date = NEW.business_date
       AND a.tenant_id = NEW.tenant_id
       AND a.reversed_at IS NULL
       AND a.reversal_of_id IS NULL
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: An active day-end adjustment already exists for this business date. Reverse it first before posting a new one.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_day_end_adjustment ON public.day_end_adjustments;
CREATE TRIGGER trg_prevent_duplicate_day_end_adjustment
  BEFORE INSERT ON public.day_end_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_day_end_adjustment();
