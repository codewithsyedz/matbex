-- Module Addons system
CREATE TYPE public.addon_billing_type AS ENUM ('recurring', 'one_time');
CREATE TYPE public.tenant_addon_status AS ENUM ('active', 'pending', 'cancelled', 'expired');
CREATE TYPE public.tenant_addon_source AS ENUM ('purchase', 'manual_grant');

-- Catalog of available addons (managed by SuperAdmins)
CREATE TABLE public.addons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_type public.addon_billing_type NOT NULL DEFAULT 'recurring',
  stripe_price_id TEXT,
  included_features JSONB NOT NULL DEFAULT '[]'::jsonb,
  quota_boosts JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.addons TO anon;
GRANT SELECT ON public.addons TO authenticated;
GRANT ALL ON public.addons TO service_role;

ALTER TABLE public.addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active addons"
  ON public.addons FOR SELECT
  USING (is_active = true OR public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins manage addons"
  ON public.addons FOR ALL
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

CREATE TRIGGER update_addons_updated_at
  BEFORE UPDATE ON public.addons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tenant-owned addon entitlements
CREATE TABLE public.tenant_addons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  addon_id UUID NOT NULL REFERENCES public.addons(id) ON DELETE CASCADE,
  status public.tenant_addon_status NOT NULL DEFAULT 'pending',
  source public.tenant_addon_source NOT NULL DEFAULT 'purchase',
  granted_by UUID,
  stripe_subscription_id TEXT,
  stripe_checkout_session_id TEXT,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_tenant_addons_unique_active
  ON public.tenant_addons (tenant_id, addon_id)
  WHERE status IN ('active','pending');

CREATE INDEX idx_tenant_addons_tenant ON public.tenant_addons(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_addons TO authenticated;
GRANT ALL ON public.tenant_addons TO service_role;

ALTER TABLE public.tenant_addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view own addons"
  ON public.tenant_addons FOR SELECT
  USING (
    public.is_superadmin(auth.uid()) OR
    tenant_id IN (SELECT tenant_id FROM public.user_tenant_roles WHERE user_id = auth.uid())
  );

CREATE POLICY "SuperAdmins manage tenant addons"
  ON public.tenant_addons FOR ALL
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

CREATE TRIGGER update_tenant_addons_updated_at
  BEFORE UPDATE ON public.tenant_addons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();