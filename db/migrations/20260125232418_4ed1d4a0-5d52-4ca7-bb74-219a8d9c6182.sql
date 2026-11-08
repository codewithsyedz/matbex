-- Allow authenticated users to read their own assigned plan
-- This is safe because it only allows reading the plan linked to their tenant
CREATE POLICY "Users can view their assigned plan" 
ON public.plans 
FOR SELECT 
USING (
  id IN (
    SELECT plan_id FROM tenants 
    WHERE id = (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  )
);