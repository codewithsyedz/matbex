-- Add inventory_item_id column to expenses table
ALTER TABLE public.expenses 
ADD COLUMN inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL;

-- Add quantity column for inventory-linked expenses
ALTER TABLE public.expenses 
ADD COLUMN quantity NUMERIC DEFAULT 1;

-- Create trigger function to auto-create purchase from expense
CREATE OR REPLACE FUNCTION public.auto_create_purchase_from_expense()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- Only create purchase if expense is linked to inventory item
  IF NEW.inventory_item_id IS NOT NULL THEN
    -- Get inventory item details
    SELECT unit_cost INTO v_item
    FROM public.inventory_items
    WHERE id = NEW.inventory_item_id;

    -- Insert purchase record
    INSERT INTO public.purchases (
      restaurant_id,
      inventory_item_id,
      quantity_received,
      unit_cost,
      total_cost,
      notes,
      received_by,
      received_at
    ) VALUES (
      NEW.restaurant_id,
      NEW.inventory_item_id,
      COALESCE(NEW.quantity, 1),
      NEW.amount / COALESCE(NEW.quantity, 1),
      NEW.amount,
      'Auto-created from expense: ' || COALESCE(NEW.description, 'No description'),
      NEW.created_by,
      NEW.expense_date::timestamptz
    );

    -- Update inventory stock
    UPDATE public.inventory_items
    SET 
      current_stock = current_stock + COALESCE(NEW.quantity, 1),
      unit_cost = NEW.amount / COALESCE(NEW.quantity, 1)
    WHERE id = NEW.inventory_item_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger on expenses table
DROP TRIGGER IF EXISTS trg_auto_create_purchase_from_expense ON public.expenses;
CREATE TRIGGER trg_auto_create_purchase_from_expense
  AFTER INSERT ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_purchase_from_expense();

-- Add index for inventory item lookups
CREATE INDEX IF NOT EXISTS idx_expenses_inventory_item ON public.expenses(inventory_item_id) WHERE inventory_item_id IS NOT NULL;