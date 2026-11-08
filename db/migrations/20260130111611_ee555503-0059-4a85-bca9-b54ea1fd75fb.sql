-- Create inventory_categories table for user-defined categories
CREATE TABLE IF NOT EXISTS public.inventory_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  cogs_frequency public.cogs_frequency NOT NULL DEFAULT 'monthly',
  inventory_account_code text DEFAULT '1200',
  cogs_account_code text DEFAULT '5000',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(restaurant_id, name)
);

-- Enable RLS
ALTER TABLE public.inventory_categories ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view categories for their restaurant"
ON public.inventory_categories FOR SELECT
USING (
  restaurant_id IN (
    SELECT restaurant_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Managers can insert categories"
ON public.inventory_categories FOR INSERT
WITH CHECK (
  restaurant_id IN (
    SELECT p.restaurant_id FROM public.profiles p
    JOIN public.user_tenant_roles utr ON utr.user_id = p.id AND utr.tenant_id = p.tenant_id
    WHERE p.id = auth.uid() AND utr.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Managers can update categories"
ON public.inventory_categories FOR UPDATE
USING (
  restaurant_id IN (
    SELECT p.restaurant_id FROM public.profiles p
    JOIN public.user_tenant_roles utr ON utr.user_id = p.id AND utr.tenant_id = p.tenant_id
    WHERE p.id = auth.uid() AND utr.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Managers can delete categories"
ON public.inventory_categories FOR DELETE
USING (
  restaurant_id IN (
    SELECT p.restaurant_id FROM public.profiles p
    JOIN public.user_tenant_roles utr ON utr.user_id = p.id AND utr.tenant_id = p.tenant_id
    WHERE p.id = auth.uid() AND utr.role IN ('owner', 'manager')
  )
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_inventory_categories_restaurant 
ON public.inventory_categories(restaurant_id);

-- Add foreign key from inventory_items to categories
ALTER TABLE public.inventory_items
ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.inventory_categories(id) ON DELETE SET NULL;