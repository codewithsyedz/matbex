-- Epic 2: Daily Sales Capture - Database Schema

-- 1. Create delivery platforms enum
CREATE TYPE public.delivery_platform AS ENUM ('hungerstation', 'jahez', 'toyou', 'mrsool', 'carriage', 'talabat', 'uber_eats', 'other');

-- 2. Create daily sales summary table with uniqueness constraint per restaurant/date
CREATE TABLE public.daily_sales_summary (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  sales_date DATE NOT NULL,
  
  -- Payment method breakdowns (mandatory)
  cash_sales NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (cash_sales >= 0),
  card_sales NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (card_sales >= 0),
  delivery_sales NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (delivery_sales >= 0),
  other_sales NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (other_sales >= 0),
  
  -- Auto-calculated total
  total_sales NUMERIC(15,2) NOT NULL GENERATED ALWAYS AS (cash_sales + card_sales + delivery_sales + other_sales) STORED,
  
  -- POS reconciliation
  pos_reported_total NUMERIC(15,2),
  system_calculated_total NUMERIC(15,2),
  variance_amount NUMERIC(15,2) GENERATED ALWAYS AS (COALESCE(pos_reported_total, 0) - system_calculated_total) STORED,
  variance_status VARCHAR(20) DEFAULT 'pending' CHECK (variance_status IN ('pending', 'matched', 'minor', 'investigate', 'resolved')),
  variance_notes TEXT,
  variance_resolved_by UUID,
  variance_resolved_at TIMESTAMP WITH TIME ZONE,
  
  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'closed')),
  submitted_by UUID,
  submitted_at TIMESTAMP WITH TIME ZONE,
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Prevent duplicate entries for the same date
  CONSTRAINT unique_daily_sales_per_restaurant UNIQUE (restaurant_id, sales_date)
);

-- 3. Create delivery platform breakdown table
CREATE TABLE public.daily_delivery_breakdown (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  daily_sales_id UUID NOT NULL REFERENCES public.daily_sales_summary(id) ON DELETE CASCADE,
  platform public.delivery_platform NOT NULL,
  gross_sales NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (gross_sales >= 0),
  platform_commission NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (platform_commission >= 0),
  net_sales NUMERIC(15,2) NOT NULL GENERATED ALWAYS AS (gross_sales - platform_commission) STORED,
  order_count INTEGER NOT NULL DEFAULT 0 CHECK (order_count >= 0),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- One entry per platform per day
  CONSTRAINT unique_platform_per_day UNIQUE (daily_sales_id, platform)
);

-- 4. Add delivery platform to sales_transactions for POS tracking
ALTER TABLE public.sales_transactions 
ADD COLUMN IF NOT EXISTS delivery_platform public.delivery_platform,
ADD COLUMN IF NOT EXISTS is_delivery BOOLEAN DEFAULT false;

-- 5. Create function to auto-calculate system totals from transactions
CREATE OR REPLACE FUNCTION public.calculate_daily_system_total(
  p_restaurant_id UUID,
  p_sales_date DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(total), 0)
  INTO v_total
  FROM public.sales_transactions
  WHERE restaurant_id = p_restaurant_id
    AND DATE(created_at) = p_sales_date;
  
  RETURN v_total;
END;
$$;

-- 6. Create function to validate delivery breakdown matches total
CREATE OR REPLACE FUNCTION public.validate_delivery_breakdown()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_breakdown_total NUMERIC;
  v_delivery_sales NUMERIC;
BEGIN
  -- Get total from all delivery breakdowns
  SELECT COALESCE(SUM(gross_sales), 0)
  INTO v_breakdown_total
  FROM public.daily_delivery_breakdown
  WHERE daily_sales_id = NEW.daily_sales_id;
  
  -- Include the new/updated row
  IF TG_OP = 'INSERT' THEN
    v_breakdown_total := v_breakdown_total + NEW.gross_sales;
  ELSIF TG_OP = 'UPDATE' THEN
    v_breakdown_total := v_breakdown_total - OLD.gross_sales + NEW.gross_sales;
  END IF;
  
  -- Get delivery_sales from parent record
  SELECT delivery_sales
  INTO v_delivery_sales
  FROM public.daily_sales_summary
  WHERE id = NEW.daily_sales_id;
  
  -- Warn if breakdown exceeds delivery total (allow it but track)
  IF v_breakdown_total > v_delivery_sales THEN
    RAISE WARNING 'Delivery platform breakdown (%) exceeds total delivery sales (%)', v_breakdown_total, v_delivery_sales;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_validate_delivery_breakdown
BEFORE INSERT OR UPDATE ON public.daily_delivery_breakdown
FOR EACH ROW
EXECUTE FUNCTION public.validate_delivery_breakdown();

-- 7. Create function to prevent closing day with unresolved variance
CREATE OR REPLACE FUNCTION public.validate_day_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only check when changing to 'closed' status
  IF NEW.status = 'closed' AND OLD.status != 'closed' THEN
    -- Check if variance is too high and unresolved
    IF NEW.variance_status = 'investigate' AND NEW.variance_resolved_at IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Cannot close day with unresolved variance of %. Please investigate and resolve the discrepancy before closing.', NEW.variance_amount;
    END IF;
    
    -- Ensure mandatory fields are present
    IF NEW.cash_sales IS NULL OR NEW.card_sales IS NULL OR NEW.delivery_sales IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: All payment types (Cash, Card, Delivery) must be recorded before closing the day.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_validate_day_close
BEFORE UPDATE ON public.daily_sales_summary
FOR EACH ROW
EXECUTE FUNCTION public.validate_day_close();

-- 8. Create function to auto-update variance status
CREATE OR REPLACE FUNCTION public.update_variance_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_variance NUMERIC;
BEGIN
  v_variance := COALESCE(NEW.pos_reported_total, 0) - COALESCE(NEW.system_calculated_total, 0);
  
  IF NEW.pos_reported_total IS NULL OR NEW.system_calculated_total IS NULL THEN
    NEW.variance_status := 'pending';
  ELSIF ABS(v_variance) = 0 THEN
    NEW.variance_status := 'matched';
  ELSIF ABS(v_variance) <= 10 THEN
    NEW.variance_status := 'minor';
  ELSE
    NEW.variance_status := 'investigate';
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_variance_status
BEFORE INSERT OR UPDATE OF pos_reported_total, system_calculated_total ON public.daily_sales_summary
FOR EACH ROW
EXECUTE FUNCTION public.update_variance_status();

-- 9. Create function to prevent date gaps
CREATE OR REPLACE FUNCTION public.validate_sales_date_sequence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last_closed_date DATE;
  v_expected_date DATE;
BEGIN
  -- Get the last closed date for this restaurant
  SELECT MAX(sales_date)
  INTO v_last_closed_date
  FROM public.daily_sales_summary
  WHERE restaurant_id = NEW.restaurant_id
    AND status = 'closed';
  
  -- If there's a previous closed day, new entry should be the next day or same day (for updates)
  IF v_last_closed_date IS NOT NULL THEN
    v_expected_date := v_last_closed_date + INTERVAL '1 day';
    
    IF NEW.sales_date < v_last_closed_date THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Cannot create sales entry for past date %. The last closed date is %.', NEW.sales_date, v_last_closed_date;
    END IF;
    
    -- Check for gaps (only when trying to close, allow drafts for any future date)
    IF NEW.status = 'closed' AND NEW.sales_date > v_expected_date THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Cannot close date % - there are unclosed days between % and %. Please close days in sequence.', NEW.sales_date, v_last_closed_date, NEW.sales_date;
    END IF;
  END IF;
  
  -- Cannot create entries for future dates
  IF NEW.sales_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Cannot create sales entry for future date %.', NEW.sales_date;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_validate_sales_date
BEFORE INSERT OR UPDATE ON public.daily_sales_summary
FOR EACH ROW
EXECUTE FUNCTION public.validate_sales_date_sequence();

-- 10. Enable RLS
ALTER TABLE public.daily_sales_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_delivery_breakdown ENABLE ROW LEVEL SECURITY;

-- 11. RLS Policies for daily_sales_summary
CREATE POLICY "Users can view their tenant's daily sales"
ON public.daily_sales_summary
FOR SELECT
USING (
  public.is_superadmin(auth.uid()) OR 
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Users can insert daily sales for their tenant"
ON public.daily_sales_summary
FOR INSERT
WITH CHECK (
  public.is_superadmin(auth.uid()) OR 
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Users can update their tenant's daily sales"
ON public.daily_sales_summary
FOR UPDATE
USING (
  public.is_superadmin(auth.uid()) OR 
  tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

-- 12. RLS Policies for daily_delivery_breakdown
CREATE POLICY "Users can view their tenant's delivery breakdown"
ON public.daily_delivery_breakdown
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.daily_sales_summary dss
    WHERE dss.id = daily_sales_id
    AND (
      public.is_superadmin(auth.uid()) OR 
      dss.tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    )
  )
);

CREATE POLICY "Users can manage their tenant's delivery breakdown"
ON public.daily_delivery_breakdown
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.daily_sales_summary dss
    WHERE dss.id = daily_sales_id
    AND (
      public.is_superadmin(auth.uid()) OR 
      dss.tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    )
  )
);

-- 13. Indexes for performance
CREATE INDEX idx_daily_sales_restaurant_date ON public.daily_sales_summary(restaurant_id, sales_date);
CREATE INDEX idx_daily_sales_status ON public.daily_sales_summary(status);
CREATE INDEX idx_daily_delivery_sales_id ON public.daily_delivery_breakdown(daily_sales_id);
CREATE INDEX idx_sales_transactions_delivery ON public.sales_transactions(delivery_platform) WHERE is_delivery = true;

-- 14. Add updated_at trigger
CREATE TRIGGER update_daily_sales_summary_updated_at
BEFORE UPDATE ON public.daily_sales_summary
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();