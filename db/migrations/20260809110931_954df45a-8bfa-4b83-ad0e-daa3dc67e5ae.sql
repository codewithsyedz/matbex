ALTER TABLE public.staff_advances
  ADD COLUMN IF NOT EXISTS ledger_reversed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ledger_reversal_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS ledger_reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ledger_reversed_by uuid,
  ADD COLUMN IF NOT EXISTS ledger_reversal_reason text;

CREATE OR REPLACE FUNCTION public.reverse_staff_advance_ledger(
  p_advance_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance RECORD;
  v_leg RECORD;
  v_first_reversal_id uuid;
  v_new_id uuid;
  v_reason text := COALESCE(NULLIF(trim(p_reason), ''), 'Staff advance reversed');
  v_count int := 0;
BEGIN
  SELECT sa.*, s.name AS staff_name
    INTO v_advance
  FROM staff_advances sa
  JOIN staff s ON s.id = sa.staff_id
  WHERE sa.id = p_advance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff advance record not found';
  END IF;

  IF NOT v_advance.ledger_posted THEN
    RAISE EXCEPTION 'Advance is not posted to the ledger';
  END IF;

  IF v_advance.ledger_reversed THEN
    RETURN v_advance.ledger_reversal_transaction_id;
  END IF;

  FOR v_leg IN
    SELECT *
    FROM account_transactions
    WHERE reference_type = 'staff_advance'
      AND reference_id = p_advance_id
      AND COALESCE(is_voided, false) = false
  LOOP
    INSERT INTO account_transactions (
      tenant_id, account_id, branch_id, transaction_date,
      debit, credit, description,
      reference_type, reference_id, original_transaction_id, created_by
    )
    VALUES (
      v_leg.tenant_id, v_leg.account_id, v_leg.branch_id, CURRENT_DATE,
      COALESCE(v_leg.credit, 0), COALESCE(v_leg.debit, 0),
      'REVERSAL: ' || COALESCE(v_leg.description, 'Staff Advance - ' || v_advance.staff_name)
        || ' (' || v_reason || ')',
      'staff_advance_reversal', p_advance_id, v_leg.id, auth.uid()
    )
    RETURNING id INTO v_new_id;

    IF v_first_reversal_id IS NULL THEN
      v_first_reversal_id := v_new_id;
    END IF;

    UPDATE account_transactions
    SET is_voided = true,
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = v_reason
    WHERE id = v_leg.id;

    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No active ledger legs found for this advance';
  END IF;

  UPDATE staff_advances
  SET ledger_reversed = true,
      ledger_reversal_transaction_id = v_first_reversal_id,
      ledger_reversed_at = now(),
      ledger_reversed_by = auth.uid(),
      ledger_reversal_reason = v_reason,
      updated_at = now()
  WHERE id = p_advance_id;

  RETURN v_first_reversal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_staff_advance_ledger(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_staff_advance_ledger(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_staff_advance_ledger(uuid, text) TO service_role;