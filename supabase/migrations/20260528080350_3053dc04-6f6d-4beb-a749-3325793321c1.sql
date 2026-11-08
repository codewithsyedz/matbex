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
        tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
      ) VALUES (
        NEW.id, auth.uid(), 'tenant.data_region.changed', 'tenant', NEW.id,
        jsonb_build_object(
          'data_region', OLD.data_region,
          'residency_locked', OLD.residency_locked
        ),
        jsonb_build_object(
          'data_region', NEW.data_region,
          'residency_locked', NEW.residency_locked
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;