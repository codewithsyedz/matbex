-- Create staff settings table for salary configuration
CREATE TABLE public.staff_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE UNIQUE,
  salary_day INTEGER NOT NULL DEFAULT 1 CHECK (salary_day >= 1 AND salary_day <= 28),
  reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  reminder_days_before INTEGER NOT NULL DEFAULT 3 CHECK (reminder_days_before >= 1 AND reminder_days_before <= 7),
  reminder_email TEXT,
  include_payroll_in_overhead BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.staff_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view staff settings in their restaurant"
ON public.staff_settings FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage staff settings"
ON public.staff_settings FOR ALL
USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

-- Add trigger for updated_at
CREATE TRIGGER update_staff_settings_updated_at
BEFORE UPDATE ON public.staff_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();