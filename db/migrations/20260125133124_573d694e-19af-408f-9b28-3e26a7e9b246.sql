-- Epic 8: Audit & Controls - Immutable Ledger & Monthly Close

-- 1. Add soft-delete columns to account_transactions (immutable ledger)
ALTER TABLE public.account_transactions 
ADD COLUMN IF NOT EXISTS is_voided BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS voided_by UUID,
ADD COLUMN IF NOT EXISTS void_reason TEXT,
ADD COLUMN IF NOT EXISTS original_transaction_id UUID REFERENCES public.account_transactions(id);

-- 2. Create fiscal period locks table
CREATE TABLE IF NOT EXISTS public.fiscal_period_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by UUID NOT NULL,
  unlock_requested_at TIMESTAMPTZ,
  unlock_requested_by UUID,
  unlock_reason TEXT,
  unlocked_at TIMESTAMPTZ,
  unlocked_by UUID,
  is_locked BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(restaurant_id, period_start, period_end)
);

-- 3. Create journal entry batches table for grouping related entries
CREATE TABLE IF NOT EXISTS public.journal_entry_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  batch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  reference_number TEXT,
  entry_type TEXT NOT NULL DEFAULT 'adjustment', -- adjustment, correction, reversal, opening_balance
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  is_posted BOOLEAN DEFAULT FALSE,
  posted_at TIMESTAMPTZ,
  posted_by UUID
);

-- 4. Enable RLS on new tables
ALTER TABLE public.fiscal_period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_batches ENABLE ROW LEVEL SECURITY;

-- 5. RLS policies for fiscal_period_locks
CREATE POLICY "Users can view their tenant's period locks"
ON public.fiscal_period_locks FOR SELECT
USING (
  public.is_superadmin(auth.uid()) OR
  public.user_belongs_to_tenant(auth.uid(), tenant_id)
);

CREATE POLICY "Owners can lock periods"
ON public.fiscal_period_locks FOR INSERT
WITH CHECK (
  public.is_superadmin(auth.uid()) OR
  public.has_tenant_role(auth.uid(), tenant_id, 'owner')
);

CREATE POLICY "Owners can update period locks"
ON public.fiscal_period_locks FOR UPDATE
USING (
  public.is_superadmin(auth.uid()) OR
  public.has_tenant_role(auth.uid(), tenant_id, 'owner')
);

-- 6. RLS policies for journal_entry_batches
CREATE POLICY "Users can view their tenant's journal batches"
ON public.journal_entry_batches FOR SELECT
USING (
  public.is_superadmin(auth.uid()) OR
  public.user_belongs_to_tenant(auth.uid(), tenant_id)
);

CREATE POLICY "Managers can create journal batches"
ON public.journal_entry_batches FOR INSERT
WITH CHECK (
  public.is_superadmin(auth.uid()) OR
  public.tenant_has_role(tenant_id, 'manager')
);

CREATE POLICY "Managers can update journal batches"
ON public.journal_entry_batches FOR UPDATE
USING (
  public.is_superadmin(auth.uid()) OR
  public.tenant_has_role(tenant_id, 'manager')
);

-- 7. Function to check if a date is in a locked period
CREATE OR REPLACE FUNCTION public.is_period_locked(p_restaurant_id UUID, p_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.fiscal_period_locks
    WHERE restaurant_id = p_restaurant_id
      AND is_locked = TRUE
      AND p_date BETWEEN period_start AND period_end
  )
$$;

-- 8. Trigger to prevent modifications to transactions in locked periods
CREATE OR REPLACE FUNCTION public.prevent_locked_period_modifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_restaurant_id UUID;
  v_is_locked BOOLEAN;
BEGIN
  -- Get restaurant_id from tenant
  SELECT r.id INTO v_restaurant_id
  FROM public.restaurants r
  WHERE r.tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
  LIMIT 1;
  
  -- Check if the transaction date falls in a locked period
  IF TG_OP = 'INSERT' THEN
    v_is_locked := public.is_period_locked(v_restaurant_id, NEW.transaction_date);
    IF v_is_locked THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Cannot create transactions in locked period. Date % is in a closed fiscal period.', NEW.transaction_date;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Allow voiding transactions (soft delete)
    IF NEW.is_voided = TRUE AND OLD.is_voided = FALSE THEN
      -- Voiding is allowed but logged
      NEW.voided_at := now();
      NEW.voided_by := auth.uid();
      RETURN NEW;
    END IF;
    
    -- Check if original date is locked
    v_is_locked := public.is_period_locked(v_restaurant_id, OLD.transaction_date);
    IF v_is_locked THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Cannot modify transactions in locked period. Date % is in a closed fiscal period.', OLD.transaction_date;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    -- Prevent all hard deletes - must void instead
    RAISE EXCEPTION 'VALIDATION_ERROR: Transactions cannot be deleted. Use void operation to cancel a transaction.';
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 9. Apply the trigger to account_transactions
DROP TRIGGER IF EXISTS enforce_period_lock ON public.account_transactions;
CREATE TRIGGER enforce_period_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.account_transactions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_locked_period_modifications();

-- 10. Function to void a transaction (creates reversing entry)
CREATE OR REPLACE FUNCTION public.void_transaction(p_transaction_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_original RECORD;
  v_reversal_id UUID;
BEGIN
  -- Get original transaction
  SELECT * INTO v_original
  FROM public.account_transactions
  WHERE id = p_transaction_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  
  IF v_original.is_voided THEN
    RAISE EXCEPTION 'Transaction is already voided';
  END IF;
  
  -- Mark original as voided
  UPDATE public.account_transactions
  SET 
    is_voided = TRUE,
    voided_at = now(),
    voided_by = auth.uid(),
    void_reason = p_reason
  WHERE id = p_transaction_id;
  
  -- Create reversing entry
  INSERT INTO public.account_transactions (
    tenant_id,
    account_id,
    transaction_date,
    debit,
    credit,
    description,
    reference_type,
    reference_id,
    created_by,
    original_transaction_id
  ) VALUES (
    v_original.tenant_id,
    v_original.account_id,
    CURRENT_DATE, -- Reversal dated today
    v_original.credit, -- Swap debit/credit
    v_original.debit,
    'VOID: ' || COALESCE(v_original.description, 'Transaction') || ' - ' || p_reason,
    'adjustment',
    p_transaction_id::text,
    auth.uid(),
    p_transaction_id
  )
  RETURNING id INTO v_reversal_id;
  
  -- Log to audit
  PERFORM public.log_audit(
    'TRANSACTION_VOIDED',
    'account_transaction',
    p_transaction_id,
    to_jsonb(v_original),
    jsonb_build_object('void_reason', p_reason, 'reversal_id', v_reversal_id),
    v_original.tenant_id
  );
  
  RETURN v_reversal_id;
END;
$$;

-- 11. Function to lock a fiscal period
CREATE OR REPLACE FUNCTION public.lock_fiscal_period(
  p_restaurant_id UUID, 
  p_period_start DATE, 
  p_period_end DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id UUID;
  v_lock_id UUID;
  v_existing_lock UUID;
BEGIN
  -- Get tenant_id
  SELECT tenant_id INTO v_tenant_id
  FROM public.restaurants WHERE id = p_restaurant_id;
  
  -- Check if period is already locked
  SELECT id INTO v_existing_lock
  FROM public.fiscal_period_locks
  WHERE restaurant_id = p_restaurant_id
    AND period_start = p_period_start
    AND period_end = p_period_end
    AND is_locked = TRUE;
  
  IF v_existing_lock IS NOT NULL THEN
    RAISE EXCEPTION 'This period is already locked';
  END IF;
  
  -- Create lock
  INSERT INTO public.fiscal_period_locks (
    tenant_id,
    restaurant_id,
    period_start,
    period_end,
    locked_by
  ) VALUES (
    v_tenant_id,
    p_restaurant_id,
    p_period_start,
    p_period_end,
    auth.uid()
  )
  ON CONFLICT (restaurant_id, period_start, period_end) 
  DO UPDATE SET
    is_locked = TRUE,
    locked_at = now(),
    locked_by = auth.uid(),
    unlocked_at = NULL,
    unlocked_by = NULL
  RETURNING id INTO v_lock_id;
  
  -- Log to audit
  PERFORM public.log_audit(
    'PERIOD_LOCKED',
    'fiscal_period_lock',
    v_lock_id,
    NULL,
    jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end),
    v_tenant_id
  );
  
  RETURN v_lock_id;
END;
$$;

-- 12. Function to unlock a fiscal period (owner only)
CREATE OR REPLACE FUNCTION public.unlock_fiscal_period(p_lock_id UUID, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lock RECORD;
BEGIN
  -- Get lock details
  SELECT * INTO v_lock
  FROM public.fiscal_period_locks
  WHERE id = p_lock_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lock not found';
  END IF;
  
  IF NOT v_lock.is_locked THEN
    RAISE EXCEPTION 'Period is not currently locked';
  END IF;
  
  -- Verify owner role
  IF NOT public.has_tenant_role(auth.uid(), v_lock.tenant_id, 'owner') AND NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Only owners can unlock fiscal periods';
  END IF;
  
  -- Unlock
  UPDATE public.fiscal_period_locks
  SET 
    is_locked = FALSE,
    unlocked_at = now(),
    unlocked_by = auth.uid(),
    unlock_reason = p_reason
  WHERE id = p_lock_id;
  
  -- Log to audit
  PERFORM public.log_audit(
    'PERIOD_UNLOCKED',
    'fiscal_period_lock',
    p_lock_id,
    to_jsonb(v_lock),
    jsonb_build_object('unlock_reason', p_reason),
    v_lock.tenant_id
  );
  
  RETURN TRUE;
END;
$$;

-- 13. Add batch_id to account_transactions for journal entry grouping
ALTER TABLE public.account_transactions
ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.journal_entry_batches(id);

-- 14. Index for performance
CREATE INDEX IF NOT EXISTS idx_period_locks_restaurant_dates 
ON public.fiscal_period_locks(restaurant_id, period_start, period_end) 
WHERE is_locked = TRUE;

CREATE INDEX IF NOT EXISTS idx_transactions_voided 
ON public.account_transactions(is_voided) 
WHERE is_voided = TRUE;

CREATE INDEX IF NOT EXISTS idx_transactions_batch 
ON public.account_transactions(batch_id) 
WHERE batch_id IS NOT NULL;