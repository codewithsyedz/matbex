
-- =========================================================
-- F1: Enforce fiscal period locks on account_transactions
-- =========================================================
CREATE OR REPLACE FUNCTION public.enforce_fiscal_period_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_date   date;
  v_locked boolean;
BEGIN
  -- Superadmins can override (rare support operations)
  IF public.is_superadmin(auth.uid()) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_tenant := OLD.tenant_id;
    v_date   := OLD.transaction_date;
  ELSE
    v_tenant := NEW.tenant_id;
    v_date   := NEW.transaction_date;
  END IF;

  IF v_tenant IS NULL OR v_date IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.fiscal_period_locks
    WHERE tenant_id = v_tenant
      AND is_locked = true
      AND v_date BETWEEN period_start AND period_end
      AND unlocked_at IS NULL
  ) INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION 'Fiscal period containing % is locked. Unlock the period or post to an open period.', v_date
      USING ERRCODE = '55006'; -- object_not_in_prerequisite_state
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_fiscal_lock ON public.account_transactions;
CREATE TRIGGER trg_enforce_fiscal_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.account_transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_fiscal_period_lock();

-- =========================================================
-- F2: audit_logs - restore INSERT policy, block UPDATE/DELETE
-- =========================================================
DROP POLICY IF EXISTS "Authenticated users can insert their own audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert their own audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

DROP POLICY IF EXISTS "No one can update audit logs" ON public.audit_logs;
CREATE POLICY "No one can update audit logs"
ON public.audit_logs
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "No one can delete audit logs" ON public.audit_logs;
CREATE POLICY "No one can delete audit logs"
ON public.audit_logs
FOR DELETE
TO authenticated
USING (false);

-- =========================================================
-- F3: Block hard-delete on sales_transactions (void instead)
-- =========================================================
CREATE OR REPLACE FUNCTION public.prevent_sales_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_superadmin(auth.uid()) THEN
    RAISE WARNING 'SuperAdmin % deleted sales_transaction % (receipt=%)', auth.uid(), OLD.id, OLD.receipt_number;
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Sales transactions cannot be deleted. Use void (settlement_status=''void'') to preserve audit trail.'
    USING ERRCODE = '42501'; -- insufficient_privilege
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_sales_hard_delete ON public.sales_transactions;
CREATE TRIGGER trg_prevent_sales_hard_delete
BEFORE DELETE ON public.sales_transactions
FOR EACH ROW EXECUTE FUNCTION public.prevent_sales_hard_delete();

-- Drop the now-superfluous owner delete policy (the trigger overrides it anyway,
-- but removing the policy makes the contract explicit at the API layer).
DROP POLICY IF EXISTS "Owners can delete sales transactions" ON public.sales_transactions;
