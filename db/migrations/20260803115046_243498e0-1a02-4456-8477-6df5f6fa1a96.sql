ALTER TABLE public.daily_sales_summary
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);

UPDATE public.daily_sales_summary d
SET branch_id = public.get_primary_branch_id(d.restaurant_id)
WHERE d.branch_id IS NULL;

ALTER TABLE public.daily_sales_summary
  DROP CONSTRAINT IF EXISTS unique_daily_sales_per_restaurant;

CREATE UNIQUE INDEX IF NOT EXISTS unique_daily_sales_per_branch
  ON public.daily_sales_summary (restaurant_id, sales_date, branch_id);

CREATE INDEX IF NOT EXISTS idx_daily_sales_summary_branch
  ON public.daily_sales_summary (branch_id, sales_date);

DROP TRIGGER IF EXISTS trg_daily_sales_summary_branch ON public.daily_sales_summary;
CREATE TRIGGER trg_daily_sales_summary_branch
  BEFORE INSERT ON public.daily_sales_summary
  FOR EACH ROW EXECUTE FUNCTION public.auto_stamp_branch_id();

DROP POLICY IF EXISTS "Branch pin restriction" ON public.daily_sales_summary;
CREATE POLICY "Branch pin restriction"
  ON public.daily_sales_summary
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (branch_id IS NULL OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id))
  WITH CHECK (branch_id IS NULL OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id));