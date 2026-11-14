CREATE TABLE IF NOT EXISTS public.cron_auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.cron_auth_tokens TO service_role;
ALTER TABLE public.cron_auth_tokens ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: only service_role / SECURITY DEFINER functions may read it.

INSERT INTO public.cron_auth_tokens (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM public.cron_auth_tokens);

CREATE OR REPLACE FUNCTION public.current_cron_token()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT token FROM public.cron_auth_tokens ORDER BY created_at ASC LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.current_cron_token() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.verify_cron_token(_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cron_auth_tokens t
    WHERE _token IS NOT NULL AND length(_token) >= 16 AND t.token = _token
  )
$$;

REVOKE ALL ON FUNCTION public.verify_cron_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_cron_token(text) TO service_role;

-- Re-point every scheduled edge-function job at the token-authenticated form.
DO $do$
DECLARE
  j record;
  v_url text;
  v_cmd text;
BEGIN
  FOR j IN SELECT jobid, jobname, command FROM cron.job WHERE command ILIKE '%functions/v1/%'
  LOOP
    v_url := (regexp_match(j.command, 'https://[^'']+/functions/v1/[a-z0-9\-]+'))[1];
    IF v_url IS NULL THEN
      CONTINUE;
    END IF;
    v_cmd := format(
      $q$SELECT net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-cron-secret', public.current_cron_token()
  ),
  body := '{"source":"cron"}'::jsonb
) AS request_id;$q$, v_url);
    PERFORM cron.alter_job(j.jobid, command := v_cmd);
  END LOOP;
END
$do$;