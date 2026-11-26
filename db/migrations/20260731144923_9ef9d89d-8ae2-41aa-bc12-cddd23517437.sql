DROP POLICY IF EXISTS dea_select_tenant ON public.day_end_adjustments;
DROP POLICY IF EXISTS dea_insert_tenant ON public.day_end_adjustments;

CREATE POLICY dea_select_branch_scoped
ON public.day_end_adjustments
FOR SELECT
TO authenticated
USING (
  tenant_id = get_user_tenant_id(auth.uid())
  AND public.user_can_access_branch(auth.uid(), restaurant_id, branch_id)
);

CREATE POLICY dea_insert_branch_scoped
ON public.day_end_adjustments
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = get_user_tenant_id(auth.uid())
  AND created_by = auth.uid()
  AND public.user_can_access_branch(auth.uid(), restaurant_id, branch_id)
);