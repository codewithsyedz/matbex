
CREATE TABLE public.owner_whatsapp_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  phone_e164 text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  opted_in_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  last_sent_ymd date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, user_id),
  CONSTRAINT phone_e164_format CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);

CREATE INDEX idx_ows_restaurant ON public.owner_whatsapp_subscriptions(restaurant_id) WHERE enabled = true;
CREATE INDEX idx_ows_user ON public.owner_whatsapp_subscriptions(user_id);

ALTER TABLE public.owner_whatsapp_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners view own whatsapp sub"
ON public.owner_whatsapp_subscriptions FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND restaurant_id = public.get_user_restaurant_id(auth.uid())
);

CREATE POLICY "owners insert own whatsapp sub"
ON public.owner_whatsapp_subscriptions FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND restaurant_id = public.get_user_restaurant_id(auth.uid())
  AND (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  )
);

CREATE POLICY "owners update own whatsapp sub"
ON public.owner_whatsapp_subscriptions FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND restaurant_id = public.get_user_restaurant_id(auth.uid())
)
WITH CHECK (
  user_id = auth.uid()
  AND restaurant_id = public.get_user_restaurant_id(auth.uid())
);

CREATE POLICY "owners delete own whatsapp sub"
ON public.owner_whatsapp_subscriptions FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  AND restaurant_id = public.get_user_restaurant_id(auth.uid())
);

CREATE TRIGGER trg_ows_updated_at
BEFORE UPDATE ON public.owner_whatsapp_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
