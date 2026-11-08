
-- Fix expense ledger auto-posting so it (a) fires when an expense is inserted already-approved
-- and (b) writes BOTH debit and credit legs via post_expense_to_ledger.

CREATE OR REPLACE FUNCTION public.auto_post_expense_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_should_post BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_should_post := (
      NEW.approval_status = 'approved'
      AND NEW.account_id IS NOT NULL
      AND COALESCE(NEW.ledger_posted, FALSE) = FALSE
      AND NEW.deleted_at IS NULL
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_post := (
      NEW.approval_status = 'approved'
      AND (OLD.approval_status IS DISTINCT FROM NEW.approval_status)
      AND NEW.account_id IS NOT NULL
      AND COALESCE(NEW.ledger_posted, FALSE) = FALSE
      AND NEW.deleted_at IS NULL
    );
  END IF;

  IF v_should_post THEN
    -- post_expense_to_ledger writes both DR + CR legs with a shared batch_id
    -- and flips expenses.ledger_posted / ledger_transaction_id itself.
    PERFORM public.post_expense_to_ledger(NEW.id, NEW.account_id);
  END IF;

  RETURN NEW;
END;
$$;

-- Replace the UPDATE-only trigger with one that also fires AFTER INSERT.
DROP TRIGGER IF EXISTS trg_auto_post_expense_on_approval ON public.expenses;

CREATE TRIGGER trg_auto_post_expense_on_approval_ins
AFTER INSERT ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.auto_post_expense_on_approval();

CREATE TRIGGER trg_auto_post_expense_on_approval_upd
AFTER UPDATE OF approval_status ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.auto_post_expense_on_approval();

-- Backfill ledger postings for any approved expenses still missing them.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, account_id
    FROM public.expenses
    WHERE approval_status = 'approved'
      AND account_id IS NOT NULL
      AND COALESCE(ledger_posted, FALSE) = FALSE
      AND deleted_at IS NULL
  LOOP
    BEGIN
      PERFORM public.post_expense_to_ledger(r.id, r.account_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped expense % during backfill: %', r.id, SQLERRM;
    END;
  END LOOP;
END $$;
