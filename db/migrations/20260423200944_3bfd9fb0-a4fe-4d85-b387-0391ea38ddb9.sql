
CREATE TABLE public.expense_category_mapping_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.expense_categories(id) ON DELETE CASCADE,
  user_id UUID,
  resolution TEXT NOT NULL DEFAULT 'unresolved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ecmg_restaurant_category
  ON public.expense_category_mapping_gaps (restaurant_id, category_id, created_at DESC);

ALTER TABLE public.expense_category_mapping_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Restaurant members can insert gap events"
  ON public.expense_category_mapping_gaps
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.restaurant_id = expense_category_mapping_gaps.restaurant_id
    )
  );

CREATE POLICY "Managers can view gap events"
  ON public.expense_category_mapping_gaps
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  );
