
-- 1. History / audit table
CREATE TABLE public.menu_item_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  price_row_id UUID,
  action TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  changed_by UUID REFERENCES auth.users(id),
  effective_from DATE,
  effective_to DATE,
  before_data JSONB,
  after_data JSONB,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mibph_lookup
  ON public.menu_item_price_history (branch_id, menu_item_id, created_at DESC);
CREATE INDEX idx_mibph_restaurant
  ON public.menu_item_price_history (restaurant_id, created_at DESC);

GRANT SELECT ON public.menu_item_price_history TO authenticated;
GRANT ALL ON public.menu_item_price_history TO service_role;

ALTER TABLE public.menu_item_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users view price history"
  ON public.menu_item_price_history
  FOR SELECT
  TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- 2. Audit trigger
CREATE OR REPLACE FUNCTION public.log_menu_item_branch_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action TEXT;
  v_row RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_row := OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_row := NEW;
  ELSE
    v_action := 'insert';
    v_row := NEW;
  END IF;

  INSERT INTO public.menu_item_price_history (
    restaurant_id, branch_id, menu_item_id, price_row_id,
    action, changed_by, effective_from, effective_to,
    before_data, after_data, note
  ) VALUES (
    v_row.restaurant_id, v_row.branch_id, v_row.menu_item_id, v_row.id,
    v_action, auth.uid(), v_row.effective_from, v_row.effective_to,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('UPDATE','INSERT') THEN to_jsonb(NEW) END,
    v_row.note
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_menu_item_branch_price_change
  ON public.menu_item_branch_prices;

CREATE TRIGGER trg_log_menu_item_branch_price_change
AFTER INSERT OR UPDATE OR DELETE
ON public.menu_item_branch_prices
FOR EACH ROW
EXECUTE FUNCTION public.log_menu_item_branch_price_change();

-- 3. Overlap prevention trigger
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
    AND daterange(effective_from, COALESCE(effective_to, DATE '9999-12-31'), '[]')
        && daterange(NEW.effective_from, v_new_to, '[]')
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

DROP TRIGGER IF EXISTS trg_prevent_menu_item_branch_price_overlap
  ON public.menu_item_branch_prices;

CREATE TRIGGER trg_prevent_menu_item_branch_price_overlap
BEFORE INSERT OR UPDATE
ON public.menu_item_branch_prices
FOR EACH ROW
EXECUTE FUNCTION public.prevent_menu_item_branch_price_overlap();
