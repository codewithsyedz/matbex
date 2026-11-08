-- Create supplier payments table to track payments made to suppliers
CREATE TABLE public.supplier_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.purchase_invoices(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  reference_number TEXT,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view supplier payments in their restaurant"
ON public.supplier_payments
FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Managers+ can create supplier payments"
ON public.supplier_payments
FOR INSERT
WITH CHECK (
  (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'))
  AND created_by = auth.uid()
);

CREATE POLICY "Managers+ can update supplier payments"
ON public.supplier_payments
FOR UPDATE
USING (has_role(auth.uid(), restaurant_id, 'owner') OR has_role(auth.uid(), restaurant_id, 'manager'));

CREATE POLICY "Owners can delete supplier payments"
ON public.supplier_payments
FOR DELETE
USING (has_role(auth.uid(), restaurant_id, 'owner'));

-- Add trigger for updated_at
CREATE TRIGGER update_supplier_payments_updated_at
BEFORE UPDATE ON public.supplier_payments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for performance
CREATE INDEX idx_supplier_payments_supplier ON public.supplier_payments(supplier_id);
CREATE INDEX idx_supplier_payments_restaurant ON public.supplier_payments(restaurant_id);
CREATE INDEX idx_supplier_payments_date ON public.supplier_payments(payment_date);