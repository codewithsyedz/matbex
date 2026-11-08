-- =====================================================================
-- DLQ v2: batch grouping, full request/response traces, reprocess controls
-- =====================================================================

ALTER TABLE public.failed_sync_items
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS http_status integer,
  ADD COLUMN IF NOT EXISTS request_trace jsonb,
  ADD COLUMN IF NOT EXISTS response_trace jsonb,
  ADD COLUMN IF NOT EXISTS max_retries integer,
  ADD COLUMN IF NOT EXISTS retry_exhausted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS discarded_by uuid,
  ADD COLUMN IF NOT EXISTS discard_reason text,
  ADD COLUMN IF NOT EXISTS last_action_reason text;

CREATE INDEX IF NOT EXISTS idx_failed_sync_items_batch
  ON public.failed_sync_items (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_failed_sync_items_tenant_status
  ON public.failed_sync_items (tenant_id, status, created_at DESC);

-- Backfill: anything already past its retry budget is flagged as exhausted.
UPDATE public.failed_sync_items
   SET retry_exhausted = true
 WHERE retry_exhausted = false
   AND status <> 'resolved'
   AND retry_count >= 6;

-- ---------------------------------------------------------------------
-- Attempt history (full request/response trace per attempt)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.failed_sync_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  failed_sync_item_id uuid NOT NULL REFERENCES public.failed_sync_items(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  attempt_number integer NOT NULL DEFAULT 1,
  kind text NOT NULL DEFAULT 'automatic',
  outcome text NOT NULL DEFAULT 'failed',
  http_status integer,
  duration_ms integer,
  request_trace jsonb,
  response_trace jsonb,
  error_message text,
  reason text,
  actor_id uuid,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT failed_sync_attempts_kind_chk
    CHECK (kind IN ('automatic','operator_retry','operator_approve','operator_resolve','operator_discard','batch_reprocess')),
  CONSTRAINT failed_sync_attempts_outcome_chk
    CHECK (outcome IN ('failed','queued','succeeded','discarded','approved','resolved'))
);

GRANT SELECT, INSERT ON public.failed_sync_attempts TO authenticated;
GRANT ALL ON public.failed_sync_attempts TO service_role;

ALTER TABLE public.failed_sync_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fsa_select_tenant_staff" ON public.failed_sync_attempts;
CREATE POLICY "fsa_select_tenant_staff"
  ON public.failed_sync_attempts FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'accountant'::app_role)
    OR public.is_superadmin(auth.uid())
  );

DROP POLICY IF EXISTS "fsa_insert_tenant_staff" ON public.failed_sync_attempts;
CREATE POLICY "fsa_insert_tenant_staff"
  ON public.failed_sync_attempts FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'cashier'::app_role)
    OR public.is_superadmin(auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_failed_sync_attempts_item
  ON public.failed_sync_attempts (failed_sync_item_id, attempted_at DESC);

-- ---------------------------------------------------------------------
-- Authorization helper
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_dlq(_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_tenant_role(auth.uid(), _tenant, 'owner'::app_role)
      OR public.has_tenant_role(auth.uid(), _tenant, 'manager'::app_role)
      OR public.is_superadmin(auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Bulk operations
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_manage_failed_sync_items(
  _ids uuid[],
  _action text,
  _reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  affected integer := 0;
BEGIN
  IF _action NOT IN ('approve','retry','resolve','discard') THEN
    RAISE EXCEPTION 'unsupported DLQ action: %', _action;
  END IF;
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT * FROM public.failed_sync_items WHERE id = ANY(_ids) FOR UPDATE
  LOOP
    IF NOT public.can_manage_dlq(r.tenant_id) THEN
      RAISE EXCEPTION 'not authorized to manage DLQ items for this tenant';
    END IF;

    IF _action = 'approve' THEN
      UPDATE public.failed_sync_items
         SET operator_approved = true,
             approved_by = auth.uid(),
             approved_at = now(),
             last_action_reason = COALESCE(_reason, last_action_reason)
       WHERE id = r.id;

      INSERT INTO public.failed_sync_attempts
        (failed_sync_item_id, tenant_id, attempt_number, kind, outcome, reason, actor_id)
      VALUES (r.id, r.tenant_id, r.retry_count, 'operator_approve', 'approved', _reason, auth.uid());

    ELSIF _action = 'retry' THEN
      IF r.status = 'resolved' THEN
        CONTINUE;
      END IF;
      UPDATE public.failed_sync_items
         SET status = 'retrying',
             operator_approved = true,
             approved_by = COALESCE(approved_by, auth.uid()),
             approved_at = COALESCE(approved_at, now()),
             retry_count = retry_count + 1,
             retry_exhausted = false,
             retry_requested_at = now(),
             retry_requested_by = auth.uid(),
             last_action_reason = COALESCE(_reason, last_action_reason)
       WHERE id = r.id;

      INSERT INTO public.failed_sync_attempts
        (failed_sync_item_id, tenant_id, attempt_number, kind, outcome, reason, actor_id,
         request_trace, response_trace, http_status, error_message)
      VALUES (r.id, r.tenant_id, r.retry_count + 1, 'operator_retry', 'queued', _reason, auth.uid(),
              r.request_trace, r.response_trace, r.http_status, r.error_message);

    ELSIF _action = 'resolve' THEN
      UPDATE public.failed_sync_items
         SET status = 'resolved',
             resolved_at = now(),
             resolved_by = auth.uid(),
             last_action_reason = COALESCE(_reason, last_action_reason)
       WHERE id = r.id;

      INSERT INTO public.failed_sync_attempts
        (failed_sync_item_id, tenant_id, attempt_number, kind, outcome, reason, actor_id)
      VALUES (r.id, r.tenant_id, r.retry_count, 'operator_resolve', 'resolved', _reason, auth.uid());

    ELSIF _action = 'discard' THEN
      UPDATE public.failed_sync_items
         SET status = 'discarded',
             discarded_at = now(),
             discarded_by = auth.uid(),
             discard_reason = _reason,
             last_action_reason = COALESCE(_reason, last_action_reason)
       WHERE id = r.id;

      INSERT INTO public.failed_sync_attempts
        (failed_sync_item_id, tenant_id, attempt_number, kind, outcome, reason, actor_id)
      VALUES (r.id, r.tenant_id, r.retry_count, 'operator_discard', 'discarded', _reason, auth.uid());
    END IF;

    affected := affected + 1;
  END LOOP;

  RETURN affected;
END;
$$;

-- Reprocess an entire failed batch (all non-resolved items sharing a batch_id).
CREATE OR REPLACE FUNCTION public.reprocess_failed_sync_batch(
  _batch_id uuid,
  _reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ids uuid[];
BEGIN
  SELECT array_agg(id) INTO _ids
    FROM public.failed_sync_items
   WHERE batch_id = _batch_id
     AND status <> 'resolved';

  IF _ids IS NULL THEN
    RETURN 0;
  END IF;

  RETURN public.bulk_manage_failed_sync_items(_ids, 'retry', COALESCE(_reason, 'batch reprocess'));
END;
$$;

-- Client-side trace appender: terminals record each automatic attempt.
CREATE OR REPLACE FUNCTION public.append_failed_sync_attempt(
  _item_id uuid,
  _attempt_number integer,
  _outcome text,
  _http_status integer DEFAULT NULL,
  _duration_ms integer DEFAULT NULL,
  _request_trace jsonb DEFAULT NULL,
  _response_trace jsonb DEFAULT NULL,
  _error_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _new_id uuid;
BEGIN
  SELECT tenant_id INTO _tenant FROM public.failed_sync_items WHERE id = _item_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'failed_sync_item not found';
  END IF;
  IF NOT (
    public.can_manage_dlq(_tenant)
    OR public.has_tenant_role(auth.uid(), _tenant, 'cashier'::app_role)
    OR public.has_tenant_role(auth.uid(), _tenant, 'accountant'::app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized to append attempts for this tenant';
  END IF;

  INSERT INTO public.failed_sync_attempts
    (failed_sync_item_id, tenant_id, attempt_number, kind, outcome, http_status,
     duration_ms, request_trace, response_trace, error_message, actor_id)
  VALUES (_item_id, _tenant, COALESCE(_attempt_number, 1), 'automatic',
          COALESCE(_outcome, 'failed'), _http_status, _duration_ms,
          _request_trace, _response_trace, _error_message, auth.uid())
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_dlq(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_manage_failed_sync_items(uuid[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reprocess_failed_sync_batch(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_failed_sync_attempt(uuid, integer, text, integer, integer, jsonb, jsonb, text) TO authenticated;