CREATE TABLE IF NOT EXISTS public.twilio_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  account_sid text,
  auth_token text,
  api_key_sid text,
  api_key_secret text,
  whatsapp_from text,
  messaging_service_sid text,
  status_callback_url text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.twilio_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their tenant twilio credentials"
ON public.twilio_credentials FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_tenant_roles utr
    WHERE utr.user_id = auth.uid()
      AND utr.tenant_id = twilio_credentials.tenant_id
      AND utr.role = 'owner'
  )
);

CREATE POLICY "Owners can insert their tenant twilio credentials"
ON public.twilio_credentials FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_tenant_roles utr
    WHERE utr.user_id = auth.uid()
      AND utr.tenant_id = twilio_credentials.tenant_id
      AND utr.role = 'owner'
  )
);

CREATE POLICY "Owners can update their tenant twilio credentials"
ON public.twilio_credentials FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_tenant_roles utr
    WHERE utr.user_id = auth.uid()
      AND utr.tenant_id = twilio_credentials.tenant_id
      AND utr.role = 'owner'
  )
);

CREATE POLICY "Owners can delete their tenant twilio credentials"
ON public.twilio_credentials FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_tenant_roles utr
    WHERE utr.user_id = auth.uid()
      AND utr.tenant_id = twilio_credentials.tenant_id
      AND utr.role = 'owner'
  )
);

CREATE TRIGGER twilio_credentials_updated_at
BEFORE UPDATE ON public.twilio_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();