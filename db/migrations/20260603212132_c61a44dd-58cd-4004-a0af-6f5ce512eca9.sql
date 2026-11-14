DROP POLICY IF EXISTS "Authenticated can read feature flags" ON public.feature_flags;
CREATE POLICY "Authenticated can read feature flags" ON public.feature_flags
FOR SELECT
TO authenticated
USING (true);