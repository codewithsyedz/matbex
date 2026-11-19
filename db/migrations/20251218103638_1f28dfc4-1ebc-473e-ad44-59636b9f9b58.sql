-- Create export requests table for approval workflow
CREATE TABLE public.export_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  requested_by UUID NOT NULL,
  approved_by UUID,
  export_type TEXT NOT NULL, -- 'sales', 'expenses', 'shifts', 'inventory', 'full_backup'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'completed', 'expired'
  data_scope JSONB DEFAULT '{}'::jsonb, -- date ranges, filters, etc.
  row_count INTEGER,
  rejection_reason TEXT,
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '24 hours'),
  download_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create session tracking table
CREATE TABLE public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  device_info JSONB DEFAULT '{}'::jsonb,
  last_active_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE public.export_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- Export requests policies
CREATE POLICY "Users can view their tenant export requests"
ON public.export_requests FOR SELECT
USING (
  user_belongs_to_tenant(auth.uid(), tenant_id) OR is_superadmin(auth.uid())
);

CREATE POLICY "Users can create export requests for their tenant"
ON public.export_requests FOR INSERT
WITH CHECK (
  user_belongs_to_tenant(auth.uid(), tenant_id) AND requested_by = auth.uid()
);

CREATE POLICY "Owners can approve/reject export requests"
ON public.export_requests FOR UPDATE
USING (
  (has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role) OR is_superadmin(auth.uid()))
);

-- Session policies
CREATE POLICY "Users can view sessions in their tenant"
ON public.user_sessions FOR SELECT
USING (
  user_id = auth.uid() OR 
  (tenant_id IS NOT NULL AND has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)) OR
  is_superadmin(auth.uid())
);

CREATE POLICY "System can create sessions"
ON public.user_sessions FOR INSERT
WITH CHECK (true);

CREATE POLICY "Owners can revoke sessions in their tenant"
ON public.user_sessions FOR UPDATE
USING (
  user_id = auth.uid() OR
  (tenant_id IS NOT NULL AND has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)) OR
  is_superadmin(auth.uid())
);

-- Function to log export activity
CREATE OR REPLACE FUNCTION public.log_export_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_audit('EXPORT_REQUEST_CREATED', 'export_request', NEW.id, NULL, to_jsonb(NEW), NEW.tenant_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != NEW.status THEN
      PERFORM log_audit('EXPORT_REQUEST_' || UPPER(NEW.status), 'export_request', NEW.id, to_jsonb(OLD), to_jsonb(NEW), NEW.tenant_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger for export audit logging
CREATE TRIGGER export_request_audit_trigger
AFTER INSERT OR UPDATE ON public.export_requests
FOR EACH ROW EXECUTE FUNCTION public.log_export_request();

-- Function to track session activity
CREATE OR REPLACE FUNCTION public.update_session_activity(session_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_sessions
  SET last_active_at = now()
  WHERE id = session_id AND is_active = true;
END;
$$;

-- Add indexes for performance
CREATE INDEX idx_export_requests_tenant ON public.export_requests(tenant_id);
CREATE INDEX idx_export_requests_status ON public.export_requests(status);
CREATE INDEX idx_user_sessions_tenant ON public.user_sessions(tenant_id);
CREATE INDEX idx_user_sessions_user ON public.user_sessions(user_id);
CREATE INDEX idx_user_sessions_active ON public.user_sessions(is_active) WHERE is_active = true;