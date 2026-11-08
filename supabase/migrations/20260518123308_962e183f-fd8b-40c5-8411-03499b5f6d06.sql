CREATE OR REPLACE FUNCTION public.notify_journal_entry_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submitter_name text;
BEGIN
  IF NEW.approval_status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, 'An accountant')
    INTO v_submitter_name
  FROM public.profiles
  WHERE id = NEW.created_by;

  INSERT INTO public.in_app_notifications (
    user_id, tenant_id, title, message,
    action_type, entity_type, entity_id, metadata
  )
  SELECT
    utr.user_id,
    NEW.tenant_id,
    'Journal entry awaiting approval',
    COALESCE(v_submitter_name, 'An accountant')
      || ' submitted a journal entry: ' || NEW.description,
    'journal_entry_pending',
    'journal_entry_batch',
    NEW.id,
    jsonb_build_object(
      'batch_id', NEW.id,
      'batch_date', NEW.batch_date,
      'entry_type', NEW.entry_type,
      'reference_number', NEW.reference_number,
      'submitted_by', NEW.created_by,
      'submitter_name', v_submitter_name
    )
  FROM public.user_tenant_roles utr
  WHERE utr.tenant_id = NEW.tenant_id
    AND utr.role IN ('owner'::app_role, 'manager'::app_role)
    AND utr.user_id <> NEW.created_by;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_journal_entry_pending ON public.journal_entry_batches;
CREATE TRIGGER trg_notify_journal_entry_pending
  AFTER INSERT ON public.journal_entry_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_journal_entry_pending();

CREATE OR REPLACE FUNCTION public.notify_journal_entry_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reviewer_name text;
  v_action_type text;
  v_title text;
  v_message text;
BEGIN
  IF OLD.approval_status = NEW.approval_status THEN
    RETURN NEW;
  END IF;

  IF NEW.approval_status = 'approved' THEN
    v_action_type := 'journal_entry_approved';
    SELECT COALESCE(full_name, 'A reviewer') INTO v_reviewer_name
    FROM public.profiles WHERE id = NEW.approved_by;
    v_title := 'Journal entry approved';
    v_message := COALESCE(v_reviewer_name, 'A reviewer')
      || ' approved your journal entry: ' || NEW.description;
  ELSIF NEW.approval_status = 'rejected' THEN
    v_action_type := 'journal_entry_rejected';
    SELECT COALESCE(full_name, 'A reviewer') INTO v_reviewer_name
    FROM public.profiles WHERE id = NEW.rejected_by;
    v_title := 'Journal entry rejected';
    v_message := COALESCE(v_reviewer_name, 'A reviewer')
      || ' rejected your journal entry: ' || NEW.description
      || COALESCE(' - Reason: ' || NEW.rejection_reason, '');
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.in_app_notifications (
      user_id, tenant_id, title, message,
      action_type, entity_type, entity_id, metadata
    ) VALUES (
      NEW.created_by, NEW.tenant_id, v_title, v_message,
      v_action_type, 'journal_entry_batch', NEW.id,
      jsonb_build_object(
        'batch_id', NEW.id,
        'batch_date', NEW.batch_date,
        'entry_type', NEW.entry_type,
        'reference_number', NEW.reference_number,
        'rejection_reason', NEW.rejection_reason,
        'reviewer_name', v_reviewer_name
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_journal_entry_decision ON public.journal_entry_batches;
CREATE TRIGGER trg_notify_journal_entry_decision
  AFTER UPDATE OF approval_status ON public.journal_entry_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_journal_entry_decision();