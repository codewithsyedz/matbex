CREATE TABLE public.menu_item_branch_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (menu_item_id, branch_id)
);

CREATE INDEX idx_miba_branch ON public.menu_item_branch_availability(branch_id);
CREATE INDEX idx_miba_restaurant ON public.menu_item_branch_availability(restaurant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_item_branch_availability TO authenticated;
GRANT SELECT ON public.menu_item_branch_availability TO anon;
GRANT ALL ON public.menu_item_branch_availability TO service_role;

ALTER TABLE public.menu_item_branch_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view menu branch availability"
  ON public.menu_item_branch_availability FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Public read menu branch availability"
  ON public.menu_item_branch_availability FOR SELECT TO anon
  USING (true);

CREATE POLICY "Managers manage menu branch availability"
  ON public.menu_item_branch_availability FOR ALL TO authenticated
  USING (
    public.user_belongs_to_restaurant(auth.uid(), restaurant_id)
    AND (
      public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    )
  )
  WITH CHECK (
    public.user_belongs_to_restaurant(auth.uid(), restaurant_id)
    AND (
      public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    )
  );

CREATE TRIGGER trg_miba_updated_at
  BEFORE UPDATE ON public.menu_item_branch_availability
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();