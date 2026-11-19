-- Create daily_menu table to track which menu items are served each day
CREATE TABLE public.daily_menu (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  menu_date DATE NOT NULL DEFAULT CURRENT_DATE,
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  UNIQUE(restaurant_id, menu_date, menu_item_id)
);

-- Enable RLS
ALTER TABLE public.daily_menu ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view daily menu in their restaurant"
ON public.daily_menu FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can add daily menu items in their restaurant"
ON public.daily_menu FOR INSERT
WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id) AND created_by = auth.uid());

CREATE POLICY "Managers+ can update daily menu"
ON public.daily_menu FOR UPDATE
USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

CREATE POLICY "Managers+ can delete daily menu items"
ON public.daily_menu FOR DELETE
USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

-- Create index for faster lookups
CREATE INDEX idx_daily_menu_date ON public.daily_menu(restaurant_id, menu_date);