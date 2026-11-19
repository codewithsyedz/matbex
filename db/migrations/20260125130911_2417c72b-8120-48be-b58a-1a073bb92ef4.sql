-- =====================================================
-- EPIC 4: EXPENSE MANAGEMENT
-- Enhanced expense tracking with CoA integration and approval workflow
-- =====================================================

-- 1. Create expense approval status enum
DO $$ BEGIN
  CREATE TYPE expense_approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Add new columns to expenses table for CoA mapping, payment method, and approval workflow
ALTER TABLE public.expenses 
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.chart_of_accounts(id),
ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'cheque', 'other')),
ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id),
ADD COLUMN IF NOT EXISTS ledger_posted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ledger_transaction_id UUID REFERENCES public.account_transactions(id);

-- 3. Create index for approval queue queries
CREATE INDEX IF NOT EXISTS idx_expenses_approval_status ON public.expenses(approval_status);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_id ON public.expenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_account_id ON public.expenses(account_id);

-- 4. Backfill tenant_id from restaurant for existing records
UPDATE public.expenses e
SET tenant_id = r.tenant_id
FROM public.restaurants r
WHERE e.restaurant_id = r.id AND e.tenant_id IS NULL;

-- 5. Create function to prevent rejected expenses from posting to ledger
CREATE OR REPLACE FUNCTION public.validate_expense_ledger_posting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- If trying to post to ledger, check approval status
  IF NEW.ledger_posted = TRUE AND OLD.ledger_posted = FALSE THEN
    IF NEW.approval_status != 'approved' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted to the ledger. Current status: %', NEW.approval_status;
    END IF;
    
    -- Ensure CoA account is assigned
    IF NEW.account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Expense must have a Chart of Accounts mapping before posting to ledger.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 6. Create trigger for ledger posting validation
DROP TRIGGER IF EXISTS trigger_validate_expense_ledger ON public.expenses;
CREATE TRIGGER trigger_validate_expense_ledger
BEFORE UPDATE ON public.expenses
FOR EACH ROW
WHEN (NEW.ledger_posted IS DISTINCT FROM OLD.ledger_posted)
EXECUTE FUNCTION public.validate_expense_ledger_posting();

-- 7. Create function to auto-set tenant_id on expense insert
CREATE OR REPLACE FUNCTION public.set_expense_tenant_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM public.restaurants
    WHERE id = NEW.restaurant_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 8. Create trigger for auto-setting tenant_id
DROP TRIGGER IF EXISTS trigger_set_expense_tenant ON public.expenses;
CREATE TRIGGER trigger_set_expense_tenant
BEFORE INSERT ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.set_expense_tenant_id();

-- 9. Create function to log approval actions
CREATE OR REPLACE FUNCTION public.log_expense_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    -- Set approval timestamp and user
    IF NEW.approval_status IN ('approved', 'rejected') THEN
      NEW.approved_at := now();
      NEW.approved_by := auth.uid();
    END IF;
    
    -- Log to audit
    INSERT INTO public.audit_logs (
      user_id, 
      tenant_id, 
      action, 
      entity_type, 
      entity_id, 
      old_data, 
      new_data
    ) VALUES (
      auth.uid(),
      NEW.tenant_id,
      'EXPENSE_' || UPPER(NEW.approval_status),
      'expense',
      NEW.id,
      jsonb_build_object('approval_status', OLD.approval_status),
      jsonb_build_object('approval_status', NEW.approval_status, 'rejection_reason', NEW.rejection_reason)
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- 10. Create trigger for approval logging
DROP TRIGGER IF EXISTS trigger_log_expense_approval ON public.expenses;
CREATE TRIGGER trigger_log_expense_approval
BEFORE UPDATE ON public.expenses
FOR EACH ROW
WHEN (NEW.approval_status IS DISTINCT FROM OLD.approval_status)
EXECUTE FUNCTION public.log_expense_approval();

-- 11. Create function to post approved expense to ledger
CREATE OR REPLACE FUNCTION public.post_expense_to_ledger(
  p_expense_id UUID,
  p_account_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_expense RECORD;
  v_transaction_id UUID;
BEGIN
  -- Get expense details
  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = p_expense_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  
  IF v_expense.approval_status != 'approved' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted to ledger';
  END IF;
  
  IF v_expense.ledger_posted THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense has already been posted to ledger';
  END IF;
  
  -- Create ledger transaction (debit the expense account)
  INSERT INTO public.account_transactions (
    tenant_id,
    account_id,
    transaction_date,
    debit,
    credit,
    description,
    reference_type,
    reference_id,
    created_by
  ) VALUES (
    v_expense.tenant_id,
    p_account_id,
    v_expense.expense_date,
    v_expense.amount,
    NULL,
    COALESCE(v_expense.description, 'Expense'),
    'expense',
    p_expense_id,
    auth.uid()
  )
  RETURNING id INTO v_transaction_id;
  
  -- Update expense as posted
  UPDATE public.expenses
  SET 
    ledger_posted = TRUE,
    ledger_transaction_id = v_transaction_id,
    account_id = p_account_id
  WHERE id = p_expense_id;
  
  RETURN v_transaction_id;
END;
$$;

-- 12. Add RLS policies for expense approval
-- Allow managers/owners to approve expenses
DROP POLICY IF EXISTS "Managers can approve expenses" ON public.expenses;
CREATE POLICY "Managers can approve expenses"
ON public.expenses
FOR UPDATE
USING (
  public.is_superadmin(auth.uid()) OR
  public.can_access_restaurant(restaurant_id)
)
WITH CHECK (
  public.is_superadmin(auth.uid()) OR
  public.can_access_restaurant(restaurant_id)
);

-- Enable realtime for expense updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;