CREATE TABLE public.role_impersonation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  impersonated_role text NOT NULL CHECK (impersonated_role IN ('manager','accountant','cashier')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_role_impersonation_logs_tenant ON public.role_impersonation_logs(tenant_id, started_at DESC);
CREATE INDEX idx_role_impersonation_logs_owner ON public.role_impersonation_logs(owner_user_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.role_impersonation_logs TO authenticated;
GRANT ALL ON public.role_impersonation_logs TO service_role;

ALTER TABLE public.role_impersonation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their tenant impersonation logs"
ON public.role_impersonation_logs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_tenant_roles utr
    WHERE utr.user_id = auth.uid()
      AND utr.tenant_id = role_impersonation_logs.tenant_id
      AND utr.role = 'owner'
  )
);

CREATE POLICY "Owners can start impersonation sessions"
ON public.role_impersonation_logs
FOR INSERT
TO authenticated
WITH CHECK (
  owner_user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_tenant_roles utr
    WHERE utr.user_id = auth.uid()
      AND utr.tenant_id = role_impersonation_logs.tenant_id
      AND utr.role = 'owner'
  )
);

CREATE POLICY "Owners can end their own impersonation sessions"
ON public.role_impersonation_logs
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());