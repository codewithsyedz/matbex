
-- Add management columns
ALTER TABLE public.contact_messages
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','archived')),
  ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handled_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- Allow SuperAdmins to update / delete
DROP POLICY IF EXISTS "SuperAdmins can update contact messages" ON public.contact_messages;
CREATE POLICY "SuperAdmins can update contact messages"
  ON public.contact_messages FOR UPDATE TO authenticated
  USING (is_superadmin(auth.uid()))
  WITH CHECK (is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "SuperAdmins can delete contact messages" ON public.contact_messages;
CREATE POLICY "SuperAdmins can delete contact messages"
  ON public.contact_messages FOR DELETE TO authenticated
  USING (is_superadmin(auth.uid()));

GRANT UPDATE, DELETE ON public.contact_messages TO authenticated;

-- Brute-force / spam guard: max 3 submissions per email per 10 minutes,
-- and max 10 submissions per hour from anywhere (global flood guard).
CREATE OR REPLACE FUNCTION public.contact_messages_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  per_email_count INT;
  global_count    INT;
BEGIN
  SELECT count(*) INTO per_email_count
  FROM public.contact_messages
  WHERE lower(email) = lower(NEW.email)
    AND created_at > now() - interval '10 minutes';

  IF per_email_count >= 3 THEN
    RAISE EXCEPTION 'Too many messages from this email. Please try again later.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO global_count
  FROM public.contact_messages
  WHERE created_at > now() - interval '1 minute';

  IF global_count >= 20 THEN
    RAISE EXCEPTION 'The contact form is temporarily rate-limited. Please retry shortly.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_messages_rate_limit ON public.contact_messages;
CREATE TRIGGER trg_contact_messages_rate_limit
  BEFORE INSERT ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.contact_messages_rate_limit();

CREATE INDEX IF NOT EXISTS idx_contact_messages_email_created
  ON public.contact_messages (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status_created
  ON public.contact_messages (status, created_at DESC);
