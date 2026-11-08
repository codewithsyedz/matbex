-- Server-side guarded undo for manual stock adjustments.
-- Refuses to revert when the original movement (or its linked expense) is locked
-- by a closed shift. Writes a reversing 'adjustment' row for the audit trail.

CREATE OR REPLACE FUNCTION public.undo_stock_adjustment(_movement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov           public.stock_movements%ROWTYPE;
  v_current_stock numeric;
  v_reverse_delta numeric;
  v_stock_after   numeric;
  v_new_id        uuid;
  v_age_seconds   numeric;
  v_linked_expense_locked boolean := false;
BEGIN
  -- Load original movement
  SELECT * INTO v_mov
  FROM public.stock_movements
  WHERE id = _movement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found' USING ERRCODE = 'P0002';
  END IF;

  -- Only manual adjustments are undoable
  IF v_mov.movement_type <> 'adjustment' THEN
    RAISE EXCEPTION 'Only manual adjustments can be undone' USING ERRCODE = 'P0001';
  END IF;

  -- Server-side lock check: movement locked by closed shift
  IF v_mov.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This stock movement is locked because its shift has been closed. Undo is not allowed.'
      USING ERRCODE = 'P0001', HINT = 'locked';
  END IF;

  -- Server-side lock check: any linked expense that is locked
  IF v_mov.reference_type = 'expense' AND v_mov.reference_id IS NOT NULL THEN
    SELECT (locked_at IS NOT NULL) INTO v_linked_expense_locked
    FROM public.expenses
    WHERE id::text = v_mov.reference_id
    LIMIT 1;

    IF COALESCE(v_linked_expense_locked, false) THEN
      RAISE EXCEPTION 'The linked expense is locked because its shift has been closed. Undo is not allowed.'
        USING ERRCODE = 'P0001', HINT = 'locked';
    END IF;
  END IF;

  -- 5-minute undo window enforced server-side
  v_age_seconds := EXTRACT(EPOCH FROM (now() - v_mov.created_at));
  IF v_age_seconds > 300 THEN
    RAISE EXCEPTION 'Undo window (5 minutes) has expired for this adjustment.'
      USING ERRCODE = 'P0001', HINT = 'expired';
  END IF;

  -- Apply reverse delta against current stock
  SELECT current_stock INTO v_current_stock
  FROM public.inventory_items
  WHERE id = v_mov.inventory_item_id
  FOR UPDATE;

  v_reverse_delta := -1 * v_mov.quantity_change;
  v_stock_after   := COALESCE(v_current_stock, 0) + v_reverse_delta;

  UPDATE public.inventory_items
  SET current_stock = v_stock_after,
      updated_at = now()
  WHERE id = v_mov.inventory_item_id;

  -- Write reversing audit row
  INSERT INTO public.stock_movements (
    tenant_id, restaurant_id, inventory_item_id, movement_type,
    quantity_change, stock_before, stock_after,
    reason, reference_type, reference_id, created_by
  ) VALUES (
    v_mov.tenant_id, v_mov.restaurant_id, v_mov.inventory_item_id, 'adjustment',
    v_reverse_delta, COALESCE(v_current_stock, 0), v_stock_after,
    'Undo of adjustment from ' || to_char(v_mov.created_at, 'Mon DD, HH24:MI'),
    'undo_adjustment', v_mov.id::text, auth.uid()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'undo_movement_id', v_new_id,
    'stock_after', v_stock_after,
    'reversed_delta', v_reverse_delta
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.undo_stock_adjustment(uuid) TO authenticated;