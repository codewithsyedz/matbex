-- Create fiscal settings table
CREATE TABLE public.fiscal_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  month_start_day INTEGER NOT NULL DEFAULT 1 CHECK (month_start_day >= 1 AND month_start_day <= 28),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);

-- Enable RLS
ALTER TABLE public.fiscal_settings ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view fiscal settings for their restaurant"
ON public.fiscal_settings
FOR SELECT
USING (
  restaurant_id IN (
    SELECT restaurant_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can insert fiscal settings for their restaurant"
ON public.fiscal_settings
FOR INSERT
WITH CHECK (
  restaurant_id IN (
    SELECT restaurant_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can update fiscal settings for their restaurant"
ON public.fiscal_settings
FOR UPDATE
USING (
  restaurant_id IN (
    SELECT restaurant_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- Create trigger for updated_at
CREATE TRIGGER update_fiscal_settings_updated_at
BEFORE UPDATE ON public.fiscal_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();