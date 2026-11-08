CREATE OR REPLACE FUNCTION public.update_inventory_wac_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_stock numeric(12,2);
  v_current_cost  numeric(12,4);
  v_new_qty       numeric(12,2);
  v_new_unit_cost numeric(12,4);
  v_new_wac       numeric(12,4);
  v_total_qty     numeric(12,2);
BEGIN
  IF NEW.inventory_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT current_stock, unit_cost
  INTO v_current_stock, v_current_cost
  FROM public.inventory_items
  WHERE id = NEW.inventory_item_id
  FOR UPDATE;

  v_new_qty := COALESCE(NEW.quantity_received, 0);
  v_new_unit_cost := COALESCE(NEW.unit_cost, 0);

  v_total_qty := COALESCE(v_current_stock, 0) + v_new_qty;

  IF v_total_qty <= 0 THEN
    RETURN NEW;
  END IF;

  IF COALESCE(v_current_stock, 0) <= 0 THEN
    v_new_wac := v_new_unit_cost;
  ELSE
    v_new_wac := (
      (COALESCE(v_current_stock, 0) * COALESCE(v_current_cost, 0))
      + (v_new_qty * v_new_unit_cost)
    ) / v_total_qty;
  END IF;

  UPDATE public.inventory_items
  SET unit_cost = v_new_wac,
      updated_at = now()
  WHERE id = NEW.inventory_item_id;

  RETURN NEW;
END;
$$;