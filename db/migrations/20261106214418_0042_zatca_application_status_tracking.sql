ALTER TABLE public.zatca_provider_applications DROP CONSTRAINT IF EXISTS zatca_provider_applications_status_check;
ALTER TABLE public.zatca_provider_applications ADD CONSTRAINT zatca_provider_applications_status_check CHECK (status IN ('draft','ready','submitted','under_review','approved','rejected'));
ALTER TABLE public.zatca_provider_applications
  ADD COLUMN IF NOT EXISTS decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_reply text,
  ADD COLUMN IF NOT EXISTS reminder_days integer NOT NULL DEFAULT 14 CHECK (reminder_days BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE public.zatca_application_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.zatca_provider_applications(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  old_status text,
  new_status text NOT NULL,
  note text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.zatca_application_status_events TO authenticated;
GRANT ALL ON public.zatca_application_status_events TO service_role;
ALTER TABLE public.zatca_application_status_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read ZATCA status history" ON public.zatca_application_status_events
  FOR SELECT TO authenticated USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role));
CREATE INDEX zatca_app_status_events_app_idx ON public.zatca_application_status_events (application_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.log_zatca_application_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF NEW.status IN ('approved','rejected') AND NEW.decision_at IS NULL THEN NEW.decision_at := now(); END IF;
    INSERT INTO public.zatca_application_status_events (application_id, tenant_id, old_status, new_status, note, changed_by)
    VALUES (NEW.id, NEW.tenant_id, OLD.status, NEW.status, left(NEW.zatca_reply, 1000), auth.uid());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_log_zatca_application_status BEFORE UPDATE ON public.zatca_provider_applications
  FOR EACH ROW EXECUTE FUNCTION public.log_zatca_application_status();