
-- ============ Menu Item Branch Prices ============
CREATE TABLE public.menu_item_branch_prices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  quarter_price NUMERIC(12,2),
  half_price NUMERIC(12,2),
  full_price NUMERIC(12,2),
  cost_override NUMERIC(12,2),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT menu_item_branch_prices_valid_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX idx_mibp_lookup
  ON public.menu_item_branch_prices (branch_id, menu_item_id, effective_from DESC);
CREATE INDEX idx_mibp_restaurant ON public.menu_item_branch_prices (restaurant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_item_branch_prices TO authenticated;
GRANT ALL ON public.menu_item_branch_prices TO service_role;

ALTER TABLE public.menu_item_branch_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view branch prices"
  ON public.menu_item_branch_prices FOR SELECT
  TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers manage branch prices - insert"
  ON public.menu_item_branch_prices FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_belongs_to_restaurant(auth.uid(), restaurant_id)
    AND (
      public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    )
  );

CREATE POLICY "Managers manage branch prices - update"
  ON public.menu_item_branch_prices FOR UPDATE
  TO authenticated
  USING (
    public.user_belongs_to_restaurant(auth.uid(), restaurant_id)
    AND (
      public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    )
  );

CREATE POLICY "Managers manage branch prices - delete"
  ON public.menu_item_branch_prices FOR DELETE
  TO authenticated
  USING (
    public.user_belongs_to_restaurant(auth.uid(), restaurant_id)
    AND (
      public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    )
  );

CREATE TRIGGER update_menu_item_branch_prices_updated_at
  BEFORE UPDATE ON public.menu_item_branch_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper: return the active price row for each item at a branch on a given date.
CREATE OR REPLACE FUNCTION public.get_branch_menu_prices(
  _branch_id UUID,
  _at DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  menu_item_id UUID,
  quarter_price NUMERIC,
  half_price NUMERIC,
  full_price NUMERIC,
  cost_override NUMERIC,
  effective_from DATE,
  effective_to DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (p.menu_item_id)
    p.menu_item_id,
    p.quarter_price,
    p.half_price,
    p.full_price,
    p.cost_override,
    p.effective_from,
    p.effective_to
  FROM public.menu_item_branch_prices p
  WHERE p.branch_id = _branch_id
    AND p.effective_from <= _at
    AND (p.effective_to IS NULL OR p.effective_to >= _at)
  ORDER BY p.menu_item_id, p.effective_from DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_branch_menu_prices(UUID, DATE) TO authenticated, anon;

-- ============ Staff Branch Transfers ============
CREATE TABLE public.staff_branch_transfers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  from_branch_id UUID REFERENCES public.branches(id),
  to_branch_id UUID NOT NULL REFERENCES public.branches(id),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT,
  transferred_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sbt_staff ON public.staff_branch_transfers (staff_id, effective_date DESC);
CREATE INDEX idx_sbt_restaurant ON public.staff_branch_transfers (restaurant_id);

GRANT SELECT, INSERT ON public.staff_branch_transfers TO authenticated;
GRANT ALL ON public.staff_branch_transfers TO service_role;

ALTER TABLE public.staff_branch_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view transfers"
  ON public.staff_branch_transfers FOR SELECT
  TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers can create transfers"
  ON public.staff_branch_transfers FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_belongs_to_restaurant(auth.uid(), restaurant_id)
    AND (
      public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    )
  );

-- Trigger: on insert, update the staff member's assigned_branch_id.
-- Past payroll_records and staff_advances keep their branch_id tag.
CREATE OR REPLACE FUNCTION public.apply_staff_branch_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_branch UUID;
BEGIN
  SELECT assigned_branch_id INTO v_current_branch
  FROM public.staff WHERE id = NEW.staff_id;

  -- Backfill from_branch_id when caller didn't set it.
  IF NEW.from_branch_id IS NULL THEN
    NEW.from_branch_id := v_current_branch;
  END IF;

  IF NEW.transferred_by IS NULL THEN
    NEW.transferred_by := auth.uid();
  END IF;

  UPDATE public.staff
     SET assigned_branch_id = NEW.to_branch_id,
         updated_at = now()
   WHERE id = NEW.staff_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_staff_branch_transfer
  BEFORE INSERT ON public.staff_branch_transfers
  FOR EACH ROW EXECUTE FUNCTION public.apply_staff_branch_transfer();
