CREATE TABLE IF NOT EXISTS public.compliance_alert_acks (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid,
  alert_key text not null,
  alert_kind text not null,
  entity_id uuid,
  note text,
  acknowledged_by uuid not null default auth.uid(),
  acknowledged_at timestamptz not null default now(),
  unique (restaurant_id, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_compliance_alert_acks_rid ON public.compliance_alert_acks(restaurant_id, acknowledged_at DESC);

GRANT SELECT, INSERT, DELETE ON public.compliance_alert_acks TO authenticated;
GRANT ALL ON public.compliance_alert_acks TO service_role;

ALTER TABLE public.compliance_alert_acks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view compliance alert acks"
ON public.compliance_alert_acks FOR SELECT TO authenticated
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Tenant users can acknowledge compliance alerts"
ON public.compliance_alert_acks FOR INSERT TO authenticated
WITH CHECK (public.can_access_restaurant(restaurant_id) AND acknowledged_by = auth.uid());

CREATE POLICY "Users can undo their own acknowledgement"
ON public.compliance_alert_acks FOR DELETE TO authenticated
USING (public.can_access_restaurant(restaurant_id) AND acknowledged_by = auth.uid());