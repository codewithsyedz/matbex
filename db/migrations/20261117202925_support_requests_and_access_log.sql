-- Help requests from inside the app, and a log of Matbex support's access to businesses.
--
-- support_requests / support_messages: written only by the server functions support-request
-- (customers) and admin-support (SuperAdmins), which also snapshot the page and the user's recent
-- client errors and send the emails. Customers read their own requests (owners: all of their
-- business's); support notes marked internal are never shown to customers.
-- support_access_log: every SuperAdmin "View as Tenant" session, with its reason (and the request
-- it was for); owners can read their business's entries (Settings → Security).

CREATE TABLE IF NOT EXISTS public.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001) UNIQUE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_email text,
  user_name text,
  category text NOT NULL DEFAULT 'question' CHECK (category IN ('question', 'problem', 'billing', 'feature', 'other')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 3 AND 150),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting_on_customer', 'resolved')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  -- where the user was and what they were using
  page_path text,
  page_title text,
  branch_id uuid,
  user_agent text,
  viewport text,
  app_version text,
  -- the user's client errors in the hour before the request (from client_errors)
  recent_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  assigned_to uuid,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_by text NOT NULL DEFAULT 'customer' CHECK (last_message_by IN ('customer', 'support')),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_requests_tenant_idx ON public.support_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_requests_status_idx ON public.support_requests (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.support_requests(id) ON DELETE CASCADE,
  author_id uuid,
  author_kind text NOT NULL CHECK (author_kind IN ('customer', 'support')),
  author_name text,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT internal OR author_kind = 'support')
);
CREATE INDEX IF NOT EXISTS support_messages_request_idx ON public.support_messages (request_id, created_at);

CREATE TABLE IF NOT EXISTS public.support_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL,
  actor_name text,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
  request_id uuid REFERENCES public.support_requests(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS support_access_log_tenant_idx ON public.support_access_log (tenant_id, started_at DESC);

DROP TRIGGER IF EXISTS trg_support_requests_updated_at ON public.support_requests;
CREATE TRIGGER trg_support_requests_updated_at BEFORE UPDATE ON public.support_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_requests_read" ON public.support_requests;
CREATE POLICY "support_requests_read" ON public.support_requests FOR SELECT TO authenticated
  USING (
    public.is_superadmin(auth.uid())
    OR (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_tenant_roles r WHERE r.user_id = auth.uid() AND r.tenant_id = support_requests.tenant_id))
    OR public.tenant_has_role(tenant_id, 'owner')
  );

DROP POLICY IF EXISTS "support_messages_read" ON public.support_messages;
CREATE POLICY "support_messages_read" ON public.support_messages FOR SELECT TO authenticated
  USING (
    public.is_superadmin(auth.uid())
    OR (NOT internal AND EXISTS (SELECT 1 FROM public.support_requests q WHERE q.id = support_messages.request_id))
  );

DROP POLICY IF EXISTS "support_access_log_read" ON public.support_access_log;
CREATE POLICY "support_access_log_read" ON public.support_access_log FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.tenant_has_role(tenant_id, 'owner'));

GRANT SELECT ON public.support_requests, public.support_messages, public.support_access_log TO authenticated;
GRANT ALL ON public.support_requests, public.support_messages, public.support_access_log TO service_role;
