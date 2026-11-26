-- Create notification preferences table
CREATE TABLE public.notification_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  
  -- Critical action preferences (all default to true)
  notify_shift_timestamp_override BOOLEAN NOT NULL DEFAULT true,
  notify_delete BOOLEAN NOT NULL DEFAULT true,
  notify_bulk_delete BOOLEAN NOT NULL DEFAULT true,
  notify_user_role_change BOOLEAN NOT NULL DEFAULT true,
  notify_settings_change BOOLEAN NOT NULL DEFAULT false,
  notify_data_export BOOLEAN NOT NULL DEFAULT true,
  notify_permission_change BOOLEAN NOT NULL DEFAULT true,
  
  -- Email delivery settings
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(user_id, tenant_id)
);

-- Enable RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can view their own preferences
CREATE POLICY "Users can view own notification preferences"
  ON public.notification_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own preferences
CREATE POLICY "Users can create own notification preferences"
  ON public.notification_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own preferences
CREATE POLICY "Users can update own notification preferences"
  ON public.notification_preferences
  FOR UPDATE
  USING (auth.uid() = user_id);

-- SuperAdmins can view all preferences
CREATE POLICY "SuperAdmins can view all notification preferences"
  ON public.notification_preferences
  FOR SELECT
  USING (public.is_superadmin(auth.uid()));

-- Add updated_at trigger
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for lookups
CREATE INDEX idx_notification_preferences_user_tenant 
  ON public.notification_preferences(user_id, tenant_id);

-- Add comment
COMMENT ON TABLE public.notification_preferences IS 'Stores user preferences for audit event email notifications';