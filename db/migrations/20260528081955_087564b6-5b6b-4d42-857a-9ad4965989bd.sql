
-- 1. Make chat-attachments bucket private
UPDATE storage.buckets SET public = false WHERE id = 'chat-attachments';

-- 2. Restrict onboarding-documents uploads to the uploader's own folder
DROP POLICY IF EXISTS "Authenticated users can upload onboarding documents" ON storage.objects;
CREATE POLICY "Users upload onboarding documents to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'onboarding-documents'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 3. Lock login_attempts inserts to service_role only
DROP POLICY IF EXISTS "System can insert login attempts" ON public.login_attempts;
CREATE POLICY "Only service role can insert login attempts"
ON public.login_attempts FOR INSERT
TO service_role
WITH CHECK (true);

-- 4. Fix demo_funnel_events INSERT policy to use profiles.tenant_id
DROP POLICY IF EXISTS "Insert own funnel events" ON public.demo_funnel_events;
CREATE POLICY "Insert own funnel events"
ON public.demo_funnel_events FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (
    SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()
  )
);
