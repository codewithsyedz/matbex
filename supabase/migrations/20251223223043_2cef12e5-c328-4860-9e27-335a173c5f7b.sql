-- Allow owners to delete sales transactions
CREATE POLICY "Owners can delete sales transactions"
ON public.sales_transactions
FOR DELETE
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role));

-- Allow owners to delete sales items (needed for cascade delete)
CREATE POLICY "Owners can delete sales items"
ON public.sales_items
FOR DELETE
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role));