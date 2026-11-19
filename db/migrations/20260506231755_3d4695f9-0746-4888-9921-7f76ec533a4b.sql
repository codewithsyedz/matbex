
-- ===========================================================================
-- Day End Adjustment Module
-- Lets users close a day/shift with a reason-tagged balancing JE for missing
-- entries (cash miscount, missing receipt, sync delay, etc.).
-- ===========================================================================

-- 1) Ensure a "Cash Over/Short" account (6999) exists for every tenant
INSERT INTO public.chart_of_accounts (
  tenant_id, account_code, account_name, account_type, is_active, description
)
SELECT t.id, '6999', 'Cash Over/Short', 'expense', true,
       'Auto-created for day-end adjustments and reconciliations'
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.account_code = '6999'
);

-- 2) Adjustment reason enum
DO $$ BEGIN
  CREATE TYPE public.day_end_adjustment_reason AS ENUM (
    'missing_receipt',
    'cash_miscount',
    'delivery_sync_delay',
    'refund_not_recorded',
    'missing_expense_entry',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.day_end_scope AS ENUM ('daily_sales','shift','expense_day');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Table
CREATE TABLE IF NOT EXISTS public.day_end_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  restaurant_id   uuid NOT NULL,
  scope           public.day_end_scope NOT NULL,
  scope_ref_id    uuid,                          -- daily_sales_summary.id, shift.id, NULL for expense_day
  business_date   date NOT NULL,
  reason          public.day_end_adjustment_reason NOT NULL,
  notes           text NOT NULL,
  amount          numeric(14,2) NOT NULL,        -- signed: + overage, - shortage
  ledger_posted   boolean NOT NULL DEFAULT false,
  ledger_batch_id uuid,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT day_end_adjustments_notes_min CHECK (length(btrim(notes)) >= 5)
);

CREATE INDEX IF NOT EXISTS idx_dea_tenant_date
  ON public.day_end_adjustments (tenant_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_dea_scope
  ON public.day_end_adjustments (scope, scope_ref_id);

ALTER TABLE public.day_end_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dea_select_tenant" ON public.day_end_adjustments;
CREATE POLICY "dea_select_tenant" ON public.day_end_adjustments
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "dea_insert_tenant" ON public.day_end_adjustments;
CREATE POLICY "dea_insert_tenant" ON public.day_end_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND created_by = auth.uid()
  );

-- No update / delete: immutable ledger principle.

-- 4) Posting function
CREATE OR REPLACE FUNCTION public.post_day_end_adjustment_to_ledger(p_adjustment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    tenant_id, batch_date, description, reference_number, entry_type,
    journal_type, created_by, is_posted, posted_at, posted_by
  ) VALUES (
    v_adj.tenant_id, v_adj.business_date, v_desc,
    'DEA-' || to_char(v_adj.business_date,'YYYYMMDD') || '-' || substr(p_adjustment_id::text,1,8),
    'adjustment', 'manual', v_adj.created_by, true, now(), v_adj.created_by
  ) RETURNING id INTO v_batch_id;

  IF v_adj.amount > 0 THEN
    -- Overage: extra cash on hand vs records => DR Cash, CR Cash Over/Short (reduces expense / income side)
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, created_by, batch_id)
    VALUES
      (v_adj.tenant_id, v_cash_id, v_adj.business_date, v_abs, v_desc, 'day_end_adjustment', p_adjustment_id, v_adj.created_by, v_batch_id);
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, created_by, batch_id)
    VALUES
      (v_adj.tenant_id, v_overshort_id, v_adj.business_date, v_abs, v_desc, 'day_end_adjustment', p_adjustment_id, v_adj.created_by, v_batch_id);
  ELSE
    -- Shortage: missing cash / unrecorded expense => DR Cash Over/Short, CR Cash
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, created_by, batch_id)
    VALUES
      (v_adj.tenant_id, v_overshort_id, v_adj.business_date, v_abs, v_desc, 'day_end_adjustment', p_adjustment_id, v_adj.created_by, v_batch_id);
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, created_by, batch_id)
    VALUES
      (v_adj.tenant_id, v_cash_id, v_adj.business_date, v_abs, v_desc, 'day_end_adjustment', v_adj.created_by, v_adj.created_by, v_batch_id);
  END IF;

  UPDATE public.day_end_adjustments
     SET ledger_posted = true, ledger_batch_id = v_batch_id
   WHERE id = p_adjustment_id;

  RETURN v_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_day_end_adjustment_to_ledger(uuid) TO authenticated;
