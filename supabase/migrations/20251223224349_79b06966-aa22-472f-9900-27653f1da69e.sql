-- Allow owners to delete shifts
CREATE POLICY "Owners can delete shifts"
ON public.shifts
FOR DELETE
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role));

-- Allow owners to delete suppliers
CREATE POLICY "Owners can delete suppliers"
ON public.suppliers
FOR DELETE
USING (has_role(auth.uid(), restaurant_id, 'owner'::app_role));