-- 1) Shared classifier: is this chart_of_accounts row a real cash/bank account?
CREATE OR REPLACE FUNCTION public.is_cash_or_bank_account(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chart_of_accounts a
    WHERE a.id = p_account_id
      AND a.account_type = 'asset'
      AND a.account_code >= '1000'
      AND a.account_code <  '1100'
      AND a.account_name !~* '(advance|receivable|prepaid|vat|inventory|deposit paid|settlement|clearing)'
  );
$$;

-- 2) Block non cash/bank accounts from being stored as an expense paying account
CREATE OR REPLACE FUNCTION public.enforce_expense_payment_account_is_cash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_name text;
BEGIN
  IF NEW.payment_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.payment_account_id IS NOT DISTINCT FROM NEW.payment_account_id THEN
    RETURN NEW;
  END IF;

  IF public.is_cash_or_bank_account(NEW.payment_account_id) THEN
    RETURN NEW;
  END IF;

  SELECT account_code, account_name INTO v_code, v_name
  FROM public.chart_of_accounts WHERE id = NEW.payment_account_id;

  RAISE EXCEPTION
    'Invalid paying account %: only cash or bank accounts (1000-1099) can settle an expense. Accounts such as staff advances, receivables, prepaids, input VAT or settlement clearing cannot be used.',
    COALESCE(v_code || ' ' || v_name, NEW.payment_account_id::text)
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_expense_payment_account_is_cash ON public.expenses;
CREATE TRIGGER trg_enforce_expense_payment_account_is_cash
BEFORE INSERT OR UPDATE OF payment_account_id ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.enforce_expense_payment_account_is_cash();

-- 3) Guard the settlement RPC itself
CREATE OR REPLACE FUNCTION public.assert_expense_funding_account_valid(p_expense_id uuid, p_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capital uuid;
BEGIN
  SELECT capital_account_id INTO v_capital FROM public.expenses WHERE id = p_expense_id;
  -- Owner / partner funded expenses legitimately credit an equity account.
  IF v_capital IS NOT NULL THEN RETURN true; END IF;
  RETURN public.is_cash_or_bank_account(p_account_id);
END;
$$;