-- Add quota limits to plans table
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS quota_limits jsonb DEFAULT '{}'::jsonb;

-- Create tenant usage tracking table
CREATE TABLE public.tenant_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL UNIQUE,
  user_count integer DEFAULT 0,
  owner_count integer DEFAULT 0,
  manager_count integer DEFAULT 0,
  cashier_count integer DEFAULT 0,
  menu_item_count integer DEFAULT 0,
  image_upload_count integer DEFAULT 0,
  email_reminder_count integer DEFAULT 0,
  email_count_reset_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tenant_usage ENABLE ROW LEVEL SECURITY;

-- RLS policies for tenant_usage
CREATE POLICY "SuperAdmins can manage all tenant usage"
ON public.tenant_usage
FOR ALL
USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Tenants can view their own usage"
ON public.tenant_usage
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_tenant_roles utr
    WHERE utr.user_id = auth.uid()
    AND utr.tenant_id = tenant_usage.tenant_id
  )
);

-- Create index for fast lookups
CREATE INDEX idx_tenant_usage_tenant_id ON public.tenant_usage(tenant_id);

-- Function to initialize tenant usage when tenant is created
CREATE OR REPLACE FUNCTION public.init_tenant_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tenant_usage (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger to auto-create usage record for new tenants
CREATE TRIGGER trigger_init_tenant_usage
AFTER INSERT ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.init_tenant_usage();

-- Function to update user count on role changes
CREATE OR REPLACE FUNCTION public.update_tenant_user_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_tenant_id := NEW.tenant_id;
  END IF;

  UPDATE public.tenant_usage
  SET
    user_count = (SELECT COUNT(DISTINCT user_id) FROM public.user_tenant_roles WHERE tenant_id = v_tenant_id),
    owner_count = (SELECT COUNT(*) FROM public.user_tenant_roles WHERE tenant_id = v_tenant_id AND role = 'owner'),
    manager_count = (SELECT COUNT(*) FROM public.user_tenant_roles WHERE tenant_id = v_tenant_id AND role = 'manager'),
    cashier_count = (SELECT COUNT(*) FROM public.user_tenant_roles WHERE tenant_id = v_tenant_id AND role = 'cashier'),
    updated_at = now()
  WHERE tenant_id = v_tenant_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger to update counts on role changes
CREATE TRIGGER trigger_update_tenant_user_counts
AFTER INSERT OR UPDATE OR DELETE ON public.user_tenant_roles
FOR EACH ROW
EXECUTE FUNCTION public.update_tenant_user_counts();

-- Function to update menu item count
CREATE OR REPLACE FUNCTION public.update_tenant_menu_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_restaurant_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_restaurant_id := OLD.restaurant_id;
  ELSE
    v_restaurant_id := NEW.restaurant_id;
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM public.restaurants WHERE id = v_restaurant_id;

  IF v_tenant_id IS NOT NULL THEN
    UPDATE public.tenant_usage
    SET
      menu_item_count = (
        SELECT COUNT(*) FROM public.menu_items mi
        JOIN public.restaurants r ON mi.restaurant_id = r.id
        WHERE r.tenant_id = v_tenant_id
      ),
      updated_at = now()
    WHERE tenant_id = v_tenant_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger to update menu count
CREATE TRIGGER trigger_update_tenant_menu_count
AFTER INSERT OR UPDATE OR DELETE ON public.menu_items
FOR EACH ROW
EXECUTE FUNCTION public.update_tenant_menu_count();

-- Function to check quota before action (returns jsonb with status)
CREATE OR REPLACE FUNCTION public.check_quota(
  p_tenant_id uuid,
  p_quota_type text,
  p_increment integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_limits jsonb;
  v_current_usage integer;
  v_limit integer;
  v_allowed boolean := true;
BEGIN
  -- Get plan limits for tenant
  SELECT p.quota_limits INTO v_plan_limits
  FROM public.tenants t
  JOIN public.plans p ON t.plan_id = p.id
  WHERE t.id = p_tenant_id;

  IF v_plan_limits IS NULL OR v_plan_limits = '{}'::jsonb THEN
    RETURN jsonb_build_object('allowed', true, 'current', 0, 'limit', null, 'remaining', null);
  END IF;

  -- Get current usage
  SELECT 
    CASE p_quota_type
      WHEN 'users' THEN user_count
      WHEN 'menu_items' THEN menu_item_count
      WHEN 'image_uploads' THEN image_upload_count
      WHEN 'email_reminders' THEN email_reminder_count
      WHEN 'owner' THEN owner_count
      WHEN 'manager' THEN manager_count
      WHEN 'cashier' THEN cashier_count
      ELSE 0
    END INTO v_current_usage
  FROM public.tenant_usage
  WHERE tenant_id = p_tenant_id;

  v_current_usage := COALESCE(v_current_usage, 0);

  -- Get limit from plan
  v_limit := (v_plan_limits->>p_quota_type)::integer;

  -- Check if action is allowed
  IF v_limit IS NOT NULL AND (v_current_usage + p_increment) > v_limit THEN
    v_allowed := false;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'current', v_current_usage,
    'limit', v_limit,
    'remaining', CASE WHEN v_limit IS NOT NULL THEN GREATEST(0, v_limit - v_current_usage) ELSE null END
  );
END;
$$;

-- Function to increment usage counters
CREATE OR REPLACE FUNCTION public.increment_usage(
  p_tenant_id uuid,
  p_quota_type text,
  p_amount integer DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tenant_usage
  SET
    image_upload_count = CASE WHEN p_quota_type = 'image_uploads' THEN image_upload_count + p_amount ELSE image_upload_count END,
    email_reminder_count = CASE WHEN p_quota_type = 'email_reminders' THEN email_reminder_count + p_amount ELSE email_reminder_count END,
    updated_at = now()
  WHERE tenant_id = p_tenant_id;
  
  RETURN FOUND;
END;
$$;

-- Initialize usage records for existing tenants
INSERT INTO public.tenant_usage (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- Update existing tenant usage counts
UPDATE public.tenant_usage tu
SET
  user_count = (SELECT COUNT(DISTINCT user_id) FROM public.user_tenant_roles WHERE tenant_id = tu.tenant_id),
  owner_count = (SELECT COUNT(*) FROM public.user_tenant_roles WHERE tenant_id = tu.tenant_id AND role = 'owner'),
  manager_count = (SELECT COUNT(*) FROM public.user_tenant_roles WHERE tenant_id = tu.tenant_id AND role = 'manager'),
  cashier_count = (SELECT COUNT(*) FROM public.user_tenant_roles WHERE tenant_id = tu.tenant_id AND role = 'cashier'),
  menu_item_count = (
    SELECT COUNT(*) FROM public.menu_items mi
    JOIN public.restaurants r ON mi.restaurant_id = r.id
    WHERE r.tenant_id = tu.tenant_id
  ),
  updated_at = now();