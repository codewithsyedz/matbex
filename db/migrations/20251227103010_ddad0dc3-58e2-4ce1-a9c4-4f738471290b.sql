-- Add default_cashier_staff_id to shift_templates for per-template cashier assignment
ALTER TABLE public.shift_templates 
ADD COLUMN IF NOT EXISTS default_cashier_staff_id uuid REFERENCES public.staff(id);

-- Remove drawer-level cashier columns since we're using template-level instead
ALTER TABLE public.drawers 
DROP COLUMN IF EXISTS default_cashier_staff_id,
DROP COLUMN IF EXISTS default_cashier_user_id;