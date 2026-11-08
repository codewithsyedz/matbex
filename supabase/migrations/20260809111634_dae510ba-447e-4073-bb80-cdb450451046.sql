CREATE OR REPLACE FUNCTION public.validate_reversal_linkage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orig public.account_transactions%ROWTYPE;
  v_base text;
BEGIN
  -- Only enforce for reversal-typed lines
  IF NEW.reference_type IS NULL OR NEW.reference_type NOT LIKE '%\_reversal' THEN
    -- A non-reversal line may still carry a link; if so it must be a real, same-tenant row
    IF NEW.original_transaction_id IS NOT NULL THEN
      SELECT * INTO v_orig FROM public.account_transactions WHERE id = NEW.original_transaction_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'REVERSAL_LINK_INVALID: original_transaction_id % does not exist', NEW.original_transaction_id
          USING ERRCODE = '23514';
      END IF;
      IF v_orig.tenant_id <> NEW.tenant_id THEN
        RAISE EXCEPTION 'REVERSAL_LINK_INVALID: original transaction belongs to a different tenant'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- On UPDATE of legacy rows, only re-validate when the linkage actually changes
  IF TG_OP = 'UPDATE'
     AND NEW.original_transaction_id IS NOT DISTINCT FROM OLD.original_transaction_id
     AND NEW.reference_type IS NOT DISTINCT FROM OLD.reference_type
     AND NEW.debit IS NOT DISTINCT FROM OLD.debit
     AND NEW.credit IS NOT DISTINCT FROM OLD.credit THEN
    RETURN NEW;
  END IF;

  IF NEW.original_transaction_id IS NULL THEN
    RAISE EXCEPTION 'REVERSAL_LINK_REQUIRED: a % line must reference the original transaction it reverses', NEW.reference_type
      USING ERRCODE = '23514';
  END IF;

  IF NEW.original_transaction_id = NEW.id THEN
    RAISE EXCEPTION 'REVERSAL_LINK_INVALID: a transaction cannot reverse itself'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_orig FROM public.account_transactions WHERE id = NEW.original_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REVERSAL_LINK_INVALID: original transaction % not found', NEW.original_transaction_id
      USING ERRCODE = '23514';
  END IF;

  IF v_orig.reference_type IS NOT NULL AND v_orig.reference_type LIKE '%\_reversal' THEN
    RAISE EXCEPTION 'REVERSAL_LINK_INVALID: cannot reverse a reversal transaction'
      USING ERRCODE = '23514';
  END IF;

  v_base := left(NEW.reference_type, length(NEW.reference_type) - length('_reversal'));
  IF v_orig.reference_type IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION 'REVERSAL_LINK_INVALID: % must reverse a % transaction (found %)',
      NEW.reference_type, v_base, COALESCE(v_orig.reference_type, 'null')
      USING ERRCODE = '23514';
  END IF;

  IF v_orig.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'REVERSAL_LINK_INVALID: reversal tenant does not match the original transaction'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.reference_id IS DISTINCT FROM v_orig.reference_id THEN
    RAISE EXCEPTION 'REVERSAL_LINK_INVALID: reversal must reference the same source document as the original'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.account_id <> v_orig.account_id THEN
    RAISE EXCEPTION 'REVERSAL_LINK_INVALID: reversal must post to the same account as the original'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.branch_id IS DISTINCT FROM v_orig.branch_id THEN
    RAISE EXCEPTION 'REVERSAL_LINK_INVALID: reversal branch must match the original transaction branch'
      USING ERRCODE = '23514';
  END IF;

  IF ROUND(COALESCE(NEW.debit, 0), 2) <> ROUND(COALESCE(v_orig.credit, 0), 2)
     OR ROUND(COALESCE(NEW.credit, 0), 2) <> ROUND(COALESCE(v_orig.debit, 0), 2) THEN
    RAISE EXCEPTION 'REVERSAL_MIRROR_INVALID: reversal must mirror the original (original DR % / CR %, reversal DR % / CR %)',
      COALESCE(v_orig.debit, 0), COALESCE(v_orig.credit, 0), COALESCE(NEW.debit, 0), COALESCE(NEW.credit, 0)
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_reversal_linkage ON public.account_transactions;
CREATE TRIGGER trg_validate_reversal_linkage
BEFORE INSERT OR UPDATE ON public.account_transactions
FOR EACH ROW EXECUTE FUNCTION public.validate_reversal_linkage();

-- One active reversal per original transaction
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_reversal_per_original
ON public.account_transactions (original_transaction_id)
WHERE original_transaction_id IS NOT NULL
  AND reference_type LIKE '%\_reversal'
  AND COALESCE(is_voided, false) = false;

CREATE INDEX IF NOT EXISTS idx_account_tx_original_transaction
ON public.account_transactions (original_transaction_id)
WHERE original_transaction_id IS NOT NULL;