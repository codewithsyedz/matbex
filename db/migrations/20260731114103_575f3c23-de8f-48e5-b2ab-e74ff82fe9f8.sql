CREATE TABLE public.menu_item_branch_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  restaurant_id uuid NOT NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  category text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, menu_item_id)
);

CREATE INDEX idx_mibc_restaurant_branch ON public.menu_item_branch_categories(restaurant_id, branch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_item_branch_categories TO authenticated;
GRANT ALL ON public.menu_item_branch_categories TO service_role;

ALTER TABLE public.menu_item_branch_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view branch categories"
ON public.menu_item_branch_categories FOR SELECT TO authenticated
USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers manage branch categories - insert"
ON public.menu_item_branch_categories FOR INSERT TO authenticated
WITH CHECK (
  public.user_belongs_to_restaurant(auth.uid(), restaurant_id)
  AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
);

CREATE POLICY "Managers manage branch categories - update"
ON public.menu_item_branch_categories FOR UPDATE TO authenticated
USING (
  public.user_belongs_to_restaurant(auth.uid(), restaurant_id)
  AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
);

CREATE POLICY "Managers manage branch categories - delete"
ON public.menu_item_branch_categories FOR DELETE TO authenticated
USING (
  public.user_belongs_to_restaurant(auth.uid(), restaurant_id)
  AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
);

CREATE TRIGGER trg_mibc_updated_at
BEFORE UPDATE ON public.menu_item_branch_categories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();