ALTER TABLE public.project_posting_runs
  ADD COLUMN IF NOT EXISTS undone_at timestamptz,
  ADD COLUMN IF NOT EXISTS undone_by uuid,
  ADD COLUMN IF NOT EXISTS undone_count integer NOT NULL DEFAULT 0;

GRANT UPDATE ON public.project_posting_runs TO authenticated;

DROP POLICY IF EXISTS "project_posting_runs_update" ON public.project_posting_runs;
CREATE POLICY "project_posting_runs_update"
ON public.project_posting_runs FOR UPDATE TO authenticated
USING (tenant_id = get_user_tenant_id(auth.uid()))
WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- Reverse the ledger effect of a posted project transaction and set it back to pending.
CREATE OR REPLACE FUNCTION public.undo_project_transaction_posting(p_txn_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t project_transactions;
  v_batch uuid;
  v_line RECORD;
  v_rev_batch uuid;
  v_ref text;
BEGIN
  SELECT * INTO v_t FROM project_transactions WHERE id = p_txn_id FOR UPDATE;
  IF v_t IS NULL THEN RAISE EXCEPTION 'TXN_NOT_FOUND'; END IF;
  IF NOT public.can_manage_capital(v_t.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only finance roles can undo project postings.';
  END IF;
  IF v_t.status <> 'posted' THEN
    RAISE EXCEPTION 'NOT_POSTED: Only posted transactions can be reverted to pending.';
  END IF;
  IF v_t.asset_id IS NOT NULL THEN
    RAISE EXCEPTION 'ASSET_CREATED: This posting created a fixed asset. Dispose or reverse the asset first.';
  END IF;

  v_batch := v_t.batch_id;
  v_ref := 'PRJ-UNDO-' || to_char(now(), 'YYYYMMDD') || '-' || left(replace(p_txn_id::text,'-',''), 6);

  IF v_batch IS NOT NULL THEN
    INSERT INTO journal_entry_batches (tenant_id, batch_date, description, reference_number,
      entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status,
      branch_id, project_id)
    VALUES (v_t.tenant_id, CURRENT_DATE,
      'Undo posting - ' || COALESCE(v_t.description, 'Project cost'), v_ref,
      'reversal', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved',
      v_t.branch_id, v_t.project_id)
    RETURNING id INTO v_rev_batch;

    FOR v_line IN
      SELECT * FROM account_transactions
       WHERE batch_id = v_batch AND COALESCE(is_voided, false) = false
    LOOP
      INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, batch_id, branch_id, project_id,
        original_transaction_id)
      VALUES (v_t.tenant_id, v_line.account_id, CURRENT_DATE, v_line.credit, v_line.debit,
        'Reversal - ' || COALESCE(v_line.description, 'Project cost'), 'project_transaction',
        p_txn_id, auth.uid(), v_rev_batch, v_line.branch_id, v_line.project_id, v_line.id);

      UPDATE account_transactions
         SET is_voided = true, void_reason = 'Undo confirm posting'
       WHERE id = v_line.id;
    END LOOP;

    UPDATE journal_entry_batches
       SET is_posted = false, approval_status = 'voided'
     WHERE id = v_batch;
  END IF;

  UPDATE project_transactions
     SET status = 'classified', batch_id = NULL, posted_at = NULL, posted_by = NULL
   WHERE id = p_txn_id;

  INSERT INTO project_classification_audit (tenant_id, transaction_id, action, new_value, batch_id, performed_by)
  VALUES (v_t.tenant_id, p_txn_id, 'unposted',
    jsonb_build_object('amount', v_t.amount, 'reversed_batch', v_batch),
    v_rev_batch, auth.uid());

  RETURN v_rev_batch;
END;
$$;

REVOKE ALL ON FUNCTION public.undo_project_transaction_posting(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.undo_project_transaction_posting(uuid) TO authenticated, service_role;