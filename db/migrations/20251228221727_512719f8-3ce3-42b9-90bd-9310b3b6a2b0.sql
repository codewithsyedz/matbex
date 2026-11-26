-- Add default_drawer_id column to shift_templates for auto-open targeting
ALTER TABLE public.shift_templates 
ADD COLUMN default_drawer_id uuid REFERENCES public.drawers(id);

-- Add index for faster lookups
CREATE INDEX idx_shift_templates_default_drawer ON public.shift_templates(default_drawer_id);

COMMENT ON COLUMN public.shift_templates.default_drawer_id IS 'The specific drawer to use for auto-opening shifts. If null, no auto-open will occur.';