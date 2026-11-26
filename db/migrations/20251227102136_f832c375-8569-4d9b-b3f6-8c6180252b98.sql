-- Add user_id to staff table to link staff members to user accounts
ALTER TABLE public.staff
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;