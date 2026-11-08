-- Create customer status enum
CREATE TYPE customer_credit_status AS ENUM ('active', 'suspended', 'blocked');

-- Create settlement status enum  
CREATE TYPE settlement_status AS ENUM ('pending', 'partial', 'settled', 'overdue');

-- Create transaction settlement status enum
CREATE TYPE transaction_settlement_status AS ENUM ('paid', 'unpaid', 'settled');

-- Customers table with credit management
CREATE TABLE public.customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  credit_limit NUMERIC NOT NULL DEFAULT 0,
  current_balance NUMERIC NOT NULL DEFAULT 0,
  credit_status customer_credit_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add index for faster lookups
CREATE INDEX idx_customers_restaurant ON public.customers(restaurant_id);
CREATE INDEX idx_customers_status ON public.customers(credit_status);

-- Enable RLS
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- RLS Policies for customers
CREATE POLICY "Users can view customers in their tenant" ON public.customers
  FOR SELECT USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Users can insert customers in their restaurant" ON public.customers
  FOR INSERT WITH CHECK (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Users can update customers in their restaurant" ON public.customers
  FOR UPDATE USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Users can delete customers in their restaurant" ON public.customers
  FOR DELETE USING (public.can_access_restaurant(restaurant_id));

-- Settlement invoices table
CREATE TABLE public.settlement_invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  status settlement_status NOT NULL DEFAULT 'pending',
  due_date DATE,
  paid_at TIMESTAMP WITH TIME ZONE,
  paid_by UUID,
  payment_method TEXT,
  notes TEXT,
  pdf_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for settlement invoices
CREATE INDEX idx_settlement_invoices_restaurant ON public.settlement_invoices(restaurant_id);
CREATE INDEX idx_settlement_invoices_customer ON public.settlement_invoices(customer_id);
CREATE INDEX idx_settlement_invoices_status ON public.settlement_invoices(status);
CREATE INDEX idx_settlement_invoices_period ON public.settlement_invoices(billing_period_start, billing_period_end);

-- Enable RLS
ALTER TABLE public.settlement_invoices ENABLE ROW LEVEL SECURITY;

-- RLS Policies for settlement_invoices
CREATE POLICY "Users can view settlement invoices in their tenant" ON public.settlement_invoices
  FOR SELECT USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Users can insert settlement invoices in their restaurant" ON public.settlement_invoices
  FOR INSERT WITH CHECK (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Users can update settlement invoices in their restaurant" ON public.settlement_invoices
  FOR UPDATE USING (public.can_access_restaurant(restaurant_id));

-- Add customer and settlement fields to sales_transactions
ALTER TABLE public.sales_transactions 
  ADD COLUMN customer_id UUID REFERENCES public.customers(id),
  ADD COLUMN settlement_status transaction_settlement_status NOT NULL DEFAULT 'paid',
  ADD COLUMN settlement_invoice_id UUID REFERENCES public.settlement_invoices(id),
  ADD COLUMN settled_at TIMESTAMP WITH TIME ZONE;

-- Index for faster settlement queries
CREATE INDEX idx_sales_transactions_customer ON public.sales_transactions(customer_id);
CREATE INDEX idx_sales_transactions_settlement_status ON public.sales_transactions(settlement_status);
CREATE INDEX idx_sales_transactions_settlement_invoice ON public.sales_transactions(settlement_invoice_id);

-- Settlement payments table for tracking partial payments
CREATE TABLE public.settlement_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  settlement_invoice_id UUID NOT NULL REFERENCES public.settlement_invoices(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  payment_method TEXT NOT NULL,
  payment_reference TEXT,
  paid_by UUID NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for settlement payments
CREATE INDEX idx_settlement_payments_invoice ON public.settlement_payments(settlement_invoice_id);

-- Enable RLS
ALTER TABLE public.settlement_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for settlement_payments
CREATE POLICY "Users can view settlement payments in their tenant" ON public.settlement_payments
  FOR SELECT USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Users can insert settlement payments in their restaurant" ON public.settlement_payments
  FOR INSERT WITH CHECK (public.can_access_restaurant(restaurant_id));

-- Settlement audit log
CREATE TABLE public.settlement_audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  settlement_invoice_id UUID REFERENCES public.settlement_invoices(id),
  customer_id UUID REFERENCES public.customers(id),
  action TEXT NOT NULL,
  actor_id UUID NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for audit logs
CREATE INDEX idx_settlement_audit_logs_invoice ON public.settlement_audit_logs(settlement_invoice_id);
CREATE INDEX idx_settlement_audit_logs_customer ON public.settlement_audit_logs(customer_id);

-- Enable RLS
ALTER TABLE public.settlement_audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for settlement_audit_logs
CREATE POLICY "Users can view settlement audit logs in their tenant" ON public.settlement_audit_logs
  FOR SELECT USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Users can insert settlement audit logs in their restaurant" ON public.settlement_audit_logs
  FOR INSERT WITH CHECK (public.can_access_restaurant(restaurant_id));

-- Function to update customer balance when transactions change
CREATE OR REPLACE FUNCTION public.update_customer_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Recalculate customer balance based on unpaid transactions
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET current_balance = (
      SELECT COALESCE(SUM(total), 0)
      FROM public.sales_transactions
      WHERE customer_id = NEW.customer_id
        AND settlement_status = 'unpaid'
    ),
    updated_at = now()
    WHERE id = NEW.customer_id;
  END IF;
  
  -- Also update old customer if changed
  IF OLD.customer_id IS NOT NULL AND OLD.customer_id != NEW.customer_id THEN
    UPDATE public.customers
    SET current_balance = (
      SELECT COALESCE(SUM(total), 0)
      FROM public.sales_transactions
      WHERE customer_id = OLD.customer_id
        AND settlement_status = 'unpaid'
    ),
    updated_at = now()
    WHERE id = OLD.customer_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger to update customer balance
CREATE TRIGGER update_customer_balance_trigger
AFTER INSERT OR UPDATE ON public.sales_transactions
FOR EACH ROW
EXECUTE FUNCTION public.update_customer_balance();

-- Function to check credit limit before allowing unpaid transaction
CREATE OR REPLACE FUNCTION public.check_customer_credit_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  customer_record RECORD;
BEGIN
  -- Only check for unpaid transactions
  IF NEW.settlement_status = 'unpaid' AND NEW.customer_id IS NOT NULL THEN
    SELECT credit_limit, current_balance, credit_status
    INTO customer_record
    FROM public.customers
    WHERE id = NEW.customer_id;
    
    -- Check if customer is blocked
    IF customer_record.credit_status = 'blocked' THEN
      RAISE EXCEPTION 'Customer account is blocked';
    END IF;
    
    -- Check credit limit (if limit is > 0)
    IF customer_record.credit_limit > 0 AND 
       (customer_record.current_balance + NEW.total) > customer_record.credit_limit THEN
      RAISE EXCEPTION 'Transaction would exceed customer credit limit of %', customer_record.credit_limit;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger to check credit limit before insert
CREATE TRIGGER check_credit_limit_trigger
BEFORE INSERT ON public.sales_transactions
FOR EACH ROW
EXECUTE FUNCTION public.check_customer_credit_limit();

-- Add updated_at triggers
CREATE TRIGGER update_customers_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_settlement_invoices_updated_at
BEFORE UPDATE ON public.settlement_invoices
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();