-- Allow owners to update sales transactions
CREATE POLICY "Owners can update sales transactions"
ON public.sales_transactions
FOR UPDATE
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role));