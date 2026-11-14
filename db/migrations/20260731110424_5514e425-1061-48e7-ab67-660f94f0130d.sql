CREATE TABLE public.menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  key text NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  color text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX menu_categories_key_branch_uidx
  ON public.menu_categories (restaurant_id, key, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX menu_categories_scope_idx ON public.menu_categories (restaurant_id, branch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_categories TO authenticated;
GRANT ALL ON public.menu_categories TO service_role;

ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view menu categories"
ON public.menu_categories FOR SELECT TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Owners and managers can insert menu categories"
ON public.menu_categories FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid())
  AND (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'manager')));

CREATE POLICY "Owners and managers can update menu categories"
ON public.menu_categories FOR UPDATE TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid())
  AND (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'manager')))
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Owners and managers can delete menu categories"
ON public.menu_categories FOR DELETE TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid())
  AND (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'manager')));

CREATE TRIGGER update_menu_categories_updated_at
BEFORE UPDATE ON public.menu_categories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.menu_categories (tenant_id, restaurant_id, key, name_en, name_ar, color, display_order)
SELECT DISTINCT public.get_restaurant_tenant_id(mi.restaurant_id), mi.restaurant_id, d.key, d.name_en, d.name_ar, d.color, d.ord
FROM public.menu_items mi
CROSS JOIN (VALUES
  ('main','Main','رئيسي','blue',1),
  ('appetizer','Appetizer','مقبلات','amber',2),
  ('dessert','Dessert','حلويات','pink',3),
  ('beverage','Beverage','مشروبات','cyan',4),
  ('side','Side','أطباق جانبية','green',5)
) AS d(key,name_en,name_ar,color,ord)
WHERE mi.restaurant_id IS NOT NULL AND public.get_restaurant_tenant_id(mi.restaurant_id) IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.menu_categories (tenant_id, restaurant_id, key, name_en, display_order)
SELECT DISTINCT public.get_restaurant_tenant_id(mi.restaurant_id), mi.restaurant_id, mi.category, initcap(replace(mi.category,'_',' ')), 90
FROM public.menu_items mi
WHERE mi.restaurant_id IS NOT NULL AND public.get_restaurant_tenant_id(mi.restaurant_id) IS NOT NULL
  AND mi.category IS NOT NULL AND mi.category <> ''
ON CONFLICT DO NOTHING;