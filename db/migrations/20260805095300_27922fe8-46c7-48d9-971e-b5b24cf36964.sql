CREATE OR REPLACE FUNCTION public.enforce_fine_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[];
  v_is_approver boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_allowed := CASE OLD.status
      WHEN 'draft'        THEN ARRAY['submitted','cancelled']
      WHEN 'submitted'    THEN ARRAY['under_review','approved','rejected','cancelled']
      WHEN 'under_review' THEN ARRAY['approved','rejected','cancelled']
      WHEN 'approved'     THEN ARRAY['applied','cancelled']
      WHEN 'rejected'     THEN ARRAY['draft','cancelled']
      WHEN 'applied'      THEN ARRAY['cancelled']
      WHEN 'cancelled'    THEN ARRAY[]::text[]
      ELSE ARRAY[]::text[]
    END;

    IF NOT (NEW.status = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'INVALID_FINE_TRANSITION: A fine cannot move from % to %.', OLD.status, NEW.status;
    END IF;

    IF NEW.status IN ('under_review','approved','rejected') THEN
      v_is_approver := public.has_role(auth.uid(), 'owner')
                    OR public.has_role(auth.uid(), 'manager')
                    OR public.has_role(auth.uid(), 'accountant')
                    OR public.has_role(auth.uid(), 'superadmin')
                    OR auth.uid() IS NULL;
      IF NOT v_is_approver THEN
        RAISE EXCEPTION 'FINE_APPROVAL_FORBIDDEN: Only owners, managers or accountants can review, approve or reject fines.';
      END IF;
    END IF;

    IF NEW.status = 'approved'
       AND auth.uid() IS NOT NULL
       AND OLD.created_by = auth.uid()
       AND NOT public.has_role(auth.uid(), 'owner') THEN
      RAISE EXCEPTION 'FINE_SELF_APPROVAL_FORBIDDEN: You cannot approve a fine you created. Ask another approver to review it.';
    END IF;

    IF NEW.status = 'rejected' AND COALESCE(btrim(NEW.rejection_reason), '') = '' THEN
      RAISE EXCEPTION 'REJECTION_REASON_REQUIRED: A written reason is mandatory when rejecting a fine.';
    END IF;

    IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN NEW.submitted_at := now(); END IF;
    IF NEW.status = 'under_review' AND NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
      NEW.reviewed_by := COALESCE(NEW.reviewed_by, auth.uid());
    END IF;
    IF NEW.status = 'approved' THEN
      NEW.approved_at := COALESCE(NEW.approved_at, now());
      NEW.approved_by := COALESCE(NEW.approved_by, auth.uid());
    END IF;
    IF NEW.status = 'draft' THEN
      NEW.submitted_at := NULL; NEW.reviewed_at := NULL; NEW.reviewed_by := NULL;
      NEW.approved_at := NULL; NEW.approved_by := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_fine_status_transition ON public.employee_fines;
CREATE TRIGGER trg_enforce_fine_status_transition
BEFORE UPDATE ON public.employee_fines
FOR EACH ROW EXECUTE FUNCTION public.enforce_fine_status_transition();