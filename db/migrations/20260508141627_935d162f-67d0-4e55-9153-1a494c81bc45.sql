-- 1. Per-user toggle for ZATCA alerts
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS notify_zatca_alerts boolean NOT NULL DEFAULT true;

-- 2. Last-seen marker on devices (used to detect "device down")
ALTER TABLE public.zatca_devices
  ADD COLUMN IF NOT EXISTS last_zatca_check_at timestamptz;

-- 3. Dedupe table - prevents repeat notifications for the same incident
CREATE TABLE IF NOT EXISTS public.zatca_alert_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  alert_key text NOT NULL,
  entity_type text,
  entity_id text,
  severity text NOT NULL DEFAULT 'warning',
  message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  notification_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_zatca_alert_state_tenant
  ON public.zatca_alert_state(tenant_id, resolved_at);

ALTER TABLE public.zatca_alert_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and managers can view zatca alerts" ON public.zatca_alert_state;
CREATE POLICY "Owners and managers can view zatca alerts"
ON public.zatca_alert_state
FOR SELECT
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('owner','manager')
  )
);

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_zatca_alert_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_zatca_alert_state ON public.zatca_alert_state;
CREATE TRIGGER trg_touch_zatca_alert_state
BEFORE UPDATE ON public.zatca_alert_state
FOR EACH ROW EXECUTE FUNCTION public.touch_zatca_alert_state();