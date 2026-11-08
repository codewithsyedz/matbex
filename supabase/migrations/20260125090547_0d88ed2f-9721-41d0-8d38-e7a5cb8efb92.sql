-- Remove the public SELECT policy that exposes pricing to everyone
DROP POLICY IF EXISTS "Anyone can view active plans" ON public.plans;

-- Superadmins already have full access via existing "Superadmins can manage plans" policy
-- No additional policy needed - only superadmins can now view/manage plans