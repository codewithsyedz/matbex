-- Per-tenant payment gateway credentials. Owner-only access.
CREATE TABLE IF NOT EXISTS public.payment_gateway_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  gateway public.payment_gateway NOT NULL,
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, gateway)
);

ALTER TABLE public.payment_gateway_credentials ENABLE ROW LEVEL SECURITY;

-- Owner-only: view, insert, update, delete
CREATE POLICY "pgcred_owner_select"
  ON public.payment_gateway_credentials FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND tenant_has_role(tenant_id, 'owner'));

CREATE POLICY "pgcred_owner_modify"
  ON public.payment_gateway_credentials FOR ALL
  TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND tenant_has_role(tenant_id, 'owner'))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND tenant_has_role(tenant_id, 'owner'));

CREATE TRIGGER trg_pgcred_updated_at
  BEFORE UPDATE ON public.payment_gateway_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();