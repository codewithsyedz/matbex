-- Create in-app notifications table
CREATE TABLE public.in_app_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  
  -- Notification content
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  
  -- Status
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications"
  ON public.in_app_notifications
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON public.in_app_notifications
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role can insert notifications
CREATE POLICY "Service role can insert notifications"
  ON public.in_app_notifications
  FOR INSERT
  WITH CHECK (true);

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.in_app_notifications;

-- Add indexes
CREATE INDEX idx_notifications_user_unread ON public.in_app_notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_tenant ON public.in_app_notifications(tenant_id, created_at DESC);

-- Add digest preference to notification_preferences
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS notification_mode TEXT NOT NULL DEFAULT 'instant' CHECK (notification_mode IN ('instant', 'digest', 'in_app_only'));

-- Add digest day preference (0 = Sunday, 1 = Monday, etc.)
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS digest_day INTEGER DEFAULT 1 CHECK (digest_day >= 0 AND digest_day <= 6);

-- Add in-app notification preference
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS in_app_enabled BOOLEAN NOT NULL DEFAULT true;

-- Create table for pending digest items
CREATE TABLE public.pending_digest_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  audit_log_id UUID REFERENCES public.audit_logs(id) ON DELETE CASCADE,
  
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  actor_name TEXT,
  old_data JSONB,
  new_data JSONB,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  included_in_digest BOOLEAN NOT NULL DEFAULT false
);

-- Enable RLS
ALTER TABLE public.pending_digest_notifications ENABLE ROW LEVEL SECURITY;

-- Only service role can access pending digest
CREATE POLICY "Service role full access on pending digest"
  ON public.pending_digest_notifications
  FOR ALL
  USING (true);

-- Add index
CREATE INDEX idx_pending_digest_user ON public.pending_digest_notifications(user_id, included_in_digest) WHERE included_in_digest = false;

COMMENT ON TABLE public.in_app_notifications IS 'Stores in-app notifications for users';
COMMENT ON TABLE public.pending_digest_notifications IS 'Stores audit events pending inclusion in weekly digest emails';