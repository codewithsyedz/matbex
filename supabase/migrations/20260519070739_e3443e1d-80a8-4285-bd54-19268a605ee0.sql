
CREATE TABLE public.team_invitation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES public.team_invitations(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('sent','resent','failed','cancelled','accepted','expired','reminded')),
  actor_user_id UUID REFERENCES auth.users(id),
  actor_email TEXT,
  message TEXT,
  error_detail TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_invitation_events_invitation ON public.team_invitation_events(invitation_id, created_at DESC);
CREATE INDEX idx_team_invitation_events_restaurant ON public.team_invitation_events(restaurant_id, created_at DESC);

ALTER TABLE public.team_invitation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and managers can view invitation events"
ON public.team_invitation_events
FOR SELECT
USING (
  is_superadmin(auth.uid())
  OR (
    can_access_restaurant(restaurant_id)
    AND (
      has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    )
  )
);

CREATE POLICY "Owners and managers can log invitation events"
ON public.team_invitation_events
FOR INSERT
WITH CHECK (
  is_superadmin(auth.uid())
  OR (
    can_access_restaurant(restaurant_id)
    AND (
      has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    )
  )
);
