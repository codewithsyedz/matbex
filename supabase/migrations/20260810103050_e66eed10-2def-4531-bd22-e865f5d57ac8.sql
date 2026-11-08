CREATE OR REPLACE FUNCTION public.validate_acquisition_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_acq_id uuid;
  v_total numeric(15,2);
  v_amount numeric(15,2);
  v_status text;
  v_financial_change boolean := true;
BEGIN
  v_acq_id := COALESCE(NEW.acquisition_id, OLD.acquisition_id);
  SELECT amount, classification_status INTO v_amount, v_status FROM project_acquisitions WHERE id = v_acq_id;
  IF v_amount IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'UPDATE' THEN
    v_financial_change := (NEW.amount IS DISTINCT FROM OLD.amount)
      OR (NEW.account_id IS DISTINCT FROM OLD.account_id)
      OR (NEW.capitalize IS DISTINCT FROM OLD.capitalize)
      OR (NEW.label IS DISTINCT FROM OLD.label)
      OR (NEW.acquisition_id IS DISTINCT FROM OLD.acquisition_id);
  END IF;

  IF v_status = 'posted' AND v_financial_change THEN
    RAISE EXCEPTION 'POSTED_LOCKED: Allocations cannot be changed after the acquisition is posted.';
  END IF;

  IF NOT v_financial_change THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_total FROM project_acquisition_allocations WHERE acquisition_id = v_acq_id;
  IF v_total > v_amount + 0.005 THEN
    RAISE EXCEPTION 'ALLOCATION_EXCEEDS: Allocated total (%) exceeds the acquisition price (%).', v_total, v_amount;
  END IF;

  UPDATE project_acquisitions
     SET classification_status = CASE WHEN ABS(v_total - v_amount) <= 0.005 THEN 'classified' ELSE 'pending' END
   WHERE id = v_acq_id AND classification_status <> 'posted';

  RETURN COALESCE(NEW, OLD);
END;
$function$;