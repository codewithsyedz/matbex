-- Create inventory_settings table for FIFO/LIFO costing method
CREATE TABLE public.inventory_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  costing_method TEXT NOT NULL DEFAULT 'fifo' CHECK (costing_method IN ('fifo', 'lifo', 'average')),
  expiry_alert_days INTEGER NOT NULL DEFAULT 7,
  expiry_alert_enabled BOOLEAN NOT NULL DEFAULT true,
  expiry_alert_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);

-- Enable RLS
ALTER TABLE public.inventory_settings ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Managers+ can manage inventory settings" ON public.inventory_settings
FOR ALL USING (
  has_role(auth.uid(), restaurant_id, 'owner') OR 
  has_role(auth.uid(), restaurant_id, 'manager')
);

CREATE POLICY "Users can view inventory settings" ON public.inventory_settings
FOR SELECT USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- Create stocktakes table
CREATE TABLE public.stocktakes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  stocktake_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'cancelled')),
  notes TEXT,
  completed_by UUID,
  completed_at TIMESTAMP WITH TIME ZONE,
  total_expected_value NUMERIC NOT NULL DEFAULT 0,
  total_counted_value NUMERIC NOT NULL DEFAULT 0,
  total_variance_value NUMERIC NOT NULL DEFAULT 0,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create stocktake_items table
CREATE TABLE public.stocktake_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stocktake_id UUID NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  expected_quantity NUMERIC NOT NULL DEFAULT 0,
  counted_quantity NUMERIC,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  variance_quantity NUMERIC GENERATED ALWAYS AS (COALESCE(counted_quantity, 0) - expected_quantity) STORED,
  variance_value NUMERIC GENERATED ALWAYS AS ((COALESCE(counted_quantity, 0) - expected_quantity) * unit_cost) STORED,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stocktake_items ENABLE ROW LEVEL SECURITY;

-- Stocktakes policies
CREATE POLICY "Users can view stocktakes in their restaurant" ON public.stocktakes
FOR SELECT USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can create stocktakes in their restaurant" ON public.stocktakes
FOR INSERT WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id) AND created_by = auth.uid());

CREATE POLICY "Managers+ can update stocktakes" ON public.stocktakes
FOR UPDATE USING (
  has_role(auth.uid(), restaurant_id, 'owner') OR 
  has_role(auth.uid(), restaurant_id, 'manager')
);

CREATE POLICY "Managers+ can delete stocktakes" ON public.stocktakes
FOR DELETE USING (
  has_role(auth.uid(), restaurant_id, 'owner') OR 
  has_role(auth.uid(), restaurant_id, 'manager')
);

-- Stocktake items policies
CREATE POLICY "Users can view stocktake items" ON public.stocktake_items
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.stocktakes s
    WHERE s.id = stocktake_items.stocktake_id
    AND user_belongs_to_restaurant(auth.uid(), s.restaurant_id)
  )
);

CREATE POLICY "Users can manage stocktake items" ON public.stocktake_items
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.stocktakes s
    WHERE s.id = stocktake_items.stocktake_id
    AND user_belongs_to_restaurant(auth.uid(), s.restaurant_id)
  )
);

-- Add trigger for updated_at
CREATE TRIGGER update_inventory_settings_updated_at
BEFORE UPDATE ON public.inventory_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_stocktakes_updated_at
BEFORE UPDATE ON public.stocktakes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add expiry_alert_sent_at to inventory_batches to track sent alerts
ALTER TABLE public.inventory_batches 
ADD COLUMN IF NOT EXISTS expiry_alert_sent_at TIMESTAMP WITH TIME ZONE;