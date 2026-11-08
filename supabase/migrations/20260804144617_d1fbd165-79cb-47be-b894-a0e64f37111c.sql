CREATE OR REPLACE FUNCTION public.approve_journal_entry(p_batch_id uuid)
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
  v_batch_date date;
  v_description text;
  v_branch uuid;
  v_line jsonb;
  v_debits numeric := 0;
  v_credits numeric := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT tenant_id, approval_status, pending_lines, batch_date, description, branch_id
    INTO v_tenant, v_status, v_lines, v_batch_date, v_description, v_branch
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
    RAISE EXCEPTION 'Only owners or managers can approve journal entries';
  END IF;

  IF NOT public.can_access_journal_branch(v_branch) THEN
    RAISE EXCEPTION 'You do not have access to this branch''s journal entries';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Batch is not pending (current status: %)', v_status;
  END IF;

  IF v_lines IS NULL OR jsonb_array_length(v_lines) < 2 THEN
    RAISE EXCEPTION 'Pending batch has no lines to post';
  END IF;

  SELECT COALESCE(SUM(COALESCE((l->>'debit')::numeric, 0)), 0),
         COALESCE(SUM(COALESCE((l->>'credit')::numeric, 0)), 0)
    INTO v_debits, v_credits
  FROM jsonb_array_elements(v_lines) AS l;

  IF ROUND(ABS(v_debits - v_credits), 2) > 0.005 THEN
    RAISE EXCEPTION 'Cannot post: voucher is out of balance. Debits % vs credits % (difference %)',
      ROUND(v_debits, 2), ROUND(v_credits, 2), ROUND(ABS(v_debits - v_credits), 2);
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date,
      debit, credit, description,
      reference_type, reference_id, created_by, batch_id, branch_id
    ) VALUES (
      v_tenant,
      (v_line->>'account_id')::uuid,
      v_batch_date,
      NULLIF((v_line->>'debit')::numeric, 0),
      NULLIF((v_line->>'credit')::numeric, 0),
      COALESCE(v_line->>'description', v_description),
      'journal_entry',
      p_batch_id,
      v_user,
      p_batch_id,
      v_branch
    );
  END LOOP;

  UPDATE public.journal_entry_batches
     SET approval_status = 'approved',
         approved_by     = v_user,
         approved_at     = now(),
         is_posted       = true,
         posted_at       = now(),
         posted_by       = v_user,
         pending_lines   = NULL
   WHERE id = p_batch_id;

  RETURN p_batch_id;
END;
$function$;