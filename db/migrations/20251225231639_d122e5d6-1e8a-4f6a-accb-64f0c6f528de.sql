-- Create shift_auto_close_settings table
CREATE TABLE public.shift_auto_close_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_close_time TIME NOT NULL DEFAULT '23:00:00',
  default_closing_amount NUMERIC NOT NULL DEFAULT 500,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);

-- Enable RLS
ALTER TABLE public.shift_auto_close_settings ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view auto-close settings in their restaurant" 
ON public.shift_auto_close_settings 
FOR SELECT 
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Owners can manage auto-close settings" 
ON public.shift_auto_close_settings 
FOR ALL 
USING (has_role(auth.uid(), restaurant_id, 'owner'));

-- Add trigger for updated_at
CREATE TRIGGER update_shift_auto_close_settings_updated_at
BEFORE UPDATE ON public.shift_auto_close_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();