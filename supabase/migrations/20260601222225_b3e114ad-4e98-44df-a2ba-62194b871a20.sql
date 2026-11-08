
UPDATE storage.buckets SET public = true WHERE id = 'application-docs';

-- Tighten write policies on application-docs to service_role only;
-- the edge function will perform uploads with the service key after verifying
-- the applicant's email + application id.
DROP POLICY IF EXISTS "Applicants upload own application docs" ON storage.objects;
DROP POLICY IF EXISTS "Applicants delete own application docs" ON storage.objects;
DROP POLICY IF EXISTS "Applicants read own application docs" ON storage.objects;
-- SuperAdmin read policy is now redundant for this bucket (public), drop it
DROP POLICY IF EXISTS "SuperAdmins read all application docs" ON storage.objects;
