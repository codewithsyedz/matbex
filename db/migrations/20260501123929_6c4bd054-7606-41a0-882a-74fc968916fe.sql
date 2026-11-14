-- Extend vat_returns with filing workflow fields
ALTER TABLE public.vat_returns
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready','submitted','paid')),
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sadad_number TEXT,
  ADD COLUMN IF NOT EXISTS zatca_mode BOOLEAN NOT NULL DEFAULT false;

-- Immutable audit log of manual adjustments
CREATE TABLE IF NOT EXISTS public.vat_return_adjustments_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vat_return_id UUID REFERENCES public.vat_returns(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  tenant_id UUID,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  field_key TEXT NOT NULL,
  old_value NUMERIC(14,2),
  new_value NUMERIC(14,2),
  reason TEXT,
  changed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vat_adj_log_restaurant_period
  ON public.vat_return_adjustments_log (restaurant_id, period_start, period_end);

ALTER TABLE public.vat_return_adjustments_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "VAT adj log viewable by restaurant members"
ON public.vat_return_adjustments_log FOR SELECT
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "VAT adj log insertable by owners/managers"
ON public.vat_return_adjustments_log FOR INSERT
WITH CHECK (
  public.can_access_restaurant(restaurant_id)
  AND (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  )
);
-- No UPDATE/DELETE policies = immutable