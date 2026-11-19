DO $do$
DECLARE
  j record;
  v_url text;
  v_cmd text;
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRsa3l1YmtiYnF3bXpqYW9nYXZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2ODI2NDYsImV4cCI6MjA4MTI1ODY0Nn0.lWDH5IPae2Yqe-kWae58KELgV6486VXijyAj4NLWKJQ';
BEGIN
  FOR j IN SELECT jobid, command FROM cron.job WHERE command ILIKE '%functions/v1/%'
  LOOP
    v_url := (regexp_match(j.command, 'https://[^'']+/functions/v1/[a-z0-9\-]+'))[1];
    IF v_url IS NULL THEN CONTINUE; END IF;
    v_cmd := format(
      $q$SELECT net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', %L,
    'Authorization', 'Bearer ' || %L,
    'x-cron-secret', public.current_cron_token()
  ),
  body := '{"source":"cron"}'::jsonb
) AS request_id;$q$, v_url, v_anon, v_anon);
    PERFORM cron.alter_job(j.jobid, command := v_cmd);
  END LOOP;
END
$do$;