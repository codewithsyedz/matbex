-- Epic 3: Cash Drawer & Shift Control - Enhanced Variance Tracking

-- 1. Create shift variance log table for accountability
CREATE TABLE public.shift_variance_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  
  -- Cashier accountability
  cashier_user_id UUID REFERENCES auth.users(id),
  cashier_staff_id UUID REFERENCES public.staff(id),
  cashier_name TEXT NOT NULL,
  
  -- Variance details
  opening_float NUMERIC(15,2) NOT NULL,
  expected_cash NUMERIC(15,2) NOT NULL,
  counted_cash NUMERIC(15,2) NOT NULL,
  variance_amount NUMERIC(15,2) NOT NULL,
  variance_percentage NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN expected_cash > 0 THEN (variance_amount / expected_cash) * 100 ELSE 0 END
  ) STORED,
  
  -- Status and resolution
  variance_status VARCHAR(20) NOT NULL CHECK (variance_status IN ('perfect', 'minor', 'investigate', 'resolved', 'escalated')),
  threshold_breached BOOLEAN NOT NULL DEFAULT false,
  
  -- Mandatory explanation for breaches
  explanation TEXT,
  resolution_notes TEXT,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  
  -- Manager review
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  review_notes TEXT,
  
  -- Timestamps
  shift_opened_at TIMESTAMP WITH TIME ZONE NOT NULL,
  shift_closed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Create variance thresholds configuration table
CREATE TABLE public.variance_thresholds (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
  
  -- Thresholds
  minor_threshold NUMERIC(15,2) NOT NULL DEFAULT 10,    -- Under this = minor variance
  investigate_threshold NUMERIC(15,2) NOT NULL DEFAULT 50, -- Over this = must investigate
  escalate_threshold NUMERIC(15,2) NOT NULL DEFAULT 100,   -- Over this = auto-escalate
  
  -- Actions
  require_explanation_above NUMERIC(15,2) NOT NULL DEFAULT 10, -- Explanation required above this
  auto_escalate_enabled BOOLEAN NOT NULL DEFAULT true,
  notify_manager_enabled BOOLEAN NOT NULL DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- One config per restaurant (or tenant-level if restaurant_id is null)
  CONSTRAINT unique_threshold_per_scope UNIQUE (tenant_id, restaurant_id)
);

-- 3. Add constraint to require opening_float > 0
ALTER TABLE public.shifts 
ADD CONSTRAINT shift_opening_float_required CHECK (opening_float >= 0);

-- 4. Add variance_status column to shifts
ALTER TABLE public.shifts 
ADD COLUMN IF NOT EXISTS variance_status VARCHAR(20) DEFAULT 'pending' 
  CHECK (variance_status IN ('pending', 'perfect', 'minor', 'investigate', 'resolved', 'escalated'));

-- 5. Add explanation_required flag
ALTER TABLE public.shifts 
ADD COLUMN IF NOT EXISTS variance_explanation TEXT,
ADD COLUMN IF NOT EXISTS variance_resolved_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS variance_resolved_at TIMESTAMP WITH TIME ZONE;

-- 6. Create function to validate shift closing with variance
CREATE OR REPLACE FUNCTION public.validate_shift_close_variance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_threshold_config RECORD;
  v_variance_abs NUMERIC;
  v_status VARCHAR(20);
  v_restaurant_tenant_id UUID;
BEGIN
  -- Only check when closing a shift
  IF NEW.status = 'closed' AND (OLD.status = 'open' OR OLD.status IS NULL) THEN
    -- Get restaurant's tenant_id
    SELECT tenant_id INTO v_restaurant_tenant_id
    FROM public.restaurants WHERE id = NEW.restaurant_id;
    
    -- Get threshold configuration (restaurant-specific or tenant default)
    SELECT * INTO v_threshold_config
    FROM public.variance_thresholds
    WHERE tenant_id = v_restaurant_tenant_id
      AND (restaurant_id = NEW.restaurant_id OR restaurant_id IS NULL)
    ORDER BY restaurant_id NULLS LAST
    LIMIT 1;
    
    -- Use defaults if no config exists
    IF v_threshold_config IS NULL THEN
      v_threshold_config.minor_threshold := 10;
      v_threshold_config.investigate_threshold := 50;
      v_threshold_config.escalate_threshold := 100;
      v_threshold_config.require_explanation_above := 10;
    END IF;
    
    v_variance_abs := ABS(COALESCE(NEW.variance, 0));
    
    -- Determine variance status
    IF v_variance_abs = 0 THEN
      v_status := 'perfect';
    ELSIF v_variance_abs <= v_threshold_config.minor_threshold THEN
      v_status := 'minor';
    ELSIF v_variance_abs <= v_threshold_config.investigate_threshold THEN
      v_status := 'investigate';
    ELSE
      v_status := 'escalated';
    END IF;
    
    NEW.variance_status := v_status;
    
    -- Require explanation for variances above threshold
    IF v_variance_abs > v_threshold_config.require_explanation_above THEN
      IF NEW.variance_explanation IS NULL OR TRIM(NEW.variance_explanation) = '' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Variance of % exceeds threshold of %. A mandatory explanation is required before closing the shift.', 
          v_variance_abs, v_threshold_config.require_explanation_above;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_validate_shift_variance
BEFORE UPDATE ON public.shifts
FOR EACH ROW
EXECUTE FUNCTION public.validate_shift_close_variance();

-- 7. Create function to log variance on shift close
CREATE OR REPLACE FUNCTION public.log_shift_variance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id UUID;
  v_cashier_name TEXT;
  v_threshold_config RECORD;
  v_threshold_breached BOOLEAN;
BEGIN
  -- Only log when shift is closed
  IF NEW.status = 'closed' AND OLD.status = 'open' THEN
    -- Get tenant_id
    SELECT tenant_id INTO v_tenant_id
    FROM public.restaurants WHERE id = NEW.restaurant_id;
    
    -- Get cashier name
    SELECT name INTO v_cashier_name
    FROM public.staff WHERE id = NEW.cashier_staff_id;
    
    IF v_cashier_name IS NULL THEN
      SELECT raw_user_meta_data->>'full_name' INTO v_cashier_name
      FROM auth.users WHERE id = NEW.cashier_user_id;
    END IF;
    
    -- Get threshold config
    SELECT * INTO v_threshold_config
    FROM public.variance_thresholds
    WHERE tenant_id = v_tenant_id
      AND (restaurant_id = NEW.restaurant_id OR restaurant_id IS NULL)
    ORDER BY restaurant_id NULLS LAST
    LIMIT 1;
    
    v_threshold_breached := ABS(COALESCE(NEW.variance, 0)) > COALESCE(v_threshold_config.require_explanation_above, 10);
    
    -- Log the variance
    INSERT INTO public.shift_variance_logs (
      tenant_id,
      restaurant_id,
      shift_id,
      cashier_user_id,
      cashier_staff_id,
      cashier_name,
      opening_float,
      expected_cash,
      counted_cash,
      variance_amount,
      variance_status,
      threshold_breached,
      explanation,
      shift_opened_at,
      shift_closed_at
    ) VALUES (
      v_tenant_id,
      NEW.restaurant_id,
      NEW.id,
      NEW.cashier_user_id,
      NEW.cashier_staff_id,
      COALESCE(v_cashier_name, 'Unknown'),
      NEW.opening_float,
      COALESCE(NEW.expected_cash, NEW.opening_float),
      COALESCE(NEW.counted_cash, 0),
      COALESCE(NEW.variance, 0),
      COALESCE(NEW.variance_status, 'pending'),
      v_threshold_breached,
      NEW.variance_explanation,
      NEW.opened_at,
      NEW.closed_at
    );
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_log_shift_variance
AFTER UPDATE ON public.shifts
FOR EACH ROW
EXECUTE FUNCTION public.log_shift_variance();

-- 8. Enable RLS
ALTER TABLE public.shift_variance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variance_thresholds ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies for shift_variance_logs
CREATE POLICY "Users can view their tenant's variance logs"
ON public.shift_variance_logs
FOR SELECT
USING (
  public.is_superadmin(auth.uid()) OR 
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "System can insert variance logs"
ON public.shift_variance_logs
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Managers can update variance logs"
ON public.shift_variance_logs
FOR UPDATE
USING (
  public.is_superadmin(auth.uid()) OR 
  public.tenant_has_role(tenant_id, 'manager')
);

-- 10. RLS Policies for variance_thresholds
CREATE POLICY "Users can view their tenant's thresholds"
ON public.variance_thresholds
FOR SELECT
USING (
  public.is_superadmin(auth.uid()) OR 
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Owners can manage thresholds"
ON public.variance_thresholds
FOR ALL
USING (
  public.is_superadmin(auth.uid()) OR 
  public.tenant_has_role(tenant_id, 'owner')
);

-- 11. Indexes
CREATE INDEX idx_variance_logs_shift ON public.shift_variance_logs(shift_id);
CREATE INDEX idx_variance_logs_cashier ON public.shift_variance_logs(cashier_user_id, cashier_staff_id);
CREATE INDEX idx_variance_logs_status ON public.shift_variance_logs(variance_status) WHERE threshold_breached = true;
CREATE INDEX idx_variance_logs_date ON public.shift_variance_logs(shift_closed_at DESC);

-- 12. Updated_at trigger for thresholds
CREATE TRIGGER update_variance_thresholds_updated_at
BEFORE UPDATE ON public.variance_thresholds
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();