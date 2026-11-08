-- 1) Add shift_id + locked_at to stock_movements
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_stock_movements_shift_id ON public.stock_movements(shift_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_locked_at ON public.stock_movements(locked_at);

-- 2) Add shift_id + locked_at to expenses
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_expenses_shift_id ON public.expenses(shift_id);

-- 3) Trigger: prevent UPDATE/DELETE on locked stock_movements
CREATE OR REPLACE FUNCTION public.prevent_locked_stock_movement_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow superadmins to bypass
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'superadmin'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL THEN
    -- Allow only the lock_at field itself to change (no-op safe path)
    IF (NEW.locked_at IS DISTINCT FROM OLD.locked_at)
       AND NEW.quantity_change = OLD.quantity_change
       AND NEW.stock_before = OLD.stock_before
       AND NEW.stock_after = OLD.stock_after
       AND NEW.movement_type = OLD.movement_type THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Stock movement is locked (shift closed). Cannot modify.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' AND OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Stock movement is locked (shift closed). Cannot delete.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_locked_stock_movement_changes ON public.stock_movements;
CREATE TRIGGER trg_prevent_locked_stock_movement_changes
  BEFORE UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_locked_stock_movement_changes();

-- 4) Trigger: prevent UPDATE/DELETE on locked expenses (only the lock-relevant columns)
CREATE OR REPLACE FUNCTION public.prevent_locked_expense_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'superadmin'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL THEN
    -- Only allow soft-delete metadata + lock changes; protect financial fields
    IF NEW.amount = OLD.amount
       AND COALESCE(NEW.quantity, 0) = COALESCE(OLD.quantity, 0)
       AND COALESCE(NEW.inventory_item_id::text, '') = COALESCE(OLD.inventory_item_id::text, '')
       AND COALESCE(NEW.shift_id::text, '') = COALESCE(OLD.shift_id::text, '') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Expense is locked to a closed shift. Cannot modify financial fields.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' AND OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Expense is locked to a closed shift. Cannot delete.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_locked_expense_changes ON public.expenses;
CREATE TRIGGER trg_prevent_locked_expense_changes
  BEFORE UPDATE OR DELETE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_locked_expense_changes();

-- 5) Trigger on shifts: when status flips to 'closed', stamp locked_at on related rows
CREATE OR REPLACE FUNCTION public.lock_shift_inventory_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'closed' AND COALESCE(OLD.status, '') <> 'closed' THEN
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

DROP TRIGGER IF EXISTS trg_lock_shift_inventory_on_close ON public.shifts;
CREATE TRIGGER trg_lock_shift_inventory_on_close
  AFTER UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_shift_inventory_on_close();