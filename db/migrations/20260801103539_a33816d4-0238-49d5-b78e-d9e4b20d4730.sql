-- Helper: can the current user act on a journal batch for this branch?
CREATE OR REPLACE FUNCTION public.can_access_journal_branch(_branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_restaurant uuid;
BEGIN
  IF v_user IS NULL THEN
    RETURN true; -- service role / system contexts
  END IF;

  IF public.is_superadmin(v_user) THEN
    RETURN true;
  END IF;

  -- Legacy / tenant-wide entries carry no branch: keep them visible
  IF _branch_id IS NULL THEN
    RETURN true;
  END IF;

  SELECT b.restaurant_id INTO v_restaurant
  FROM public.branches b
  WHERE b.id = _branch_id;

  IF v_restaurant IS NULL THEN
    RETURN true;
  END IF;

  RETURN public.user_can_access_branch(v_user, v_restaurant, _branch_id);
END;
$$;

-- Tighten RLS on journal_entry_batches with branch scoping
DROP POLICY IF EXISTS "Users can view their tenant's journal batches" ON public.journal_entry_batches;
CREATE POLICY "Users can view their tenant's journal batches"
ON public.journal_entry_batches
FOR SELECT
USING (
  (
    public.is_superadmin(auth.uid())
    OR public.user_belongs_to_tenant(auth.uid(), tenant_id)
  )
  AND public.can_access_journal_branch(branch_id)
);

DROP POLICY IF EXISTS "Authorized roles can create journal batches" ON public.journal_entry_batches;
CREATE POLICY "Authorized roles can create journal batches"
ON public.journal_entry_batches
FOR INSERT
WITH CHECK (
  public.can_post_journal_entries(tenant_id)
  AND public.can_access_journal_branch(branch_id)
);

DROP POLICY IF EXISTS "Authorized roles can update journal batches" ON public.journal_entry_batches;
CREATE POLICY "Authorized roles can update journal batches"
ON public.journal_entry_batches
FOR UPDATE
USING (
  public.can_post_journal_entries(tenant_id)
  AND public.can_access_journal_branch(branch_id)
)
WITH CHECK (
  public.can_post_journal_entries(tenant_id)
  AND public.can_access_journal_branch(branch_id)
);

-- Enforce branch access inside the approve RPC (SECURITY DEFINER bypasses RLS)
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

-- Same guard for rejection
CREATE OR REPLACE FUNCTION public.reject_journal_entry(p_batch_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_status text;
  v_branch uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT tenant_id, approval_status, branch_id INTO v_tenant, v_status, v_branch
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
    RAISE EXCEPTION 'Only owners or managers can reject journal entries';
  END IF;

  IF NOT public.can_access_journal_branch(v_branch) THEN
    RAISE EXCEPTION 'You do not have access to this branch''s journal entries';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Batch is not pending (current status: %)', v_status;
  END IF;

  UPDATE public.journal_entry_batches
     SET approval_status  = 'rejected',
         rejected_by      = v_user,
         rejected_at      = now(),
         rejection_reason = p_reason
   WHERE id = p_batch_id;

  RETURN p_batch_id;
END;
$function$;