-- Add delete policy for expenses (managers+ can delete)
CREATE POLICY "Managers+ can delete expenses" 
ON public.expenses 
FOR DELETE 
USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR 
  has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);