-- Create suppliers table
CREATE TABLE public.suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- RLS policies for suppliers
CREATE POLICY "Managers+ can manage suppliers" ON public.suppliers
FOR ALL USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

CREATE POLICY "Users can view suppliers in their restaurant" ON public.suppliers
FOR SELECT USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- Add supplier_id to inventory_items
ALTER TABLE public.inventory_items ADD COLUMN supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- Create purchases table
CREATE TABLE public.purchases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity_received NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  invoice_number TEXT,
  notes TEXT,
  received_by UUID NOT NULL,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

-- RLS policies for purchases
CREATE POLICY "Users can create purchases in their restaurant" ON public.purchases
FOR INSERT WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id) AND received_by = auth.uid());

CREATE POLICY "Users can view purchases in their restaurant" ON public.purchases
FOR SELECT USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can update purchases" ON public.purchases
FOR UPDATE USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

-- Create waste_records table
CREATE TABLE public.waste_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity_wasted NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  waste_reason TEXT NOT NULL,
  notes TEXT,
  recorded_by UUID NOT NULL,
  waste_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.waste_records ENABLE ROW LEVEL SECURITY;

-- RLS policies for waste_records
CREATE POLICY "Users can create waste records in their restaurant" ON public.waste_records
FOR INSERT WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id) AND recorded_by = auth.uid());

CREATE POLICY "Users can view waste records in their restaurant" ON public.waste_records
FOR SELECT USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can delete waste records" ON public.waste_records
FOR DELETE USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

-- Update triggers
CREATE TRIGGER update_suppliers_updated_at
BEFORE UPDATE ON public.suppliers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();