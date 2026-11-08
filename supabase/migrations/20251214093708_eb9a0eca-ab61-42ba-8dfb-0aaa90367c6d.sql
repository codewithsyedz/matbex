-- Allow authenticated users to create restaurants (for onboarding)
CREATE POLICY "Users can create restaurants"
ON public.restaurants FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to create their own roles (for onboarding)
CREATE POLICY "Users can create their own roles"
ON public.user_roles FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());