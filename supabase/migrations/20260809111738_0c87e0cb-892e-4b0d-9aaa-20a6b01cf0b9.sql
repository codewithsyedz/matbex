CREATE OR REPLACE FUNCTION public.reverse_card_settlement_deposit(p_deposit_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.get_user_tenant_id(auth.uid());
  v_dep RECORD;
  v_batch_id uuid;
  v_line RECORD;
BEGIN
  IF v_tenant_id IS NULL OR NOT public.can_reverse_card_settlement(v_tenant_id) THEN
    RAISE EXCEPTION 'Only owners, accountants or superadmins can reverse a card settlement deposit';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A reversal reason is required';
  END IF;

  SELECT * INTO v_dep FROM card_settlement_deposits
  WHERE id = p_deposit_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit not found';
  END IF;
  IF v_dep.is_reversed THEN
    RAISE EXCEPTION 'Deposit already reversed';
  END IF;

  INSERT INTO journal_entry_batches (
    tenant_id, branch_id, description, batch_date, created_by, entry_type, journal_type,
    is_posted, posted_at, posted_by
  ) VALUES (
    v_tenant_id, v_dep.branch_id,
    'Reversal of card settlement deposit - ' || v_dep.deposit_date::text,
    CURRENT_DATE, auth.uid(), 'reversal', 'adjustment', true, now(), auth.uid()
  ) RETURNING id INTO v_batch_id;

  FOR v_line IN
    SELECT * FROM account_transactions
    WHERE batch_id = v_dep.journal_batch_id
      AND COALESCE(is_voided, false) = false
  LOOP
    INSERT INTO account_transactions (
      tenant_id, branch_id, account_id, transaction_date, debit, credit, description,
      reference_type, reference_id, original_transaction_id, batch_id, created_by
    )
    VALUES (v_tenant_id, v_line.branch_id, v_line.account_id, CURRENT_DATE,
            COALESCE(v_line.credit, 0), COALESCE(v_line.debit, 0),
            'Reversal: ' || COALESCE(v_line.description, ''),
            'card_settlement_reversal', p_deposit_id, v_line.id, v_batch_id, auth.uid());
  END LOOP;

  UPDATE card_settlement_deposits
  SET is_reversed = true, reversed_at = now(), reversed_by = auth.uid(),
      reversal_reason = p_reason, reversal_batch_id = v_batch_id
  WHERE id = p_deposit_id;

  RETURN v_batch_id;
END;
$function$;