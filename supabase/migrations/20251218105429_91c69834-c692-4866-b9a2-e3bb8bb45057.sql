-- Drop the security definer view and recreate as regular view
DROP VIEW IF EXISTS public.superadmin_audit_events_view;

-- The view doesn't need special privileges - RLS on the base table is sufficient
-- Users who can't access superadmin_audit_events won't be able to query this view either