-- 1) Schema additions
ALTER TABLE public.journal_entry_batches
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS pending_lines jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_entry_batches_approval_status_chk'
  ) THEN
    ALTER TABLE public.journal_entry_batches
      ADD CONSTRAINT journal_entry_batches_approval_status_chk
      CHECK (approval_status IN ('pending','approved','rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_journal_entry_batches_pending
  ON public.journal_entry_batches (tenant_id, approval_status)
  WHERE approval_status = 'pending';

-- 2) Trigger: anyone who is NOT owner/manager/superadmin is forced into pending state
CREATE OR REPLACE FUNCTION public.enforce_journal_entry_approval_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_is_privileged boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_privileged :=
    public.is_superadmin(v_user)
    OR public.has_tenant_role(v_user, NEW.tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(v_user, NEW.tenant_id, 'manager'::app_role);

  IF NOT v_is_privileged THEN
    NEW.approval_status := 'pending';
    NEW.is_posted := false;
    NEW.posted_at := NULL;
    NEW.posted_by := NULL;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_journal_entry_approval_state ON public.journal_entry_batches;
CREATE TRIGGER trg_enforce_journal_entry_approval_state
  BEFORE INSERT ON public.journal_entry_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_journal_entry_approval_state();

-- 3) Submit pending journal entry (accountant or any can_post_journal_entries caller)
CREATE OR REPLACE FUNCTION public.submit_pending_journal_entry(
  p_description text,
  p_entry_type text,
  p_journal_type text,
  p_batch_date date,
  p_reference_number text,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    approval_status, pending_lines
  ) VALUES (
    v_tenant, COALESCE(p_batch_date, CURRENT_DATE), p_description, p_reference_number,
    COALESCE(p_entry_type, 'adjustment'), COALESCE(p_journal_type, 'adjustment'),
    v_user, false, 'pending', p_lines
  )
  RETURNING id INTO v_batch_id;

  RETURN v_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_pending_journal_entry(text, text, text, date, text, jsonb) TO authenticated;

-- 4) Approve pending journal entry (owner/manager/superadmin)
CREATE OR REPLACE FUNCTION public.approve_journal_entry(p_batch_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_status text;
  v_lines jsonb;
  v_batch_date date;
  v_description text;
  v_line jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT tenant_id, approval_status, pending_lines, batch_date, description
    INTO v_tenant, v_status, v_lines, v_batch_date, v_description
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
      reference_type, reference_id, created_by, batch_id
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
      p_batch_id
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
$$;

GRANT EXECUTE ON FUNCTION public.approve_journal_entry(uuid) TO authenticated;

-- 5) Reject pending journal entry
CREATE OR REPLACE FUNCTION public.reject_journal_entry(p_batch_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_status text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT tenant_id, approval_status INTO v_tenant, v_status
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
$$;

GRANT EXECUTE ON FUNCTION public.reject_journal_entry(uuid, text) TO authenticated;