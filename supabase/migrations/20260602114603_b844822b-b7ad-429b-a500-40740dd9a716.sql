CREATE TABLE IF NOT EXISTS public.client_errors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  user_id uuid,
  route text,
  release text,
  user_agent text,
  error_name text,
  error_message text,
  error_stack text,
  context jsonb,
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('warning','error','fatal'))
);

CREATE INDEX IF NOT EXISTS idx_client_errors_tenant_time ON public.client_errors(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_errors_occurred_at ON public.client_errors(occurred_at DESC);

GRANT INSERT ON public.client_errors TO anon, authenticated;
GRANT SELECT ON public.client_errors TO authenticated;
GRANT ALL ON public.client_errors TO service_role;

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can log a client error"
  ON public.client_errors
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Owners/managers can read errors for their own tenant.
-- has_role is scoped per-restaurant; we check that the caller has owner/manager
-- on ANY restaurant within the same tenant.
CREATE POLICY "Owners and managers can read tenant client errors"
  ON public.client_errors
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('owner'::app_role, 'manager'::app_role)
    )
  );