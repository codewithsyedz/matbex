
-- Add conversion factor + stock unit label to inventory_items
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS units_per_pack numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stock_unit text;

COMMENT ON COLUMN public.inventory_items.units_per_pack IS 'How many stock units are contained in one purchase unit (e.g. 12 liters per case). Stock change = expense quantity * units_per_pack.';
COMMENT ON COLUMN public.inventory_items.stock_unit IS 'Display label for the stock unit (e.g. liter). Falls back to unit if null.';

-- Stock movements audit log
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('purchase','usage','adjustment','waste','transfer')),
  quantity_change numeric NOT NULL,
  stock_before numeric NOT NULL,
  stock_after numeric NOT NULL,
  reason text,
  reference_type text,
  reference_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON public.stock_movements(inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_restaurant ON public.stock_movements(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON public.stock_movements(reference_type, reference_id);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read stock movements"
  ON public.stock_movements FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members write stock movements"
  ON public.stock_movements FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
