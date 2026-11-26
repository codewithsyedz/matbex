-- =============================================================================
-- Email infrastructure (previously provisioned outside migrations by Lovable)
-- =============================================================================
-- Table-backed queue + send log + suppression list. The API job runner drains
-- the queue and sends through Resend (RESEND_API_KEY). Function signatures
-- match the ones legacy migrations ALTER, so they apply cleanly.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.email_send_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      text,
  template_name   text NOT NULL,
  recipient_email text NOT NULL,
  status          text NOT NULL,          -- queued | sent | suppressed | failed | dlq
  error_message   text,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS email_send_log_created_idx ON public.email_send_log (created_at DESC);

CREATE TABLE IF NOT EXISTS public.email_send_state (
  id                              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  batch_size                      int NOT NULL DEFAULT 10,
  send_delay_ms                   int NOT NULL DEFAULT 200,
  auth_email_ttl_minutes          int NOT NULL DEFAULT 15,
  transactional_email_ttl_minutes int NOT NULL DEFAULT 60,
  retry_after_until               timestamptz,
  updated_at                      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.email_send_state (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.suppressed_emails (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  reason     text NOT NULL,             -- unsubscribe | bounce | complaint | manual
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  token      text NOT NULL UNIQUE,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

-- ---- queue -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_queue (
  msg_id      bigserial PRIMARY KEY,
  queue_name  text NOT NULL,                -- auth_emails | transactional_emails | *_dlq
  message     jsonb NOT NULL,
  read_ct     int NOT NULL DEFAULT 0,
  vt          timestamptz NOT NULL DEFAULT now(),   -- visible-after
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_queue_ready_idx ON public.email_queue (queue_name, vt);
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.email_queue (queue_name, message) VALUES (queue_name, payload)
  RETURNING msg_id INTO v_id;
  PERFORM pg_notify('email_queue', queue_name);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer)
RETURNS TABLE (msg_id bigint, read_ct integer, message jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.msg_id FROM public.email_queue q
    WHERE q.queue_name = read_email_batch.queue_name AND q.vt <= now()
    ORDER BY q.msg_id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.email_queue q
     SET read_ct = q.read_ct + 1,
         vt = now() + make_interval(secs => read_email_batch.vt)
    FROM picked
   WHERE q.msg_id = picked.msg_id
  RETURNING q.msg_id, q.read_ct, q.message;
END $$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name text, message_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.email_queue q WHERE q.queue_name = delete_email.queue_name AND q.msg_id = message_id;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
  DELETE FROM public.email_queue q WHERE q.queue_name = source_queue AND q.msg_id = message_id;
  INSERT INTO public.email_queue (queue_name, message) VALUES (dlq_name, payload) RETURNING msg_id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb), public.read_email_batch(text, integer, integer),
  public.delete_email(text, bigint), public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb), public.read_email_batch(text, integer, integer),
  public.delete_email(text, bigint), public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
