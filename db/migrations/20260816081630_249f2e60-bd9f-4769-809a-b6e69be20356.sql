CREATE OR REPLACE FUNCTION public.acknowledge_posted_journal_entry(p_batch_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_status text;
  v_lines jsonb;
  v_branch uuid;
  v_tx_count int := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT tenant_id, approval_status, pending_lines, branch_id
    INTO v_tenant, v_status, v_lines, v_branch
  FROM public.journal_entry_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Journal entry batch not found';
  END IF;

  IF NOT (
    public.is_superadmin(v_user)
    OR public.has_tenant_role(v_user, v_tenant, 'owner'::app_role)
    OR public.has_tenant_role(v_user, v_tenant, 'manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only owners or managers can acknowledge journal entries';
  END IF;

  IF NOT public.can_access_journal_branch(v_branch) THEN
    RAISE EXCEPTION 'You do not have access to this branch''s journal entries';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Batch is not pending (current status: %)', v_status;
  END IF;

  IF v_lines IS NOT NULL AND jsonb_array_length(v_lines) >= 2 THEN
    RAISE EXCEPTION 'This entry has staged lines and must be approved, not acknowledged';
  END IF;

  SELECT count(*) INTO v_tx_count
  FROM public.account_transactions
  WHERE batch_id = p_batch_id;

  IF v_tx_count = 0 THEN
    RAISE EXCEPTION 'Nothing to acknowledge: this batch has no ledger transactions';
  END IF;

  UPDATE public.journal_entry_batches
  SET approval_status = 'approved',
      approved_by = v_user,
      approved_at = now(),
      is_posted = true,
      posted_at = COALESCE(posted_at, now()),
      posted_by = COALESCE(posted_by, created_by)
  WHERE id = p_batch_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, new_values)
  VALUES (
    v_tenant, v_user, 'JOURNAL_ENTRY_ACKNOWLEDGED', 'journal_entry_batches', p_batch_id,
    jsonb_build_object('reason', 'already posted directly to ledger', 'transaction_count', v_tx_count)
  );

  RETURN p_batch_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.acknowledge_posted_journal_entry(uuid) TO authenticated;