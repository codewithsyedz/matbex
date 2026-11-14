ALTER TABLE public.fine_violation_types
  ADD COLUMN IF NOT EXISTS requires_evidence boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.fine_evidence_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  fine_id uuid NOT NULL REFERENCES public.employee_fines(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  content_type text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fine_evidence_fine ON public.fine_evidence_attachments(fine_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fine_evidence_attachments TO authenticated;
GRANT ALL ON public.fine_evidence_attachments TO service_role;

ALTER TABLE public.fine_evidence_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View fine evidence"
ON public.fine_evidence_attachments FOR SELECT TO authenticated
USING (can_access_restaurant(restaurant_id));

CREATE POLICY "Managers manage fine evidence"
ON public.fine_evidence_attachments FOR ALL TO authenticated
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role))
WITH CHECK (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

CREATE TRIGGER trg_fine_evidence_updated_at
BEFORE UPDATE ON public.fine_evidence_attachments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enforce_fine_evidence_requirement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required boolean := false;
  v_count integer := 0;
BEGIN
  IF NEW.status NOT IN ('submitted','approved','applied') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(requires_evidence, false) INTO v_required
  FROM public.fine_violation_types
  WHERE id = NEW.violation_type_id;

  IF NOT COALESCE(v_required, false) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.fine_evidence_attachments
  WHERE fine_id = NEW.id;

  IF v_count = 0 AND COALESCE(NEW.evidence_path, '') = '' THEN
    RAISE EXCEPTION 'EVIDENCE_REQUIRED: This violation type requires at least one supporting evidence attachment before the fine can be submitted or approved.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_fine_evidence ON public.employee_fines;
CREATE CONSTRAINT TRIGGER trg_enforce_fine_evidence
AFTER INSERT OR UPDATE ON public.employee_fines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_fine_evidence_requirement();