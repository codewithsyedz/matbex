-- Create report schedules table
CREATE TABLE public.report_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('sales', 'expenses', 'shifts', 'full')),
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  email TEXT NOT NULL,
  day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),
  day_of_month INTEGER CHECK (day_of_month >= 1 AND day_of_month <= 28),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own schedules"
ON public.report_schedules FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can create their own schedules"
ON public.report_schedules FOR INSERT
WITH CHECK (user_id = auth.uid() AND user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can update their own schedules"
ON public.report_schedules FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own schedules"
ON public.report_schedules FOR DELETE
USING (user_id = auth.uid());

-- Add trigger for updated_at
CREATE TRIGGER update_report_schedules_updated_at
BEFORE UPDATE ON public.report_schedules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();