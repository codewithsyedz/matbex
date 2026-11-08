DROP POLICY IF EXISTS "Owners and managers can view POS settings" ON public.pos_hardware_settings;
DROP POLICY IF EXISTS "Staff can view POS settings" ON public.pos_hardware_settings;

CREATE POLICY "Staff can view POS settings"
ON public.pos_hardware_settings
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'cashier'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'waiter'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'accountant'::app_role)
);