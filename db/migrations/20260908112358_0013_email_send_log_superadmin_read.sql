GRANT SELECT ON public.email_send_log TO authenticated;

DROP POLICY IF EXISTS "Superadmins can read send log" ON public.email_send_log;
CREATE POLICY "Superadmins can read send log"
ON public.email_send_log
FOR SELECT
TO authenticated
USING (public.is_superadmin(auth.uid()));