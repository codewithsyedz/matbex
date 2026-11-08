-- Create staff_types table for custom staff roles
CREATE TABLE public.staff_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, name)
);

-- Enable RLS
ALTER TABLE public.staff_types ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view staff types in their restaurant"
ON public.staff_types FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage staff types"
ON public.staff_types FOR ALL
USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

-- Change staff.role from enum to text
ALTER TABLE public.staff ALTER COLUMN role TYPE TEXT USING role::TEXT;

-- Drop the enum type (no longer needed)
DROP TYPE IF EXISTS public.staff_role;