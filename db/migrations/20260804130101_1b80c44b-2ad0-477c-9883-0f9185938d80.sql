CREATE OR REPLACE FUNCTION public.is_settlement_batch(_batch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.journal_entry_batches b
    WHERE b.id = _batch_id
      AND (b.reference_number LIKE 'EXPPAY-%' OR b.reference_number LIKE 'EXPPAYREV-%')
  )
$$;

CREATE OR REPLACE FUNCTION public.protect_ap_settlement_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid;
BEGIN
  IF current_setting('app.settlement_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_batch := OLD.batch_id;
  IF v_batch IS NULL OR NOT public.is_settlement_batch(v_batch) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Posted AP settlement entries cannot be deleted. Use the payment reversal flow, which posts a balancing reversal entry.'
      USING ERRCODE = 'check_violation';
  END IF;

  RAISE EXCEPTION 'Posted AP settlement entries are immutable and cannot be edited. Use the payment reversal flow, which posts a balancing reversal entry.'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ap_settlement_transactions ON public.account_transactions;
CREATE TRIGGER trg_protect_ap_settlement_transactions
BEFORE UPDATE OR DELETE ON public.account_transactions
FOR EACH ROW EXECUTE FUNCTION public.protect_ap_settlement_transactions();

CREATE OR REPLACE FUNCTION public.protect_ap_settlement_batches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.settlement_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF COALESCE(OLD.reference_number,'') NOT LIKE 'EXPPAY-%'
     AND COALESCE(OLD.reference_number,'') NOT LIKE 'EXPPAYREV-%' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Posted AP settlement journal batches cannot be deleted. Use the payment reversal flow instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  RAISE EXCEPTION 'Posted AP settlement journal batches are immutable. Use the payment reversal flow instead.'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ap_settlement_batches ON public.journal_entry_batches;
CREATE TRIGGER trg_protect_ap_settlement_batches
BEFORE UPDATE OR DELETE ON public.journal_entry_batches
FOR EACH ROW EXECUTE FUNCTION public.protect_ap_settlement_batches();