-- Create team_invitations table to track invitation status
CREATE TABLE public.team_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invite_token UUID NOT NULL DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  invited_by UUID REFERENCES auth.users(id),
  invited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unique constraint to prevent duplicate pending invites
CREATE UNIQUE INDEX team_invitations_unique_pending ON public.team_invitations(email, restaurant_id) WHERE status = 'pending';

-- Enable RLS
ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view invitations for their restaurant
CREATE POLICY "Users can view invitations for their restaurant"
ON public.team_invitations
FOR SELECT
USING (
  public.is_superadmin(auth.uid()) OR
  public.can_access_restaurant(restaurant_id)
);

-- Policy: Owners and managers can create invitations
CREATE POLICY "Owners and managers can create invitations"
ON public.team_invitations
FOR INSERT
WITH CHECK (
  public.is_superadmin(auth.uid()) OR
  (public.can_access_restaurant(restaurant_id) AND 
   (public.has_role(auth.uid(), restaurant_id, 'owner') OR 
    public.has_role(auth.uid(), restaurant_id, 'manager')))
);

-- Policy: Owners can update invitations (cancel, etc.)
CREATE POLICY "Owners can update invitations"
ON public.team_invitations
FOR UPDATE
USING (
  public.is_superadmin(auth.uid()) OR
  (public.can_access_restaurant(restaurant_id) AND 
   public.has_role(auth.uid(), restaurant_id, 'owner'))
);

-- Policy: Owners can delete invitations
CREATE POLICY "Owners can delete invitations"
ON public.team_invitations
FOR DELETE
USING (
  public.is_superadmin(auth.uid()) OR
  (public.can_access_restaurant(restaurant_id) AND 
   public.has_role(auth.uid(), restaurant_id, 'owner'))
);

-- Add trigger for updated_at
CREATE TRIGGER update_team_invitations_updated_at
BEFORE UPDATE ON public.team_invitations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();