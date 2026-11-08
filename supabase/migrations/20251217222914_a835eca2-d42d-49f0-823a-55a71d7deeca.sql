-- Profit targets table for configurable targets and alerts
CREATE TABLE public.profit_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL DEFAULT 'daily', -- daily, weekly, monthly
  target_amount NUMERIC NOT NULL DEFAULT 0,
  prime_cost_target NUMERIC DEFAULT 65, -- percentage
  margin_target NUMERIC DEFAULT 10, -- percentage
  alert_enabled BOOLEAN NOT NULL DEFAULT true,
  alert_threshold NUMERIC DEFAULT 10, -- alert when X% below target
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, target_type)
);

-- Profit notifications table for tracking sent alerts
CREATE TABLE public.profit_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL, -- 'daily_summary', 'target_missed', 'milestone'
  date DATE NOT NULL,
  email_sent_at TIMESTAMP WITH TIME ZONE,
  email_recipient TEXT,
  summary_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profit_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profit_notifications ENABLE ROW LEVEL SECURITY;

-- Profit targets policies
CREATE POLICY "Users can view profit targets in their restaurant"
ON public.profit_targets FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage profit targets"
ON public.profit_targets FOR ALL
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

-- Profit notifications policies
CREATE POLICY "Users can view profit notifications in their restaurant"
ON public.profit_notifications FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can insert profit notifications in their restaurant"
ON public.profit_notifications FOR INSERT
WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- Indexes
CREATE INDEX idx_profit_targets_restaurant ON public.profit_targets(restaurant_id);
CREATE INDEX idx_profit_notifications_restaurant_date ON public.profit_notifications(restaurant_id, date);

-- Update trigger
CREATE TRIGGER update_profit_targets_updated_at
BEFORE UPDATE ON public.profit_targets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();