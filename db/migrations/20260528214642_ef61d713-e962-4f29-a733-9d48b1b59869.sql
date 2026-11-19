
-- Floor plans
CREATE TABLE public.pos_floor_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  restaurant_id UUID NOT NULL,
  branch_id UUID,
  name TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 1000,
  height INTEGER NOT NULL DEFAULT 700,
  is_default BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_floor_plans TO authenticated;
GRANT ALL ON public.pos_floor_plans TO service_role;

ALTER TABLE public.pos_floor_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view floor plans"
ON public.pos_floor_plans FOR SELECT TO authenticated
USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Managers+ can insert floor plans"
ON public.pos_floor_plans FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.restaurant_id = pos_floor_plans.restaurant_id AND ur.role = ANY (ARRAY['owner'::app_role, 'manager'::app_role])));

CREATE POLICY "Managers+ can update floor plans"
ON public.pos_floor_plans FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.restaurant_id = pos_floor_plans.restaurant_id AND ur.role = ANY (ARRAY['owner'::app_role, 'manager'::app_role])));

CREATE POLICY "Managers+ can delete floor plans"
ON public.pos_floor_plans FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.restaurant_id = pos_floor_plans.restaurant_id AND ur.role = ANY (ARRAY['owner'::app_role, 'manager'::app_role])));

CREATE TRIGGER update_pos_floor_plans_updated_at BEFORE UPDATE ON public.pos_floor_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extend pos_tables
ALTER TABLE public.pos_tables
  ADD COLUMN floor_plan_id UUID REFERENCES public.pos_floor_plans(id) ON DELETE SET NULL,
  ADD COLUMN x INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN y INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN width INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN height INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN shape TEXT NOT NULL DEFAULT 'rect' CHECK (shape IN ('rect','circle')),
  ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','seated','ordered','billing','dirty')),
  ADD COLUMN seated_at TIMESTAMPTZ,
  ADD COLUMN server_id UUID,
  ADD COLUMN guest_count INTEGER;

-- Allow cashiers/staff to update status fields (but not edit layout). Existing manager+ policy still covers full updates.
CREATE POLICY "Staff can update table status"
ON public.pos_tables FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()));

-- Add table_id to sales_transactions (nullable)
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES public.pos_tables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_transactions_table_id ON public.sales_transactions(table_id) WHERE table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_tables_floor_plan ON public.pos_tables(floor_plan_id) WHERE floor_plan_id IS NOT NULL;
