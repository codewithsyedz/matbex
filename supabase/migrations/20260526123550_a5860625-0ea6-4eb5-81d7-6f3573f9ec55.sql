
CREATE TABLE IF NOT EXISTS public.demo_funnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_funnel_events_tenant ON public.demo_funnel_events(tenant_id, event_type, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_demo_funnel_first_event ON public.demo_funnel_events(tenant_id, event_type)
  WHERE event_type IN ('first_order','first_report_view','branch_attempted','export_attempted','upgrade_clicked');

ALTER TABLE public.demo_funnel_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners/managers view own funnel events"
ON public.demo_funnel_events FOR SELECT
USING (
  tenant_id IN (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager')
  )
);

CREATE POLICY "Insert own funnel events"
ON public.demo_funnel_events FOR INSERT
WITH CHECK (
  tenant_id IN (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Super admins view all funnel events"
ON public.demo_funnel_events FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'superadmin'
  )
);

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS sales_assist_flagged_at TIMESTAMPTZ;
