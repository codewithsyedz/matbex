
CREATE TABLE public.accounting_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('zoho_books','xero','quickbooks','smacc')),
  region TEXT NOT NULL DEFAULT 'sa' CHECK (region IN ('com','eu','in','sa','com.au','jp')),
  organization_id TEXT,
  organization_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connected','error','expired')),
  auto_sync_enabled BOOLEAN NOT NULL DEFAULT true,
  sync_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (sync_frequency IN ('hourly','daily','manual')),
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_integrations TO authenticated;
GRANT ALL ON public.accounting_integrations TO service_role;
ALTER TABLE public.accounting_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their accounting integrations"
ON public.accounting_integrations FOR SELECT TO authenticated
USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role));

CREATE POLICY "Owners insert their accounting integrations"
ON public.accounting_integrations FOR INSERT TO authenticated
WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role));

CREATE POLICY "Owners update their accounting integrations"
ON public.accounting_integrations FOR UPDATE TO authenticated
USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role));

CREATE POLICY "Owners delete their accounting integrations"
ON public.accounting_integrations FOR DELETE TO authenticated
USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role));

CREATE TABLE public.accounting_account_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  integration_id UUID NOT NULL REFERENCES public.accounting_integrations(id) ON DELETE CASCADE,
  matbex_account_code TEXT NOT NULL,
  matbex_account_name TEXT,
  external_account_id TEXT NOT NULL,
  external_account_name TEXT,
  external_account_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_id, matbex_account_code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_account_mappings TO authenticated;
GRANT ALL ON public.accounting_account_mappings TO service_role;
ALTER TABLE public.accounting_account_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage account mappings"
ON public.accounting_account_mappings FOR ALL TO authenticated
USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role))
WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role));

CREATE TABLE public.accounting_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  integration_id UUID NOT NULL REFERENCES public.accounting_integrations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  external_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('push','pull')),
  status TEXT NOT NULL CHECK (status IN ('success','error','skipped')),
  error_message TEXT,
  payload JSONB,
  response JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_log_tenant_date ON public.accounting_sync_log (tenant_id, synced_at DESC);
CREATE INDEX idx_sync_log_entity ON public.accounting_sync_log (entity_type, entity_id);

GRANT SELECT ON public.accounting_sync_log TO authenticated;
GRANT ALL ON public.accounting_sync_log TO service_role;
ALTER TABLE public.accounting_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and managers view sync logs"
ON public.accounting_sync_log FOR SELECT TO authenticated
USING (
  public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
  OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
);

CREATE TABLE public.accounting_sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  integration_id UUID NOT NULL REFERENCES public.accounting_integrations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create','update','delete','pull')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_sync_queue_pending ON public.accounting_sync_queue (status, next_attempt_at) WHERE status = 'pending';

GRANT SELECT ON public.accounting_sync_queue TO authenticated;
GRANT ALL ON public.accounting_sync_queue TO service_role;
ALTER TABLE public.accounting_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view sync queue"
ON public.accounting_sync_queue FOR SELECT TO authenticated
USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role));

CREATE TRIGGER update_accounting_integrations_updated_at
BEFORE UPDATE ON public.accounting_integrations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_accounting_account_mappings_updated_at
BEFORE UPDATE ON public.accounting_account_mappings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
