
-- Schedule table
CREATE TABLE IF NOT EXISTS public.cogs_trueup_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly')),
  stocktake_kind TEXT NOT NULL CHECK (stocktake_kind IN ('daily','weekly')),
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  hour_of_day SMALLINT NOT NULL DEFAULT 2 CHECK (hour_of_day BETWEEN 0 AND 23),
  correct_wac BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  notify_user_ids UUID[] NOT NULL DEFAULT '{}',
  last_run_at TIMESTAMPTZ,
  last_run_id UUID,
  last_status TEXT,
  next_run_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, frequency, stocktake_kind)
);

CREATE INDEX IF NOT EXISTS idx_cogs_trueup_sched_due
  ON public.cogs_trueup_schedules (next_run_at) WHERE enabled = true;

ALTER TABLE public.cogs_trueup_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners/managers view trueup schedules"
ON public.cogs_trueup_schedules FOR SELECT
USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);

CREATE POLICY "Owners/managers manage trueup schedules"
ON public.cogs_trueup_schedules FOR ALL
USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);

CREATE TRIGGER trg_cogs_trueup_sched_updated
BEFORE UPDATE ON public.cogs_trueup_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Augment runs table
ALTER TABLE public.cogs_trueup_runs
  ADD COLUMN IF NOT EXISTS triggered_by TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES public.cogs_trueup_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ;

-- Helper: pick latest reconcilable stocktake for a restaurant + kind
CREATE OR REPLACE FUNCTION public.pick_latest_reconcilable_stocktake(
  _restaurant_id UUID,
  _kind TEXT
) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF _kind = 'weekly' THEN
    SELECT id INTO v_id FROM public.weekly_stocktakes
     WHERE restaurant_id = _restaurant_id
       AND status IN ('submitted','posted')
       AND NOT EXISTS (
         SELECT 1 FROM public.cogs_trueup_runs r
          WHERE r.stocktake_id = weekly_stocktakes.id AND r.stocktake_kind = 'weekly'
       )
     ORDER BY week_end_date DESC LIMIT 1;
  ELSE
    SELECT id INTO v_id FROM public.stocktakes
     WHERE restaurant_id = _restaurant_id
       AND status = 'completed'
       AND NOT EXISTS (
         SELECT 1 FROM public.cogs_trueup_runs r
          WHERE r.stocktake_id = stocktakes.id AND r.stocktake_kind = 'daily'
       )
     ORDER BY stocktake_date DESC LIMIT 1;
  END IF;
  RETURN v_id;
END $$;

-- Compute next_run_at on insert/update
CREATE OR REPLACE FUNCTION public.cogs_trueup_compute_next_run()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_base TIMESTAMPTZ; v_next TIMESTAMPTZ;
BEGIN
  v_base := COALESCE(NEW.last_run_at, now());
  IF NEW.frequency = 'daily' THEN
    v_next := date_trunc('day', v_base) + (NEW.hour_of_day || ' hours')::interval;
    IF v_next <= now() THEN v_next := v_next + interval '1 day'; END IF;
  ELSE
    v_next := date_trunc('day', v_base) + (NEW.hour_of_day || ' hours')::interval;
    -- advance to target dow
    WHILE EXTRACT(DOW FROM v_next)::int <> COALESCE(NEW.day_of_week, 1) OR v_next <= now() LOOP
      v_next := v_next + interval '1 day';
    END LOOP;
  END IF;
  NEW.next_run_at := v_next;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cogs_trueup_sched_next ON public.cogs_trueup_schedules;
CREATE TRIGGER trg_cogs_trueup_sched_next
BEFORE INSERT OR UPDATE OF frequency, day_of_week, hour_of_day, last_run_at, enabled
ON public.cogs_trueup_schedules
FOR EACH ROW EXECUTE FUNCTION public.cogs_trueup_compute_next_run();
