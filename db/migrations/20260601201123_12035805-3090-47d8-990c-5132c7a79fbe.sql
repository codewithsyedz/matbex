
ALTER TABLE public.tenant_applications
  ADD COLUMN IF NOT EXISTS selected_addon_ids uuid[] NOT NULL DEFAULT '{}';
