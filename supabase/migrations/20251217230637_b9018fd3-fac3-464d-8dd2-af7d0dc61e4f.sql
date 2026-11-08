-- Create inventory_batches table for lot/batch tracking
CREATE TABLE public.inventory_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  manufacture_date DATE,
  expiry_date DATE,
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;

-- RLS policies for inventory_batches
CREATE POLICY "Users can view batches in their restaurant" ON public.inventory_batches
FOR SELECT USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage batches" ON public.inventory_batches
FOR ALL USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

-- Create inventory_valuations table for historical snapshots
CREATE TABLE public.inventory_valuations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  valuation_date DATE NOT NULL,
  total_items INTEGER NOT NULL DEFAULT 0,
  total_quantity NUMERIC NOT NULL DEFAULT 0,
  total_value NUMERIC NOT NULL DEFAULT 0,
  items_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, valuation_date)
);

-- Enable RLS
ALTER TABLE public.inventory_valuations ENABLE ROW LEVEL SECURITY;

-- RLS policies for inventory_valuations
CREATE POLICY "Users can view valuations in their restaurant" ON public.inventory_valuations
FOR SELECT USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can insert valuations in their restaurant" ON public.inventory_valuations
FOR INSERT WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- Create purchase_invoices table for invoice tracking
CREATE TABLE public.purchase_invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;

-- RLS policies for purchase_invoices
CREATE POLICY "Users can view invoices in their restaurant" ON public.purchase_invoices
FOR SELECT USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can create invoices in their restaurant" ON public.purchase_invoices
FOR INSERT WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id) AND created_by = auth.uid());

CREATE POLICY "Managers+ can update invoices" ON public.purchase_invoices
FOR UPDATE USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

-- Create invoice_items table
CREATE TABLE public.invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for invoice_items (inherit from invoice)
CREATE POLICY "Users can view invoice items" ON public.invoice_items
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.purchase_invoices 
    WHERE id = invoice_items.invoice_id 
    AND user_belongs_to_restaurant(auth.uid(), restaurant_id)
  )
);

CREATE POLICY "Users can create invoice items" ON public.invoice_items
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.purchase_invoices 
    WHERE id = invoice_items.invoice_id 
    AND user_belongs_to_restaurant(auth.uid(), restaurant_id)
  )
);

-- Triggers for updated_at
CREATE TRIGGER update_inventory_batches_updated_at
BEFORE UPDATE ON public.inventory_batches
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_purchase_invoices_updated_at
BEFORE UPDATE ON public.purchase_invoices
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();