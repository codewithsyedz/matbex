-- Create global chat defaults table for platform-wide settings
CREATE TABLE public.global_chat_defaults (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_enabled_default BOOLEAN NOT NULL DEFAULT true,
  allow_message_edit_default BOOLEAN NOT NULL DEFAULT true,
  allow_message_delete_default BOOLEAN NOT NULL DEFAULT true,
  edit_window_minutes_default INTEGER DEFAULT 15,
  delete_window_minutes_default INTEGER DEFAULT 15,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.global_chat_defaults ENABLE ROW LEVEL SECURITY;

-- Only SuperAdmins can read/write global defaults
CREATE POLICY "SuperAdmins can read global chat defaults"
ON public.global_chat_defaults FOR SELECT
USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can update global chat defaults"
ON public.global_chat_defaults FOR UPDATE
USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can insert global chat defaults"
ON public.global_chat_defaults FOR INSERT
WITH CHECK (public.is_superadmin(auth.uid()));

-- Insert default row
INSERT INTO public.global_chat_defaults (
  chat_enabled_default,
  allow_message_edit_default,
  allow_message_delete_default,
  edit_window_minutes_default,
  delete_window_minutes_default
) VALUES (true, true, true, 15, 15);

-- Add trigger for updated_at
CREATE TRIGGER update_global_chat_defaults_updated_at
BEFORE UPDATE ON public.global_chat_defaults
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add RLS policies for SuperAdmins to access chat_messages across all tenants
CREATE POLICY "SuperAdmins can view all chat messages"
ON public.chat_messages FOR SELECT
USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can delete any chat message"
ON public.chat_messages FOR DELETE
USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can update any chat message"
ON public.chat_messages FOR UPDATE
USING (public.is_superadmin(auth.uid()));