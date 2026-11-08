-- Add auto-open configuration to shift_templates
ALTER TABLE public.shift_templates
ADD COLUMN IF NOT EXISTS auto_open_enabled boolean NOT NULL DEFAULT false;

-- Add default cashier to drawers table for auto-open assignment
ALTER TABLE public.drawers
ADD COLUMN IF NOT EXISTS default_cashier_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS default_cashier_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;