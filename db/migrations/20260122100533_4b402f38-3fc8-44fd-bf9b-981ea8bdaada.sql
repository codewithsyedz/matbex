-- Create chat_settings table with chat_enabled field
CREATE TABLE public.chat_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  chat_enabled BOOLEAN NOT NULL DEFAULT true,
  allow_message_edit BOOLEAN NOT NULL DEFAULT true,
  allow_message_delete BOOLEAN NOT NULL DEFAULT true,
  edit_window_minutes INTEGER DEFAULT 15,
  delete_window_minutes INTEGER DEFAULT 5,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT chat_settings_tenant_id_key UNIQUE (tenant_id)
);

-- Enable RLS
ALTER TABLE public.chat_settings ENABLE ROW LEVEL SECURITY;

-- SuperAdmins can do anything
CREATE POLICY "SuperAdmins can manage all chat settings"
  ON public.chat_settings
  FOR ALL
  USING (public.is_superadmin(auth.uid()));

-- Tenant users can read their own settings
CREATE POLICY "Users can read their tenant chat settings"
  ON public.chat_settings
  FOR SELECT
  USING (public.user_belongs_to_tenant(auth.uid(), tenant_id));

-- Create trigger for updated_at
CREATE TRIGGER update_chat_settings_updated_at
  BEFORE UPDATE ON public.chat_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();