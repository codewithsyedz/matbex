-- Create plans table for subscription tiers
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  price numeric NOT NULL DEFAULT 0,
  billing_interval text NOT NULL DEFAULT 'monthly',
  default_feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert default plans
INSERT INTO public.plans (name, price, billing_interval, default_feature_flags, description) VALUES
  ('free', 0, 'monthly', '{"daily_profit": true, "inventory": false, "payroll": false, "api_access": false, "multi_location": false, "advanced_reports": false}'::jsonb, 'Basic plan for small restaurants'),
  ('pro', 49, 'monthly', '{"daily_profit": true, "inventory": true, "payroll": true, "api_access": false, "multi_location": false, "advanced_reports": true}'::jsonb, 'Professional plan with full features'),
  ('enterprise', 199, 'monthly', '{"daily_profit": true, "inventory": true, "payroll": true, "api_access": true, "multi_location": true, "advanced_reports": true}'::jsonb, 'Enterprise plan for chains');

-- Create tenants table
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trial', 'suspended', 'archived')),
  plan_id uuid REFERENCES public.plans(id),
  trial_ends_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create tenant_features table for per-tenant overrides
CREATE TABLE public.tenant_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, feature_key)
);

-- Add tenant_id to restaurants table
ALTER TABLE public.restaurants 
ADD COLUMN tenant_id uuid REFERENCES public.tenants(id),
ADD COLUMN is_primary boolean NOT NULL DEFAULT true;

-- Remove old status/plan columns from restaurants (they now live on tenants)
-- First we need to migrate existing data

-- Create a tenant for each existing restaurant
INSERT INTO public.tenants (id, name, status, created_at, updated_at)
SELECT 
  id, -- Use same id as restaurant for easier migration
  name,
  CASE 
    WHEN status = 'active' THEN 'active'
    WHEN status = 'suspended' THEN 'suspended'
    ELSE 'active'
  END,
  created_at,
  updated_at
FROM public.restaurants;

-- Set the free plan for all migrated tenants
UPDATE public.tenants 
SET plan_id = (SELECT id FROM public.plans WHERE name = 'free' LIMIT 1)
WHERE plan_id IS NULL;

-- Update restaurants to point to their tenant (same id after migration)
UPDATE public.restaurants 
SET tenant_id = id,
    is_primary = true
WHERE tenant_id IS NULL;

-- Now make tenant_id NOT NULL
ALTER TABLE public.restaurants 
ALTER COLUMN tenant_id SET NOT NULL;

-- Create user_tenant_roles table to replace restaurant-scoped roles
CREATE TABLE public.user_tenant_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, tenant_id, role)
);

-- Migrate existing user_roles to user_tenant_roles
INSERT INTO public.user_tenant_roles (user_id, tenant_id, role, created_at)
SELECT 
  ur.user_id,
  r.tenant_id,
  ur.role,
  ur.created_at
FROM public.user_roles ur
JOIN public.restaurants r ON ur.restaurant_id = r.id
ON CONFLICT (user_id, tenant_id, role) DO NOTHING;

-- Update profiles to use tenant_id instead of restaurant_id
ALTER TABLE public.profiles
ADD COLUMN tenant_id uuid REFERENCES public.tenants(id);

-- Migrate existing profile restaurant associations to tenant
UPDATE public.profiles p
SET tenant_id = r.tenant_id
FROM public.restaurants r
WHERE p.restaurant_id = r.id;

-- Create helper function to check tenant membership
CREATE OR REPLACE FUNCTION public.user_belongs_to_tenant(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_tenant_roles
    WHERE user_id = _user_id
      AND tenant_id = _tenant_id
  )
$$;

-- Create helper function for tenant-scoped role check
CREATE OR REPLACE FUNCTION public.has_tenant_role(_user_id uuid, _tenant_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_tenant_roles
    WHERE user_id = _user_id
      AND tenant_id = _tenant_id
      AND role = _role
  )
$$;

-- Get user's current tenant
CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.profiles WHERE id = _user_id LIMIT 1
$$;

-- Enable RLS on new tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tenant_roles ENABLE ROW LEVEL SECURITY;

-- Plans policies (public read for all authenticated, superadmin manage)
CREATE POLICY "Anyone can view active plans" ON public.plans
  FOR SELECT USING (is_active = true);

CREATE POLICY "Superadmins can manage plans" ON public.plans
  FOR ALL USING (is_superadmin(auth.uid()));

-- Tenants policies
CREATE POLICY "Users can view their tenant" ON public.tenants
  FOR SELECT USING (user_belongs_to_tenant(auth.uid(), id) OR is_superadmin(auth.uid()));

CREATE POLICY "Superadmins can manage tenants" ON public.tenants
  FOR ALL USING (is_superadmin(auth.uid()));

CREATE POLICY "Allow tenant creation during onboarding" ON public.tenants
  FOR INSERT WITH CHECK (true);

-- Tenant features policies
CREATE POLICY "Users can view their tenant features" ON public.tenant_features
  FOR SELECT USING (user_belongs_to_tenant(auth.uid(), tenant_id) OR is_superadmin(auth.uid()));

CREATE POLICY "Superadmins can manage tenant features" ON public.tenant_features
  FOR ALL USING (is_superadmin(auth.uid()));

-- User tenant roles policies
CREATE POLICY "Users can view their own roles" ON public.user_tenant_roles
  FOR SELECT USING (user_id = auth.uid() OR is_superadmin(auth.uid()));

CREATE POLICY "Tenant owners can manage roles" ON public.user_tenant_roles
  FOR ALL USING (
    has_tenant_role(auth.uid(), tenant_id, 'owner') OR 
    is_superadmin(auth.uid())
  );

CREATE POLICY "Allow role creation during onboarding" ON public.user_tenant_roles
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Update restaurants policies to use tenant-based access
DROP POLICY IF EXISTS "Users can view their restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Users can create restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Owners can update their restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Superadmins can view all restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Superadmins can update all restaurants" ON public.restaurants;

CREATE POLICY "Users can view tenant restaurants" ON public.restaurants
  FOR SELECT USING (user_belongs_to_tenant(auth.uid(), tenant_id) OR is_superadmin(auth.uid()));

CREATE POLICY "Tenant owners can manage restaurants" ON public.restaurants
  FOR ALL USING (
    has_tenant_role(auth.uid(), tenant_id, 'owner') OR 
    is_superadmin(auth.uid())
  );

CREATE POLICY "Allow restaurant creation during onboarding" ON public.restaurants
  FOR INSERT WITH CHECK (true);

-- Update profiles policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Superadmins can view all profiles" ON public.profiles;

CREATE POLICY "Users can view own and tenant profiles" ON public.profiles
  FOR SELECT USING (
    auth.uid() = id OR 
    (tenant_id IS NOT NULL AND user_belongs_to_tenant(auth.uid(), tenant_id)) OR
    is_superadmin(auth.uid())
  );

-- Create triggers for updated_at
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tenant_features_updated_at
  BEFORE UPDATE ON public.tenant_features
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();