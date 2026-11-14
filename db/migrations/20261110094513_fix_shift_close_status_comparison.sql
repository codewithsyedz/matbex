-- Closing a shift failed: lock_shift_inventory_on_close() compared the enum column with
-- COALESCE(OLD.status, ''), and '' is not a valid shift_status, so every UPDATE that set
-- status = 'closed' raised "invalid input value for enum shift_status" and rolled back
-- (CloseShiftModal included). Compare as text instead; the body is otherwise unchanged
-- (from 20260423192636).
CREATE OR REPLACE FUNCTION public.lock_shift_inventory_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'closed' AND COALESCE(OLD.status::text, '') <> 'closed' THEN
    -- Lock movements created during the shift window for this restaurant
    UPDATE public.stock_movements
       SET locked_at = now(),
           shift_id = COALESCE(shift_id, NEW.id)
     WHERE restaurant_id = NEW.restaurant_id
       AND locked_at IS NULL
       AND created_at >= NEW.opened_at
       AND created_at <= COALESCE(NEW.closed_at, now());

    -- Lock inventory-linked expenses created during shift window
    UPDATE public.expenses
       SET locked_at = now(),
           shift_id = COALESCE(shift_id, NEW.id)
     WHERE restaurant_id = NEW.restaurant_id
       AND locked_at IS NULL
       AND inventory_item_id IS NOT NULL
       AND created_at >= NEW.opened_at
       AND created_at <= COALESCE(NEW.closed_at, now());
  END IF;
  RETURN NEW;
END;
$$;
