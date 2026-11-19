CREATE TABLE IF NOT EXISTS public.dlq_alert_dedupe (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  branch_id UUID,
  error_category TEXT NOT NULL,
  window_bucket TIMESTAMPTZ NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_expires_at TIMESTAMPTZ NOT NULL,
  first_item_id UUID,
  suppressed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dlq_alert_dedupe_bucket
  ON public.dlq_alert_dedupe (
    tenant_id,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    error_category,
    window_bucket
  );

CREATE INDEX IF NOT EXISTS idx_dlq_alert_dedupe_expires
  ON public.dlq_alert_dedupe (window_expires_at);

GRANT SELECT ON public.dlq_alert_dedupe TO authenticated;
GRANT ALL ON public.dlq_alert_dedupe TO service_role;

ALTER TABLE public.dlq_alert_dedupe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and managers view dedupe entries for their tenant"
  ON public.dlq_alert_dedupe FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'superadmin'::app_role)
  );

-- Classify an error message into a coarse category (mirrors client heuristic)
CREATE OR REPLACE FUNCTION public.classify_dlq_error(_msg TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  m TEXT := lower(coalesce(_msg, ''));
BEGIN
  IF m ~ 'version|stale|conflict|409' THEN RETURN 'version_conflict'; END IF;
  IF m ~ 'validation|invalid|schema|zod|400' THEN RETURN 'validation'; END IF;
  IF m ~ 'auth|unauthorized|forbidden|401|403' THEN RETURN 'auth'; END IF;
  IF m ~ 'network|fetch|timeout|dns|offline' THEN RETURN 'network'; END IF;
  IF m ~ 'rate|429|throttle' THEN RETURN 'rate_limit'; END IF;
  IF m ~ '500|502|503|504|server' THEN RETURN 'server'; END IF;
  RETURN 'other';
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_owners_on_failed_sync_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_user_id UUID;
  title_text TEXT;
  msg_text TEXT;
  category TEXT;
  window_minutes INTEGER := 15;
  dedupe_hit BOOLEAN := false;
BEGIN
  category := public.classify_dlq_error(NEW.error_message);

  -- Try to open a fresh dedupe window; if one is already live, treat as suppressed
  BEGIN
    INSERT INTO public.dlq_alert_dedupe (
      tenant_id, branch_id, error_category, window_bucket,
      window_started_at, window_expires_at, first_item_id
    ) VALUES (
      NEW.tenant_id, NEW.branch_id, category,
      to_timestamp(floor(extract(epoch FROM now()) / (window_minutes * 60)) * window_minutes * 60),
      now(), now() + make_interval(mins => window_minutes), NEW.id
    );
  EXCEPTION WHEN unique_violation THEN
    dedupe_hit := true;
    UPDATE public.dlq_alert_dedupe
       SET suppressed_count = suppressed_count + 1,
           updated_at = now()
     WHERE tenant_id = NEW.tenant_id
       AND coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(NEW.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND error_category = category
       AND window_bucket = to_timestamp(floor(extract(epoch FROM now()) / (window_minutes * 60)) * window_minutes * 60);
  END;

  IF dedupe_hit THEN
    RETURN NEW; -- alert already sent within the window
  END IF;

  title_text := 'POS sync failure';
  msg_text := format('Failed sync: %s%s — %s',
    NEW.event_type,
    CASE WHEN NEW.branch_id IS NOT NULL THEN ' (branch)' ELSE '' END,
    left(coalesce(NEW.error_message,'unknown error'), 240)
  );

  FOR owner_user_id IN
    SELECT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'owner'
      AND p.tenant_id = NEW.tenant_id
  LOOP
    INSERT INTO public.in_app_notifications (
      user_id, tenant_id, title, message, action_type, entity_type, entity_id, metadata, is_read
    ) VALUES (
      owner_user_id,
      NEW.tenant_id,
      title_text,
      msg_text,
      'sync_failure',
      'failed_sync_item',
      NEW.id,
      jsonb_build_object(
        'event_type', NEW.event_type,
        'event_id', NEW.event_id,
        'branch_id', NEW.branch_id,
        'terminal_id', NEW.terminal_id,
        'error_code', NEW.error_code,
        'retry_count', NEW.retry_count,
        'error_category', category,
        'dedupe_window_minutes', window_minutes
      ),
      false
    );
  END LOOP;

  INSERT INTO public.pending_digest_notifications (
    tenant_id, user_id, channel, subject, body, metadata, status, created_at
  )
  SELECT
    NEW.tenant_id,
    ows.user_id,
    'whatsapp',
    title_text,
    msg_text,
    jsonb_build_object(
      'phone_e164', ows.phone_e164,
      'failed_sync_item_id', NEW.id,
      'event_type', NEW.event_type,
      'branch_id', NEW.branch_id,
      'error_category', category,
      'dedupe_window_minutes', window_minutes
    ),
    'pending',
    now()
  FROM public.owner_whatsapp_subscriptions ows
  JOIN public.restaurants r ON r.id = ows.restaurant_id
  WHERE r.tenant_id = NEW.tenant_id
    AND ows.enabled = true
  ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_owners_on_failed_sync_item failed: %', SQLERRM;
  RETURN NEW;
END;
$$;