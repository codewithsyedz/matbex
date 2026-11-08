-- Add 'superadmin' to app_role enum
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'superadmin';

-- Add tenant management fields to restaurants table
ALTER TABLE public.restaurants 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free',
ADD COLUMN IF NOT EXISTS suspended_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS suspended_reason text;

-- Create index for status filtering
CREATE INDEX IF NOT EXISTS idx_restaurants_status ON public.restaurants(status);
CREATE INDEX IF NOT EXISTS idx_restaurants_plan ON public.restaurants(plan);

-- Create a superadmin_users table (not tied to any restaurant)
CREATE TABLE IF NOT EXISTS public.superadmin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

-- Enable RLS on superadmin_users
ALTER TABLE public.superadmin_users ENABLE ROW LEVEL SECURITY;

-- Create function to check if user is superadmin
CREATE OR REPLACE FUNCTION public.is_superadmin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.superadmin_users
    WHERE user_id = _user_id
  )
$$;

-- RLS policies for superadmin_users (only superadmins can view/manage)
CREATE POLICY "Superadmins can view superadmin users"
ON public.superadmin_users
FOR SELECT
USING (is_superadmin(auth.uid()));

CREATE POLICY "Superadmins can manage superadmin users"
ON public.superadmin_users
FOR ALL
USING (is_superadmin(auth.uid()));

-- Update restaurants RLS to allow superadmins to view all
CREATE POLICY "Superadmins can view all restaurants"
ON public.restaurants
FOR SELECT
USING (is_superadmin(auth.uid()));

-- Allow superadmins to update any restaurant
CREATE POLICY "Superadmins can update all restaurants"
ON public.restaurants
FOR UPDATE
USING (is_superadmin(auth.uid()));

-- Allow superadmins to view all user_roles for tenant management
CREATE POLICY "Superadmins can view all user roles"
ON public.user_roles
FOR SELECT
USING (is_superadmin(auth.uid()));

-- Allow superadmins to view all profiles for tenant management
CREATE POLICY "Superadmins can view all profiles"
ON public.profiles
FOR SELECT
USING (is_superadmin(auth.uid()));