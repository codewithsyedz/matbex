
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS data_region text NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS residency_locked boolean NOT NULL DEFAULT false;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_data_region_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_data_region_check
  CHECK (data_region IN ('global', 'ksa'));

CREATE INDEX IF NOT EXISTS idx_tenants_data_region ON public.tenants(data_region);

CREATE OR REPLACE FUNCTION public.guard_tenant_data_region()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.data_region IS DISTINCT FROM OLD.data_region)
       OR (NEW.residency_locked IS DISTINCT FROM OLD.residency_locked) THEN
      IF NOT public.is_superadmin(auth.uid()) THEN
        RAISE EXCEPTION 'Only SuperAdmins can change tenant data residency';
      END IF;
      IF OLD.residency_locked AND NEW.data_region IS DISTINCT FROM OLD.data_region THEN
        RAISE EXCEPTION 'Tenant residency is locked; unlock before changing region';
      END IF;
      INSERT INTO public.audit_logs (
        tenant_id, user_id, action, entity_type, entity_id, metadata
      ) VALUES (
        NEW.id, auth.uid(), 'tenant.data_region.changed', 'tenant', NEW.id,
        jsonb_build_object(
          'from', OLD.data_region, 'to', NEW.data_region,
          'locked_from', OLD.residency_locked, 'locked_to', NEW.residency_locked
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_tenant_data_region ON public.tenants;
CREATE TRIGGER trg_guard_tenant_data_region
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_tenant_data_region();
