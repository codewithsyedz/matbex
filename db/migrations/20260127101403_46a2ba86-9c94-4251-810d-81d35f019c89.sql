-- Allow anyone (including anonymous users) to view active plans for registration
CREATE POLICY "Anyone can view active plans" 
ON public.plans 
FOR SELECT 
USING (is_active = true);