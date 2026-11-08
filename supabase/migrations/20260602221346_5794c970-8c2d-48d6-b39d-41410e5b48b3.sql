-- Add is_inventory_item boolean flag to expenses, auto-maintained by trigger.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS is_inventory_item boolean NOT NULL DEFAULT false;

-- Trigger function: true when the expense has an inventory_item_id (single-item)
-- OR when at least one stock_movements row references it (itemized invoice).
CREATE OR REPLACE FUNCTION public.set_expense_is_inventory_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.inventory_item_id IS NOT NULL THEN
    NEW.is_inventory_item := true;
  ELSE
    -- Check for any stock movements that reference this expense (itemized invoices).
    -- On INSERT, id won't have movements yet, so this evaluates false; the
    -- AFTER trigger on stock_movements (below) will flip it to true.
    IF EXISTS (
      SELECT 1 FROM public.stock_movements
      WHERE reference_type = 'expense' AND reference_id = NEW.id
    ) THEN
      NEW.is_inventory_item := true;
    ELSE
      NEW.is_inventory_item := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_expense_is_inventory_item ON public.expenses;
CREATE TRIGGER trg_set_expense_is_inventory_item
BEFORE INSERT OR UPDATE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.set_expense_is_inventory_item();

-- Reflect back to expenses when stock movements are added/removed for an itemized invoice.
CREATE OR REPLACE FUNCTION public.sync_expense_inventory_flag_from_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_ref_id := OLD.reference_id;
  ELSE
    v_ref_id := NEW.reference_id;
  END IF;

  IF v_ref_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only react to movements that reference expenses
  IF (TG_OP <> 'DELETE' AND NEW.reference_type = 'expense')
     OR (TG_OP = 'DELETE' AND OLD.reference_type = 'expense') THEN
    UPDATE public.expenses e
    SET is_inventory_item = (
      e.inventory_item_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.reference_type = 'expense' AND sm.reference_id = e.id
      )
    )
    WHERE e.id = v_ref_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_expense_inventory_flag ON public.stock_movements;
CREATE TRIGGER trg_sync_expense_inventory_flag
AFTER INSERT OR DELETE ON public.stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.sync_expense_inventory_flag_from_movement();

-- Backfill existing rows
UPDATE public.expenses e
SET is_inventory_item = (
  e.inventory_item_id IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM public.stock_movements sm
    WHERE sm.reference_type = 'expense' AND sm.reference_id = e.id
  )
);