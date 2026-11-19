-- 1. Strict write-side branch access check (NULL is NOT acceptable for writes)
CREATE OR REPLACE FUNCTION public.can_write_journal_branch(_branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _branch_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN public.can_access_journal_branch(_branch_id);
END;
$$;

-- 2. Validation trigger on journal_entry_batches
CREATE OR REPLACE FUNCTION public.validate_journal_batch_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch_tenant uuid;
  v_active boolean;
  v_deleted timestamptz;
  v_candidates uuid[];
BEGIN
  -- Auto-resolve when the tenant has exactly one active branch.
  IF NEW.branch_id IS NULL THEN
    SELECT array_agg(b.id ORDER BY b.is_primary DESC, b.created_at)
      INTO v_candidates
    FROM public.branches b
    JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE r.tenant_id = NEW.tenant_id
      AND b.is_active
      AND b.deleted_at IS NULL;

    IF v_candidates IS NULL OR array_length(v_candidates, 1) <> 1 THEN
      RAISE EXCEPTION 'BRANCH_REQUIRED: journal entry "%" must specify a branch_id', NEW.description
        USING HINT = 'Select a branch before submitting the journal entry.';
    END IF;

    NEW.branch_id := v_candidates[1];
  END IF;

  SELECT r.tenant_id, b.is_active, b.deleted_at
    INTO v_branch_tenant, v_active, v_deleted
  FROM public.branches b
  JOIN public.restaurants r ON r.id = b.restaurant_id
  WHERE b.id = NEW.branch_id;

  IF v_branch_tenant IS NULL THEN
    RAISE EXCEPTION 'BRANCH_INVALID: branch % does not exist', NEW.branch_id;
  END IF;

  IF v_branch_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'BRANCH_TENANT_MISMATCH: branch % belongs to another tenant', NEW.branch_id;
  END IF;

  IF COALESCE(v_active, false) = false OR v_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'BRANCH_INACTIVE: branch % is inactive or deleted', NEW.branch_id;
  END IF;

  -- Branch is immutable once the entry left the pending state.
  IF TG_OP = 'UPDATE'
     AND NEW.branch_id IS DISTINCT FROM OLD.branch_id
     AND (OLD.approval_status <> 'pending' OR COALESCE(OLD.is_posted, false)) THEN
    RAISE EXCEPTION 'BRANCH_LOCKED: cannot change the branch of an approved or posted journal entry';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_journal_batch_branch ON public.journal_entry_batches;
CREATE TRIGGER trg_validate_journal_batch_branch
BEFORE INSERT OR UPDATE ON public.journal_entry_batches
FOR EACH ROW EXECUTE FUNCTION public.validate_journal_batch_branch();

-- 3. Ledger lines inherit / must match their batch's branch
CREATE OR REPLACE FUNCTION public.enforce_journal_line_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch_branch uuid;
BEGIN
  IF NEW.batch_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT branch_id INTO v_batch_branch
  FROM public.journal_entry_batches
  WHERE id = NEW.batch_id;

  IF v_batch_branch IS NULL THEN
    RETURN NEW; -- not a journal batch line (e.g. expense posting batch)
  END IF;

  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := v_batch_branch;
  ELSIF NEW.branch_id <> v_batch_branch THEN
    RAISE EXCEPTION 'BRANCH_LINE_MISMATCH: ledger line branch % does not match journal batch branch %',
      NEW.branch_id, v_batch_branch;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_journal_line_branch ON public.account_transactions;
CREATE TRIGGER trg_enforce_journal_line_branch
BEFORE INSERT OR UPDATE ON public.account_transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_journal_line_branch();

-- 4. Tighten RLS write policies to require a writable branch
DROP POLICY IF EXISTS "Authorized roles can create journal batches" ON public.journal_entry_batches;
CREATE POLICY "Authorized roles can create journal batches"
ON public.journal_entry_batches
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_post_journal_entries(tenant_id)
  AND public.can_write_journal_branch(branch_id)
);

DROP POLICY IF EXISTS "Authorized roles can update journal batches" ON public.journal_entry_batches;
CREATE POLICY "Authorized roles can update journal batches"
ON public.journal_entry_batches
FOR UPDATE
TO authenticated
USING (
  public.can_post_journal_entries(tenant_id)
  AND public.can_write_journal_branch(branch_id)
)
WITH CHECK (
  public.can_post_journal_entries(tenant_id)
  AND public.can_write_journal_branch(branch_id)
);