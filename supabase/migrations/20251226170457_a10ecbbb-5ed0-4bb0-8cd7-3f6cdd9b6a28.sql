-- Add auto-close columns to shift_templates
ALTER TABLE public.shift_templates 
ADD COLUMN IF NOT EXISTS auto_close_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_close_time time DEFAULT '23:59:00',
ADD COLUMN IF NOT EXISTS default_closing_amount numeric DEFAULT 0;