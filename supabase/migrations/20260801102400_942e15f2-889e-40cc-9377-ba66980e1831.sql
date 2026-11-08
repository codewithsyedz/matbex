ALTER TABLE public.journal_entry_batches
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jeb_branch ON public.journal_entry_batches(branch_id);

-- Backfill from the ledger lines each batch produced (most common branch wins)
WITH ranked AS (
  SELECT at.batch_id,
         at.branch_id,
         row_number() OVER (PARTITION BY at.batch_id ORDER BY count(*) DESC) AS rn
  FROM public.account_transactions at
  WHERE at.batch_id IS NOT NULL AND at.branch_id IS NOT NULL
  GROUP BY at.batch_id, at.branch_id
)
UPDATE public.journal_entry_batches b
   SET branch_id = r.branch_id
  FROM ranked r
 WHERE r.batch_id = b.id AND r.rn = 1 AND b.branch_id IS NULL;

DROP FUNCTION IF EXISTS public.submit_pending_journal_entry(text, text, text, date, text, jsonb);

CREATE OR REPLACE FUNCTION public.submit_pending_journal_entry(
  p_description text,
  p_entry_type text,
  p_journal_type text,
  p_batch_date date,
  p_reference_number text,
  p_lines jsonb,
  p_branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_batch_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_user;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant for current user';
  END IF;

  IF NOT public.can_post_journal_entries(v_tenant) THEN
    RAISE EXCEPTION 'Not authorised to submit journal entries';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'Journal entry must have at least two lines';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF (v_line->>'account_id') IS NULL THEN
      RAISE EXCEPTION 'Each line must include account_id';
    END IF;
    v_total_debit  := v_total_debit  + COALESCE((v_line->>'debit')::numeric,  0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::numeric, 0);
  END LOOP;

  IF abs(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Unbalanced entry: debits=% credits=%', v_total_debit, v_total_credit;
  END IF;

  INSERT INTO public.journal_entry_batches (
    tenant_id, batch_date, description, reference_number,
    entry_type, journal_type, created_by, is_posted,
    approval_status, pending_lines, branch_id
  ) VALUES (
    v_tenant, COALESCE(p_batch_date, CURRENT_DATE), p_description, p_reference_number,
    COALESCE(p_entry_type, 'adjustment'), COALESCE(p_journal_type, 'adjustment'),
    v_user, false, 'pending', p_lines, p_branch_id
  )
  RETURNING id INTO v_batch_id;

  RETURN v_batch_id;
END;
$function$;

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