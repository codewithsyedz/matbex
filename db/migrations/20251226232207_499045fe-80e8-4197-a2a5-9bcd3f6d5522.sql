-- Daily COGS Submissions table - core submission record per shift
CREATE TABLE public.daily_cogs_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  shift_template_id UUID REFERENCES public.shift_templates(id) ON DELETE SET NULL,
  submission_date DATE NOT NULL,
  shift_type TEXT NOT NULL DEFAULT 'full' CHECK (shift_type IN ('morning', 'evening', 'night', 'full')),
  
  -- Cashier who submitted
  cashier_user_id UUID NOT NULL,
  cashier_name TEXT NOT NULL,
  
  -- Kitchen verification
  kitchen_incharge_name TEXT,
  kitchen_verified_at TIMESTAMP WITH TIME ZONE,
  
  -- Stock values (SAR)
  opening_stock_value NUMERIC NOT NULL DEFAULT 0,
  closing_stock_value NUMERIC NOT NULL DEFAULT 0,
  purchases_value NUMERIC NOT NULL DEFAULT 0,
  
  -- Sales summary
  cash_sales NUMERIC NOT NULL DEFAULT 0,
  card_sales NUMERIC NOT NULL DEFAULT 0,
  online_sales NUMERIC NOT NULL DEFAULT 0,
  total_sales NUMERIC NOT NULL DEFAULT 0,
  
  -- Auto-calculated fields
  cogs NUMERIC NOT NULL DEFAULT 0,
  food_cost_percentage NUMERIC NOT NULL DEFAULT 0,
  
  -- Comparison fields
  theoretical_cogs NUMERIC DEFAULT 0,
  variance_value NUMERIC DEFAULT 0,
  variance_percentage NUMERIC DEFAULT 0,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'correction_requested')),
  
  -- Approval workflow
  submitted_at TIMESTAMP WITH TIME ZONE,
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  
  -- Signatures (digital or noted)
  cashier_signature_at TIMESTAMP WITH TIME ZONE,
  kitchen_signature_at TIMESTAMP WITH TIME ZONE,
  manager_signature_at TIMESTAMP WITH TIME ZONE,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Prevent duplicate submissions for same shift/date
  CONSTRAINT unique_shift_date_submission UNIQUE (restaurant_id, submission_date, shift_type)
);

-- COGS Stock Items - detailed stock breakdown per category
CREATE TABLE public.cogs_stock_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.daily_cogs_submissions(id) ON DELETE CASCADE,
  stock_type TEXT NOT NULL CHECK (stock_type IN ('opening', 'closing')),
  
  -- Stock categories from PRD
  category TEXT NOT NULL CHECK (category IN (
    'flour_atta', 'rice', 'meat_chicken', 'oil_ghee', 'vegetables', 
    'dairy_laban', 'spices_condiments', 'ready_mix', 'other'
  )),
  category_label TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- COGS Purchases - individual purchase entries during shift
CREATE TABLE public.cogs_purchases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.daily_cogs_submissions(id) ON DELETE CASCADE,
  
  supplier_name TEXT,
  invoice_number TEXT,
  payment_mode TEXT NOT NULL DEFAULT 'cash' CHECK (payment_mode IN ('cash', 'credit', 'transfer')),
  item_type TEXT NOT NULL CHECK (item_type IN (
    'flour_atta', 'rice', 'meat_chicken', 'oil_ghee', 'vegetables', 
    'dairy_laban', 'spices_condiments', 'ready_mix', 'other'
  )),
  amount NUMERIC NOT NULL DEFAULT 0,
  
  -- Audit flag
  missing_bill BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  
  entered_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- COGS Exception Logs - for variance remarks and anomalies
CREATE TABLE public.cogs_exception_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.daily_cogs_submissions(id) ON DELETE CASCADE,
  
  exception_type TEXT NOT NULL CHECK (exception_type IN (
    'high_food_cost', 'high_purchases', 'variance_threshold', 'missing_bill', 'manual_entry'
  )),
  
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'wastage_spoilage', 'free_staff_meals', 'theft_suspected', 'over_portioning',
    'market_price_increase', 'entry_error', 'other'
  )),
  reason_label TEXT NOT NULL,
  
  remarks TEXT NOT NULL,
  
  logged_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- COGS Correction Tickets - for amendment requests post-approval
CREATE TABLE public.cogs_correction_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.daily_cogs_submissions(id) ON DELETE CASCADE,
  
  requested_by UUID NOT NULL,
  request_reason TEXT NOT NULL,
  
  -- What needs correction
  field_to_correct TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  
  -- Approval
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  review_notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- COGS Historical Average - for anomaly detection
CREATE TABLE public.cogs_historical_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  
  stat_date DATE NOT NULL,
  avg_opening_stock NUMERIC NOT NULL DEFAULT 0,
  avg_purchases NUMERIC NOT NULL DEFAULT 0,
  avg_closing_stock NUMERIC NOT NULL DEFAULT 0,
  avg_cogs NUMERIC NOT NULL DEFAULT 0,
  avg_food_cost_percentage NUMERIC NOT NULL DEFAULT 0,
  
  -- Rolling averages (last 5 shifts)
  rolling_avg_opening_stock NUMERIC DEFAULT 0,
  rolling_avg_purchases NUMERIC DEFAULT 0,
  
  data_points_count INTEGER NOT NULL DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_restaurant_stat_date UNIQUE (restaurant_id, stat_date)
);

-- Enable RLS on all tables
ALTER TABLE public.daily_cogs_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_exception_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_correction_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_historical_stats ENABLE ROW LEVEL SECURITY;

-- RLS Policies for daily_cogs_submissions
CREATE POLICY "Users can view COGS submissions in their restaurant"
ON public.daily_cogs_submissions FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Users can create COGS submissions in their restaurant"
ON public.daily_cogs_submissions FOR INSERT
WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id) AND cashier_user_id = auth.uid());

CREATE POLICY "Users can update their own draft submissions"
ON public.daily_cogs_submissions FOR UPDATE
USING (
  (cashier_user_id = auth.uid() AND status = 'draft') OR
  has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR
  has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);

-- RLS for cogs_stock_items
CREATE POLICY "Users can view stock items via submission"
ON public.cogs_stock_items FOR SELECT
USING (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND user_belongs_to_restaurant(auth.uid(), s.restaurant_id)
));

CREATE POLICY "Users can insert stock items for their submissions"
ON public.cogs_stock_items FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND s.cashier_user_id = auth.uid()
));

CREATE POLICY "Users can update stock items for their submissions"
ON public.cogs_stock_items FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND (s.cashier_user_id = auth.uid() OR 
    has_role(auth.uid(), s.restaurant_id, 'manager'::app_role))
));

CREATE POLICY "Users can delete stock items for their submissions"
ON public.cogs_stock_items FOR DELETE
USING (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND s.cashier_user_id = auth.uid() AND s.status = 'draft'
));

-- RLS for cogs_purchases
CREATE POLICY "Users can view purchases via submission"
ON public.cogs_purchases FOR SELECT
USING (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND user_belongs_to_restaurant(auth.uid(), s.restaurant_id)
));

CREATE POLICY "Users can insert purchases for their submissions"
ON public.cogs_purchases FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND s.cashier_user_id = auth.uid()
) AND entered_by = auth.uid());

CREATE POLICY "Users can update purchases for their submissions"
ON public.cogs_purchases FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND (s.cashier_user_id = auth.uid() OR 
    has_role(auth.uid(), s.restaurant_id, 'manager'::app_role))
));

CREATE POLICY "Users can delete purchases for draft submissions"
ON public.cogs_purchases FOR DELETE
USING (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND s.cashier_user_id = auth.uid() AND s.status = 'draft'
));

-- RLS for cogs_exception_logs
CREATE POLICY "Users can view exception logs via submission"
ON public.cogs_exception_logs FOR SELECT
USING (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND user_belongs_to_restaurant(auth.uid(), s.restaurant_id)
));

CREATE POLICY "Users can insert exception logs for their submissions"
ON public.cogs_exception_logs FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND s.cashier_user_id = auth.uid()
) AND logged_by = auth.uid());

-- RLS for cogs_correction_tickets
CREATE POLICY "Users can view correction tickets via submission"
ON public.cogs_correction_tickets FOR SELECT
USING (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND user_belongs_to_restaurant(auth.uid(), s.restaurant_id)
));

CREATE POLICY "Users can create correction tickets"
ON public.cogs_correction_tickets FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND user_belongs_to_restaurant(auth.uid(), s.restaurant_id)
) AND requested_by = auth.uid());

CREATE POLICY "Managers can update correction tickets"
ON public.cogs_correction_tickets FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM daily_cogs_submissions s
  WHERE s.id = submission_id AND (
    has_role(auth.uid(), s.restaurant_id, 'owner'::app_role) OR
    has_role(auth.uid(), s.restaurant_id, 'manager'::app_role)
  )
));

-- RLS for cogs_historical_stats
CREATE POLICY "Users can view historical stats in their restaurant"
ON public.cogs_historical_stats FOR SELECT
USING (user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "System can manage historical stats"
ON public.cogs_historical_stats FOR ALL
USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR
  has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);

-- Indexes for performance
CREATE INDEX idx_cogs_submissions_restaurant_date ON public.daily_cogs_submissions(restaurant_id, submission_date);
CREATE INDEX idx_cogs_submissions_status ON public.daily_cogs_submissions(status);
CREATE INDEX idx_cogs_stock_items_submission ON public.cogs_stock_items(submission_id);
CREATE INDEX idx_cogs_purchases_submission ON public.cogs_purchases(submission_id);
CREATE INDEX idx_cogs_exception_logs_submission ON public.cogs_exception_logs(submission_id);
CREATE INDEX idx_cogs_historical_restaurant ON public.cogs_historical_stats(restaurant_id, stat_date);

-- Trigger for auto-calculating COGS on update
CREATE OR REPLACE FUNCTION public.calculate_cogs_values()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate total sales
  NEW.total_sales := COALESCE(NEW.cash_sales, 0) + COALESCE(NEW.card_sales, 0) + COALESCE(NEW.online_sales, 0);
  
  -- Calculate COGS: Opening Stock + Purchases - Closing Stock
  NEW.cogs := COALESCE(NEW.opening_stock_value, 0) + COALESCE(NEW.purchases_value, 0) - COALESCE(NEW.closing_stock_value, 0);
  
  -- Calculate Food Cost %
  IF NEW.total_sales > 0 THEN
    NEW.food_cost_percentage := (NEW.cogs / NEW.total_sales) * 100;
  ELSE
    NEW.food_cost_percentage := 0;
  END IF;
  
  -- Calculate variance if theoretical COGS exists
  IF NEW.theoretical_cogs > 0 THEN
    NEW.variance_value := NEW.cogs - NEW.theoretical_cogs;
    NEW.variance_percentage := (NEW.variance_value / NEW.theoretical_cogs) * 100;
  END IF;
  
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trigger_calculate_cogs
BEFORE INSERT OR UPDATE ON public.daily_cogs_submissions
FOR EACH ROW
EXECUTE FUNCTION public.calculate_cogs_values();