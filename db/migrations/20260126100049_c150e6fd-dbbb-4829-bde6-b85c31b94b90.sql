-- Fix suppliers table SELECT policy to only allow managers and owners
-- Currently allows all restaurant staff (including cashiers) to view sensitive supplier contact information

-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Users can view suppliers in their restaurant" ON public.suppliers;

-- Create new restrictive SELECT policy - only managers and owners can view suppliers
CREATE POLICY "Managers and owners can view suppliers" ON public.suppliers
FOR SELECT USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role) 
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);