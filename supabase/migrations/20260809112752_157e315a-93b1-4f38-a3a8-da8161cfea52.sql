-- Atomic reversal + settlement update for staff advances.
-- Everything below runs inside the function's single transaction: if the
-- settlement update fails, the reversal ledger lines roll back with it.
CREATE OR REPLACE FUNCTION public.reverse_staff_advance_atomic(
  p_advance_id uuid,
  p_reason text DEFAULT NULL,
  p_settlement text DEFAULT 'none'  -- 'none' | 'forgive' | 'delete'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance RECORD;
  v_reason text := COALESCE(NULLIF(trim(p_reason), ''), 'Staff advance reversed');
  v_reversal_id uuid;
  v_did_reverse boolean := false;
BEGIN
  IF p_settlement NOT IN ('none', 'forgive', 'delete') THEN
    RAISE EXCEPTION 'Invalid settlement action: %', p_settlement
      USING ERRCODE = '22023';
  END IF;

  -- Lock the source row for the whole transaction so a concurrent reversal
  -- cannot slip between the status check and the ledger write.
  SELECT * INTO v_advance
  FROM staff_advances
  WHERE id = p_advance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff advance record not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_advance.ledger_posted AND COALESCE(v_advance.ledger_reversed, false) THEN
    IF p_settlement = 'none' THEN
      RAISE EXCEPTION 'REVERSAL_ALREADY_POSTED: this advance is already reversed'
        USING ERRCODE = '23505';
    END IF;
  ELSIF v_advance.ledger_posted THEN
    v_reversal_id := public.reverse_staff_advance_ledger(p_advance_id, v_reason);
    v_did_reverse := true;
  ELSIF p_settlement = 'none' THEN
    RAISE EXCEPTION 'REVERSAL_NOT_POSTED: this advance has no ledger entry to reverse'
      USING ERRCODE = '22023';
  END IF;

  IF p_settlement = 'forgive' THEN
    UPDATE staff_advances
    SET status = 'forgiven', updated_at = now()
    WHERE id = p_advance_id;
  ELSIF p_settlement = 'delete' THEN
    DELETE FROM staff_advances WHERE id = p_advance_id;
  END IF;

  RETURN jsonb_build_object(
    'advance_id', p_advance_id,
    'reversed', v_did_reverse,
    'reversal_transaction_id', COALESCE(v_reversal_id, v_advance.ledger_reversal_transaction_id),
    'settlement', p_settlement,
    'reason', v_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_staff_advance_atomic(uuid, text, text) TO authenticated;