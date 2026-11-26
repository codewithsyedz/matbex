
CREATE TABLE public.notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  template_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  subject TEXT,
  body TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,
  UNIQUE (restaurant_id, template_key, channel)
);

CREATE INDEX idx_notif_tmpl_rest_key ON public.notification_templates (restaurant_id, template_key);

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view restaurant templates"
ON public.notification_templates FOR SELECT
TO authenticated
USING (restaurant_id = public.get_user_restaurant_id(auth.uid()));

CREATE POLICY "owners/managers insert restaurant templates"
ON public.notification_templates FOR INSERT
TO authenticated
WITH CHECK (
  restaurant_id = public.get_user_restaurant_id(auth.uid())
  AND (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  )
);

CREATE POLICY "owners/managers update restaurant templates"
ON public.notification_templates FOR UPDATE
TO authenticated
USING (
  restaurant_id = public.get_user_restaurant_id(auth.uid())
  AND (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  )
);

CREATE POLICY "owners delete restaurant templates"
ON public.notification_templates FOR DELETE
TO authenticated
USING (
  restaurant_id = public.get_user_restaurant_id(auth.uid())
  AND public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
);

CREATE TRIGGER trg_notif_tmpl_updated_at
BEFORE UPDATE ON public.notification_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
