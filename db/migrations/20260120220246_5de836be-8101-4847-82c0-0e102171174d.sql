-- Create customer balance adjustments table for manual corrections
CREATE TABLE public.customer_balance_adjustments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('credit', 'debit', 'correction', 'write_off')),
  amount NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reference_number TEXT
);

-- Enable RLS
ALTER TABLE public.customer_balance_adjustments ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view adjustments for their tenant"
  ON public.customer_balance_adjustments FOR SELECT
  USING (
    public.is_superadmin(auth.uid()) 
    OR public.user_belongs_to_tenant(auth.uid(), tenant_id)
  );

CREATE POLICY "Users can create adjustments for their tenant"
  ON public.customer_balance_adjustments FOR INSERT
  WITH CHECK (
    public.is_superadmin(auth.uid()) 
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'owner')
  );

-- Create trigger function to update customer balance on adjustment
CREATE OR REPLACE FUNCTION public.apply_balance_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  adjustment_amount NUMERIC;
BEGIN
  -- Determine the direction of adjustment
  IF NEW.adjustment_type IN ('credit', 'write_off') THEN
    -- Credit reduces the balance (payment/write-off)
    adjustment_amount := -NEW.amount;
  ELSE
    -- Debit/correction adds to the balance
    adjustment_amount := NEW.amount;
  END IF;

  -- Update customer balance
  UPDATE public.customers
  SET current_balance = GREATEST(0, current_balance + adjustment_amount),
      updated_at = now()
  WHERE id = NEW.customer_id;

  RETURN NEW;
END;
$$;

-- Create trigger for balance adjustment
CREATE TRIGGER apply_customer_balance_adjustment
  AFTER INSERT ON public.customer_balance_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_balance_adjustment();

-- Generate reference number for adjustments
CREATE OR REPLACE FUNCTION public.generate_adjustment_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.reference_number IS NULL THEN
    NEW.reference_number := 'ADJ-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_adjustment_reference
  BEFORE INSERT ON public.customer_balance_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_adjustment_reference();