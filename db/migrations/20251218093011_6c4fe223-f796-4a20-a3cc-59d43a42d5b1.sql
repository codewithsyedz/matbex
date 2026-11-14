-- Drop and recreate the restaurants INSERT policy to be more explicit
DROP POLICY IF EXISTS "Users can create restaurants" ON public.restaurants;

CREATE POLICY "Users can create restaurants" 
ON public.restaurants 
FOR INSERT 
TO authenticated
WITH CHECK (true);