-- Create tenant activity logs table
CREATE TABLE public.tenant_activity_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create webhook configurations table
CREATE TABLE public.webhook_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  secret TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create webhook delivery logs table
CREATE TABLE public.webhook_deliveries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  webhook_config_id UUID NOT NULL REFERENCES public.webhook_configs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  delivered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL DEFAULT false
);

-- Enable RLS
ALTER TABLE public.tenant_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Activity logs: SuperAdmins can manage
CREATE POLICY "Superadmins can manage activity logs"
ON public.tenant_activity_logs FOR ALL
USING (is_superadmin(auth.uid()));

-- Webhook configs: SuperAdmins only
CREATE POLICY "Superadmins can manage webhook configs"
ON public.webhook_configs FOR ALL
USING (is_superadmin(auth.uid()));

-- Webhook deliveries: SuperAdmins only
CREATE POLICY "Superadmins can view webhook deliveries"
ON public.webhook_deliveries FOR ALL
USING (is_superadmin(auth.uid()));

-- Create function to log tenant activity
CREATE OR REPLACE FUNCTION public.log_tenant_activity(
  _tenant_id UUID,
  _action TEXT,
  _entity_type TEXT DEFAULT NULL,
  _entity_id UUID DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _log_id UUID;
BEGIN
  INSERT INTO public.tenant_activity_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_tenant_id, auth.uid(), _action, _entity_type, _entity_id, _metadata)
  RETURNING id INTO _log_id;
  
  RETURN _log_id;
END;
$$;

-- Create trigger for tenant status changes
CREATE OR REPLACE FUNCTION public.notify_tenant_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Log the status change
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.tenant_activity_logs (tenant_id, action, metadata)
    VALUES (NEW.id, 'status_changed', jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status));
  END IF;
  
  -- Log plan changes
  IF OLD.plan_id IS DISTINCT FROM NEW.plan_id THEN
    INSERT INTO public.tenant_activity_logs (tenant_id, action, metadata)
    VALUES (NEW.id, 'plan_changed', jsonb_build_object('old_plan_id', OLD.plan_id, 'new_plan_id', NEW.plan_id));
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_status_change_trigger
AFTER UPDATE ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.notify_tenant_status_change();

-- Add index for faster activity log queries
CREATE INDEX idx_tenant_activity_logs_tenant_id ON public.tenant_activity_logs(tenant_id);
CREATE INDEX idx_tenant_activity_logs_created_at ON public.tenant_activity_logs(created_at DESC);