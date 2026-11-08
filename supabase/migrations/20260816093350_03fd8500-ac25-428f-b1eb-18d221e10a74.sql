DROP POLICY IF EXISTS "Staff can view suppliers" ON public.suppliers;
CREATE POLICY "Staff can view suppliers"
ON public.suppliers FOR SELECT
USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'cashier'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'accountant'::app_role)
);
DROP POLICY IF EXISTS "Managers+ can manage suppliers" ON public.suppliers;
CREATE POLICY "Managers+ can manage suppliers"
ON public.suppliers FOR ALL
USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'accountant'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'accountant'::app_role)
);