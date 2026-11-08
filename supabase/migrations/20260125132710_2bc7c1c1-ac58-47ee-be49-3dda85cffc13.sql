-- Create KPI alerts table for persistent threshold alerts
CREATE TABLE public.kpi_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL, -- 'profit_below_target', 'prime_cost_high', 'margin_low', 'cash_variance_high', 'expense_spike'
  severity TEXT NOT NULL DEFAULT 'warning', -- 'warning', 'critical'
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  metric_value NUMERIC,
  threshold_value NUMERIC,
  reference_date DATE NOT NULL DEFAULT CURRENT_DATE,
  triggered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  acknowledged_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for efficient querying
CREATE INDEX idx_kpi_alerts_restaurant_active ON public.kpi_alerts(restaurant_id, is_active, triggered_at DESC);
CREATE INDEX idx_kpi_alerts_type_date ON public.kpi_alerts(restaurant_id, alert_type, reference_date);

-- Enable RLS
ALTER TABLE public.kpi_alerts ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view alerts for their restaurant"
ON public.kpi_alerts
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.restaurant_id = kpi_alerts.restaurant_id
    AND user_roles.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert alerts for their restaurant"
ON public.kpi_alerts
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.restaurant_id = kpi_alerts.restaurant_id
    AND user_roles.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update alerts for their restaurant"
ON public.kpi_alerts
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.restaurant_id = kpi_alerts.restaurant_id
    AND user_roles.user_id = auth.uid()
  )
);

-- Add additional threshold columns to profit_targets
ALTER TABLE public.profit_targets 
ADD COLUMN IF NOT EXISTS cash_variance_threshold NUMERIC DEFAULT 50,
ADD COLUMN IF NOT EXISTS expense_spike_threshold NUMERIC DEFAULT 30,
ADD COLUMN IF NOT EXISTS expense_spike_window_days INTEGER DEFAULT 7;