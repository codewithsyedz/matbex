CREATE POLICY "Managers+ can delete invoices" ON public.purchase_invoices
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);

CREATE POLICY "Managers+ can delete invoice items" ON public.invoice_items
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.purchase_invoices pi
    WHERE pi.id = invoice_items.invoice_id
      AND (
        has_role(auth.uid(), pi.restaurant_id, 'owner'::app_role)
        OR has_role(auth.uid(), pi.restaurant_id, 'manager'::app_role)
      )
  )
);