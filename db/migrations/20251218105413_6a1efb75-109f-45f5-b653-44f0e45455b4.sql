-- Create enum for SuperAdmin action types
CREATE TYPE public.superadmin_action_type AS ENUM (
  -- Tenant & lifecycle
  'TENANT_CREATE',
  'TENANT_STATUS_CHANGE',
  'TENANT_DELETE',
  'PLAN_CHANGE',
  'FEATURE_TOGGLE',
  'BILLING_CHANGE',
  -- Security & access
  'USER_ROLE_CHANGE',
  'USER_CREATE',
  'USER_DELETE',
  'PASSWORD_RESET_FORCE',
  'MFA_RESET_FORCE',
  'IMPERSONATION_START',
  'IMPERSONATION_END',
  'ACCOUNT_UNLOCK',
  'SESSION_REVOKE',
  -- Data & configuration
  'BULK_DATA_DELETE',
  'BULK_DATA_IMPORT',
  'RLS_POLICY_CHANGE',
  'SECURITY_SETTING_CHANGE',
  'GLOBAL_CONFIG_CHANGE',
  -- Export & compliance
  'DATA_EXPORT',
  'DATA_EXPORT_APPROVE',
  'DATA_EXPORT_REJECT',
  'RETENTION_POLICY_CHANGE',
  'API_TOKEN_CREATE',
  'API_TOKEN_REVOKE',
  'AUDIT_LOG_EXPORT',
  'WEBHOOK_CONFIG_CHANGE',
  -- Other
  'OTHER'
);

-- Create enum for target types
CREATE TYPE public.audit_target_type AS ENUM (
  'tenant',
  'user',
  'restaurant',
  'plan',
  'feature',
  'setting',
  'export_request',
  'session',
  'webhook',
  'api_token',
  'audit_log',
  'other'
);

-- Create dedicated SuperAdmin audit events table with immutable structure
CREATE TABLE public.superadmin_audit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Actor information
  actor_id UUID NOT NULL,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL DEFAULT 'superadmin',
  
  -- Request context
  ip_address TEXT,
  user_agent TEXT,
  request_id UUID DEFAULT gen_random_uuid(),
  correlation_id UUID,
  
  -- Action details
  action_type superadmin_action_type NOT NULL,
  target_type audit_target_type NOT NULL,
  target_id UUID,
  target_identifier TEXT, -- For non-UUID identifiers
  
  -- Before/after snapshots
  metadata_before JSONB DEFAULT '{}'::jsonb,
  metadata_after JSONB DEFAULT '{}'::jsonb,
  
  -- Additional context
  context JSONB DEFAULT '{}'::jsonb,
  summary TEXT, -- Human-readable summary
  
  -- Integrity (optional hash chain)
  previous_event_id UUID,
  event_hash TEXT
);

-- Create indexes for fast querying
CREATE INDEX idx_superadmin_audit_timestamp ON public.superadmin_audit_events(timestamp DESC);
CREATE INDEX idx_superadmin_audit_actor ON public.superadmin_audit_events(actor_id);
CREATE INDEX idx_superadmin_audit_action ON public.superadmin_audit_events(action_type);
CREATE INDEX idx_superadmin_audit_target ON public.superadmin_audit_events(target_type, target_id);
CREATE INDEX idx_superadmin_audit_tenant ON public.superadmin_audit_events((context->>'tenant_id'));
CREATE INDEX idx_superadmin_audit_correlation ON public.superadmin_audit_events(correlation_id);

-- Enable RLS
ALTER TABLE public.superadmin_audit_events ENABLE ROW LEVEL SECURITY;

-- STRICT RLS: Only SuperAdmins can view, NO ONE can update or delete
CREATE POLICY "Only SuperAdmins can view audit events"
  ON public.superadmin_audit_events FOR SELECT
  USING (is_superadmin(auth.uid()));

-- System-level insert only (via security definer function)
CREATE POLICY "System can insert audit events"
  ON public.superadmin_audit_events FOR INSERT
  WITH CHECK (true);

-- Explicitly deny updates and deletes at policy level
-- (RLS prevents these operations for all users)

-- Create security definer function to log SuperAdmin events
CREATE OR REPLACE FUNCTION public.log_superadmin_event(
  _actor_id UUID,
  _actor_email TEXT,
  _action_type superadmin_action_type,
  _target_type audit_target_type,
  _target_id UUID DEFAULT NULL,
  _target_identifier TEXT DEFAULT NULL,
  _metadata_before JSONB DEFAULT '{}'::jsonb,
  _metadata_after JSONB DEFAULT '{}'::jsonb,
  _context JSONB DEFAULT '{}'::jsonb,
  _summary TEXT DEFAULT NULL,
  _ip_address TEXT DEFAULT NULL,
  _user_agent TEXT DEFAULT NULL,
  _correlation_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event_id UUID;
  _previous_id UUID;
  _hash_input TEXT;
  _event_hash TEXT;
BEGIN
  -- Verify the actor is actually a SuperAdmin
  IF NOT is_superadmin(_actor_id) THEN
    RAISE EXCEPTION 'Actor is not a SuperAdmin';
  END IF;

  -- Get the previous event for hash chain
  SELECT id INTO _previous_id
  FROM public.superadmin_audit_events
  ORDER BY timestamp DESC
  LIMIT 1;

  -- Create hash input (simplified hash chain)
  _hash_input := COALESCE(_previous_id::text, 'genesis') || '|' || 
                 _actor_id::text || '|' || 
                 _action_type::text || '|' || 
                 now()::text;
  _event_hash := encode(sha256(_hash_input::bytea), 'hex');

  -- Insert the audit event
  INSERT INTO public.superadmin_audit_events (
    actor_id,
    actor_email,
    actor_role,
    action_type,
    target_type,
    target_id,
    target_identifier,
    metadata_before,
    metadata_after,
    context,
    summary,
    ip_address,
    user_agent,
    correlation_id,
    previous_event_id,
    event_hash
  ) VALUES (
    _actor_id,
    _actor_email,
    'superadmin',
    _action_type,
    _target_type,
    _target_id,
    _target_identifier,
    _metadata_before,
    _metadata_after,
    _context,
    _summary,
    _ip_address,
    _user_agent,
    _correlation_id,
    _previous_id,
    _event_hash
  )
  RETURNING id INTO _event_id;

  RETURN _event_id;
END;
$$;

-- Create view for easier querying with computed fields
CREATE OR REPLACE VIEW public.superadmin_audit_events_view AS
SELECT 
  e.*,
  CASE 
    WHEN e.metadata_before != e.metadata_after THEN true
    ELSE false
  END as has_changes,
  jsonb_object_keys(e.metadata_after) as changed_fields
FROM public.superadmin_audit_events e;