CREATE TABLE public.enquiry_form_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL CHECK (event IN ('view','start','submit','error')),
  path TEXT,
  referrer TEXT,
  language TEXT,
  device TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_enquiry_form_events_created_at ON public.enquiry_form_events (created_at DESC);
CREATE INDEX idx_enquiry_form_events_event ON public.enquiry_form_events (event);

GRANT INSERT ON public.enquiry_form_events TO anon;
GRANT INSERT, SELECT ON public.enquiry_form_events TO authenticated;
GRANT ALL ON public.enquiry_form_events TO service_role;

ALTER TABLE public.enquiry_form_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can record enquiry form events"
ON public.enquiry_form_events FOR INSERT TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Super admins can read enquiry form events"
ON public.enquiry_form_events FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'));
