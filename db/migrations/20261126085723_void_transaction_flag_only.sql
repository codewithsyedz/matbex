-- void_transaction counted every void twice.
--
-- It flagged the original line is_voided = true AND inserted a swapped "VOID:" reversal line
-- (reference_type 'adjustment'). Reports, the trial balance and account balances all skip voided
-- lines, so they then saw only the reversal: the account moved by twice the amount, and the
-- reversal's entry was unbalanced by the full amount.
--
-- A void is now the flag alone, the same as the other voids in the ledger (expense
-- reclassification, payroll restatement, day-end reopen). The original line is kept with
-- voided_at / voided_by / void_reason, and the audit row still records it. Staging (production
-- copy) has no lines written by the old reversal path, so there is nothing to repair.
--
-- The signature is unchanged; it now returns the voided line's id (there is no reversal line).
CREATE OR REPLACE FUNCTION public.void_transaction(p_transaction_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_original RECORD;
BEGIN
  SELECT * INTO v_original
  FROM public.account_transactions
  WHERE id = p_transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- Caller must be allowed to post ledger entries for this tenant.
  IF NOT public.can_post_journal_entries(v_original.tenant_id) THEN
    RAISE EXCEPTION 'Not allowed to void transactions for this business' USING ERRCODE = '42501';
  END IF;
  IF v_original.is_voided THEN
    RAISE EXCEPTION 'Transaction is already voided';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to void a transaction';
  END IF;

  UPDATE public.account_transactions
  SET is_voided   = TRUE,
      voided_at   = now(),
      voided_by   = auth.uid(),
      void_reason = p_reason
  WHERE id = p_transaction_id;

  PERFORM public.log_audit(
    'TRANSACTION_VOIDED',
    'account_transaction',
    p_transaction_id,
    to_jsonb(v_original),
    jsonb_build_object('void_reason', p_reason),
    v_original.tenant_id
  );

  RETURN p_transaction_id;
END;
$$;
REVOKE ALL ON FUNCTION public.void_transaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_transaction(uuid, text) TO authenticated, service_role;
