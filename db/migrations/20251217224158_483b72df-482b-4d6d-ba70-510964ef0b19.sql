-- Create table for tracking auto-reorder requests
CREATE TABLE public.reorder_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  requested_quantity NUMERIC NOT NULL DEFAULT 0,
  current_stock NUMERIC NOT NULL DEFAULT 0,
  reorder_level NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID,
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.reorder_requests ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view reorder requests in their restaurant"
ON public.reorder_requests
FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can create reorder requests in their restaurant"
ON public.reorder_requests
FOR INSERT
WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can update reorder requests"
ON public.reorder_requests
FOR UPDATE
USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

CREATE POLICY "Managers+ can delete reorder requests"
ON public.reorder_requests
FOR DELETE
USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

-- Create index for faster lookups
CREATE INDEX idx_reorder_requests_restaurant_status ON public.reorder_requests(restaurant_id, status);
CREATE INDEX idx_reorder_requests_inventory_item ON public.reorder_requests(inventory_item_id);