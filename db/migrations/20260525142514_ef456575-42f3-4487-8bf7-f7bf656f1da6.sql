
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;

CREATE POLICY "Superadmins can read zatca audit seq"
  ON public.zatca_audit_seq FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Users can read own pending digest notifications"
  ON public.pending_digest_notifications FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()) OR user_id = auth.uid());
