-- Create inventory_usage table to track daily consumption
CREATE TABLE public.inventory_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity_used NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
);

-- Enable RLS
ALTER TABLE public.inventory_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies for inventory_usage
CREATE POLICY "Users can view inventory usage in their restaurant"
  ON public.inventory_usage FOR SELECT
  USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can create inventory usage in their restaurant"
  ON public.inventory_usage FOR INSERT
  WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id) AND created_by = auth.uid());

CREATE POLICY "Managers+ can update inventory usage"
  ON public.inventory_usage FOR UPDATE
  USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

CREATE POLICY "Managers+ can delete inventory usage"
  ON public.inventory_usage FOR DELETE
  USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

-- Create staff_rates table for hourly rates
CREATE TABLE public.staff_rates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  hourly_rate NUMERIC NOT NULL DEFAULT 0,
  role_type TEXT NOT NULL DEFAULT 'staff',
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, user_id, effective_from)
);

-- Enable RLS
ALTER TABLE public.staff_rates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for staff_rates
CREATE POLICY "Users can view staff rates in their restaurant"
  ON public.staff_rates FOR SELECT
  USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage staff rates"
  ON public.staff_rates FOR ALL
  USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

-- Add trigger for updated_at
CREATE TRIGGER update_staff_rates_updated_at
  BEFORE UPDATE ON public.staff_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for performance
CREATE INDEX idx_inventory_usage_date ON public.inventory_usage(restaurant_id, usage_date);
CREATE INDEX idx_inventory_usage_item ON public.inventory_usage(inventory_item_id);
CREATE INDEX idx_staff_rates_user ON public.staff_rates(restaurant_id, user_id, is_active);