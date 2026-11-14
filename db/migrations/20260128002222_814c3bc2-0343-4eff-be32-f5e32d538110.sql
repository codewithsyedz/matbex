-- Create overhead_payments table to track monthly payments
CREATE TABLE public.overhead_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  overhead_allocation_id UUID NOT NULL REFERENCES overhead_allocation(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_month DATE NOT NULL,
  amount_paid NUMERIC NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  notes TEXT,
  ledger_posted BOOLEAN DEFAULT false,
  ledger_transaction_id UUID REFERENCES account_transactions(id),
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(overhead_allocation_id, payment_month)
);

-- Enable RLS
ALTER TABLE overhead_payments ENABLE ROW LEVEL SECURITY;

-- RLS policies using user_tenant_roles
CREATE POLICY "Users can view overhead payments for their restaurant"
  ON overhead_payments FOR SELECT
  USING (restaurant_id IN (
    SELECT restaurant_id FROM user_tenant_roles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can create overhead payments for their restaurant"
  ON overhead_payments FOR INSERT
  WITH CHECK (restaurant_id IN (
    SELECT restaurant_id FROM user_tenant_roles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update overhead payments for their restaurant"
  ON overhead_payments FOR UPDATE
  USING (restaurant_id IN (
    SELECT restaurant_id FROM user_tenant_roles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can delete overhead payments for their restaurant"
  ON overhead_payments FOR DELETE
  USING (restaurant_id IN (
    SELECT restaurant_id FROM user_tenant_roles WHERE user_id = auth.uid()
  ));

-- Create function to post overhead payment to ledger
CREATE OR REPLACE FUNCTION post_overhead_payment_to_ledger(
  p_payment_id UUID,
  p_payment_method TEXT DEFAULT 'cash'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_overhead RECORD;
  v_batch_id UUID;
  v_expense_account_id UUID;
  v_credit_account_id UUID;
BEGIN
  SELECT * INTO v_payment FROM overhead_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  
  IF v_payment.ledger_posted = true THEN
    RAISE EXCEPTION 'Payment already posted to ledger';
  END IF;
  
  SELECT * INTO v_overhead FROM overhead_allocation WHERE id = v_payment.overhead_allocation_id;
  
  IF v_overhead.account_id IS NOT NULL THEN
    v_expense_account_id := v_overhead.account_id;
  ELSE
    SELECT id INTO v_expense_account_id FROM chart_of_accounts 
    WHERE tenant_id = v_payment.tenant_id 
    AND account_code = CASE 
      WHEN LOWER(v_overhead.name) LIKE '%rent%' THEN '6000'
      WHEN LOWER(v_overhead.name) LIKE '%utilit%' OR LOWER(v_overhead.name) LIKE '%electric%' OR LOWER(v_overhead.name) LIKE '%water%' OR LOWER(v_overhead.name) LIKE '%gas%' THEN '6050'
      WHEN LOWER(v_overhead.name) LIKE '%insurance%' THEN '6100'
      WHEN LOWER(v_overhead.name) LIKE '%internet%' OR LOWER(v_overhead.name) LIKE '%phone%' THEN '6150'
      ELSE '6200'
    END
    AND is_active = true
    LIMIT 1;
  END IF;
  
  SELECT id INTO v_credit_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_payment.tenant_id 
  AND account_code = CASE 
    WHEN p_payment_method = 'cash' THEN '1000'
    WHEN p_payment_method IN ('card', 'bank') THEN '1010'
    ELSE '2000'
  END
  AND is_active = true
  LIMIT 1;
  
  IF v_expense_account_id IS NULL OR v_credit_account_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts not found';
  END IF;
  
  INSERT INTO journal_entry_batches (
    tenant_id, description, reference_type, reference_id, entry_date, is_approved
  ) VALUES (
    v_payment.tenant_id,
    'Overhead Payment: ' || v_overhead.name || ' for ' || TO_CHAR(v_payment.payment_month, 'Mon YYYY'),
    'overhead_payment',
    p_payment_id,
    v_payment.payment_date,
    true
  ) RETURNING id INTO v_batch_id;
  
  INSERT INTO account_transactions (
    tenant_id, account_id, batch_id, transaction_date, debit, description, reference_type, reference_id
  ) VALUES (
    v_payment.tenant_id, v_expense_account_id, v_batch_id, v_payment.payment_date,
    v_payment.amount_paid, 'Overhead: ' || v_overhead.name, 'overhead_payment', p_payment_id
  );
  
  INSERT INTO account_transactions (
    tenant_id, account_id, batch_id, transaction_date, credit, description, reference_type, reference_id
  ) VALUES (
    v_payment.tenant_id, v_credit_account_id, v_batch_id, v_payment.payment_date,
    v_payment.amount_paid, 'Overhead: ' || v_overhead.name, 'overhead_payment', p_payment_id
  );
  
  UPDATE chart_of_accounts SET balance = COALESCE(balance, 0) + v_payment.amount_paid 
  WHERE id = v_expense_account_id;
  
  UPDATE chart_of_accounts SET balance = COALESCE(balance, 0) - v_payment.amount_paid 
  WHERE id = v_credit_account_id;
  
  UPDATE overhead_payments SET 
    ledger_posted = true,
    ledger_transaction_id = v_batch_id,
    updated_at = now()
  WHERE id = p_payment_id;
  
  RETURN v_batch_id;
END;
$$;

-- Update validation trigger to allow overhead_payment reference type
CREATE OR REPLACE FUNCTION validate_transaction_account_mapping()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reference_type IN (
    'daily_sales', 'expense', 'settlement', 'balance_adjustment', 
    'payroll', 'supplier_payment', 'staff_advance', 'advance_deduction',
    'inventory_purchase', 'purchase_invoice', 'overhead_payment'
  ) THEN
    RETURN NEW;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM chart_of_accounts 
    WHERE id = NEW.account_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Invalid or inactive account';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;