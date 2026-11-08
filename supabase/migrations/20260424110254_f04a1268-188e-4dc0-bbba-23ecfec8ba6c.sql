-- Add partial payment support to expenses
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0;

-- Backfill: existing 'paid' expenses are fully paid; 'unpaid' stay at 0
UPDATE public.expenses
SET paid_amount = amount
WHERE status = 'paid' AND paid_amount = 0;

-- Trigger: keep status in sync with paid_amount vs amount
CREATE OR REPLACE FUNCTION public.sync_expense_payment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.paid_amount IS NULL THEN
    NEW.paid_amount := 0;
  END IF;
  IF NEW.paid_amount < 0 THEN
    RAISE EXCEPTION 'paid_amount cannot be negative';
  END IF;
  IF NEW.paid_amount > NEW.amount THEN
    RAISE EXCEPTION 'paid_amount (%) cannot exceed amount (%)', NEW.paid_amount, NEW.amount;
  END IF;
  IF NEW.paid_amount >= NEW.amount AND NEW.amount > 0 THEN
    NEW.status := 'paid';
  ELSE
    NEW.status := 'unpaid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_expense_payment_status ON public.expenses;
CREATE TRIGGER trg_sync_expense_payment_status
BEFORE INSERT OR UPDATE OF paid_amount, amount, status ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.sync_expense_payment_status();