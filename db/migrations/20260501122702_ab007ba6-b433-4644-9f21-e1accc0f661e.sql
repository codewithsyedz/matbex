CREATE TABLE IF NOT EXISTS public.vat_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  tenant_id UUID,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  box1_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box1_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box1_1_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box1_1_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box2_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box2_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box3_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box3_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box4_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box4_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box5_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box5_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box7_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box7_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box7_1_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box7_1_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box8_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box8_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box8_1_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box8_1_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box9_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box9_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box9_1_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box9_1_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box10_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box10_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box11_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  box11_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  box14_corrections NUMERIC(14,2) NOT NULL DEFAULT 0,
  box15_credit_carried NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_vat_returns_restaurant_period
  ON public.vat_returns (restaurant_id, period_start, period_end);

ALTER TABLE public.vat_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "VAT returns viewable by restaurant members"
ON public.vat_returns FOR SELECT
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "VAT returns insertable by owners/managers"
ON public.vat_returns FOR INSERT
WITH CHECK (
  public.can_access_restaurant(restaurant_id)
  AND (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  )
);

CREATE POLICY "VAT returns updatable by owners/managers"
ON public.vat_returns FOR UPDATE
USING (
  public.can_access_restaurant(restaurant_id)
  AND (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  )
);

CREATE POLICY "VAT returns deletable by owners"
ON public.vat_returns FOR DELETE
USING (
  public.can_access_restaurant(restaurant_id)
  AND public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
);

CREATE TRIGGER update_vat_returns_updated_at
BEFORE UPDATE ON public.vat_returns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();