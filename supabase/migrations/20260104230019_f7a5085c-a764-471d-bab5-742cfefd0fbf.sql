-- Add accepted_by_user_id column to team_invitations
ALTER TABLE public.team_invitations 
ADD COLUMN IF NOT EXISTS accepted_by_user_id UUID REFERENCES auth.users(id);