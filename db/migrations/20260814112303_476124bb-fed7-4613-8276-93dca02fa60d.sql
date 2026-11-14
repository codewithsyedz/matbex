DO $do$
DECLARE r text;
BEGIN
  FOR r IN SELECT DISTINCT username FROM cron.job LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.current_cron_token() TO %I', r);
  END LOOP;
END $do$;