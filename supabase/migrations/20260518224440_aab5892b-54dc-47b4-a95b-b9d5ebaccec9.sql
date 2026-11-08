-- Close branch-pin RLS gap on remaining branch_id-bearing tables.
-- These were missed in the original Phase 3 migration but contain
-- per-branch operational data that pinned staff should not see across branches.

ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_backfill_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Branch pin restriction" ON public.shift_templates;
CREATE POLICY "Branch pin restriction"
  ON public.shift_templates
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (branch_id IS NULL OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id))
  WITH CHECK (branch_id IS NULL OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id));

DROP POLICY IF EXISTS "Branch pin restriction" ON public.pos_backfill_entries;
CREATE POLICY "Branch pin restriction"
  ON public.pos_backfill_entries
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (branch_id IS NULL OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id))
  WITH CHECK (branch_id IS NULL OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id));