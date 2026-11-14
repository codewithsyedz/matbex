CREATE OR REPLACE FUNCTION public.validate_overhead_payment_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required numeric;
  v_name text;
BEGIN
  SELECT monthly_amount, name INTO v_required, v_name
  FROM public.overhead_allocation
  WHERE id = NEW.overhead_allocation_id;

  IF v_required IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.amount_paid, 0) < v_required - 0.005 THEN
    RAISE EXCEPTION 'Payment of % for overhead "%" is less than the current monthly amount of % (short by %).',
      to_char(COALESCE(NEW.amount_paid,0), 'FM999999990.00'),
      COALESCE(v_name, 'overhead'),
      to_char(v_required, 'FM999999990.00'),
      to_char(v_required - COALESCE(NEW.amount_paid,0), 'FM999999990.00')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_overhead_payment_amount ON public.overhead_payments;
CREATE TRIGGER trg_validate_overhead_payment_amount
BEFORE INSERT OR UPDATE OF amount_paid, overhead_allocation_id ON public.overhead_payments
FOR EACH ROW EXECUTE FUNCTION public.validate_overhead_payment_amount();