-- Menu items table for POS integration
CREATE TABLE public.menu_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'main',
  selling_price NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Recipe ingredients - links menu items to inventory for cost calculation
CREATE TABLE public.recipe_ingredients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity_required NUMERIC NOT NULL DEFAULT 1,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Sales items - tracks individual items sold in each transaction
CREATE TABLE public.sales_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES public.sales_transactions(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_items ENABLE ROW LEVEL SECURITY;

-- Menu items policies
CREATE POLICY "Users can view menu items in their restaurant"
ON public.menu_items FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage menu items"
ON public.menu_items FOR ALL
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

-- Recipe ingredients policies
CREATE POLICY "Users can view recipe ingredients in their restaurant"
ON public.recipe_ingredients FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage recipe ingredients"
ON public.recipe_ingredients FOR ALL
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_role(auth.uid(), restaurant_id, 'manager'::app_role));

-- Sales items policies
CREATE POLICY "Users can view sales items in their restaurant"
ON public.sales_items FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can create sales items in their restaurant"
ON public.sales_items FOR INSERT
WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- Create indexes for performance
CREATE INDEX idx_menu_items_restaurant ON public.menu_items(restaurant_id);
CREATE INDEX idx_recipe_ingredients_menu_item ON public.recipe_ingredients(menu_item_id);
CREATE INDEX idx_sales_items_transaction ON public.sales_items(transaction_id);
CREATE INDEX idx_sales_items_menu_item ON public.sales_items(menu_item_id);
CREATE INDEX idx_sales_items_created_at ON public.sales_items(created_at);

-- Update triggers
CREATE TRIGGER update_menu_items_updated_at
BEFORE UPDATE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();