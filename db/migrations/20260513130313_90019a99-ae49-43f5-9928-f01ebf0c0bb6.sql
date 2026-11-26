
CREATE TABLE public.daypart_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL UNIQUE REFERENCES public.restaurants(id) ON DELETE CASCADE,
  morning_start INTEGER NOT NULL DEFAULT 6 CHECK (morning_start >= 0 AND morning_start <= 23),
  noon_start INTEGER NOT NULL DEFAULT 12 CHECK (noon_start >= 0 AND noon_start <= 23),
  evening_start INTEGER NOT NULL DEFAULT 17 CHECK (evening_start >= 0 AND evening_start <= 23),
  late_night_start INTEGER NOT NULL DEFAULT 22 CHECK (late_night_start >= 0 AND late_night_start <= 23),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CHECK (morning_start < noon_start AND noon_start < evening_start AND evening_start < late_night_start)
);

ALTER TABLE public.daypart_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view daypart settings for their restaurant"
  ON public.daypart_settings FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert daypart settings for their restaurant"
  ON public.daypart_settings FOR INSERT
  WITH CHECK (restaurant_id IN (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update daypart settings for their restaurant"
  ON public.daypart_settings FOR UPDATE
  USING (restaurant_id IN (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid()));

CREATE TRIGGER update_daypart_settings_updated_at
  BEFORE UPDATE ON public.daypart_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
