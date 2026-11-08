-- Create function to send audit alert via edge function
CREATE OR REPLACE FUNCTION public.trigger_audit_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  critical_actions TEXT[] := ARRAY[
    'SHIFT_TIMESTAMP_OVERRIDE',
    'DELETE',
    'BULK_DELETE',
    'USER_ROLE_CHANGE',
    'SETTINGS_CHANGE',
    'DATA_EXPORT',
    'PERMISSION_CHANGE'
  ];
  supabase_url TEXT;
  service_key TEXT;
BEGIN
  -- Only trigger for critical actions
  IF NOT (NEW.action = ANY(critical_actions)) THEN
    RETURN NEW;
  END IF;

  -- Get Supabase URL from vault or use default
  supabase_url := current_setting('app.settings.supabase_url', true);
  IF supabase_url IS NULL OR supabase_url = '' THEN
    supabase_url := 'https://tlkyubkbbqwmzjaogavb.supabase.co';
  END IF;

  -- Call edge function asynchronously via pg_net (if available)
  -- This uses Supabase's built-in HTTP extension
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/send-audit-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body := jsonb_build_object(
      'audit_log_id', NEW.id,
      'action', NEW.action,
      'entity_type', NEW.entity_type,
      'entity_id', NEW.entity_id,
      'user_id', NEW.user_id,
      'tenant_id', NEW.tenant_id,
      'old_data', NEW.old_data,
      'new_data', NEW.new_data
    )
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the insert
    RAISE WARNING 'Failed to send audit alert: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Create trigger for audit alerts
DROP TRIGGER IF EXISTS audit_alert_trigger ON public.audit_logs;
CREATE TRIGGER audit_alert_trigger
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_audit_alert();

-- Add comment for documentation
COMMENT ON FUNCTION public.trigger_audit_alert() IS 'Sends email alerts to owners when critical audit events occur';