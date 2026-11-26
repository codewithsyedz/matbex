-- Create combo packages table
CREATE TABLE public.combo_packages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create combo package items junction table
CREATE TABLE public.combo_package_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  combo_id UUID NOT NULL REFERENCES public.combo_packages(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  portion_type TEXT NOT NULL DEFAULT 'full', -- quarter, half, full
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(combo_id, menu_item_id, portion_type)
);

-- Enable RLS
ALTER TABLE public.combo_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_package_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for combo_packages
CREATE POLICY "Users can view combos in their restaurant"
  ON public.combo_packages FOR SELECT
  USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can manage combos"
  ON public.combo_packages FOR ALL
  USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

-- RLS policies for combo_package_items
CREATE POLICY "Users can view combo items"
  ON public.combo_package_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.combo_packages
    WHERE combo_packages.id = combo_package_items.combo_id
    AND user_belongs_to_restaurant(auth.uid(), combo_packages.restaurant_id)
  ));

CREATE POLICY "Managers+ can manage combo items"
  ON public.combo_package_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.combo_packages
    WHERE combo_packages.id = combo_package_items.combo_id
    AND (has_role(auth.uid(), combo_packages.restaurant_id, 'owner') OR has_role(auth.uid(), combo_packages.restaurant_id, 'manager'))
  ));

-- Create indexes
CREATE INDEX idx_combo_packages_restaurant ON public.combo_packages(restaurant_id);
CREATE INDEX idx_combo_package_items_combo ON public.combo_package_items(combo_id);

-- Add trigger for updated_at
CREATE TRIGGER update_combo_packages_updated_at
  BEFORE UPDATE ON public.combo_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();