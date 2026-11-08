
CREATE TABLE IF NOT EXISTS public.pos_payment_method_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  payment_method text NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('cash','card','delivery','other')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, payment_method)
);

CREATE INDEX IF NOT EXISTS idx_pos_payment_method_map_restaurant
  ON public.pos_payment_method_map (restaurant_id);

ALTER TABLE public.pos_payment_method_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view payment mapping"
ON public.pos_payment_method_map FOR SELECT
TO authenticated
USING (public.user_belongs_to_tenant(auth.uid(), tenant_id));

CREATE POLICY "Managers can insert payment mapping"
ON public.pos_payment_method_map FOR INSERT
TO authenticated
WITH CHECK (public.tenant_has_role(tenant_id, 'manager'));

CREATE POLICY "Managers can update payment mapping"
ON public.pos_payment_method_map FOR UPDATE
TO authenticated
USING (public.tenant_has_role(tenant_id, 'manager'));

CREATE POLICY "Managers can delete payment mapping"
ON public.pos_payment_method_map FOR DELETE
TO authenticated
USING (public.tenant_has_role(tenant_id, 'manager'));

CREATE TRIGGER trg_pos_payment_method_map_updated_at
BEFORE UPDATE ON public.pos_payment_method_map
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
