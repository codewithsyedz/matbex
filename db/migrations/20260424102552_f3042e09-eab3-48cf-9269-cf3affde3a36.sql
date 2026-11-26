CREATE TABLE IF NOT EXISTS public.coa_audit_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  day_of_week SMALLINT NOT NULL DEFAULT 1 CHECK (day_of_week BETWEEN 0 AND 6),
  send_time TIME NOT NULL DEFAULT '09:00:00',
  include_owners_managers BOOLEAN NOT NULL DEFAULT true,
  extra_recipients TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

ALTER TABLE public.coa_audit_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and managers can view their CoA audit schedule"
ON public.coa_audit_schedules FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id = coa_audit_schedules.restaurant_id
      AND ur.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Owners and managers can insert their CoA audit schedule"
ON public.coa_audit_schedules FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id = coa_audit_schedules.restaurant_id
      AND ur.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Owners and managers can update their CoA audit schedule"
ON public.coa_audit_schedules FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id = coa_audit_schedules.restaurant_id
      AND ur.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Owners and managers can delete their CoA audit schedule"
ON public.coa_audit_schedules FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id = coa_audit_schedules.restaurant_id
      AND ur.role IN ('owner', 'manager')
  )
);

CREATE TRIGGER update_coa_audit_schedules_updated_at
BEFORE UPDATE ON public.coa_audit_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();