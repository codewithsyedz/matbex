CREATE POLICY "SuperAdmins can view all branches"
ON public.branches FOR SELECT
TO authenticated
USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can insert branches"
ON public.branches FOR INSERT
TO authenticated
WITH CHECK (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can update branches"
ON public.branches FOR UPDATE
TO authenticated
USING (public.is_superadmin(auth.uid()))
WITH CHECK (public.is_superadmin(auth.uid()));