-- inventory_usage rows were refused with "Consumption date cannot be in the future" for every
-- recipe sale rung up between midnight and 03:00 Riyadh time: the sale's usage_date is the
-- restaurant's business day (Asia/Riyadh, UTC+3) and the check compared it with CURRENT_DATE,
-- which is the database's day (UTC). "Today" is now the restaurant's own date.
CREATE OR REPLACE FUNCTION public.validate_inventory_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_stock NUMERIC;
  v_item_name TEXT;
  v_today date;
BEGIN
  IF NEW.usage_date IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Consumption date is required for inventory usage entries.';
  END IF;

  SELECT (now() AT TIME ZONE COALESCE(r.timezone, 'Asia/Riyadh'))::date INTO v_today
    FROM public.restaurants r WHERE r.id = NEW.restaurant_id;
  -- Either side of the date line counts as today.
  IF NEW.usage_date > GREATEST(COALESCE(v_today, CURRENT_DATE), CURRENT_DATE) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Consumption date cannot be in the future.';
  END IF;

  IF NEW.sale_item_id IS NOT NULL THEN
    -- Stock already moved by the sale; only accept rows that mirror a posting of that line.
    IF NOT EXISTS (
      SELECT 1 FROM public.provisional_cogs_postings p
      WHERE p.sale_item_id = NEW.sale_item_id
        AND p.inventory_item_id = NEW.inventory_item_id
        AND p.restaurant_id = NEW.restaurant_id
        AND p.status <> 'reversed'
    ) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Sale usage must match a stock posting of the same sale line.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT current_stock, name INTO v_current_stock, v_item_name
  FROM public.inventory_items
  WHERE id = NEW.inventory_item_id;

  IF v_current_stock < NEW.quantity_used THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Insufficient stock for "%" - Available: %, Requested: %. Negative inventory is not allowed.',
      v_item_name, v_current_stock, NEW.quantity_used;
  END IF;

  RETURN NEW;
END;
$function$;
