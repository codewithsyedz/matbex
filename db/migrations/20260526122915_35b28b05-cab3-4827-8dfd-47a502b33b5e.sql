-- Demo tenant flags
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tenant_type text NOT NULL DEFAULT 'PRODUCTION',
  ADD COLUMN IF NOT EXISTS allow_real_payments boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_exports boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_branches integer;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_tenant_type_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_tenant_type_check
  CHECK (tenant_type IN ('PRODUCTION', 'DEMO_ENTERPRISE'));

CREATE INDEX IF NOT EXISTS idx_tenants_tenant_type ON public.tenants(tenant_type);

-- Helper: is this tenant a demo?
CREATE OR REPLACE FUNCTION public.is_demo_tenant(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = _tenant_id AND tenant_type = 'DEMO_ENTERPRISE'
  );
$$;

-- In-place upgrade: demo → production (retains all data)
CREATE OR REPLACE FUNCTION public.activate_tenant_production(_tenant_id uuid)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.tenants;
BEGIN
  -- Only tenant owners or superadmins may activate
  IF NOT (public.is_superadmin(auth.uid())
          OR public.has_tenant_role(auth.uid(), _tenant_id, 'owner'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.tenants
  SET tenant_type = 'PRODUCTION',
      allow_real_payments = true,
      allow_exports = true,
      max_branches = NULL,
      status = 'active',
      trial_ends_at = NULL,
      updated_at = now()
  WHERE id = _tenant_id
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;