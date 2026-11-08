
CREATE TABLE public.restaurant_notification_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','sms')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  UNIQUE (restaurant_id, channel)
);

CREATE INDEX idx_rnc_restaurant ON public.restaurant_notification_channels (restaurant_id);

ALTER TABLE public.restaurant_notification_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view restaurant channels"
ON public.restaurant_notification_channels FOR SELECT
TO authenticated
USING (restaurant_id = public.get_user_restaurant_id(auth.uid()));

CREATE POLICY "owners/managers insert restaurant channels"
ON public.restaurant_notification_channels FOR INSERT
TO authenticated
WITH CHECK (
  restaurant_id = public.get_user_restaurant_id(auth.uid())
  AND (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  )
);

CREATE POLICY "owners/managers update restaurant channels"
ON public.restaurant_notification_channels FOR UPDATE
TO authenticated
USING (
  restaurant_id = public.get_user_restaurant_id(auth.uid())
  AND (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  )
);

CREATE TRIGGER trg_rnc_updated_at
BEFORE UPDATE ON public.restaurant_notification_channels
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
