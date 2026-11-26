
-- Create an RPC to securely return owner emails for a tenant
-- This function uses SECURITY DEFINER to access auth.users
CREATE OR REPLACE FUNCTION public.get_tenant_owner_emails(p_tenant_id UUID)
RETURNS TABLE(email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT au.email::TEXT
  FROM public.user_tenant_roles utr
  JOIN auth.users au ON au.id = utr.user_id
  WHERE utr.tenant_id = p_tenant_id
    AND utr.role = 'owner';
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_tenant_owner_emails(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_owner_emails(UUID) TO anon;
