-- Create staff_advances table for tracking advance payments to staff
CREATE TABLE public.staff_advances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank_transfer', 'cheque')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deducted', 'forgiven')),
  deducted_from_payroll_id UUID REFERENCES public.payroll_records(id) ON DELETE SET NULL,
  deducted_at TIMESTAMP WITH TIME ZONE,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Ledger integration
  ledger_posted BOOLEAN DEFAULT false,
  ledger_transaction_id UUID REFERENCES public.account_transactions(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.staff_advances ENABLE ROW LEVEL SECURITY;

-- Create RLS policies - only managers and owners can manage advances
CREATE POLICY "Managers and owners can view staff advances" ON public.staff_advances
FOR SELECT USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role) 
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);

CREATE POLICY "Managers and owners can create staff advances" ON public.staff_advances
FOR INSERT WITH CHECK (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role) 
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);

CREATE POLICY "Managers and owners can update staff advances" ON public.staff_advances
FOR UPDATE USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role) 
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);

CREATE POLICY "Owners can delete staff advances" ON public.staff_advances
FOR DELETE USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
);

-- Create index for common queries
CREATE INDEX idx_staff_advances_staff_id ON public.staff_advances(staff_id);
CREATE INDEX idx_staff_advances_restaurant_id ON public.staff_advances(restaurant_id);
CREATE INDEX idx_staff_advances_status ON public.staff_advances(status);

-- Create function to post advance to ledger
-- DR Employee Advances Receivable (1150), CR Cash/Bank (1000/1010)
CREATE OR REPLACE FUNCTION post_staff_advance_to_ledger(p_advance_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance RECORD;
  v_restaurant RECORD;
  v_advance_account_id uuid;
  v_cash_account_id uuid;
  v_transaction_id uuid;
  v_staff_name text;
BEGIN
  -- Get advance details with staff name
  SELECT sa.*, s.name as staff_name INTO v_advance 
  FROM staff_advances sa
  JOIN staff s ON sa.staff_id = s.id
  WHERE sa.id = p_advance_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff advance record not found';
  END IF;
  
  IF v_advance.ledger_posted THEN
    RAISE EXCEPTION 'Advance already posted to ledger';
  END IF;
  
  -- Get restaurant
  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_advance.restaurant_id;
  
  -- Get or create Employee Advances Receivable account (1150)
  SELECT id INTO v_advance_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1150' AND is_active = true LIMIT 1;
  
  -- If account doesn't exist, create it
  IF v_advance_account_id IS NULL THEN
    INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
    VALUES (v_restaurant.tenant_id, '1150', 'Employee Advances Receivable', 'asset', 'Advances given to employees pending deduction from salary')
    RETURNING id INTO v_advance_account_id;
  END IF;
  
  -- Get Cash account
  SELECT id INTO v_cash_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
  
  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash account (1000) not configured';
  END IF;
  
  -- DEBIT: Employee Advances Receivable (asset increases)
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit, 
    description, reference_type, reference_id, created_by
  )
  VALUES (
    v_restaurant.tenant_id, v_advance_account_id, v_advance.advance_date, v_advance.amount,
    'Staff Advance - ' || v_advance.staff_name, 'staff_advance', p_advance_id, v_advance.created_by
  )
  RETURNING id INTO v_transaction_id;
  
  -- CREDIT: Cash (asset decreases)
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, credit, 
    description, reference_type, reference_id, created_by
  )
  VALUES (
    v_restaurant.tenant_id, v_cash_account_id, v_advance.advance_date, v_advance.amount,
    'Staff Advance - ' || v_advance.staff_name, 'staff_advance', p_advance_id, v_advance.created_by
  );
  
  -- Mark as posted
  UPDATE staff_advances 
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_advance_id;
  
  RETURN v_transaction_id;
END;
$$;

-- Create function to reverse advance when deducted from payroll
-- DR Cash/Wages (reduces what's paid), CR Employee Advances Receivable (asset decreases)
CREATE OR REPLACE FUNCTION deduct_advance_from_payroll(p_advance_id uuid, p_payroll_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance RECORD;
  v_restaurant RECORD;
  v_advance_account_id uuid;
  v_wages_account_id uuid;
  v_staff_name text;
BEGIN
  -- Get advance details
  SELECT sa.*, s.name as staff_name INTO v_advance 
  FROM staff_advances sa
  JOIN staff s ON sa.staff_id = s.id
  WHERE sa.id = p_advance_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff advance record not found';
  END IF;
  
  IF v_advance.status = 'deducted' THEN
    RAISE EXCEPTION 'Advance already deducted';
  END IF;
  
  -- Get restaurant
  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_advance.restaurant_id;
  
  -- Get accounts
  SELECT id INTO v_advance_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1150' AND is_active = true LIMIT 1;
  
  SELECT id INTO v_wages_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '6100' AND is_active = true LIMIT 1;
  
  IF v_advance_account_id IS NOT NULL AND v_wages_account_id IS NOT NULL THEN
    -- DEBIT: Wages (reduces net payment)
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, debit, 
      description, reference_type, reference_id
    )
    VALUES (
      v_restaurant.tenant_id, v_wages_account_id, CURRENT_DATE, v_advance.amount,
      'Advance Deduction - ' || v_advance.staff_name, 'advance_deduction', p_advance_id
    );
    
    -- CREDIT: Employee Advances Receivable (asset decreases)
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit, 
      description, reference_type, reference_id
    )
    VALUES (
      v_restaurant.tenant_id, v_advance_account_id, CURRENT_DATE, v_advance.amount,
      'Advance Deduction - ' || v_advance.staff_name, 'advance_deduction', p_advance_id
    );
  END IF;
  
  -- Update advance status
  UPDATE staff_advances 
  SET status = 'deducted', 
      deducted_from_payroll_id = p_payroll_id,
      deducted_at = now(),
      updated_at = now()
  WHERE id = p_advance_id;
END;
$$;