-- 1. Refine the batch branch validation: hard requirement for pending/unposted
CREATE OR REPLACE FUNCTION public.validate_journal_batch_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch_tenant uuid;
  v_active boolean;
  v_deleted timestamptz;
  v_candidates uuid[];
  v_is_pending boolean;
BEGIN
  v_is_pending := (NEW.approval_status = 'pending') OR COALESCE(NEW.is_posted, false) = false;

  IF NEW.branch_id IS NULL THEN
    SELECT array_agg(b.id ORDER BY b.is_primary DESC, b.created_at)
      INTO v_candidates
    FROM public.branches b
    JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE r.tenant_id = NEW.tenant_id
      AND b.is_active
      AND b.deleted_at IS NULL;

    IF v_candidates IS NOT NULL AND array_length(v_candidates, 1) = 1 THEN
      NEW.branch_id := v_candidates[1];
    ELSIF v_is_pending THEN
      RAISE EXCEPTION 'BRANCH_REQUIRED: journal entry "%" must specify a branch_id', NEW.description
        USING HINT = 'Select a branch before submitting the journal entry.';
    ELSE
      -- Automated, already-posted system batch with no resolvable branch
      -- (e.g. tenant-wide COGS true-ups): allow, stays consolidated-only.
      RETURN NEW;
    END IF;
  END IF;

  SELECT r.tenant_id, b.is_active, b.deleted_at
    INTO v_branch_tenant, v_active, v_deleted
  FROM public.branches b
  JOIN public.restaurants r ON r.id = b.restaurant_id
  WHERE b.id = NEW.branch_id;

  IF v_branch_tenant IS NULL THEN
    RAISE EXCEPTION 'BRANCH_INVALID: branch % does not exist', NEW.branch_id;
  END IF;

  IF v_branch_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'BRANCH_TENANT_MISMATCH: branch % belongs to another tenant', NEW.branch_id;
  END IF;

  IF COALESCE(v_active, false) = false OR v_deleted IS NOT NULL THEN
    -- Only block new work on a closed branch; historical rows may be re-touched.
    IF TG_OP = 'INSERT' OR NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      RAISE EXCEPTION 'BRANCH_INACTIVE: branch % is inactive or deleted', NEW.branch_id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.branch_id IS DISTINCT FROM OLD.branch_id
     AND (OLD.approval_status <> 'pending' OR COALESCE(OLD.is_posted, false)) THEN
    RAISE EXCEPTION 'BRANCH_LOCKED: cannot change the branch of an approved or posted journal entry';
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Day-end adjustment posting stamps the adjustment's branch
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
