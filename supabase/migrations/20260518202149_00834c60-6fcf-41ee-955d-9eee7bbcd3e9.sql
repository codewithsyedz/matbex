
-- Backfill workflow: queue POS daily totals for a branch that later goes live,
-- then reconcile against earlier manual EOD entries.

CREATE TABLE IF NOT EXISTS public.pos_backfill_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  business_date date NOT NULL,
  cash_amount numeric(12,2) NOT NULL DEFAULT 0,
  card_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) GENERATED ALWAYS AS (cash_amount + card_amount) STORED,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','csv')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','reconciled','discarded')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  reconciled_by uuid,
  adjustment_cash numeric(12,2),
  adjustment_card numeric(12,2),
  adjustment_receipt_prefix text,
  CONSTRAINT pos_backfill_amounts_nonneg CHECK (cash_amount >= 0 AND card_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_pos_backfill_branch_date
  ON public.pos_backfill_entries (restaurant_id, branch_id, business_date);
CREATE INDEX IF NOT EXISTS idx_pos_backfill_status
  ON public.pos_backfill_entries (restaurant_id, status);

ALTER TABLE public.pos_backfill_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View backfill in restaurant"
  ON public.pos_backfill_entries FOR SELECT
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Insert backfill in restaurant"
  ON public.pos_backfill_entries FOR INSERT
  WITH CHECK (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Owners/managers update backfill"
  ON public.pos_backfill_entries FOR UPDATE
  USING (
    public.has_role(auth.uid(), restaurant_id, 'owner'::public.app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::public.app_role)
  );

CREATE POLICY "Owners delete backfill"
  ON public.pos_backfill_entries FOR DELETE
  USING (public.has_role(auth.uid(), restaurant_id, 'owner'::public.app_role));
