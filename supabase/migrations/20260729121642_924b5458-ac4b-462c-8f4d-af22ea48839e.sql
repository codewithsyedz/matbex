
CREATE OR REPLACE FUNCTION public.prevent_menu_item_branch_price_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_to DATE;
  v_conflict RECORD;
BEGIN
  v_new_to := COALESCE(NEW.effective_to, DATE '9999-12-31');

  IF NEW.effective_to IS NOT NULL AND NEW.effective_to < NEW.effective_from THEN
    RAISE EXCEPTION 'effective_to (%) must be on or after effective_from (%)',
      NEW.effective_to, NEW.effective_from
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, effective_from, effective_to
    INTO v_conflict
  FROM public.menu_item_branch_prices
  WHERE branch_id = NEW.branch_id
    AND menu_item_id = NEW.menu_item_id
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND daterange(effective_from, COALESCE(effective_to, DATE '9999-12-31'), '[)')
        && daterange(NEW.effective_from, v_new_to, '[)')
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Overlapping price period for this item at this branch (conflicts with row % [% → %])',
      v_conflict.id, v_conflict.effective_from,
      COALESCE(v_conflict.effective_to::text, 'open')
      USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END;
$$;
