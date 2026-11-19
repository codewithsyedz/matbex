
CREATE TABLE IF NOT EXISTS public.account_branch_visibility (
  account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (account_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_abv_account ON public.account_branch_visibility(account_id);
CREATE INDEX IF NOT EXISTS idx_abv_branch  ON public.account_branch_visibility(branch_id);
CREATE INDEX IF NOT EXISTS idx_abv_tenant  ON public.account_branch_visibility(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_branch_visibility TO authenticated;
GRANT ALL ON public.account_branch_visibility TO service_role;

ALTER TABLE public.account_branch_visibility ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abv_select_tenant_members"
  ON public.account_branch_visibility FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "abv_write_owner_manager"
  ON public.account_branch_visibility FOR ALL
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.tenant_has_role(public.get_user_tenant_id(auth.uid()), 'manager')
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.tenant_has_role(public.get_user_tenant_id(auth.uid()), 'manager')
  );

CREATE OR REPLACE FUNCTION public.is_account_visible_for_branch(
  _account_id uuid,
  _branch_id  uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _branch_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.account_branch_visibility WHERE account_id = _account_id
    )
    OR EXISTS (
      SELECT 1 FROM public.account_branch_visibility
      WHERE account_id = _account_id AND branch_id = _branch_id
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_account_visible_for_branch(uuid, uuid) TO authenticated, anon, service_role;
