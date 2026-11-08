-- =====================================================
-- TENANT ISOLATION SECURITY IMPROVEMENTS
-- =====================================================

-- Helper functions for cleaner RLS policies

-- Check if user belongs to tenant AND has minimum required role
CREATE OR REPLACE FUNCTION public.tenant_has_role(_tenant_id uuid, _min_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND (
        (_min_role = 'cashier') OR
        (_min_role = 'manager' AND role IN ('owner', 'manager')) OR
        (_min_role = 'owner' AND role = 'owner')
      )
  )
$$;

-- Get tenant_id for a restaurant (cached lookup)
CREATE OR REPLACE FUNCTION public.get_restaurant_tenant_id(_restaurant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.restaurants WHERE id = _restaurant_id
$$;

-- Check if user can access restaurant
CREATE OR REPLACE FUNCTION public.can_access_restaurant(_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    public.is_superadmin(auth.uid()) 
    OR public.user_belongs_to_tenant(auth.uid(), public.get_restaurant_tenant_id(_restaurant_id))
$$;

-- =====================================================
-- AUDIT LOGGING TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  tenant_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only superadmins can view all audit logs
CREATE POLICY "Superadmins can view all audit logs"
ON public.audit_logs FOR SELECT
USING (public.is_superadmin(auth.uid()));

-- Tenant owners can view their own audit logs
CREATE POLICY "Tenant owners can view own audit logs"
ON public.audit_logs FOR SELECT
USING (
  tenant_id IS NOT NULL
  AND public.user_belongs_to_tenant(auth.uid(), tenant_id)
  AND public.has_tenant_role(auth.uid(), tenant_id, 'owner')
);

-- System insert policy
CREATE POLICY "System can insert audit logs"
ON public.audit_logs FOR INSERT
WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON public.audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- Audit logging function
CREATE OR REPLACE FUNCTION public.log_audit(
  _action TEXT,
  _entity_type TEXT,
  _entity_id UUID DEFAULT NULL,
  _old_data JSONB DEFAULT NULL,
  _new_data JSONB DEFAULT NULL,
  _tenant_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _log_id UUID;
  _user_tenant_id UUID;
BEGIN
  -- Get user's tenant if not provided
  IF _tenant_id IS NULL THEN
    SELECT tenant_id INTO _user_tenant_id FROM public.profiles WHERE id = auth.uid();
  ELSE
    _user_tenant_id := _tenant_id;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, tenant_id, action, entity_type, entity_id, old_data, new_data
  ) VALUES (
    auth.uid(), _user_tenant_id, _action, _entity_type, _entity_id, _old_data, _new_data
  )
  RETURNING id INTO _log_id;
  
  RETURN _log_id;
END;
$$;

-- =====================================================
-- AUDIT TRIGGERS FOR SENSITIVE OPERATIONS
-- =====================================================

-- Generic audit trigger
CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id UUID;
  _record RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _record := OLD;
  ELSE
    _record := NEW;
  END IF;

  -- Try to extract tenant_id
  BEGIN
    _tenant_id := (_record::jsonb->>'tenant_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    _tenant_id := NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (user_id, tenant_id, action, entity_type, entity_id, old_data)
    VALUES (auth.uid(), _tenant_id, 'DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (user_id, tenant_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (auth.uid(), _tenant_id, 'UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (user_id, tenant_id, action, entity_type, entity_id, new_data)
    VALUES (auth.uid(), _tenant_id, 'INSERT', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Add audit triggers to critical tables
DROP TRIGGER IF EXISTS audit_tenants_trigger ON public.tenants;
CREATE TRIGGER audit_tenants_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_superadmin_users_trigger ON public.superadmin_users;
CREATE TRIGGER audit_superadmin_users_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.superadmin_users
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_user_tenant_roles_trigger ON public.user_tenant_roles;
CREATE TRIGGER audit_user_tenant_roles_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.user_tenant_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_plans_trigger ON public.plans;
CREATE TRIGGER audit_plans_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.plans
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_restaurants_trigger ON public.restaurants;
CREATE TRIGGER audit_restaurants_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- =====================================================
-- ENHANCED RLS POLICIES WITH SUPERADMIN BYPASS
-- =====================================================

-- Update tenants table policies for explicit SuperAdmin bypass
DROP POLICY IF EXISTS "Superadmins can manage tenants" ON public.tenants;
CREATE POLICY "Superadmins can manage tenants"
ON public.tenants FOR ALL
USING (public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "Tenant members can view own tenant" ON public.tenants;
CREATE POLICY "Tenant members can view own tenant"
ON public.tenants FOR SELECT
USING (public.user_belongs_to_tenant(auth.uid(), id));

DROP POLICY IF EXISTS "Tenant owners can update own tenant" ON public.tenants;
CREATE POLICY "Tenant owners can update own tenant"
ON public.tenants FOR UPDATE
USING (public.has_tenant_role(auth.uid(), id, 'owner'));

-- Update user_tenant_roles for better security
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_tenant_roles;
CREATE POLICY "Users can view own roles"
ON public.user_tenant_roles FOR SELECT
USING (
  user_id = auth.uid() 
  OR public.is_superadmin(auth.uid())
  OR public.has_tenant_role(auth.uid(), tenant_id, 'owner')
);

DROP POLICY IF EXISTS "Tenant owners can manage roles" ON public.user_tenant_roles;
CREATE POLICY "Tenant owners can manage roles"
ON public.user_tenant_roles FOR ALL
USING (
  public.is_superadmin(auth.uid())
  OR public.has_tenant_role(auth.uid(), tenant_id, 'owner')
);

-- Update tenant_features policies
DROP POLICY IF EXISTS "Superadmins can manage features" ON public.tenant_features;
CREATE POLICY "Superadmins can manage features"
ON public.tenant_features FOR ALL
USING (public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "Tenant members can view own features" ON public.tenant_features;
CREATE POLICY "Tenant members can view own features"
ON public.tenant_features FOR SELECT
USING (public.user_belongs_to_tenant(auth.uid(), tenant_id));