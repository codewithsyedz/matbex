-- Security fix found during the self-hosting migration.
-- current_cron_token() returns the scheduler secret. `REVOKE ... FROM PUBLIC`
-- does not remove the explicit EXECUTE that default privileges grant to the
-- API roles, so any anonymous caller could read it via POST /rest/v1/rpc/current_cron_token
-- and then invoke scheduler-only functions. Restrict it to the owner/service role.
REVOKE EXECUTE ON FUNCTION public.current_cron_token() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_cron_token() TO service_role;
