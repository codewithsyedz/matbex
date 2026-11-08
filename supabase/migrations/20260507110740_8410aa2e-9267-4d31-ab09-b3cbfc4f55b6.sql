
CREATE TABLE IF NOT EXISTS public.pos_payment_method_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  pattern text NOT NULL,
  match_type text NOT NULL CHECK (match_type IN ('contains','prefix','suffix','regex','exact')),
  bucket text NOT NULL CHECK (bucket IN ('cash','card','delivery','other')),
  priority int NOT NULL DEFAULT 100,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_payment_method_rules_restaurant
  ON public.pos_payment_method_rules (restaurant_id, priority);

ALTER TABLE public.pos_payment_method_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view payment rules"
ON public.pos_payment_method_rules FOR SELECT TO authenticated
USING (public.user_belongs_to_tenant(auth.uid(), tenant_id));

CREATE POLICY "Managers can insert payment rules"
ON public.pos_payment_method_rules FOR INSERT TO authenticated
WITH CHECK (public.tenant_has_role(tenant_id, 'manager'));

CREATE POLICY "Managers can update payment rules"
ON public.pos_payment_method_rules FOR UPDATE TO authenticated
USING (public.tenant_has_role(tenant_id, 'manager'));

CREATE POLICY "Managers can delete payment rules"
ON public.pos_payment_method_rules FOR DELETE TO authenticated
USING (public.tenant_has_role(tenant_id, 'manager'));

CREATE TRIGGER trg_pos_payment_method_rules_updated_at
BEFORE UPDATE ON public.pos_payment_method_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
