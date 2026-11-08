-- Add explicit deny-all policy so RLS-enabled table has a policy. Service role bypasses RLS.
CREATE POLICY "No client access to payment webhook events"
ON public.payment_webhook_events
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);